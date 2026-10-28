/**
 * 화면 스토어 테스트용 가짜 window.rclonegui. jobs CRUD와 설정은 메모리에서 처리하고
 * 경로 검사는 main과 같은 checkPathPair로 SAFETY_BLOCKED 등을 돌려준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { createDefaultSettings } from "@/shared/defaults";
import { ERROR_MESSAGES, type typErrorCode } from "@/shared/errors";
import type { itfJobsChangedEvent, itfRcloneGuiApi } from "@/shared/ipc-contract";
import { checkPathPair } from "@/shared/path-utils";
import type { typApiResult } from "@/shared/schemas/common";
import type { typJob, typJobDraft } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";

export interface itfFakeApi {
    api: itfRcloneGuiApi;
    /** 호출된 메서드 이름 ("jobs.create" 등) */
    calls: string[];
    /** main의 jobs:changed 이벤트를 흉내 낸다 */
    emitJobsChanged: (jobs: typJob[]) => void;
    /** 현재 메모리 목록 */
    jobs: () => typJob[];
    /** 다음 listRemotes 응답을 직접 제어 (configPath별 resolve 함수) */
    remotesResolvers: Array<{ configPath: string | null; resolve: (v: string[]) => void }>;
}

let uuidSeq = 0;

export function fakeUuid(n: number): string {
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function makeJob(over: Partial<typJob> = {}): typJob {
    uuidSeq += 1;
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: fakeUuid(1000 + uuidSeq),
        name: "작업",
        notes: "",
        source: "C:\\tmp\\src",
        destination: "D:\\tmp\\dst",
        mode: "copy",
        excludes: [...excludes],
        options,
        configPathOverride: null,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 0,
        createdAt: "2026-10-28T00:00:00.000Z",
        updatedAt: "2026-10-28T00:00:00.000Z",
        lastRun: null,
        ...over,
    };
}

function f_Ok<T>(data: T): Promise<typApiResult<T>> {
    return Promise.resolve({ ok: true, data });
}

function f_Fail<T>(code: typErrorCode, message?: string): Promise<typApiResult<T>> {
    return Promise.resolve({
        ok: false,
        error: { code, message: message ?? ERROR_MESSAGES[code] },
    });
}

/** main의 job-store처럼 경로 안전 규칙 위반을 envelope로 돌려준다 */
function f_PathError(source: string, destination: string): Promise<typApiResult<typJob>> | null {
    const first = checkPathPair(source, destination, true).errors[0];
    return first ? f_Fail(first.code, first.message) : null;
}

export function createFakeApi(seed: typJob[] = []): itfFakeApi {
    let jobs = seed.map((j) => structuredClone(j));
    let settings: typSettings = createDefaultSettings();
    const calls: string[] = [];
    const listeners = new Set<(e: itfJobsChangedEvent) => void>();
    const remotesResolvers: itfFakeApi["remotesResolvers"] = [];
    // 시드(fakeUuid(1~99))와 겹치지 않게 100부터
    let seq = 100;

    function f_Notify(): void {
        for (const l of listeners) l({ jobs: structuredClone(jobs) });
    }

    const notImplemented = <T>(name: string) => {
        calls.push(name);
        return f_Fail<T>("INTERNAL");
    };

    const api: itfRcloneGuiApi = {
        app: {
            getInfo: () => notImplemented("app.getInfo"),
            getNotices: () => notImplemented("app.getNotices"),
            openLogsFolder: () => notImplemented("app.openLogsFolder"),
        },
        settings: {
            get: () => {
                calls.push("settings.get");
                return f_Ok(structuredClone(settings));
            },
            update: (patch) => {
                calls.push("settings.update");
                settings = { ...settings, ...structuredClone(patch) } as typSettings;
                return f_Ok(structuredClone(settings));
            },
        },
        jobs: {
            list: () => {
                calls.push("jobs.list");
                return f_Ok(structuredClone(jobs));
            },
            create: (draft: typJobDraft) => {
                calls.push("jobs.create");
                const bad = f_PathError(draft.source, draft.destination);
                if (bad) return bad;
                seq += 1;
                const job = makeJob({
                    ...structuredClone(draft),
                    id: fakeUuid(seq),
                    autoSync: { ...draft.autoSync, nextRunAt: null, lastAutoRunAt: null },
                });
                jobs = [...jobs, job];
                f_Notify();
                return f_Ok(structuredClone(job));
            },
            update: (id, patch) => {
                calls.push("jobs.update");
                const cur = jobs.find((j) => j.id === id);
                if (!cur) return f_Fail("NOT_FOUND");
                const next: typJob = {
                    ...cur,
                    ...structuredClone(patch),
                    autoSync: { ...cur.autoSync, ...patch.autoSync },
                    rev: cur.rev + 1,
                };
                const bad = f_PathError(next.source, next.destination);
                if (bad) return bad;
                jobs = jobs.map((j) => (j.id === id ? next : j));
                f_Notify();
                return f_Ok(structuredClone(next));
            },
            remove: (id) => {
                calls.push("jobs.remove");
                if (!jobs.some((j) => j.id === id)) return f_Fail("NOT_FOUND");
                jobs = jobs.filter((j) => j.id !== id);
                f_Notify();
                return f_Ok(null);
            },
            duplicate: (id) => {
                calls.push("jobs.duplicate");
                const cur = jobs.find((j) => j.id === id);
                if (!cur) return f_Fail("NOT_FOUND");
                seq += 1;
                const copy = {
                    ...structuredClone(cur),
                    id: fakeUuid(seq),
                    name: `${cur.name} (복사)`,
                    rev: 0,
                };
                jobs = [...jobs, copy];
                f_Notify();
                return f_Ok(structuredClone(copy));
            },
        },
        rclone: {
            detect: () => notImplemented("rclone.detect"),
            listRemotes: (configPath) => {
                calls.push(`rclone.listRemotes:${configPath ?? "null"}`);
                return new Promise((resolve) => {
                    remotesResolvers.push({
                        configPath: configPath ?? null,
                        resolve: (v) => resolve({ ok: true, data: v }),
                    });
                });
            },
            testPath: () => notImplemented("rclone.testPath"),
        },
        wsl: { listDistros: () => notImplemented("wsl.listDistros") },
        dialog: {
            pickDirectory: () => notImplemented("dialog.pickDirectory"),
            pickFile: () => notImplemented("dialog.pickFile"),
        },
        system: { openExternal: () => notImplemented("system.openExternal") },
        events: {
            onJobsChanged: (cb) => {
                listeners.add(cb);
                return () => listeners.delete(cb);
            },
        },
    };

    return {
        api,
        calls,
        emitJobsChanged: (next) => {
            jobs = structuredClone(next);
            f_Notify();
        },
        jobs: () => structuredClone(jobs),
        remotesResolvers,
    };
}
