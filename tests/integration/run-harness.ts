/**
 * 실행 통합 테스트 공용 준비. 임시 폴더와 임시 rclone.conf(alias remote)만 쓰고,
 * 실제 저장소(작업·이력·active-run)와 비교·실행 서비스를 임시 userData로 만든다.
 * 저장소 DB(SQLite)는 openAppDb로 열고, 테스트가 끝나면 닫는다(Windows는 열린 파일을 지울 수 없다).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    statSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { expect, onTestFinished } from "vitest";

// ========== Internal imports ==========
import { clsRcloneEnv } from "@/main/rclone/detect";
import { runRclone, type typRunRclone } from "@/main/rclone/process";
import { clsActivityLock } from "@/main/services/activity-lock";
import { clsCompareService } from "@/main/services/compare-service";
import { clsPathService } from "@/main/services/path-service";
import { clsActiveRunStore } from "@/main/services/run-recovery";
import { clsRunService } from "@/main/services/run-service";
import { openAppDb } from "@/main/store/app-db";
import { clsHistoryStore } from "@/main/store/history-store";
import { clsJobStore } from "@/main/store/job-store";
import { createDefaultSettings } from "@/shared/defaults";
import type { typRunMode } from "@/shared/schemas/common";
import type { typJob, typJobDraft, typJobRunOptions } from "@/shared/schemas/job";
import type { typRunRecord } from "@/shared/schemas/run";
import type { itfDryRunSummary, typRunEvent } from "@/shared/types/run";

export const RCLONE = process.env.RCLONEGUI_TEST_RCLONE ?? "rclone";
const probe = spawnSync(RCLONE, ["version"], { shell: false, windowsHide: true, encoding: "utf8" });
export const HAS_RCLONE = probe.status === 0;
if (!HAS_RCLONE) {
    console.warn(
        `[test:int] rclone을 실행할 수 없어 건너뜁니다 (${RCLONE}): ${probe.error?.message ?? probe.stderr}`,
    );
}

export const OLD = new Date("2026-01-01T00:00:00Z");
export const NEWER = new Date(OLD.getTime() + 10 * 60_000);
export const ALIAS = "it-run";
const LOGGER = { info: () => undefined, warn: () => undefined, error: () => undefined };
const MANUAL_BIN = process.env.RCLONEGUI_TEST_RCLONE ?? null;

export function makeRoot(prefix: string): { root: string; conf: string } {
    const root = mkdtempSync(join(tmpdir(), prefix));
    const conf = join(root, "rclone.conf");
    // 테스트 준비용 설정 파일. 앱 코드는 이 파일을 읽지 않고 경로만 --config로 넘긴다
    writeFileSync(conf, `[${ALIAS}]\ntype = alias\nremote = ${root}\n`);
    return { root, conf };
}

export function writeFile(path: string, text: string | Buffer, mtime = OLD): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    utimesSync(path, mtime, mtime);
}

/** 폴더 안 파일: 상대 경로("/") → 내용·수정시간 */
export function snapshotTree(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else {
                const rel = relative(dir, p).replaceAll("\\", "/");
                out[rel] = `${readFileSync(p, "utf8")}@${Math.round(statSync(p).mtimeMs)}`;
            }
        }
    };
    walk(dir);
    return out;
}

export interface itfEnvOptions {
    root: string;
    conf: string;
    source: string;
    destination: string;
    mode: typRunMode;
    options?: Partial<typJobRunOptions>;
    /** 자동 실행 설정(기본: 꺼짐) */
    autoSync?: Partial<typJobDraft["autoSync"]>;
    /** runRclone을 감싸 출력·취소 시점을 조작할 때 */
    wrapRun?: (run: typRunRclone, runs: () => clsRunService) => typRunRclone;
}

let envNo = 0;

export async function makeEnv(o: itfEnvOptions) {
    envNo += 1;
    const userData = join(o.root, `userdata-${envNo}`);
    mkdirSync(userData, { recursive: true });
    const settings = createDefaultSettings();
    const settingsSource = { get: () => settings };
    const { db } = await openAppDb({ userDataDir: userData });
    onTestFinished(() => db.close());
    const jobs = new clsJobStore({ db, caseInsensitive: () => true });
    await jobs.load();
    const { excludes, ...defaults } = settings.defaults;
    const job: typJob = await jobs.create({
        name: "실행 통합",
        notes: "",
        source: o.source,
        destination: o.destination,
        mode: o.mode,
        excludes: [...excludes, "*.tmp"],
        options: { ...defaults, ...o.options },
        configPathOverride: null,
        autoSync: { enabled: false, intervalMinutes: 60, allowDeletes: false, ...o.autoSync },
    });
    const history = new clsHistoryStore(db, () => 500);
    await history.load();
    const rcloneEnv = new clsRcloneEnv({
        getSettings: () => ({ rclonePath: MANUAL_BIN, configPath: o.conf }),
        logger: LOGGER,
        env: { ...process.env, RCLONE_CONFIG: undefined },
    });
    const pathService = new clsPathService({ rcloneEnv });
    const activity = new clsActivityLock();
    const compare = new clsCompareService({
        jobs,
        settings: settingsSource,
        rcloneEnv,
        pathService,
        activity,
        logger: LOGGER,
    });
    const activeRun = new clsActiveRunStore(userData);
    const events: typRunEvent[] = [];
    const holder: { runs: clsRunService | null } = { runs: null };
    const runFn = o.wrapRun ? o.wrapRun(runRclone, () => holder.runs!) : runRclone;
    const logsDir = join(userData, "logs");
    const runs = new clsRunService({
        jobs,
        settings: settingsSource,
        rcloneEnv,
        compare,
        history,
        activity,
        activeRun,
        logsDir,
        logger: LOGGER,
        run: runFn,
        emit: (e) => events.push(e),
    });
    holder.runs = runs;

    /** 실행이 끝날 때까지 기다리고 finished 이벤트를 돌려준다 */
    const waitFinished = async (
        runId: string,
    ): Promise<{ record: typRunRecord; dryRunSummary: itfDryRunSummary | null }> => {
        expect(await runs.whenIdle(60_000)).toBe(true);
        const fin = events.filter((e) => e.type === "finished" && e.runId === runId);
        expect(fin).toHaveLength(1);
        const e = fin[0]!;
        if (e.type !== "finished") throw new Error("finished 아님");
        return { record: e.record, dryRunSummary: e.dryRunSummary };
    };

    return {
        /** 테스트가 고칠 수 있는 설정(안전 임계값 등) */
        settings,
        userData,
        db,
        logsDir,
        job,
        jobs,
        history,
        compare,
        runs,
        events,
        activeRunFile: join(userData, "active-run.json"),
        waitFinished,
    };
}
