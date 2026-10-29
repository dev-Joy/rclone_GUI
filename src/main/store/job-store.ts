/**
 * 동기화 작업(Job) 저장소 (jobs.json).
 *
 * - 사용자 수정(create/update)은 rev +1, updatedAt 갱신, 경로 안전 규칙(S1~S4a) 검사.
 * - 실행 기록·스케줄 같은 관리 필드(lastRun, autoSync.nextRunAt/lastAutoRunAt)는
 *   setBookkeeping으로만 바꾸고 rev/updatedAt을 건드리지 않는다(비교 계획 토큰 보호).
 *   단, 자동 실행을 켜고 끄거나 주기를 바꾸면 nextRunAt을 다시 정한다(nextRunAfterEdit, MVP_SPEC §10.2).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { nowIso } from "@/main/lib/time";
import { clsJsonStore } from "@/main/store/json-store";
import type { itfAppNotice } from "@/shared/ipc-contract";
import { checkPathPair } from "@/shared/path-utils";
import { nextRunAfterEdit } from "@/shared/schedule";
import {
    zJobDraft,
    zJobPatch,
    zJobsFile,
    type typJob,
    type typJobDraft,
    type typJobPatch,
    type typJobsFile,
} from "@/shared/schemas/job";

export const MAX_JOB_NAME = 80;
export const COPY_SUFFIX = " (복사)";

export interface itfJobBookkeeping {
    lastRun?: typJob["lastRun"];
    nextRunAt?: string | null;
    lastAutoRunAt?: string | null;
}

export interface itfJobStoreOptions {
    userDataDir: string;
    /** 경로 비교 시 대소문자 무시 여부 (설정값을 매번 읽는다) */
    caseInsensitive: () => boolean;
    onNotice?: (n: itfAppNotice) => void;
    onChange?: (jobs: typJob[]) => void;
}

export class clsJobStore {
    private readonly store: clsJsonStore<typJobsFile>;
    private readonly opts: itfJobStoreOptions;

    constructor(opts: itfJobStoreOptions) {
        this.opts = opts;
        this.store = new clsJsonStore({
            file: join(opts.userDataDir, "jobs.json"),
            label: "작업 목록",
            schema: zJobsFile,
            createDefault: () => ({ version: 1, jobs: [] }),
            ...(opts.onNotice ? { onNotice: opts.onNotice } : {}),
        });
    }

    async load(): Promise<typJob[]> {
        return (await this.store.load()).jobs;
    }

    list(): typJob[] {
        return this.store.get().jobs;
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
        await this.commit((jobs) => [...jobs, job]);
        return job;
    }

    async update(id: string, patchInput: typJobPatch): Promise<typJob> {
        const patch = zJobPatch.parse(patchInput);
        let updated: typJob | undefined;
        await this.commit((jobs) =>
            jobs.map((job) => {
                if (job.id !== id) return job;
                const now = nowIso();
                // 관리 필드(nextRunAt/lastAutoRunAt)는 화면 입력으로 바꾸지 않는다.
                // 켜고 끄거나 주기를 바꾼 경우에만 nextRunAt을 다시 정한다
                const autoSync = patch.autoSync
                    ? { ...job.autoSync, ...patch.autoSync }
                    : job.autoSync;
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
                updated = next;
                return next;
            }),
        );
        if (!updated) throw new clsAppError("NOT_FOUND", "작업을 찾을 수 없습니다.");
        return updated;
    }

    async remove(id: string): Promise<void> {
        this.get(id);
        await this.commit((jobs) => jobs.filter((j) => j.id !== id));
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
        await this.commit((jobs) => [...jobs, copy]);
        return copy;
    }

    /** 실행 결과·스케줄 기록. rev/updatedAt은 바꾸지 않는다 */
    async setBookkeeping(id: string, b: itfJobBookkeeping): Promise<typJob> {
        let updated: typJob | undefined;
        await this.commit((jobs) =>
            jobs.map((job) => {
                if (job.id !== id) return job;
                updated = {
                    ...job,
                    lastRun: b.lastRun === undefined ? job.lastRun : b.lastRun,
                    autoSync: {
                        ...job.autoSync,
                        nextRunAt: b.nextRunAt === undefined ? job.autoSync.nextRunAt : b.nextRunAt,
                        lastAutoRunAt:
                            b.lastAutoRunAt === undefined
                                ? job.autoSync.lastAutoRunAt
                                : b.lastAutoRunAt,
                    },
                };
                return updated;
            }),
        );
        if (!updated) throw new clsAppError("NOT_FOUND", "작업을 찾을 수 없습니다.");
        return updated;
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

    private async commit(mutate: (jobs: typJob[]) => typJob[]): Promise<void> {
        const file = await this.store.update((cur) => ({ version: 1, jobs: mutate(cur.jobs) }));
        this.opts.onChange?.(file.jobs);
    }
}
