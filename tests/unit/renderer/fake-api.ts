/**
 * 화면 스토어 테스트용 가짜 window.rclonegui. jobs CRUD와 설정은 메모리에서 처리하고
 * 경로 검사는 main과 같은 checkPathPair로 SAFETY_BLOCKED 등을 돌려준다.
 * 비교(compare.*)는 응답을 테스트가 직접 제어한다(run·get resolver, active, 진행 이벤트).
 * 실행(run.*)은 start 응답·getActive 값을 테스트가 정하고, run:event를 직접 보낸다.
 * 이력(history.*)은 테스트가 넣은 레코드·로그를 돌려주고, 스케줄러 상태·app:notify 이벤트도 직접 보낸다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { createDefaultSettings } from "@/shared/defaults";
import { ERROR_MESSAGES, type typErrorCode } from "@/shared/errors";
import type { itfJobsChangedEvent, itfRcloneGuiApi } from "@/shared/ipc-contract";
import type {
    itfCompareActive,
    itfCompareProgress,
    itfCompareResult,
} from "@/shared/types/compare";
import { checkPathPair } from "@/shared/path-utils";
import type { typApiResult, typAppErrorPayload } from "@/shared/schemas/common";
import type { typJob, typJobDraft } from "@/shared/schemas/job";
import type { typHistoryListInput } from "@/shared/schemas/history";
import type { typRunRecord, typStartRunInput } from "@/shared/schemas/run";
import type { typSettings } from "@/shared/schemas/settings";
import type { itfRunLogView } from "@/shared/types/history";
import type { itfRunSnapshot, typRunEvent } from "@/shared/types/run";
import type { itfAppNotify, itfSchedulerState } from "@/shared/types/scheduler";

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
    /** compare.run 응답 제어 */
    compareRunResolvers: Array<{
        jobId: string;
        resolve: (r: typApiResult<itfCompareResult>) => void;
    }>;
    /** compare.get 응답 제어 */
    compareGetResolvers: Array<{
        jobId: string;
        resolve: (r: itfCompareResult | null) => void;
    }>;
    /** compare.getActive 응답 */
    setCompareActive: (a: itfCompareActive | null) => void;
    /** main의 compare:progress 이벤트를 흉내 낸다 */
    emitCompareProgress: (e: itfCompareProgress) => void;
    /** run.start에 넘어온 입력 */
    runStartInputs: typStartRunInput[];
    /** 다음 run.start 응답(기본: 성공, runId fakeUuid(9001)) */
    setRunStartResult: (r: typApiResult<{ runId: string }>) => void;
    /** run.getActive 응답 */
    setRunActive: (a: itfRunSnapshot | null) => void;
    /** main의 run:event 이벤트를 흉내 낸다 */
    emitRunEvent: (e: typRunEvent) => void;
    /** history.list가 돌려줄 레코드(최신순) */
    setHistory: (records: typRunRecord[]) => void;
    /** history.list에 넘어온 조건 */
    historyQueries: typHistoryListInput[];
    /** history.readLog 응답(runId별). 없으면 NOT_FOUND */
    setLogView: (runId: string, view: itfRunLogView) => void;
    /** 다음 history.clear 응답 실패(예: BUSY) */
    setHistoryClearError: (e: typAppErrorPayload | null) => void;
    setSchedulerState: (s: itfSchedulerState) => void;
    emitSchedulerState: (s: itfSchedulerState) => void;
    emitAppNotify: (n: itfAppNotify) => void;
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
    const compareRunResolvers: itfFakeApi["compareRunResolvers"] = [];
    const compareGetResolvers: itfFakeApi["compareGetResolvers"] = [];
    const progressListeners = new Set<(e: itfCompareProgress) => void>();
    let compareActive: itfCompareActive | null = null;
    const runListeners = new Set<(e: typRunEvent) => void>();
    const runStartInputs: typStartRunInput[] = [];
    let runStartResult: typApiResult<{ runId: string }> = {
        ok: true,
        data: { runId: fakeUuid(9001) },
    };
    let runActive: itfRunSnapshot | null = null;
    let history: typRunRecord[] = [];
    const historyQueries: typHistoryListInput[] = [];
    const logViews = new Map<string, itfRunLogView>();
    let historyClearError: typAppErrorPayload | null = null;
    let schedulerState: itfSchedulerState = { paused: false, running: null, next: null };
    const schedulerListeners = new Set<(e: itfSchedulerState) => void>();
    const notifyListeners = new Set<(e: itfAppNotify) => void>();
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
        compare: {
            run: (jobId) => {
                calls.push(`compare.run:${jobId}`);
                return new Promise((resolve) => compareRunResolvers.push({ jobId, resolve }));
            },
            cancel: (jobId) => {
                calls.push(`compare.cancel:${jobId}`);
                return f_Ok(null);
            },
            get: (jobId) => {
                calls.push(`compare.get:${jobId}`);
                return new Promise((resolve) =>
                    compareGetResolvers.push({
                        jobId,
                        resolve: (r) => resolve({ ok: true, data: r }),
                    }),
                );
            },
            getActive: () => {
                calls.push("compare.getActive");
                return f_Ok(compareActive);
            },
        },
        run: {
            start: (input) => {
                calls.push(`run.start:${input.jobId}:${input.dryRun}`);
                runStartInputs.push(structuredClone(input));
                return Promise.resolve(structuredClone(runStartResult));
            },
            cancel: (runId) => {
                calls.push(`run.cancel:${runId}`);
                return f_Ok(null);
            },
            getActive: () => {
                calls.push("run.getActive");
                return f_Ok(runActive);
            },
        },
        history: {
            list: (query) => {
                calls.push("history.list");
                const q = query ?? {};
                historyQueries.push(structuredClone(q));
                const rows = q.jobId ? history.filter((r) => r.jobId === q.jobId) : history;
                return f_Ok(structuredClone(q.limit ? rows.slice(0, q.limit) : rows));
            },
            get: (runId) => {
                calls.push(`history.get:${runId}`);
                return f_Ok(structuredClone(history.find((r) => r.id === runId) ?? null));
            },
            readLog: (runId) => {
                calls.push(`history.readLog:${runId}`);
                const v = logViews.get(runId);
                return v ? f_Ok(structuredClone(v)) : f_Fail("NOT_FOUND");
            },
            clear: (deleteLogs) => {
                calls.push(`history.clear:${deleteLogs}`);
                if (historyClearError) {
                    return Promise.resolve({ ok: false as const, error: historyClearError });
                }
                const removed = history.filter((r) => r.status !== "running").length;
                history = history.filter((r) => r.status === "running");
                return f_Ok({ removed, deletedLogs: deleteLogs ? removed : 0 });
            },
        },
        scheduler: {
            getState: () => {
                calls.push("scheduler.getState");
                return f_Ok(structuredClone(schedulerState));
            },
            setPaused: (paused) => {
                calls.push(`scheduler.setPaused:${paused}`);
                schedulerState = { ...schedulerState, paused };
                return f_Ok(structuredClone(schedulerState));
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
            onCompareProgress: (cb) => {
                progressListeners.add(cb);
                return () => progressListeners.delete(cb);
            },
            onRunEvent: (cb) => {
                runListeners.add(cb);
                return () => runListeners.delete(cb);
            },
            onSchedulerState: (cb) => {
                schedulerListeners.add(cb);
                return () => schedulerListeners.delete(cb);
            },
            onAppNotify: (cb) => {
                notifyListeners.add(cb);
                return () => notifyListeners.delete(cb);
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
        compareRunResolvers,
        compareGetResolvers,
        setCompareActive: (a) => {
            compareActive = a;
        },
        emitCompareProgress: (e) => {
            for (const l of progressListeners) l(e);
        },
        runStartInputs,
        setRunStartResult: (r) => {
            runStartResult = r;
        },
        setRunActive: (a) => {
            runActive = a;
        },
        emitRunEvent: (e) => {
            for (const l of runListeners) l(e);
        },
        setHistory: (records) => {
            history = structuredClone(records);
        },
        historyQueries,
        setLogView: (runId, view) => {
            logViews.set(runId, view);
        },
        setHistoryClearError: (e) => {
            historyClearError = e;
        },
        setSchedulerState: (st) => {
            schedulerState = st;
        },
        emitSchedulerState: (st) => {
            schedulerState = st;
            for (const l of schedulerListeners) l(st);
        },
        emitAppNotify: (n) => {
            for (const l of notifyListeners) l(n);
        },
    };
}
