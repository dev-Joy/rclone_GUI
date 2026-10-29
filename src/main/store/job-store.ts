/**
 * 동기화 작업(Job) 저장소 (SQLite jobs 테이블, INT-002 T-01).
 *
 * - 사용자 수정(create/update)은 rev +1, updatedAt 갱신, 경로 안전 규칙(S1~S4a) 검사.
 * - 실행 기록·스케줄 같은 관리 필드(lastRun, autoSync.nextRunAt/lastAutoRunAt)는
 *   setBookkeeping으로만 바꾸고 rev/updatedAt을 건드리지 않는다(비교 계획 토큰 보호).
 *   단, 자동 실행을 켜고 끄거나 주기를 바꾸면 nextRunAt을 다시 정한다(nextRunAfterEdit, MVP_SPEC §10.2).
 * - 목록은 메모리 캐시로 동기 조회한다. 쓰기는 행 단위 SQL이고, 커밋에 성공한 뒤에만
 *   캐시를 바꾸고 onChange를 부른다. 읽을 수 없는 행은 건너뛰되 지우지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { randomUUID } from "node:crypto";
import { z } from "zod";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { nowIso } from "@/main/lib/time";
import type { clsSqliteDb } from "@/main/store/sqlite-db";
import type { itfAppNotice } from "@/shared/ipc-contract";
import { checkPathPair } from "@/shared/path-utils";
import { nextRunAfterEdit } from "@/shared/schedule";
import {
    zJob,
    zJobDraft,
    zJobPatch,
    type typJob,
    type typJobDraft,
    type typJobPatch,
} from "@/shared/schemas/job";

export const MAX_JOB_NAME = 80;
export const COPY_SUFFIX = " (복사)";

export interface itfJobBookkeeping {
    lastRun?: typJob["lastRun"];
    nextRunAt?: string | null;
    lastAutoRunAt?: string | null;
}

export interface itfJobStoreOptions {
    db: clsSqliteDb;
    /** 경로 비교 시 대소문자 무시 여부 (설정값을 매번 읽는다) */
    caseInsensitive: () => boolean;
    onNotice?: (n: itfAppNotice) => void;
    onChange?: (jobs: typJob[]) => void;
}

const zDataRow = z.object({ data: z.string() });

const SQL_SELECT_ALL = "SELECT data FROM jobs ORDER BY seq";
const SQL_INSERT =
    "INSERT INTO jobs (id, name, rev, created_at, updated_at, data) VALUES ($id, $name, $rev, $createdAt, $updatedAt, $data)";
const SQL_UPDATE =
    "UPDATE jobs SET name = $name, rev = $rev, created_at = $createdAt, updated_at = $updatedAt, data = $data WHERE id = $id";
const SQL_DELETE = "DELETE FROM jobs WHERE id = $id";

/** DB 행 값. 전체 작업은 data(JSON)에, 조회용 열은 따로 둔다 */
function f_Row(job: typJob): Record<string, string | number> {
    return {
        id: job.id,
        name: job.name,
        rev: job.rev,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        data: JSON.stringify(job),
    };
}

/** data 열 → 작업. JSON·스키마가 맞지 않으면 null */
function f_ParseRow(row: unknown): typJob | null {
    const r = zDataRow.safeParse(row);
    if (!r.success) return null;
    try {
        const parsed = zJob.safeParse(JSON.parse(r.data.data));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export class clsJobStore {
    private readonly db: clsSqliteDb;
    private readonly opts: itfJobStoreOptions;
    private jobs: typJob[] = [];

    constructor(opts: itfJobStoreOptions) {
        this.opts = opts;
        this.db = opts.db;
    }

    async load(): Promise<typJob[]> {
        const rows = this.db.all(SQL_SELECT_ALL);
        const jobs: typJob[] = [];
        let skipped = 0;
        for (const row of rows) {
            const job = f_ParseRow(row);
            if (job) jobs.push(job);
            else skipped += 1;
        }
        if (skipped > 0) {
            this.opts.onNotice?.({
                level: "error",
                message: `작업 목록에서 읽을 수 없는 작업 ${skipped}개를 건너뛰었습니다. 저장된 값은 지우지 않았습니다.`,
            });
        }
        this.jobs = jobs;
        return this.jobs;
    }

    list(): typJob[] {
        return this.jobs;
    }

    get(id: string): typJob {
        const job = this.list().find((j) => j.id === id);
        if (!job) throw new clsAppError("NOT_FOUND", "작업을 찾을 수 없습니다.");
        return job;
    }

    async create(draftInput: typJobDraft): Promise<typJob> {
        const draft = zJobDraft.parse(draftInput);
        this.assertPaths(draft.source, draft.destination);
        const now = nowIso();
        const job: typJob = {
            ...draft,
            id: randomUUID(),
            autoSync: {
                ...draft.autoSync,
                nextRunAt: nextRunAfterEdit(null, draft.autoSync, new Date(now)),
                lastAutoRunAt: null,
            },
            rev: 0,
            createdAt: now,
            updatedAt: now,
            lastRun: null,
        };
        return this.insert(job);
    }

    async update(id: string, patchInput: typJobPatch): Promise<typJob> {
        const patch = zJobPatch.parse(patchInput);
        const job = this.get(id);
        const now = nowIso();
        // 관리 필드(nextRunAt/lastAutoRunAt)는 화면 입력으로 바꾸지 않는다.
        // 켜고 끄거나 주기를 바꾼 경우에만 nextRunAt을 다시 정한다
        const autoSync = patch.autoSync ? { ...job.autoSync, ...patch.autoSync } : job.autoSync;
        const next: typJob = {
            ...job,
            ...patch,
            options: patch.options ?? job.options,
            autoSync: {
                ...autoSync,
                nextRunAt: nextRunAfterEdit(job.autoSync, autoSync, new Date(now)),
            },
            rev: job.rev + 1,
            updatedAt: now,
        };
        this.assertPaths(next.source, next.destination);
        return this.replace(next);
    }

    async remove(id: string): Promise<void> {
        this.get(id);
        this.db.run(SQL_DELETE, { id });
        this.jobs = this.jobs.filter((j) => j.id !== id);
        this.opts.onChange?.(this.jobs);
    }

    async duplicate(id: string): Promise<typJob> {
        const src = this.get(id);
        const now = nowIso();
        const base = src.name.slice(0, MAX_JOB_NAME - COPY_SUFFIX.length);
        const copy: typJob = {
            ...structuredClone(src),
            id: randomUUID(),
            name: `${base}${COPY_SUFFIX}`,
            autoSync: {
                ...src.autoSync,
                nextRunAt: nextRunAfterEdit(null, src.autoSync, new Date(now)),
                lastAutoRunAt: null,
            },
            rev: 0,
            createdAt: now,
            updatedAt: now,
            lastRun: null,
        };
        return this.insert(copy);
    }

    /** 실행 결과·스케줄 기록. rev/updatedAt은 바꾸지 않는다 */
    async setBookkeeping(id: string, b: itfJobBookkeeping): Promise<typJob> {
        const job = this.get(id);
        return this.replace({
            ...job,
            lastRun: b.lastRun === undefined ? job.lastRun : b.lastRun,
            autoSync: {
                ...job.autoSync,
                nextRunAt: b.nextRunAt === undefined ? job.autoSync.nextRunAt : b.nextRunAt,
                lastAutoRunAt:
                    b.lastAutoRunAt === undefined ? job.autoSync.lastAutoRunAt : b.lastAutoRunAt,
            },
        });
    }

    private assertPaths(source: string, destination: string): void {
        const { errors } = checkPathPair(source, destination, this.opts.caseInsensitive());
        const first = errors[0];
        if (first) {
            throw new clsAppError(
                first.code,
                first.message,
                errors.map((e) => e.message).join("\n"),
            );
        }
    }

    /** 검증 → INSERT → 캐시 → onChange (DB 실패 시 캐시는 그대로) */
    private insert(jobInput: typJob): typJob {
        const job = zJob.parse(jobInput);
        this.db.run(SQL_INSERT, f_Row(job));
        this.jobs = [...this.jobs, job];
        this.opts.onChange?.(this.jobs);
        return job;
    }

    /** 검증 → UPDATE(id) → 캐시 → onChange (DB 실패 시 캐시는 그대로) */
    private replace(jobInput: typJob): typJob {
        const job = zJob.parse(jobInput);
        const { changes } = this.db.run(SQL_UPDATE, f_Row(job));
        if (changes === 0) throw new clsAppError("NOT_FOUND", "작업을 찾을 수 없습니다.");
        this.jobs = this.jobs.map((j) => (j.id === job.id ? job : j));
        this.opts.onChange?.(this.jobs);
        return job;
    }
}
