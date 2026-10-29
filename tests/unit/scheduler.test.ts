// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { itfAutoOutcome } from "@/main/services/run-service";
import { autoOutcomeNotice, clsScheduler, FAILURE_WARN_COUNT } from "@/main/services/scheduler";
import { createDefaultSettings } from "@/shared/defaults";
import { PARTIAL_LEFT_NOTICE_SHORT } from "@/shared/partial-files";
import type { typJob } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";
import type { itfRunSnapshot } from "@/shared/types/run";
import type { itfAppNotify, itfSchedulerState } from "@/shared/types/scheduler";

const T0 = Date.parse("2026-10-29T10:00:00.000Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const MIN = 60_000;

function f_Id(n: number): string {
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function f_Job(
    n: number,
    nextRunAt: string | null,
    over: Partial<typJob["autoSync"]> = {},
): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: f_Id(n),
        name: `작업${n}`,
        notes: "",
        source: "C:\\fake\\src",
        destination: "C:\\fake\\dst",
        mode: "copy",
        excludes: [...excludes],
        options,
        configPathOverride: null,
        autoSync: {
            enabled: true,
            intervalMinutes: 10,
            allowDeletes: false,
            nextRunAt,
            lastAutoRunAt: null,
            ...over,
        },
        rev: 0,
        createdAt: iso(0),
        updatedAt: iso(0),
        lastRun: null,
    };
}

function f_Deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let settle: ((v: T) => void) | null = null;
    const promise = new Promise<T>((r) => {
        settle = r;
    });
    return { promise, resolve: (v) => settle?.(v) };
}

interface itfDeferred {
    jobId: string;
    runId: string;
    resolve: (o: Partial<itfAutoOutcome>) => void;
}

function f_Harness(jobsInit: typJob[], o: { paused?: boolean; startError?: clsAppError } = {}) {
    let nowMs = T0;
    let jobs = jobsInit.map((j) => structuredClone(j));
    let settings: typSettings = {
        ...createDefaultSettings(),
        scheduler: { paused: o.paused ?? false },
    };
    let busy = false;
    let seq = 0;
    const started: itfDeferred[] = [];
    const notices: itfAppNotify[] = [];
    const states: itfSchedulerState[] = [];
    const logs: string[] = [];
    const intervals: Array<{ fn: () => void; ms: number }> = [];
    let active: { jobId: string; jobName: string } | null = null;

    const sched = new clsScheduler({
        jobs: {
            list: () => jobs,
            setBookkeeping: async (id, b) => {
                jobs = jobs.map((j) =>
                    j.id !== id
                        ? j
                        : {
                              ...j,
                              lastRun: b.lastRun === undefined ? j.lastRun : b.lastRun,
                              autoSync: {
                                  ...j.autoSync,
                                  ...(b.nextRunAt === undefined ? {} : { nextRunAt: b.nextRunAt }),
                                  ...(b.lastAutoRunAt === undefined
                                      ? {}
                                      : { lastAutoRunAt: b.lastAutoRunAt }),
                              },
                          },
                );
                return jobs.find((j) => j.id === id)!;
            },
        },
        settings: {
            get: () => settings,
            update: async (patch) => {
                settings = {
                    ...settings,
                    scheduler: { ...settings.scheduler, ...patch.scheduler },
                };
                return settings;
            },
        },
        runs: {
            startAuto: async (jobId) => {
                if (o.startError) throw o.startError;
                if (busy || active) throw new clsAppError("BUSY", "busy");
                seq += 1;
                const runId = f_Id(900 + seq);
                const job = jobs.find((j) => j.id === jobId)!;
                active = { jobId, jobName: job.name };
                const { promise: done, resolve: resolveDone } = f_Deferred<itfAutoOutcome>();
                started.push({
                    jobId,
                    runId,
                    resolve: (over) => {
                        active = null;
                        resolveDone({
                            runId,
                            jobId,
                            jobName: job.name,
                            status: "success",
                            error: null,
                            plan: null,
                            stats: null,
                            finishedAt: new Date(nowMs).toISOString(),
                            recorded: true,
                            transferStarted: false,
                            ...over,
                        });
                    },
                });
                return { runId, done };
            },
            getActive: () =>
                active ? ({ ...active, trigger: "scheduler" } as unknown as itfRunSnapshot) : null,
        },
        logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
        notify: (n) => notices.push(n),
        emitState: (s) => states.push(s),
        now: () => new Date(nowMs),
        timers: {
            setInterval: (fn, ms) => {
                intervals.push({ fn, ms });
                return intervals.length;
            },
            clearInterval: () => undefined,
        },
    });
    return {
        sched,
        started,
        notices,
        states,
        logs,
        intervals,
        job: (n: number) => jobs.find((j) => j.id === f_Id(n))!,
        settings: () => settings,
        setBusy: (v: boolean) => {
            busy = v;
        },
        advance: (ms: number) => {
            nowMs += ms;
        },
        nowIso: () => new Date(nowMs).toISOString(),
        /** 끝난 자동 실행의 후처리(예약 기록·알림)를 기다린다 */
        flush: async () => {
            for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
        },
    };
}

describe("clsScheduler 시작·재시작", () => {
    it("start: 지난·없는 예약은 now+60초, 미래는 유지, 꺼진 작업은 null, tick 20초", async () => {
        const h = f_Harness([
            f_Job(1, iso(-5 * MIN)),
            f_Job(2, null),
            f_Job(3, iso(5 * MIN)),
            f_Job(4, iso(-MIN), { enabled: false }),
        ]);
        await h.sched.start();
        expect(h.job(1).autoSync.nextRunAt).toBe(iso(MIN));
        expect(h.job(2).autoSync.nextRunAt).toBe(iso(MIN));
        expect(h.job(3).autoSync.nextRunAt).toBe(iso(5 * MIN));
        expect(h.job(4).autoSync.nextRunAt).toBeNull();
        expect(h.intervals).toEqual([expect.objectContaining({ ms: 20_000 })]);
        expect(h.states.at(-1)?.next).toMatchObject({ jobId: f_Id(1), at: iso(MIN) });
    });

    it("재시작 직후 지난 예약은 바로 돌지 않고(중복 0) 60초 뒤 한 번만 돈다", async () => {
        const h = f_Harness([f_Job(1, iso(-30 * MIN))]);
        await h.sched.start();
        await h.sched.tick();
        expect(h.started).toHaveLength(0);
        h.advance(MIN);
        await h.sched.tick();
        await h.sched.tick();
        expect(h.started).toHaveLength(1);
    });
});

describe("clsScheduler tick", () => {
    it("기한이 지난 가장 이른 1건만 시작, 시작하자마자 now+주기 기록, 끝나면 끝난 시각+주기·lastAutoRunAt", async () => {
        const h = f_Harness([f_Job(1, iso(-MIN)), f_Job(2, iso(-2 * MIN)), f_Job(3, iso(MIN))]);
        await h.sched.tick();
        expect(h.started.map((s) => s.jobId)).toEqual([f_Id(2)]);
        expect(h.job(2).autoSync.nextRunAt).toBe(iso(10 * MIN));
        expect(h.states.at(-1)?.running).toMatchObject({ jobId: f_Id(2), trigger: "scheduler" });
        h.advance(30_000);
        h.started[0]!.resolve({ status: "success", stats: null });
        await h.flush();
        expect(h.job(2).autoSync).toMatchObject({
            nextRunAt: iso(30_000 + 10 * MIN),
            lastAutoRunAt: iso(30_000),
        });
        // 다음 tick에서 남은 작업 1
        await h.sched.tick();
        expect(h.started.map((s) => s.jobId)).toEqual([f_Id(2), f_Id(1)]);
    });

    it("겹침 방지: 자동 실행 중이거나 동시에 부른 tick은 하나만 시작한다", async () => {
        const h = f_Harness([f_Job(1, iso(-MIN)), f_Job(2, iso(-MIN))]);
        await Promise.all([h.sched.tick(), h.sched.tick()]);
        expect(h.started).toHaveLength(1);
        await h.sched.tick();
        expect(h.started).toHaveLength(1);
    });

    it("락이 차 있으면(BUSY) 예약을 유지하고 로그는 한 번만, 비면 시작한다", async () => {
        const h = f_Harness([f_Job(1, iso(-MIN))]);
        h.setBusy(true);
        await h.sched.tick();
        await h.sched.tick();
        expect(h.started).toHaveLength(0);
        expect(h.job(1).autoSync.nextRunAt).toBe(iso(-MIN));
        expect(h.logs.filter((l) => l.includes("대기"))).toHaveLength(1);
        h.setBusy(false);
        await h.sched.tick();
        expect(h.started).toHaveLength(1);
    });

    it("일시정지면 시작하지 않고, 해제하면 지난 예약을 now+30초로 미룬다", async () => {
        const h = f_Harness([f_Job(1, iso(-MIN)), f_Job(2, iso(5 * MIN))], { paused: true });
        await h.sched.tick();
        expect(h.started).toHaveLength(0);
        const state = await h.sched.setPaused(false);
        expect(h.settings().scheduler.paused).toBe(false);
        expect(state.paused).toBe(false);
        expect(h.job(1).autoSync.nextRunAt).toBe(iso(30_000));
        expect(h.job(2).autoSync.nextRunAt).toBe(iso(5 * MIN));
        await h.sched.tick();
        expect(h.started).toHaveLength(0);
        h.advance(30_000);
        await h.sched.tick();
        expect(h.started).toHaveLength(1);
        expect((await h.sched.setPaused(true)).paused).toBe(true);
    });

    it("꺼진 작업은 시작하지 않는다", async () => {
        const h = f_Harness([f_Job(1, iso(-MIN), { enabled: false })]);
        await h.sched.tick();
        expect(h.started).toHaveLength(0);
    });

    it("주기 변경 뒤 끝나면 새 주기로 예약한다", async () => {
        const h = f_Harness([f_Job(1, iso(-MIN), { intervalMinutes: 3 })]);
        await h.sched.tick();
        expect(h.job(1).autoSync.nextRunAt).toBe(iso(3 * MIN));
        h.started[0]!.resolve({ status: "noop" });
        await h.flush();
        expect(h.job(1).autoSync.nextRunAt).toBe(iso(3 * MIN));
    });

    it("절전 재개: 지난 예약을 now+60초로", async () => {
        const h = f_Harness([f_Job(1, iso(-MIN))]);
        await h.sched.onResume();
        expect(h.job(1).autoSync.nextRunAt).toBe(iso(MIN));
    });

    it("시작 실패(BUSY 아님)는 다음 주기로 미뤄 tick마다 반복하지 않는다", async () => {
        const h = f_Harness([f_Job(1, iso(-MIN))], { startError: new clsAppError("NOT_FOUND") });
        await h.sched.tick();
        expect(h.job(1).autoSync.nextRunAt).toBe(iso(10 * MIN));
    });
});

describe("clsScheduler 알림", () => {
    it("noop은 알리지 않고 blocked·failed·success·canceled는 알린다(작업 이름·수만)", async () => {
        const h = f_Harness([f_Job(1, iso(-MIN))]);
        const outcomes: Array<Partial<itfAutoOutcome>> = [
            { status: "noop" },
            {
                status: "blocked",
                error: { code: "SAFETY_BLOCKED", message: "대상에서 2개를 지워야 하지만" },
            },
            { status: "failed", error: { code: "PATH_NOT_FOUND", message: "원본: C:\\secret" } },
            {
                status: "success",
                stats: {
                    transfers: 3,
                    deletes: 1,
                    errors: 0,
                } as itfAutoOutcome["stats"],
            },
            { status: "canceled" },
        ];
        for (const o of outcomes) {
            h.advance(11 * MIN);
            await h.sched.tick();
            h.started.at(-1)!.resolve(o);
            await h.flush();
        }
        expect(h.notices.map((n) => n.level)).toEqual(["warning", "error", "success", "info"]);
        expect(h.notices[0]!.message).toContain("‘작업1’");
        expect(h.notices[0]!.message).toContain("2개를 지워야");
        expect(h.notices[1]!.message).not.toContain("secret");
        expect(h.notices[2]!.message).toBe("‘작업1’ 자동 실행 완료: 복사 3개, 삭제 1개");
    });

    it(`연속 실패 ${FAILURE_WARN_COUNT}회면 경고를 한 번 더(4회째는 없음), 성공하면 다시 센다`, async () => {
        const h = f_Harness([f_Job(1, iso(-MIN))]);
        const f_Run = async (o: Partial<itfAutoOutcome>) => {
            h.advance(11 * MIN);
            await h.sched.tick();
            h.started.at(-1)!.resolve(o);
            await h.flush();
        };
        const failed = {
            status: "failed" as const,
            error: { code: "RCLONE_FAILED" as const, message: "x" },
        };
        for (let i = 0; i < 4; i += 1) await f_Run(failed);
        const warns = h.notices.filter((n) => n.message.includes("연속 실패"));
        expect(warns).toHaveLength(1);
        expect(h.logs.filter((l) => l.includes("연속 실패"))).toHaveLength(1);
        await f_Run({ status: "success" });
        for (let i = 0; i < 3; i += 1) await f_Run(failed);
        expect(h.notices.filter((n) => n.message.includes("연속 실패"))).toHaveLength(2);
    });

    it("autoOutcomeNotice: noop은 null", () => {
        expect(
            autoOutcomeNotice({
                runId: "r",
                jobId: "j",
                jobName: "n",
                status: "noop",
                error: null,
                plan: null,
                stats: null,
                finishedAt: iso(0),
                recorded: false,
                transferStarted: false,
            }),
        ).toBeNull();
    });

    it("autoOutcomeNotice: 전송 중 실패·취소면 .partial 안내를 덧붙인다(경로 없음)", () => {
        const base: itfAutoOutcome = {
            runId: "r",
            jobId: "j",
            jobName: "n",
            status: "canceled",
            error: null,
            plan: null,
            stats: null,
            finishedAt: iso(0),
            recorded: true,
            transferStarted: true,
        };
        const canceled = autoOutcomeNotice(base);
        expect(canceled).toEqual({
            level: "warning",
            message: `‘n’ 자동 실행을 취소했습니다. ${PARTIAL_LEFT_NOTICE_SHORT}`,
        });
        const failed = autoOutcomeNotice({
            ...base,
            status: "failed",
            error: { code: "RCLONE_FAILED", message: "원본: C:\\secret" },
        });
        expect(failed?.message.endsWith(PARTIAL_LEFT_NOTICE_SHORT)).toBe(true);
        expect(failed?.message).not.toContain("secret");
        // 전송 전에 멈췄거나 성공·일부 실패면 덧붙이지 않는다
        for (const o of [
            { ...base, transferStarted: false },
            { ...base, status: "failed" as const, transferStarted: false },
            { ...base, status: "partial" as const },
            { ...base, status: "success" as const },
        ]) {
            expect(autoOutcomeNotice(o)?.message).not.toContain(".partial");
        }
        expect(autoOutcomeNotice({ ...base, transferStarted: false })?.level).toBe("info");
    });
});
