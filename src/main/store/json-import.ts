/**
 * 예전 JSON 저장 파일(settings.json·jobs.json·history.json)을 SQLite로 한 번 옮긴다 (INT-002 T-01).
 *
 * - 이미 옮겼으면(meta.json_import) 다시 가져오지 않는다. 그때 원래 이름 JSON이 남아 있으면 알리기만 한다.
 * - 읽기는 기존 clsJsonStore를 그대로 쓴다(.bak 복구·.corrupt 격리·.unsupported 보관 동작 동일).
 * - 중복 id는 작업은 먼저 나온 것, 이력은 최신(앞쪽) 것을 남기고 건너뛴 수를 센다.
 * - 쓰기는 한 트랜잭션: 설정 행(없으면 기본값) → 작업(파일 순서) → 이력(오래된 것부터, seq 내림차순 = 기존 최신순)
 *   → 개수 확인 → meta.json_import. 실패하면 ROLLBACK하고 JSON은 그대로 두고 throw.
 * - 커밋 뒤 있던 파일만 X.json → X.json.migrated, X.json.bak → X.json.bak.migrated로 바꾼다
 *   (대상이 있으면 .migrated-<시각>). active-run.json·*.corrupt-*·*.unsupported-*·rclonegui.db는 건드리지 않는다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { fileStamp, nowIso } from "@/main/lib/time";
import { clsJsonStore, renameWithRetry } from "@/main/store/json-store";
import { deepMerge } from "@/main/store/settings-store";
import type { clsSqliteDb } from "@/main/store/sqlite-db";
import { createDefaultSettings } from "@/shared/defaults";
import type { itfAppNotice } from "@/shared/ipc-contract";
import { zJobsFile, type typJob } from "@/shared/schemas/job";
import { zHistoryFile, type typRunRecord } from "@/shared/schemas/run";
import { zSettings } from "@/shared/schemas/settings";

export const LEGACY_FILES = ["settings.json", "jobs.json", "history.json"] as const;

export interface itfJsonImportReport {
    /** json: 예전 파일이 하나라도 있었음, none: 새 설치 */
    source: "json" | "none";
    jobs: number;
    runs: number;
    /** 설정 파일을 가져왔는지(없으면 기본값 행) */
    settings: boolean;
    skippedDuplicates: number;
    /** 바꾼 파일 이름(새 이름) */
    renamed: string[];
    /** 이름을 바꾸지 못한 원래 파일 이름 */
    renameFailed: string[];
}

const META_KEY = "json_import";
const zCountRow = z.object({ n: z.union([z.number(), z.bigint()]) });

const SQL_META_GET = "SELECT value FROM meta WHERE key = $key";
const SQL_META_SET = "INSERT INTO meta (key, value) VALUES ($key, $value)";
const SQL_SETTINGS = "INSERT INTO settings (id, data, updated_at) VALUES (1, $data, $updatedAt)";
const SQL_JOB =
    "INSERT INTO jobs (id, name, rev, created_at, updated_at, data) VALUES ($id, $name, $rev, $createdAt, $updatedAt, $data)";
const SQL_RUN =
    "INSERT INTO run_records (id, job_id, status, started_at, log_file, data) VALUES ($id, $jobId, $status, $startedAt, $logFile, $data)";
const SQL_COUNT_JOBS = "SELECT COUNT(*) AS n FROM jobs";
const SQL_COUNT_RUNS = "SELECT COUNT(*) AS n FROM run_records";

/** 본 파일이나 .bak이 있는지 */
function f_Present(file: string): boolean {
    return existsSync(file) || existsSync(`${file}.bak`);
}

/** 같은 id는 처음 나온 것만 남긴다. 건너뛴 수를 함께 돌려준다 */
function f_Dedupe<T extends { id: string }>(items: readonly T[]): { kept: T[]; skipped: number } {
    const seen = new Set<string>();
    const kept: T[] = [];
    for (const it of items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        kept.push(it);
    }
    return { kept, skipped: items.length - kept.length };
}

function f_Count(db: clsSqliteDb, sql: string): number {
    return Number(zCountRow.parse(db.get(sql)).n);
}

/** 커밋 뒤 파일 이름 바꾸기. 실패해도 이전은 끝난 것이므로 알리기만 한다 */
async function f_RenameMigrated(
    userDataDir: string,
    onNotice: ((n: itfAppNotice) => void) | undefined,
): Promise<{ renamed: string[]; renameFailed: string[] }> {
    const renamed: string[] = [];
    const renameFailed: string[] = [];
    for (const name of LEGACY_FILES) {
        for (const from of [name, `${name}.bak`]) {
            const path = join(userDataDir, from);
            if (!existsSync(path)) continue;
            let to = `${from}.migrated`;
            if (existsSync(join(userDataDir, to))) to = `${from}.migrated-${fileStamp()}`;
            try {
                await renameWithRetry(path, join(userDataDir, to));
                renamed.push(to);
            } catch {
                renameFailed.push(from);
            }
        }
    }
    if (renameFailed.length > 0) {
        onNotice?.({
            level: "warning",
            message: `예전 저장 파일을 새 저장소로 옮겼지만 ${renameFailed.join(", ")} 의 이름을 바꾸지 못했습니다. 이 파일은 다시 읽지 않으니 지워도 됩니다.`,
        });
    }
    return { renamed, renameFailed };
}

/**
 * 예전 JSON을 한 번 가져온다. 이미 가져왔으면 null.
 * 트랜잭션이 실패하면 JSON 파일은 원래 이름 그대로 두고 throw한다.
 */
export async function importLegacyJson(
    db: clsSqliteDb,
    userDataDir: string,
    onNotice?: (n: itfAppNotice) => void,
): Promise<itfJsonImportReport | null> {
    if (db.get(SQL_META_GET, { key: META_KEY }) !== undefined) {
        const left = LEGACY_FILES.filter((name) => existsSync(join(userDataDir, name)));
        if (left.length > 0) {
            onNotice?.({
                level: "warning",
                message: `${left.join(", ")} 파일이 있지만 이미 새 저장소로 옮긴 뒤라 읽지 않았습니다. 예전 파일 내용으로 되돌리려면 README의 'SQLite 이전과 되돌리기'를 보세요.`,
            });
        }
        return null;
    }

    // 1) 읽기(트랜잭션 밖). 손상·버전 처리는 기존 JSON 저장소와 같다
    const files = {
        settings: join(userDataDir, "settings.json"),
        jobs: join(userDataDir, "jobs.json"),
        history: join(userDataDir, "history.json"),
    };
    const present = {
        settings: f_Present(files.settings),
        jobs: f_Present(files.jobs),
        history: f_Present(files.history),
    };
    const noticeOpt = onNotice ? { onNotice } : {};
    const settings = present.settings
        ? await new clsJsonStore({
              file: files.settings,
              label: "설정",
              schema: zSettings,
              createDefault: createDefaultSettings,
              prepare: (data) => deepMerge(createDefaultSettings(), data),
              ...noticeOpt,
          }).load()
        : createDefaultSettings();
    const jobsFile = present.jobs
        ? await new clsJsonStore({
              file: files.jobs,
              label: "작업 목록",
              schema: zJobsFile,
              createDefault: () => ({ version: 1 as const, jobs: [] }),
              ...noticeOpt,
          }).load()
        : { version: 1 as const, jobs: [] };
    const historyFile = present.history
        ? await new clsJsonStore({
              file: files.history,
              label: "실행 이력",
              schema: zHistoryFile,
              createDefault: () => ({ version: 1 as const, records: [] }),
              ...noticeOpt,
          }).load()
        : { version: 1 as const, records: [] };

    // 2) 중복 정리: 작업은 먼저 나온 것, 이력은 최신순 파일의 앞쪽(최신) 것
    const jobs = f_Dedupe<typJob>(jobsFile.jobs);
    const runs = f_Dedupe<typRunRecord>(historyFile.records);
    const skippedDuplicates = jobs.skipped + runs.skipped;
    const source = present.settings || present.jobs || present.history ? "json" : "none";

    // 3) 한 트랜잭션으로 쓰기
    const at = nowIso();
    db.transaction(() => {
        db.run(SQL_SETTINGS, { data: JSON.stringify(settings), updatedAt: at });
        for (const job of jobs.kept) {
            db.run(SQL_JOB, {
                id: job.id,
                name: job.name,
                rev: job.rev,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
                data: JSON.stringify(job),
            });
        }
        // 오래된 것부터 넣어 seq 내림차순이 기존 최신순과 같게 한다
        for (const r of runs.kept.toReversed()) {
            db.run(SQL_RUN, {
                id: r.id,
                jobId: r.jobId,
                status: r.status,
                startedAt: r.startedAt,
                logFile: r.logFile,
                data: JSON.stringify(r),
            });
        }
        const jobCount = f_Count(db, SQL_COUNT_JOBS);
        const runCount = f_Count(db, SQL_COUNT_RUNS);
        if (jobCount !== jobs.kept.length || runCount !== runs.kept.length) {
            throw new clsAppError(
                "STORE_ERROR",
                "예전 저장 파일을 옮기는 중 개수가 맞지 않아 취소했습니다.",
                `jobs ${jobCount}/${jobs.kept.length}, runs ${runCount}/${runs.kept.length}`,
            );
        }
        db.run(SQL_META_SET, {
            key: META_KEY,
            value: JSON.stringify({
                at,
                source,
                counts: { jobs: jobCount, runs: runCount, settings: present.settings },
                skippedDuplicates,
            }),
        });
    });

    // 4) 커밋 뒤 있던 파일만 이름 바꾸기
    const { renamed, renameFailed } = await f_RenameMigrated(userDataDir, onNotice);
    return {
        source,
        jobs: jobs.kept.length,
        runs: runs.kept.length,
        settings: present.settings,
        skippedDuplicates,
        renamed,
        renameFailed,
    };
}
