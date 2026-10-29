// ========== External imports ==========
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import {
    clsProcessSpawnError,
    type itfProcessResult,
    type itfRunProcessOptions,
    type typRunRclone,
} from "@/main/rclone/process";
import { clsActivityLock } from "@/main/services/activity-lock";
import type { itfBatcherTimers } from "@/main/services/run-events";
import { clsRunService, type itfRunServiceDeps } from "@/main/services/run-service";
import { createDefaultSettings } from "@/shared/defaults";
import type { typJob } from "@/shared/schemas/job";
import type { typActiveRunFile, typRunRecord } from "@/shared/schemas/run";
import type { itfCompareResult, itfCompareSummary } from "@/shared/types/compare";
import type { typRunEvent } from "@/shared/types/run";
import { fixtureLines } from "./fixtures";

const BIN = "C:\\fake\\rclone.exe";
const CONF = "C:\\fake\\rclone.conf";
const SRC = "C:\\fake\\src";
const DST = "C:\\fake\\dst";
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "f".repeat(32);
const PID = 4242;
const T0 = Date.parse("2026-10-28T00:00:00.000Z");

const logsRoot = mkdtempSync(join(tmpdir(), "rclonegui-runsvc-"));
afterAll(() => rmSync(logsRoot, { recursive: true, force: true }));

function f_Job(over: Partial<typJob> = {}): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: JOB_ID,
        name: "실행 작업",
        notes: "",
        source: SRC,
        destination: DST,
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

function f_Summary(over: Partial<itfCompareSummary> = {}): itfCompareSummary {
    return {
        sourceFiles: 4,
        destFiles: 3,
        createFiles: 2,
        updateFiles: 2,
        deleteFiles: 2,
        sameFiles: 1,
        conflictFiles: 0,
        conflictGroups: 0,
        createBytes: 10,
        updateBytes: 14,
        deleteBytes: 8,
        transferBytes: 24,
        caseOnlyFiles: 0,
        hashComparedFiles: 0,
        hashUnavailableFiles: 0,
        ...over,
    };
}

function f_Compare(over: Partial<itfCompareResult> = {}): itfCompareResult {
    return {
        jobId: JOB_ID,
        jobRev: 0,
        createdAt: new Date(T0).toISOString(),
        durationMs: 1,
        mode: "copy",
        method: { checkHashes: false, modtimeToleranceMs: 2000, caseInsensitive: true },
        destMissing: false,
        summary: f_Summary(),
        entries: [],
        warnings: [],
        planToken: TOKEN,
        ...over,
    };
}

/** sync 비교 결과. 대상 100개 중 2개 삭제(대량 아님), sync-dryrun fixture와 같은 계획 */
function f_SyncCompare(over: Partial<itfCompareSummary> = {}): itfCompareResult {
    return f_Compare({ mode: "sync", summary: f_Summary({ destFiles: 100, ...over }) });
}

function f_Res(over: Partial<itfProcessResult> = {}): itfProcessResult {
    return {
        exitCode: 0,
        signal: null,
        stdout: "",
        stdoutBytes: Buffer.alloc(0),
        stdoutTruncated: false,
        stderrTail: "",
        timedOut: false,
        canceled: false,
        durationMs: 1,
        closed: true,
        ...over,
    };
}

interface itfProc {
    args: string[];
    opts: Omit<itfRunProcessOptions, "env">;
    aborts: number;
    finish: (lines: string[], over?: Partial<itfProcessResult>) => void;
}

/** 타이머가 저절로 돌지 않는다(flush로만 보냄) → 이벤트 순서가 정해진다 */
const NO_TIMERS: itfBatcherTimers = {
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    now: () => T0,
};

interface itfHarnessOptions {
    job?: typJob;
    compare?: itfCompareResult | null;
    /** null이면 프로세스를 직접 끝낸다(procs[i].finish) */
    script?: { lines: string[]; over?: Partial<itfProcessResult> } | null;
    /** 프로세스 순서별 스크립트(사전 확인 → 실제 실행). 있으면 script 대신 쓴다 */
    scripts?: Array<{ lines: string[]; over?: Partial<itfProcessResult> } | null>;
    safety?: Partial<ReturnType<typeof createDefaultSettings>["safety"]>;
    spawnError?: string;
    /** 취소했을 때 프로세스 결과 */
    cancelResult?: Partial<itfProcessResult>;
    /** 자동 실행 비교 결과(기본: compare). Error면 실패, "hang"이면 취소될 때까지 기다린다 */
    autoCompare?: itfCompareResult | Error | "hang";
    /** rclone 감지 실패 */
    requireError?: clsAppError;
}

let caseNo = 0;

function f_Harness(o: itfHarnessOptions = {}) {
    caseNo += 1;
    const logsDir = join(logsRoot, `c${caseNo}`);
    const job = o.job ?? f_Job();
    const compare = o.compare === undefined ? f_Compare() : o.compare;
    const procs: itfProc[] = [];
    const events: typRunEvent[] = [];
    const logs: string[] = [];
    const begun: typRunRecord[] = [];
    const patches: Array<Partial<typRunRecord>> = [];
    const bookkeeping: unknown[] = [];
    const invalidated: string[] = [];
    const requirePlanCalls: string[] = [];
    const activeOps: string[] = [];
    const written: typActiveRunFile[] = [];
    const autoCompareCalls: string[] = [];
    let idSeq = 0;
    const script = o.script === undefined ? { lines: fixtureLines("copy-dryrun") } : o.script;

    const run: typRunRclone = (_bin, args, opts) =>
        new Promise((resolve, reject) => {
            if (o.spawnError) {
                reject(new clsProcessSpawnError(o.spawnError, "spawn"));
                return;
            }
            const proc: itfProc = {
                args: [...args],
                opts,
                aborts: 0,
                finish: (lines, over = {}) => {
                    for (const line of lines) opts.onStderrLine?.(line);
                    resolve(f_Res(over));
                },
            };
            opts.signal?.addEventListener("abort", () => {
                proc.aborts += 1;
                resolve(f_Res({ canceled: true, exitCode: null, ...o.cancelResult }));
            });
            const mine = o.scripts ? (o.scripts[procs.length] ?? null) : script;
            procs.push(proc);
            opts.onSpawn?.(PID + procs.length - 1);
            if (mine) setTimeout(() => proc.finish(mine.lines, mine.over), 0);
        });

    const activity = new clsActivityLock();
    const deps: itfRunServiceDeps = {
        jobs: {
            get: (id) => {
                if (id !== job.id) throw new clsAppError("NOT_FOUND", "작업을 찾을 수 없습니다.");
                return job;
            },
            setBookkeeping: async (id, b) => {
                bookkeeping.push({ id, ...b });
                return job;
            },
        },
        settings: {
            get: () => {
                const st = createDefaultSettings();
                return { ...st, safety: { ...st.safety, ...o.safety } };
            },
        },
        rcloneEnv: {
            require: async () => {
                if (o.requireError) throw o.requireError;
                return { binaryPath: BIN, configPath: CONF };
            },
            resolveConfigFor: async () => CONF,
        },
        compare: {
            compareForAuto: (jobId, signal) => {
                autoCompareCalls.push(jobId);
                const ac = o.autoCompare === undefined ? compare : o.autoCompare;
                if (ac === "hang") {
                    return new Promise((_resolve, reject) => {
                        signal.addEventListener("abort", () =>
                            reject(new clsAppError("CANCELED", "비교를 취소했습니다.")),
                        );
                    });
                }
                if (ac instanceof Error) return Promise.reject(ac);
                if (!ac) return Promise.reject(new clsAppError("INTERNAL"));
                return Promise.resolve(ac);
            },
            requirePlan: (jobId, token) => {
                requirePlanCalls.push(token);
                if (!compare || token !== compare.planToken) throw new clsAppError("PLAN_REQUIRED");
                return compare;
            },
            invalidate: (jobId) => {
                invalidated.push(jobId);
            },
            get: () => compare,
        },
        history: {
            begin: async (rec) => {
                begun.push(rec);
                return rec;
            },
            patch: async (id, p) => {
                patches.push(p);
                return { ...begun.find((r) => r.id === id)!, ...p };
            },
        },
        activity,
        activeRun: {
            write: async (rec) => {
                activeOps.push("write");
                written.push(rec);
            },
            clear: async () => {
                activeOps.push("clear");
            },
        },
        logsDir,
        logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
        run,
        now: () => new Date(T0),
        newId: () => {
            idSeq += 1;
            return `00000000-0000-4000-8000-${String(900 + idSeq).padStart(12, "0")}`;
        },
        emit: (e) => events.push(e),
        timers: NO_TIMERS,
    };
    const svc = new clsRunService(deps);
    return {
        svc,
        activity,
        procs,
        events,
        logs,
        begun,
        patches,
        bookkeeping,
        invalidated,
        requirePlanCalls,
        activeOps,
        written,
        autoCompareCalls,
        logsDir,
        finished: () => events.filter((e) => e.type === "finished"),
    };
}

async function f_Err(p: Promise<unknown>): Promise<clsAppError> {
    const e = await p.then(
        () => null,
        (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(clsAppError);
    return e as clsAppError;
}

async function f_Done(h: ReturnType<typeof f_Harness>): Promise<typRunRecord> {
    expect(await h.svc.whenIdle(2000)).toBe(true);
    const f = h.finished();
    expect(f).toHaveLength(1);
    const e = f[0]!;
    if (e.type !== "finished") throw new Error("finished 아님");
    return e.record;
}

describe("clsRunService 미리보기(dry-run)", () => {
    it("토큰 없이 실행, --dry-run, 이벤트 순서(started 처음·finished 마지막 1회), 집계", async () => {
        const h = f_Harness();
        const { runId } = await h.svc.start({ jobId: JOB_ID, dryRun: true });
        const rec = await f_Done(h);
        expect(rec).toMatchObject({ id: runId, status: "success", dryRun: true, pid: PID });
        expect(h.requirePlanCalls).toEqual([]);
        expect(h.procs[0]!.args).toContain("--dry-run");
        expect(h.procs[0]!.opts.timeoutMs).toBeNull();
        expect(h.procs[0]!.opts.collectStdout).toBe(false);
        const types = h.events.map((e) => e.type);
        expect(types[0]).toBe("started");
        expect(types.at(-1)).toBe("finished");
        expect(types).toContain("stats");
        expect(types).toContain("log");
        expect(types.indexOf("phase")).toBeLessThan(types.indexOf("finished"));
        const fin = h.finished()[0]!;
        if (fin.type !== "finished") throw new Error();
        expect(fin.dryRunSummary).toMatchObject({ copyFiles: 3, touchFiles: 1, deleteFiles: 0 });
        // 유효한 비교 결과가 있으면 계획을 남긴다(copy: 삭제 0)
        expect(rec.plan).toMatchObject({ createFiles: 2, updateFiles: 2, deleteFiles: 0 });
        expect(rec.stats).toMatchObject({ transfers: 3 });
    });

    it("dry-run은 비교 결과를 무효화하지 않고 lastRun도 바꾸지 않는다", async () => {
        const h = f_Harness();
        await h.svc.start({ jobId: JOB_ID, dryRun: true });
        await f_Done(h);
        expect(h.invalidated).toEqual([]);
        expect(h.bookkeeping).toEqual([]);
        expect(h.begun).toHaveLength(1);
        expect(h.activity.current()).toBeNull();
    });

    it("sync 작업도 미리보기는 된다(--max-delete 없음)", async () => {
        const h = f_Harness({
            job: f_Job({ mode: "sync" }),
            script: { lines: fixtureLines("sync-dryrun") },
        });
        await h.svc.start({ jobId: JOB_ID, dryRun: true });
        await f_Done(h);
        expect(h.procs[0]!.args[0]).toBe("sync");
        expect(h.procs[0]!.args).toContain("--dry-run");
        expect(h.procs[0]!.args).not.toContain("--max-delete");
    });

    it("active-run: 시작 후 기록(pid·이미지 이름) → 끝나면 삭제", async () => {
        const h = f_Harness();
        await h.svc.start({ jobId: JOB_ID, dryRun: true });
        await f_Done(h);
        expect(h.activeOps).toEqual(["write", "clear"]);
        expect(h.written[0]).toMatchObject({ pid: PID, imageName: "rclone.exe", jobId: JOB_ID });
    });

    it("실행 로그 파일: 경로·설정 파일은 가리고 rclone 줄은 남긴다. app.log에는 경로 없음", async () => {
        const h = f_Harness();
        await h.svc.start({ jobId: JOB_ID, dryRun: true });
        const rec = await f_Done(h);
        const files = readdirSync(h.logsDir);
        expect(files).toEqual([rec.logFile]);
        expect(rec.logFile).toMatch(/^run-\d{8}-\d{6}-00000000-00000000\.log$/);
        const text = readFileSync(join(h.logsDir, rec.logFile!), "utf8");
        expect(text).toContain("-- <원본> <대상>");
        expect(text).toContain("--config <설정 파일>");
        expect(text).not.toContain("fake");
        expect(text).toContain("Skipped copy as --dry-run is set");
        expect(text).toMatch(/# 종료: .* status=success exit=0/);
        for (const line of h.logs) expect(line).not.toMatch(/fake|한글|touch\.txt/);
    });
});

describe("clsRunService 실제 copy", () => {
    it("planToken + 확인한 삭제 수 0 → --dry-run 없이 실행, lastRun 갱신, 비교 무효화", async () => {
        const h = f_Harness({ script: { lines: fixtureLines("copy-real") } });
        const { runId } = await h.svc.start({
            jobId: JOB_ID,
            dryRun: false,
            planToken: TOKEN,
            confirmedDeletes: 0,
        });
        const rec = await f_Done(h);
        expect(h.procs[0]!.args).not.toContain("--dry-run");
        expect(h.procs[0]!.args).not.toContain("--max-delete");
        expect(rec).toMatchObject({ status: "success", dryRun: false });
        expect(rec.plan).toMatchObject({ createFiles: 2, updateFiles: 2, deleteFiles: 0 });
        expect(h.invalidated).toEqual([JOB_ID]);
        expect(h.bookkeeping).toEqual([
            { id: JOB_ID, lastRun: { runId, at: new Date(T0).toISOString(), status: "success" } },
        ]);
        const fin = h.finished()[0]!;
        if (fin.type !== "finished") throw new Error();
        expect(fin.dryRunSummary).toBeNull();
    });

    it("finished 이벤트를 받을 때는 락이 이미 풀려 있다", async () => {
        const h = f_Harness({ script: { lines: fixtureLines("copy-real") } });
        const lockAtFinish: unknown[] = [];
        const origPush = h.events.push.bind(h.events);
        h.events.push = (...items: typRunEvent[]) => {
            for (const e of items)
                if (e.type === "finished") lockAtFinish.push(h.activity.current());
            return origPush(...items);
        };
        await h.svc.start({ jobId: JOB_ID, dryRun: false, planToken: TOKEN, confirmedDeletes: 0 });
        await f_Done(h);
        expect(lockAtFinish).toEqual([null]);
    });
});

describe("clsRunService 실제 실행 게이트", () => {
    const cases: Array<{
        name: string;
        code: string;
        opts?: itfHarnessOptions;
        input: Record<string, unknown>;
    }> = [
        {
            name: "sync 확인한 삭제 수 불일치 → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            opts: { job: f_Job({ mode: "sync" }), compare: f_SyncCompare() },
            input: { planToken: TOKEN, confirmedDeletes: 1 },
        },
        {
            name: "sync 빈 원본(S7) → EMPTY_SOURCE_BLOCKED",
            code: "EMPTY_SOURCE_BLOCKED",
            opts: {
                job: f_Job({ mode: "sync" }),
                compare: f_SyncCompare({
                    sourceFiles: 0,
                    createFiles: 0,
                    updateFiles: 0,
                    deleteFiles: 100,
                }),
            },
            input: { planToken: TOKEN, confirmedDeletes: 100, confirmLargeDeletes: true },
        },
        {
            name: "sync + ignoreErrors(S15) → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            opts: {
                job: f_Job({
                    mode: "sync",
                    options: { ...f_Job().options, ignoreErrors: true },
                }),
                compare: f_SyncCompare(),
            },
            input: { planToken: TOKEN, confirmedDeletes: 2 },
        },
        {
            name: "대량 삭제(S11) 확인 없음 → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            opts: { job: f_Job({ mode: "sync" }), compare: f_SyncCompare({ destFiles: 3 }) },
            input: { planToken: TOKEN, confirmedDeletes: 2 },
        },
        {
            name: "대량 삭제 confirmLargeDeletes:false → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            opts: {
                job: f_Job({ mode: "sync" }),
                compare: f_SyncCompare(),
                safety: { deleteConfirmFiles: 0 },
            },
            input: { planToken: TOKEN, confirmedDeletes: 2, confirmLargeDeletes: false },
        },
        {
            name: "sync 형식 충돌 → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            opts: { job: f_Job({ mode: "sync" }), compare: f_SyncCompare({ conflictFiles: 1 }) },
            input: { planToken: TOKEN, confirmedDeletes: 2 },
        },
        {
            name: "토큰 없음 → PLAN_REQUIRED",
            code: "PLAN_REQUIRED",
            input: { confirmedDeletes: 0 },
        },
        {
            name: "다른 토큰 → PLAN_REQUIRED",
            code: "PLAN_REQUIRED",
            input: { planToken: "0".repeat(32), confirmedDeletes: 0 },
        },
        {
            name: "비교 결과 없음 → PLAN_REQUIRED",
            code: "PLAN_REQUIRED",
            opts: { compare: null },
            input: { planToken: TOKEN, confirmedDeletes: 0 },
        },
        {
            name: "확인한 삭제 수 없음 → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            input: { planToken: TOKEN },
        },
        {
            name: "확인한 삭제 수 불일치(copy는 0) → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            input: { planToken: TOKEN, confirmedDeletes: 2 },
        },
        {
            name: "형식 충돌 → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            opts: { compare: f_Compare({ summary: f_Summary({ conflictFiles: 1 }) }) },
            input: { planToken: TOKEN, confirmedDeletes: 0 },
        },
        {
            name: "대소문자만 다른 항목 → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            opts: { compare: f_Compare({ summary: f_Summary({ caseOnlyFiles: 1 }) }) },
            input: { planToken: TOKEN, confirmedDeletes: 0 },
        },
        {
            name: "경로 오류(대상이 원본 안) → SAFETY_BLOCKED",
            code: "SAFETY_BLOCKED",
            opts: { job: f_Job({ destination: `${SRC}\\sub` }) },
            input: { planToken: TOKEN, confirmedDeletes: 0 },
        },
    ];
    for (const c of cases) {
        it(`${c.name}, 이력·프로세스 0회, 락 해제`, async () => {
            const h = f_Harness(c.opts);
            const e = await f_Err(h.svc.start({ jobId: JOB_ID, dryRun: false, ...c.input }));
            expect(e.code).toBe(c.code);
            expect(h.begun).toEqual([]);
            expect(h.procs).toEqual([]);
            expect(h.events).toEqual([]);
            expect(h.activity.current()).toBeNull();
        });
    }

    it("PLAN_STALE은 그대로 전달한다", async () => {
        const h = f_Harness();
        const svc = new clsRunService({
            jobs: { get: () => f_Job(), setBookkeeping: async () => f_Job() },
            settings: { get: () => createDefaultSettings() },
            rcloneEnv: {
                require: async () => ({ binaryPath: BIN, configPath: CONF }),
                resolveConfigFor: async () => CONF,
            },
            compare: {
                requirePlan: () => {
                    throw new clsAppError("PLAN_STALE");
                },
                invalidate: () => undefined,
                get: () => null,
                compareForAuto: async () => {
                    throw new clsAppError("INTERNAL");
                },
            },
            history: { begin: async (r) => r, patch: async () => h.begun[0]! },
            activity: new clsActivityLock(),
            activeRun: { write: async () => undefined, clear: async () => undefined },
            logsDir: h.logsDir,
            logger: { info: () => undefined, warn: () => undefined },
        });
        const e = await f_Err(
            svc.start({ jobId: JOB_ID, dryRun: false, planToken: TOKEN, confirmedDeletes: 0 }),
        );
        expect(e.code).toBe("PLAN_STALE");
    });
});

describe("clsRunService 락·취소·실패", () => {
    it("비교 중이면 BUSY(이력·프로세스 없음), 실행 중 두 번째 시작도 BUSY", async () => {
        const h = f_Harness({ script: null });
        const release = h.activity.acquire(
            { kind: "compare", jobId: JOB_ID, startedAt: new Date(T0).toISOString() },
            () => "busy",
        );
        const e1 = await f_Err(h.svc.start({ jobId: JOB_ID, dryRun: true }));
        expect(e1.code).toBe("BUSY");
        expect(e1.message).toContain("‘실행 작업’ 작업을 비교하는 중");
        expect(h.begun).toEqual([]);
        release();
        await h.svc.start({ jobId: JOB_ID, dryRun: true });
        const e2 = await f_Err(h.svc.start({ jobId: JOB_ID, dryRun: true }));
        expect(e2.code).toBe("BUSY");
        expect(e2.message).toContain("실행하는 중");
        expect(h.begun).toHaveLength(1);
        expect(h.svc.isRunningJob(JOB_ID)).toBe(true);
        h.procs[0]!.finish([]);
        await f_Done(h);
        expect(h.svc.isRunningJob(JOB_ID)).toBe(false);
    });

    it("getActive: 진행 중 스냅샷(최근 로그·단계·집계), 끝나면 null", async () => {
        const h = f_Harness({ script: null });
        const { runId } = await h.svc.start({ jobId: JOB_ID, dryRun: true });
        h.procs[0]!.opts.onStderrLine?.(fixtureLines("copy-dryrun")[0]!);
        const snap = h.svc.getActive();
        expect(snap).toMatchObject({
            runId,
            phase: "transferring",
            status: "running",
            cancelRequested: false,
        });
        expect(snap?.tail).toHaveLength(1);
        expect(snap?.dryRunSummary?.copyFiles).toBe(1);
        snap?.tail.push(snap.tail[0]!);
        expect(h.svc.getActive()?.tail).toHaveLength(1);
        h.procs[0]!.finish([]);
        await f_Done(h);
        expect(h.svc.getActive()).toBeNull();
    });

    it("취소는 한 번만 abort(idempotent), 결과 canceled, 다른 runId는 무시", async () => {
        const h = f_Harness({ script: null });
        const { runId } = await h.svc.start({ jobId: JOB_ID, dryRun: true });
        h.svc.cancel("00000000-0000-4000-8000-000000000999");
        expect(h.procs[0]!.aborts).toBe(0);
        h.svc.cancel(runId);
        h.svc.cancel(runId);
        expect(h.svc.getActive()?.cancelRequested).toBe(true);
        const rec = await f_Done(h);
        expect(h.procs[0]!.aborts).toBe(1);
        expect(rec.status).toBe("canceled");
        expect(rec.error?.code).toBe("CANCELED");
        h.svc.cancel(runId);
    });

    it("실제 copy 취소도 lastRun(canceled)·비교 무효화", async () => {
        const h = f_Harness({ script: null });
        const { runId } = await h.svc.start({
            jobId: JOB_ID,
            dryRun: false,
            planToken: TOKEN,
            confirmedDeletes: 0,
        });
        h.svc.cancel(runId);
        await f_Done(h);
        expect(h.invalidated).toEqual([JOB_ID]);
        expect(h.bookkeeping).toEqual([
            expect.objectContaining({ lastRun: expect.objectContaining({ status: "canceled" }) }),
        ]);
    });

    it("프로세스 종료를 확인하지 못하면(closed:false) active-run을 남긴다", async () => {
        const h = f_Harness({ script: null, cancelResult: { closed: false } });
        const { runId } = await h.svc.start({ jobId: JOB_ID, dryRun: true });
        h.svc.cancel(runId);
        await f_Done(h);
        expect(h.activeOps).toEqual(["write"]);
    });

    it("rclone을 시작하지 못하면(ENOENT) failed 이력, 락 해제, finished 1회", async () => {
        const h = f_Harness({ spawnError: "ENOENT" });
        await h.svc.start({ jobId: JOB_ID, dryRun: true });
        const rec = await f_Done(h);
        expect(rec.status).toBe("failed");
        expect(rec.error?.code).toBe("RCLONE_NOT_FOUND");
        expect(rec.pid).toBeNull();
        expect(h.activity.current()).toBeNull();
        expect(h.activeOps).toEqual(["clear"]);
    });

    it("exit 3 → failed PATH_NOT_FOUND, 오류 줄 detail", async () => {
        const err = JSON.stringify({ level: "error", msg: "directory not found" });
        const h = f_Harness({ script: { lines: [err], over: { exitCode: 3 } } });
        await h.svc.start({ jobId: JOB_ID, dryRun: true });
        const rec = await f_Done(h);
        expect(rec.status).toBe("failed");
        expect(rec.error).toMatchObject({ code: "PATH_NOT_FOUND", detail: "directory not found" });
    });

    it("whenIdle: 실행이 없으면 바로 true, 끝나지 않으면 false", async () => {
        const h = f_Harness({ script: null });
        expect(await h.svc.whenIdle(10)).toBe(true);
        await h.svc.start({ jobId: JOB_ID, dryRun: true });
        expect(await h.svc.whenIdle(10)).toBe(false);
        h.procs[0]!.finish([]);
        expect(await h.svc.whenIdle(1000)).toBe(true);
    });
});

function f_SyncJob(preflight = true): typJob {
    return f_Job({
        mode: "sync",
        options: { ...f_Job().options, preflightBeforeDestructive: preflight },
    });
}

describe("clsRunService 실제 sync (Phase 7)", () => {
    const SYNC_INPUT = { jobId: JOB_ID, dryRun: false, planToken: TOKEN, confirmedDeletes: 2 };

    it("사전 확인 일치 → spawn 2회(1차 --dry-run·--max-delete 없음, 2차 --max-delete 2), 단계 순서", async () => {
        const h = f_Harness({
            job: f_SyncJob(),
            compare: f_SyncCompare(),
            scripts: [{ lines: fixtureLines("sync-dryrun") }, { lines: fixtureLines("sync-real") }],
        });
        const { runId } = await h.svc.start(SYNC_INPUT);
        const rec = await f_Done(h);
        expect(h.procs).toHaveLength(2);
        expect(h.procs[0]!.args).toContain("--dry-run");
        expect(h.procs[0]!.args).not.toContain("--max-delete");
        expect(h.procs[1]!.args).not.toContain("--dry-run");
        const md = h.procs[1]!.args.indexOf("--max-delete");
        expect(h.procs[1]!.args[md + 1]).toBe("2");
        const phases = h.events.flatMap((e) => (e.type === "phase" ? [e.phase] : []));
        expect(phases).toEqual(["preflight", "transferring", "finalizing"]);
        expect(rec).toMatchObject({ status: "success", dryRun: false, pid: PID + 1 });
        expect(rec.preflight).toMatchObject({ deletes: 2, errors: 0 });
        expect(rec.stats).not.toBeNull();
        expect(h.written.map((w) => w.pid)).toEqual([PID, PID + 1]);
        expect(h.bookkeeping).toEqual([
            expect.objectContaining({
                lastRun: expect.objectContaining({ runId, status: "success" }),
            }),
        ]);
        const fin = h.finished()[0]!;
        if (fin.type !== "finished") throw new Error();
        expect(fin.dryRunSummary).toBeNull();
        const text = readFileSync(join(h.logsDir, rec.logFile!), "utf8");
        expect(text).toContain("# 단계: 사전 확인");
        expect(text).toContain("# 단계: 실제 실행");
        expect(text.match(/# rcloneGUI 실행 로그/g)).toHaveLength(1);
        expect(text).not.toContain("fake");
    });

    it("사전 확인 불일치 → spawn 1회, blocked PLAN_DRIFT(차이 줄), record.preflight, 무효화, lastRun blocked", async () => {
        const h = f_Harness({
            job: f_SyncJob(),
            // 계획은 삭제 1개인데 사전 확인은 2개
            compare: f_SyncCompare({ deleteFiles: 1 }),
            scripts: [{ lines: fixtureLines("sync-dryrun") }, null],
        });
        const { runId } = await h.svc.start({ ...SYNC_INPUT, confirmedDeletes: 1 });
        const rec = await f_Done(h);
        expect(h.procs).toHaveLength(1);
        expect(rec.status).toBe("blocked");
        expect(rec.error?.code).toBe("PLAN_DRIFT");
        expect(rec.error?.detail).toContain("삭제: 계획 1개, 미리보기 2개");
        expect(rec.error?.detail).toContain("삭제(통계): 계획 1개, 사전 확인 2개");
        expect(rec.preflight).toMatchObject({ deletes: 2 });
        expect(rec.stats).toBeNull();
        expect(h.invalidated).toEqual([JOB_ID]);
        expect(h.bookkeeping).toEqual([
            expect.objectContaining({
                lastRun: expect.objectContaining({ runId, status: "blocked" }),
            }),
        ]);
        expect(h.activity.current()).toBeNull();
        expect(h.activeOps.at(-1)).toBe("clear");
    });

    it("사전 확인 꺼짐 → spawn 1회, --max-delete 2, --dry-run 없음", async () => {
        const h = f_Harness({
            job: f_SyncJob(false),
            compare: f_SyncCompare(),
            script: { lines: fixtureLines("sync-real") },
        });
        await h.svc.start(SYNC_INPUT);
        const rec = await f_Done(h);
        expect(h.procs).toHaveLength(1);
        expect(h.procs[0]!.args).not.toContain("--dry-run");
        expect(h.procs[0]!.args).toEqual(expect.arrayContaining(["--max-delete", "2"]));
        expect(rec.status).toBe("success");
        expect(rec.preflight).toBeNull();
    });

    it("삭제 0인 sync → 사전 확인 없이 --max-delete 0", async () => {
        const h = f_Harness({
            job: f_SyncJob(),
            compare: f_SyncCompare({ deleteFiles: 0, deleteBytes: 0 }),
            script: { lines: fixtureLines("copy-real") },
        });
        await h.svc.start({ ...SYNC_INPUT, confirmedDeletes: 0 });
        await f_Done(h);
        expect(h.procs).toHaveLength(1);
        expect(h.procs[0]!.args[0]).toBe("sync");
        expect(h.procs[0]!.args).not.toContain("--dry-run");
        const md = h.procs[0]!.args.indexOf("--max-delete");
        expect(h.procs[0]!.args[md + 1]).toBe("0");
    });

    it("대량 삭제는 confirmLargeDeletes:true면 실행된다", async () => {
        const h = f_Harness({
            job: f_SyncJob(false),
            compare: f_SyncCompare({ destFiles: 3 }),
            script: { lines: fixtureLines("sync-real") },
        });
        await h.svc.start({ ...SYNC_INPUT, confirmLargeDeletes: true });
        expect((await f_Done(h)).status).toBe("success");
    });

    it("사전 확인 중 취소 → canceled(대상 불변 안내), 실제 실행 없음", async () => {
        const h = f_Harness({ job: f_SyncJob(), compare: f_SyncCompare(), script: null });
        const { runId } = await h.svc.start(SYNC_INPUT);
        expect(h.svc.getActive()?.phase).toBe("preflight");
        h.svc.cancel(runId);
        const rec = await f_Done(h);
        expect(h.procs).toHaveLength(1);
        expect(rec.status).toBe("canceled");
        expect(rec.error?.message).toContain("사전 확인 중 취소");
        expect(h.invalidated).toEqual([JOB_ID]);
    });

    it("사전 확인 exit≠0 → failed, 실제 실행 없음", async () => {
        const err = JSON.stringify({ level: "error", msg: "boom" });
        const h = f_Harness({
            job: f_SyncJob(),
            compare: f_SyncCompare(),
            scripts: [{ lines: [err], over: { exitCode: 1 } }],
        });
        await h.svc.start(SYNC_INPUT);
        const rec = await f_Done(h);
        expect(h.procs).toHaveLength(1);
        expect(rec.status).toBe("failed");
        expect(rec.error).toMatchObject({ code: "RCLONE_FAILED", detail: "boom" });
        expect(rec.error?.message).toMatch(/^사전 확인에 실패해/);
    });

    it("실제 sync exit 7 → failed MAX_DELETE_EXCEEDED (fixture sync-maxdelete1)", async () => {
        const h = f_Harness({
            job: f_SyncJob(false),
            compare: f_SyncCompare(),
            script: { lines: fixtureLines("sync-maxdelete1"), over: { exitCode: 7 } },
        });
        await h.svc.start(SYNC_INPUT);
        const rec = await f_Done(h);
        expect(rec.status).toBe("failed");
        expect(rec.error?.code).toBe("MAX_DELETE_EXCEEDED");
        expect(rec.stats).toMatchObject({ deletes: 1, fatalError: true });
    });
});

function f_AutoJob(
    over: { mode?: "copy" | "sync"; allowDeletes?: boolean; preflight?: boolean } & Partial<
        Pick<typJob, "rev">
    > = {},
): typJob {
    const base = f_Job();
    return f_Job({
        mode: over.mode ?? "copy",
        rev: over.rev ?? 0,
        options: { ...base.options, preflightBeforeDestructive: over.preflight ?? true },
        autoSync: {
            ...base.autoSync,
            enabled: true,
            intervalMinutes: 1,
            allowDeletes: over.allowDeletes ?? false,
        },
    });
}

/** 자동 실행을 끝까지 기다리고 finished 이벤트가 1번인지 확인한다 */
async function f_Auto(h: ReturnType<typeof f_Harness>) {
    const { runId, done } = await h.svc.startAuto(JOB_ID);
    const o = await done;
    expect(o.runId).toBe(runId);
    expect(await h.svc.whenIdle(2000)).toBe(true);
    expect(h.finished()).toHaveLength(1);
    expect(h.activity.current()).toBeNull();
    return o;
}

describe("clsRunService 자동 실행 (Phase 8)", () => {
    it("copy: 비교(compareForAuto) → 실행, trigger scheduler, started는 비교 단계, lastRun·무효화", async () => {
        const h = f_Harness({ job: f_AutoJob(), script: { lines: fixtureLines("copy-real") } });
        const o = await f_Auto(h);
        expect(o).toMatchObject({ status: "success", recorded: true, jobName: "실행 작업" });
        expect(h.autoCompareCalls).toEqual([JOB_ID]);
        expect(h.requirePlanCalls).toEqual([]);
        expect(h.procs).toHaveLength(1);
        expect(h.procs[0]!.args).not.toContain("--dry-run");
        const started = h.events[0]!;
        if (started.type !== "started") throw new Error("started 아님");
        expect(started.snapshot).toMatchObject({ trigger: "scheduler", phase: "comparing" });
        expect(h.begun).toHaveLength(1);
        expect(h.begun[0]).toMatchObject({ trigger: "scheduler", dryRun: false });
        expect(h.begun[0]!.plan).toMatchObject({ createFiles: 2, updateFiles: 2, deleteFiles: 0 });
        expect(h.invalidated).toEqual([JOB_ID]);
        expect(h.bookkeeping).toEqual([
            expect.objectContaining({ lastRun: expect.objectContaining({ status: "success" }) }),
        ]);
    });

    it("바꿀 것이 없으면 noop: 이력·프로세스 없음, lastRun{runId:null, noop}", async () => {
        const h = f_Harness({
            job: f_AutoJob(),
            compare: f_Compare({
                summary: f_Summary({ createFiles: 0, updateFiles: 0, deleteFiles: 0 }),
            }),
        });
        const o = await f_Auto(h);
        expect(o).toMatchObject({ status: "noop", recorded: false, error: null });
        expect(h.begun).toEqual([]);
        expect(h.procs).toEqual([]);
        expect(h.invalidated).toEqual([]);
        expect(h.bookkeeping).toEqual([
            expect.objectContaining({
                lastRun: expect.objectContaining({ runId: null, status: "noop" }),
            }),
        ]);
    });

    const BLOCKS: Array<{
        name: string;
        job: typJob;
        compare: itfCompareResult;
        safety?: Partial<ReturnType<typeof createDefaultSettings>["safety"]>;
        text: string;
    }> = [
        {
            name: "allowDeletes 꺼짐 + 삭제",
            job: f_AutoJob({ mode: "sync" }),
            compare: f_SyncCompare(),
            text: "삭제를 허용하지 않아",
        },
        {
            name: "autoMaxDeletes 초과",
            job: f_AutoJob({ mode: "sync", allowDeletes: true }),
            compare: f_SyncCompare(),
            safety: { autoMaxDeletes: 1 },
            text: "최대 삭제 수’(1개)를 넘어",
        },
        {
            name: "autoMaxDeletes 0 = 자동 삭제 금지",
            job: f_AutoJob({ mode: "sync", allowDeletes: true }),
            compare: f_SyncCompare(),
            safety: { autoMaxDeletes: 0 },
            text: "0이라",
        },
        {
            name: "대량 삭제",
            job: f_AutoJob({ mode: "sync", allowDeletes: true }),
            compare: f_SyncCompare({ destFiles: 3 }),
            text: "대량 삭제",
        },
        {
            name: "사전 확인 꺼짐 + 삭제",
            job: f_AutoJob({ mode: "sync", allowDeletes: true, preflight: false }),
            compare: f_SyncCompare(),
            text: "사전 확인이 꺼져",
        },
        {
            name: "S5 형식 충돌",
            job: f_AutoJob(),
            compare: f_Compare({ summary: f_Summary({ conflictFiles: 1 }) }),
            text: "파일과 폴더 이름이 겹치는",
        },
        {
            name: "S6 대소문자만 다름",
            job: f_AutoJob(),
            compare: f_Compare({ summary: f_Summary({ caseOnlyFiles: 1 }) }),
            text: "대소문자만 다른",
        },
        {
            name: "S7 빈 원본 sync",
            job: f_AutoJob({ mode: "sync", allowDeletes: true }),
            compare: f_SyncCompare({ sourceFiles: 0, createFiles: 0, updateFiles: 0 }),
            text: "원본에 파일이 없어",
        },
        {
            name: "S15 sync + 오류 무시",
            job: {
                ...f_AutoJob({ mode: "sync", allowDeletes: true }),
                options: { ...f_AutoJob().options, ignoreErrors: true },
            },
            compare: f_SyncCompare(),
            text: "--ignore-errors",
        },
    ];
    for (const b of BLOCKS) {
        it(`게이트 차단: ${b.name} → blocked 이력 1건, 프로세스·무효화 없음`, async () => {
            const h = f_Harness({
                job: b.job,
                compare: b.compare,
                ...(b.safety ? { safety: b.safety } : {}),
            });
            const o = await f_Auto(h);
            expect(o.status).toBe("blocked");
            expect(o.recorded).toBe(true);
            expect(o.error?.message).toContain(b.text);
            expect(h.procs).toEqual([]);
            expect(h.invalidated).toEqual([]);
            expect(h.begun).toHaveLength(1);
            expect(h.begun[0]).toMatchObject({
                status: "blocked",
                trigger: "scheduler",
                logFile: null,
            });
            expect(h.begun[0]!.finishedAt).not.toBeNull();
            expect(h.bookkeeping).toEqual([
                expect.objectContaining({
                    lastRun: expect.objectContaining({ runId: o.runId, status: "blocked" }),
                }),
            ]);
        });
    }

    it("삭제 허용 + 한도 이하 + 사전 확인 켜짐 → 사전 확인 dry-run 후 --max-delete 2", async () => {
        const h = f_Harness({
            job: f_AutoJob({ mode: "sync", allowDeletes: true }),
            compare: f_SyncCompare(),
            scripts: [{ lines: fixtureLines("sync-dryrun") }, { lines: fixtureLines("sync-real") }],
        });
        const o = await f_Auto(h);
        expect(o.status).toBe("success");
        expect(h.procs).toHaveLength(2);
        expect(h.procs[0]!.args).toContain("--dry-run");
        const md = h.procs[1]!.args.indexOf("--max-delete");
        expect(h.procs[1]!.args[md + 1]).toBe("2");
        expect(o.stats).not.toBeNull();
    });

    it("비교 실패 → failed 이력(오류 코드 유지), 프로세스 없음", async () => {
        const h = f_Harness({
            job: f_AutoJob(),
            autoCompare: new clsAppError("PATH_NOT_FOUND", "원본: 경로가 없습니다."),
        });
        const o = await f_Auto(h);
        expect(o).toMatchObject({ status: "failed", recorded: true });
        expect(o.error?.code).toBe("PATH_NOT_FOUND");
        expect(h.begun[0]).toMatchObject({ status: "failed", trigger: "scheduler" });
        expect(h.procs).toEqual([]);
    });

    it("rclone 없음(실행 전) → failed 이력", async () => {
        const h = f_Harness({
            job: f_AutoJob(),
            requireError: new clsAppError("RCLONE_NOT_FOUND"),
        });
        const o = await f_Auto(h);
        expect(o.status).toBe("failed");
        expect(o.error?.code).toBe("RCLONE_NOT_FOUND");
        expect(h.autoCompareCalls).toEqual([]);
        expect(h.begun).toHaveLength(1);
    });

    it("비교 중 취소 → canceled 이력, 프로세스 없음", async () => {
        const h = f_Harness({ job: f_AutoJob(), autoCompare: "hang" });
        const { runId, done } = await h.svc.startAuto(JOB_ID);
        // 비교가 시작될 때까지 기다린다
        for (let i = 0; i < 20 && h.autoCompareCalls.length === 0; i += 1) {
            await new Promise((r) => setTimeout(r, 0));
        }
        expect(h.svc.getActive()).toMatchObject({
            runId,
            phase: "comparing",
            trigger: "scheduler",
        });
        h.svc.cancel(runId);
        const o = await done;
        expect(o.status).toBe("canceled");
        expect(o.error?.message).toContain("비교 중에 취소");
        expect(h.begun[0]).toMatchObject({ status: "canceled" });
        expect(h.procs).toEqual([]);
        expect(h.activity.current()).toBeNull();
    });

    it("비교하는 동안 작업 rev가 바뀌면 blocked PLAN_STALE", async () => {
        const h = f_Harness({ job: f_AutoJob(), autoCompare: f_Compare({ jobRev: 1 }) });
        const o = await f_Auto(h);
        expect(o.status).toBe("blocked");
        expect(o.error?.code).toBe("PLAN_STALE");
        expect(h.procs).toEqual([]);
    });

    it("락은 await 전에 동기로 잡는다: 같은 tick의 수동 시작은 BUSY", async () => {
        const h = f_Harness({ job: f_AutoJob(), script: { lines: fixtureLines("copy-real") } });
        const pending = h.svc.startAuto(JOB_ID);
        expect(h.activity.current()).toMatchObject({ kind: "run", jobId: JOB_ID });
        const e = await f_Err(h.svc.start({ jobId: JOB_ID, dryRun: true }));
        expect(e.code).toBe("BUSY");
        const { done } = await pending;
        expect((await done).status).toBe("success");
        expect(h.begun).toHaveLength(1);
    });

    it("락이 차 있으면 BUSY를 던지고 이력·작업 기록·이벤트가 없다", async () => {
        const h = f_Harness({ job: f_AutoJob() });
        const release = h.activity.acquire(
            { kind: "compare", jobId: JOB_ID, startedAt: new Date(T0).toISOString() },
            () => "busy",
        );
        const e = await f_Err(h.svc.startAuto(JOB_ID));
        expect(e.code).toBe("BUSY");
        expect(h.begun).toEqual([]);
        expect(h.bookkeeping).toEqual([]);
        expect(h.events).toEqual([]);
        release();
    });
});
