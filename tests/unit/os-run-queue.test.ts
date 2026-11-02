// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import {
    checkOsRunEntry,
    clsOsRunQueue,
    entryBlockError,
    exitCodeForStatus,
    headlessExitDecision,
    isRetryablePathError,
    OS_RUN_WAIT_TIMEOUT_TEXT,
    precheckJobPaths,
    type itfOsRunClock,
    type typHeadlessExitCode,
    type typPathCheck,
} from "@/main/services/os-run-queue";
import type { itfAutoOutcome } from "@/main/services/run-service";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import type { itfPathProbe } from "@/shared/ipc-contract";
import type { typAppErrorPayload, typRunStatus } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";
import type { itfAppNotify } from "@/shared/types/scheduler";

const MIN = 60_000;
const HOUR = 60 * MIN;

function f_Id(n: number): string {
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function f_Job(n: number, over: Partial<typJob["autoSync"]> = {}): typJob {
    const d = createJobDraft(createDefaultSettings());
    return {
        ...d,
        name: `작업${n}`,
        source: "C:\\fake\\src",
        destination: "C:\\fake\\dst",
        id: f_Id(n),
        autoSync: {
            ...d.autoSync,
            enabled: true,
            backend: "os",
            nextRunAt: null,
            lastAutoRunAt: null,
            ...over,
        },
        rev: 0,
        createdAt: "2026-11-02T00:00:00.000Z",
        updatedAt: "2026-11-02T00:00:00.000Z",
        lastRun: null,
    };
}

async function f_Flush(): Promise<void> {
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
}

/** 수동 시계: advance가 시각을 옮기며 due가 지난 타이머를 순서대로 실행한다 */
function f_Clock() {
    let now = 0;
    let seq = 0;
    const timers = new Map<number, { due: number; fn: () => void }>();
    const clock: itfOsRunClock = {
        now: () => now,
        setTimeout: (fn, ms) => {
            seq += 1;
            timers.set(seq, { due: now + ms, fn });
            return seq;
        },
        clearTimeout: (h) => {
            timers.delete(h as number);
        },
    };
    return {
        clock,
        now: () => now,
        pending: () => timers.size,
        advance: async (ms: number) => {
            const target = now + ms;
            for (;;) {
                await f_Flush();
                let next: [number, { due: number; fn: () => void }] | null = null;
                for (const t of timers) {
                    if (t[1].due <= target && (next === null || t[1].due < next[1].due)) next = t;
                }
                if (next === null) break;
                timers.delete(next[0]);
                now = next[1].due;
                next[1].fn();
            }
            now = target;
            await f_Flush();
        },
    };
}

interface itfStarted {
    jobId: string;
    runId: string;
    at: number;
    finish: (status: typRunStatus, over?: Partial<itfAutoOutcome>) => void;
}

function f_Harness(
    jobsInit: typJob[],
    o: {
        paused?: boolean;
        /** startAuto 호출 순서별: "busy"면 BUSY, Error면 그 오류, 그 밖에는 실행 시작 */
        start?: Array<"busy" | Error | "run">;
        paths?: typPathCheck[];
    } = {},
) {
    const c = f_Clock();
    let jobs = jobsInit;
    let settings: typSettings = {
        ...createDefaultSettings(),
        scheduler: { paused: o.paused ?? false },
    };
    const started: itfStarted[] = [];
    const startCalls: Array<{ jobId: string; trigger: string; at: number }> = [];
    const cancels: Array<{ runId: string; reason: string | undefined }> = [];
    const blocked: Array<{ jobId: string; error: typAppErrorPayload }> = [];
    const pathChecks: Array<{ jobId: string; at: number }> = [];
    const notices: itfAppNotify[] = [];
    const book: Array<{ id: string; lastAutoRunAt: string | null | undefined }> = [];
    const idles: Array<typHeadlessExitCode | null> = [];
    const logs: string[] = [];
    const startScript = [...(o.start ?? [])];
    const pathScript = [...(o.paths ?? [])];
    let seq = 0;
    /** 남은 횟수만큼 jobs.list가 예외를 던진다(예상하지 못한 오류 흉내) */
    let listFailures = 0;
    const queue = new clsOsRunQueue({
        jobs: {
            list: () => {
                if (listFailures > 0) {
                    listFailures -= 1;
                    throw new Error("boom");
                }
                return jobs;
            },
            setBookkeeping: async (id, b) => {
                book.push({ id, lastAutoRunAt: b.lastAutoRunAt });
                return jobs.find((j) => j.id === id)!;
            },
        },
        settings: { get: () => settings },
        runs: {
            startAuto: async (jobId, trigger = "scheduler") => {
                startCalls.push({ jobId, trigger, at: c.now() });
                const s = startScript.shift() ?? "run";
                if (s === "busy") throw new clsAppError("BUSY", "busy");
                if (s instanceof Error) throw s;
                seq += 1;
                const runId = f_Id(900 + seq);
                const job = jobs.find((j) => j.id === jobId)!;
                let resolve: ((v: itfAutoOutcome) => void) | null = null;
                const done = new Promise<itfAutoOutcome>((r) => {
                    resolve = r;
                });
                started.push({
                    jobId,
                    runId,
                    at: c.now(),
                    finish: (status, over = {}) =>
                        resolve?.({
                            runId,
                            jobId,
                            jobName: job.name,
                            status,
                            error: null,
                            plan: null,
                            stats: null,
                            finishedAt: new Date(c.now()).toISOString(),
                            recorded: status !== "noop",
                            transferStarted: false,
                            ...over,
                        }),
                });
                return { runId, done };
            },
            cancel: (runId, reason) => {
                cancels.push({ runId, reason });
            },
            recordAutoBlocked: async (jobId, _trigger, error) => {
                blocked.push({ jobId, error });
                return {
                    runId: f_Id(800 + blocked.length),
                    jobId,
                    jobName: "작업",
                    status: "blocked",
                    error,
                    plan: null,
                    stats: null,
                    finishedAt: new Date(c.now()).toISOString(),
                    recorded: true,
                    transferStarted: false,
                };
            },
        },
        checkPaths: async (job) => {
            pathChecks.push({ jobId: job.id, at: c.now() });
            return pathScript.shift() ?? { ok: true };
        },
        notify: (n) => notices.push(n),
        logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
        clock: c.clock,
        onIdle: (code) => idles.push(code),
    });
    return {
        queue,
        clock: c,
        started,
        startCalls,
        cancels,
        blocked,
        pathChecks,
        notices,
        book,
        idles,
        logs,
        setJobs: (j: typJob[]) => {
            jobs = j;
        },
        setPaused: (paused: boolean) => {
            settings = { ...settings, scheduler: { paused } };
        },
        failListTimes: (n: number) => {
            listFailures = n;
        },
    };
}

function f_Probe(over: Partial<itfPathProbe>): itfPathProbe {
    return {
        kind: "local",
        displayPath: "x",
        normalizedPath: "x",
        exists: true,
        isDirectory: true,
        readable: true,
        isRoot: false,
        message: "폴더입니다.",
        warnings: [],
        ...over,
    };
}

/** 원본(경로에 src)·대상 probe 결과를 돌려주는 가짜 pathService */
function f_PathSvc(src: itfPathProbe, dst: itfPathProbe) {
    return { probe: async ({ path }: { path: string }) => (path.includes("src") ? src : dst) };
}

describe("순수 함수", () => {
    it("checkOsRunEntry: 없음 → 꺼짐 → 앱 백엔드 → 일시정지 → 통과", () => {
        expect(checkOsRunEntry(null, false)).toEqual({ ok: false, reason: "notFound" });
        expect(checkOsRunEntry(f_Job(1, { enabled: false }), false)).toMatchObject({
            ok: false,
            reason: "disabled",
        });
        expect(checkOsRunEntry(f_Job(1, { backend: "app" }), false)).toMatchObject({
            reason: "notOsBackend",
        });
        expect(checkOsRunEntry(f_Job(1), true)).toMatchObject({ reason: "paused" });
        expect(checkOsRunEntry(f_Job(1, { enabled: false }), true)).toMatchObject({
            reason: "disabled",
        });
        expect(checkOsRunEntry(f_Job(1), false)).toMatchObject({ ok: true });
    });

    it("entryBlockError: SCHEDULE_SKIPPED, 이유마다 다른 문구", () => {
        const msgs = (["disabled", "notOsBackend", "paused"] as const).map((r) => {
            const e = entryBlockError(r);
            expect(e.code).toBe("SCHEDULE_SKIPPED");
            return e.message;
        });
        expect(new Set(msgs).size).toBe(3);
    });

    it("exitCodeForStatus: 0·1·2", () => {
        expect(exitCodeForStatus("success")).toBe(0);
        expect(exitCodeForStatus("noop")).toBe(0);
        for (const s of ["failed", "partial", "canceled", "running", "interrupted"] as const) {
            expect(exitCodeForStatus(s)).toBe(1);
        }
        expect(exitCodeForStatus("blocked")).toBe(2);
    });

    it("headlessExitDecision: 헤드리스·종료 중 아님·대기열 비었을 때만 exit, force는 대기열 무관", () => {
        const base = { headless: true, quitting: false, queueIdle: true, force: false };
        expect(headlessExitDecision(base)).toBe("exit");
        // 기다리는 동안 second-instance로 새 요청이 들어와 대기열이 찼으면 끝내지 않는다
        expect(headlessExitDecision({ ...base, queueIdle: false })).toBe("stay");
        expect(headlessExitDecision({ ...base, queueIdle: false, force: true })).toBe("exit");
        // GUI로 바뀌었거나 이미 종료 중이면 force여도 끝내지 않는다
        expect(headlessExitDecision({ ...base, headless: false, force: true })).toBe("stay");
        expect(headlessExitDecision({ ...base, quitting: true, force: true })).toBe("stay");
    });

    it("isRetryablePathError: 경로 없음·rclone 실패만", () => {
        expect(isRetryablePathError("PATH_NOT_FOUND")).toBe(true);
        expect(isRetryablePathError("RCLONE_FAILED")).toBe(true);
        for (const c of [
            "PATH_INVALID",
            "PATH_NOT_DIRECTORY",
            "RCLONE_NOT_FOUND",
            "CONFIG_REQUIRED",
        ] as const) {
            expect(isRetryablePathError(c)).toBe(false);
        }
    });

    it("precheckJobPaths: 형식 오류는 재시도 없음, 원본 없음은 재시도, 대상 없음(새 폴더)은 통과", async () => {
        const settings = { get: () => createDefaultSettings() };
        const job = f_Job(1);
        expect(
            await precheckJobPaths(
                { ...job, source: "C:\\same", destination: "C:\\same" },
                {
                    pathService: f_PathSvc(f_Probe({}), f_Probe({})),
                    settings,
                },
            ),
        ).toMatchObject({ ok: false, retryable: false });
        expect(
            await precheckJobPaths(job, {
                pathService: f_PathSvc(f_Probe({}), f_Probe({})),
                settings,
            }),
        ).toEqual({ ok: true });
        expect(
            await precheckJobPaths(job, {
                pathService: f_PathSvc(
                    f_Probe({ exists: false, message: "응답이 없습니다(5초)." }),
                    f_Probe({}),
                ),
                settings,
            }),
        ).toEqual({ ok: false, retryable: true, code: "PATH_NOT_FOUND" });
        expect(
            await precheckJobPaths(job, {
                pathService: f_PathSvc(f_Probe({ isDirectory: false }), f_Probe({})),
                settings,
            }),
        ).toEqual({ ok: false, retryable: false, code: "PATH_NOT_DIRECTORY" });
        expect(
            await precheckJobPaths(job, {
                pathService: f_PathSvc(
                    f_Probe({}),
                    f_Probe({
                        exists: false,
                        isDirectory: false,
                        readable: null,
                        message: "경로가 없습니다.",
                    }),
                ),
                settings,
            }),
        ).toEqual({ ok: true });
    });
});

describe("clsOsRunQueue", () => {
    it("진입 검사: 없음은 이력 없이 2, 꺼짐·앱 백엔드는 blocked + 알림, 일시정지는 blocked·알림 없음", async () => {
        const none = f_Harness([]);
        none.queue.enqueue(f_Id(1));
        await none.clock.advance(0);
        expect(none.blocked).toEqual([]);
        expect(none.idles).toEqual([2]);

        for (const [job, paused, notify] of [
            [f_Job(1, { enabled: false }), false, 1],
            [f_Job(1, { backend: "app" }), false, 1],
            [f_Job(1), true, 0],
        ] as const) {
            const h = f_Harness([job], { paused });
            h.queue.enqueue(f_Id(1));
            await h.clock.advance(0);
            expect(h.blocked).toHaveLength(1);
            expect(h.blocked[0]!.error.code).toBe("SCHEDULE_SKIPPED");
            expect(h.startCalls).toEqual([]);
            expect(h.notices).toHaveLength(notify);
            expect(h.idles).toEqual([2]);
        }
    });

    it("FIFO·직렬: A·B·C 순서로 하나씩, trigger os-scheduler", async () => {
        const h = f_Harness([f_Job(1), f_Job(2), f_Job(3)]);
        h.queue.enqueue(f_Id(1));
        h.queue.enqueue(f_Id(2));
        h.queue.enqueue(f_Id(3));
        await h.clock.advance(0);
        expect(h.started.map((s) => s.jobId)).toEqual([f_Id(1)]);
        h.started[0]!.finish("success");
        await h.clock.advance(0);
        h.started[1]!.finish("success");
        await h.clock.advance(0);
        h.started[2]!.finish("success");
        await h.clock.advance(0);
        expect(h.startCalls.map((c) => [c.jobId, c.trigger])).toEqual([
            [f_Id(1), "os-scheduler"],
            [f_Id(2), "os-scheduler"],
            [f_Id(3), "os-scheduler"],
        ]);
        expect(h.idles).toEqual([0]);
        expect(h.queue.isIdle()).toBe(true);
    });

    it("중복: 대기·실행 중 같은 jobId(대소문자 무시)는 duplicate, 한 번만 실행", async () => {
        const h = f_Harness([f_Job(1), f_Job(2)]);
        expect(h.queue.enqueue(f_Id(1))).toBe("queued");
        await h.clock.advance(0);
        expect(h.queue.enqueue(f_Id(1).toUpperCase())).toBe("duplicate");
        expect(h.queue.enqueue(f_Id(2))).toBe("queued");
        expect(h.queue.enqueue(f_Id(2))).toBe("duplicate");
        expect([...h.queue.activeJobIds()]).toEqual([f_Id(1), f_Id(2)]);
        h.started[0]!.finish("success");
        await h.clock.advance(0);
        h.started[1]!.finish("success");
        await h.clock.advance(0);
        expect(h.startCalls).toHaveLength(2);
    });

    it("BUSY: busyPollMs 간격으로 다시, 매번 진입 검사(그 사이 끄면 blocked)", async () => {
        const h = f_Harness([f_Job(1)], { start: ["busy", "busy"] });
        h.queue.enqueue(f_Id(1));
        await h.clock.advance(0);
        expect(h.startCalls.map((c) => c.at)).toEqual([0]);
        await h.clock.advance(5_000);
        expect(h.startCalls.map((c) => c.at)).toEqual([0, 5_000]);
        await h.clock.advance(5_000);
        expect(h.startCalls.map((c) => c.at)).toEqual([0, 5_000, 10_000]);
        expect(h.started).toHaveLength(1);
        // 경로 확인은 항목당 한 번
        expect(h.pathChecks).toHaveLength(1);

        const off = f_Harness([f_Job(1)], { start: ["busy"] });
        off.queue.enqueue(f_Id(1));
        await off.clock.advance(0);
        off.setJobs([f_Job(1, { enabled: false })]);
        await off.clock.advance(5_000);
        expect(off.startCalls).toHaveLength(1);
        expect(off.blocked).toHaveLength(1);
        expect(off.idles).toEqual([2]);
    });

    it("60분: BUSY가 계속되면 60분+ 뒤 blocked(BUSY 문구), 뒤 항목은 자기 대기 시각 기준", async () => {
        const busy: Array<"busy"> = Array.from({ length: 2000 }, () => "busy" as const);
        const h = f_Harness([f_Job(1), f_Job(2)], { start: busy });
        h.queue.enqueue(f_Id(1));
        await h.clock.advance(30 * MIN);
        h.queue.enqueue(f_Id(2));
        await h.clock.advance(30 * MIN);
        expect(h.blocked).toEqual([]);
        await h.clock.advance(5_000);
        expect(h.blocked).toEqual([
            { jobId: f_Id(1), error: { code: "BUSY", message: OS_RUN_WAIT_TIMEOUT_TEXT } },
        ]);
        expect(h.idles).toEqual([]);
        // 두 번째는 30분 뒤에 들어왔으므로 아직 기다린다
        await h.clock.advance(25 * MIN);
        expect(h.blocked).toHaveLength(1);
        await h.clock.advance(5 * MIN + 5_000);
        expect(h.blocked.map((b) => b.jobId)).toEqual([f_Id(1), f_Id(2)]);
        expect(h.idles).toEqual([2]);
    });

    it("경로 재시도: 재시도할 실패 3회 + 마지막 확인 뒤 startAuto로 진행(총 4회, 간격 2분)", async () => {
        const fail: typPathCheck = { ok: false, retryable: true, code: "PATH_NOT_FOUND" };
        const h = f_Harness([f_Job(1)], { paths: [fail, fail, fail, fail] });
        h.queue.enqueue(f_Id(1));
        await h.clock.advance(10 * MIN);
        expect(h.pathChecks.map((p) => p.at)).toEqual([0, 2 * MIN, 4 * MIN, 6 * MIN]);
        expect(h.startCalls.map((c) => c.at)).toEqual([6 * MIN]);
        expect(h.logs.filter((l) => l.startsWith("경로 확인 재시도"))).toHaveLength(3);
    });

    it("경로 재시도: 2회 실패 뒤 성공 → startAuto, 재시도 안 할 오류는 바로 startAuto", async () => {
        const fail: typPathCheck = { ok: false, retryable: true, code: "RCLONE_FAILED" };
        const h = f_Harness([f_Job(1)], { paths: [fail, fail, { ok: true }] });
        h.queue.enqueue(f_Id(1));
        await h.clock.advance(10 * MIN);
        expect(h.pathChecks).toHaveLength(3);
        expect(h.startCalls.map((c) => c.at)).toEqual([4 * MIN]);

        const bad = f_Harness([f_Job(1)], {
            paths: [{ ok: false, retryable: false, code: "PATH_INVALID" }],
        });
        bad.queue.enqueue(f_Id(1));
        await bad.clock.advance(0);
        expect(bad.pathChecks).toHaveLength(1);
        expect(bad.startCalls).toHaveLength(1);
    });

    it("전송 뒤 실패는 다시 시도하지 않는다(종료 코드 1)", async () => {
        const h = f_Harness([f_Job(1)]);
        h.queue.enqueue(f_Id(1));
        await h.clock.advance(0);
        h.started[0]!.finish("failed", { transferStarted: true });
        await h.clock.advance(HOUR);
        expect(h.startCalls).toHaveLength(1);
        expect(h.idles).toEqual([1]);
    });

    it("시간 제한: 시작 12시간 뒤 cancel(runId, timeLimit) 1회, canceled → 1, 타이머 정리", async () => {
        const h = f_Harness([f_Job(1)]);
        h.queue.enqueue(f_Id(1));
        await h.clock.advance(0);
        await h.clock.advance(12 * HOUR - 1);
        expect(h.cancels).toEqual([]);
        await h.clock.advance(1);
        expect(h.cancels).toEqual([{ runId: h.started[0]!.runId, reason: "timeLimit" }]);
        h.started[0]!.finish("canceled");
        await h.clock.advance(0);
        expect(h.idles).toEqual([1]);
        expect(h.clock.pending()).toBe(0);

        const quick = f_Harness([f_Job(1)]);
        quick.queue.enqueue(f_Id(1));
        await quick.clock.advance(0);
        quick.started[0]!.finish("success");
        await quick.clock.advance(13 * HOUR);
        expect(quick.cancels).toEqual([]);
    });

    it("종료 코드는 첫 항목 결과만, 뒤 항목 결과와 무관", async () => {
        const h = f_Harness([f_Job(1), f_Job(2)]);
        h.queue.enqueue(f_Id(1));
        h.queue.enqueue(f_Id(2));
        await h.clock.advance(0);
        h.started[0]!.finish("noop");
        await h.clock.advance(0);
        h.started[1]!.finish("failed");
        await h.clock.advance(0);
        expect(h.idles).toEqual([0]);
    });

    it("startAuto가 BUSY 아닌 오류(작업 없어짐 경합)면 2", async () => {
        const h = f_Harness([f_Job(1)], { start: [new clsAppError("NOT_FOUND")] });
        h.queue.enqueue(f_Id(1));
        await h.clock.advance(0);
        expect(h.idles).toEqual([2]);
        expect(h.blocked).toEqual([]);
    });

    it("dispose: 기다리던 sleep이 풀리고 더 이상 startAuto 없음, 남은 대기 수(실행 중 제외)", async () => {
        const h = f_Harness([f_Job(1), f_Job(2), f_Job(3)], { start: ["busy"] });
        h.queue.enqueue(f_Id(1));
        h.queue.enqueue(f_Id(2));
        await h.clock.advance(0);
        expect(h.queue.dispose()).toBe(2);
        await h.clock.advance(HOUR);
        expect(h.startCalls).toHaveLength(1);
        expect(h.idles).toEqual([]);
        expect(h.queue.enqueue(f_Id(3))).toBe("duplicate");

        const running = f_Harness([f_Job(1), f_Job(2)]);
        running.queue.enqueue(f_Id(1));
        running.queue.enqueue(f_Id(2));
        await running.clock.advance(0);
        expect(running.queue.dispose()).toBe(1);
        expect(running.clock.pending()).toBe(0);
    });

    it("예약 기록·알림: lastAutoRunAt 기록(nextRunAt 안 건드림), noop은 알리지 않고 success는 알린다", async () => {
        const h = f_Harness([f_Job(1), f_Job(2)]);
        h.queue.enqueue(f_Id(1));
        h.queue.enqueue(f_Id(2));
        await h.clock.advance(0);
        h.started[0]!.finish("noop");
        await h.clock.advance(MIN);
        h.started[1]!.finish("success");
        await h.clock.advance(0);
        expect(h.book).toEqual([
            { id: f_Id(1), lastAutoRunAt: new Date(0).toISOString() },
            { id: f_Id(2), lastAutoRunAt: new Date(MIN).toISOString() },
        ]);
        expect(h.notices).toHaveLength(1);
        expect(h.notices[0]!.message).toContain("작업2");
    });

    it("예상하지 못한 오류: 그 항목은 1로 끝내고 다음 항목을 처리한 뒤 onIdle에 이른다", async () => {
        const h = f_Harness([f_Job(1), f_Job(2)]);
        h.failListTimes(1);
        h.queue.enqueue(f_Id(1));
        h.queue.enqueue(f_Id(2));
        await h.clock.advance(0);
        expect(h.startCalls.map((x) => x.jobId)).toEqual([f_Id(2)]);
        h.started[0]!.finish("success");
        await h.clock.advance(0);
        expect(h.idles).toEqual([1]);
        expect(h.queue.isIdle()).toBe(true);
        expect(h.logs.some((m) => m.includes(`OS 예약 대기열 오류: job=${f_Id(1)}`))).toBe(true);
    });

    it("예상하지 못한 오류가 마지막 항목이어도 onIdle을 부른다", async () => {
        const h = f_Harness([f_Job(1)]);
        h.failListTimes(1);
        h.queue.enqueue(f_Id(1));
        await h.clock.advance(0);
        expect(h.idles).toEqual([1]);
        expect(h.queue.isIdle()).toBe(true);
    });

    it("비었다가 다시 차면 onIdle을 다시 부른다", async () => {
        const h = f_Harness([f_Job(1), f_Job(2)]);
        h.queue.enqueue(f_Id(1));
        await h.clock.advance(0);
        h.started[0]!.finish("success");
        await h.clock.advance(0);
        h.queue.enqueue(f_Id(2));
        await h.clock.advance(0);
        h.started[1]!.finish("blocked");
        await h.clock.advance(0);
        expect(h.idles).toEqual([0, 0]);
    });
});
