/**
 * 자동 실행 스케줄러 (MVP_SPEC §10, intent T-10). 앱이 켜져 있는 동안 main에서만 돈다.
 *
 * - 20초마다 tick: 일시정지면 무시, 자기 자동 실행이 진행 중이거나 이전 tick이 끝나지 않았으면 무시(겹침 방지).
 *   예약이 지난 작업 중 가장 이른 1건만 실행 서비스 startAuto로 시작한다.
 * - 전역 락이 차 있으면(BUSY) 예약을 그대로 두고 다음 tick에 다시 본다(로그는 한 번만).
 * - 중복 방지: 시작하자마자 nextRunAt = 시작 시각 + 주기를 먼저 기록하고, 끝나면 끝난 시각 + 주기와
 *   lastAutoRunAt을 기록한다(재시작해도 같은 예약으로 다시 돌지 않는다).
 * - 앱 시작: 켜진 작업의 예약이 없거나 지났으면 now + 60초(몰아서 따라잡지 않음). 절전 재개도 같다.
 *   일시정지를 풀면 지난 예약만 now + 30초.
 * - 알림: blocked·failed·partial·canceled·success만(noop은 알리지 않음). 문구에는 작업 이름과 수만 쓴다(경로 없음).
 *   같은 작업이 연속 3번 실패하면 경고를 한 번 더 알린다(자동 실행을 끄지는 않음, 카운터는 메모리).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsLogger } from "@/main/lib/logger";
import type { clsRunService, itfAutoOutcome } from "@/main/services/run-service";
import type { clsJobStore, itfJobBookkeeping } from "@/main/store/job-store";
import { ERROR_MESSAGES } from "@/shared/errors";
import {
    addMinutes,
    nextAfterFinish,
    nextAutoRun,
    pickDue,
    reconcileNextRun,
    rescheduleOnUnpause,
    RESUME_DELAY_MS,
    SCHEDULER_TICK_MS,
    STARTUP_DELAY_MS,
} from "@/shared/schedule";
import type { typAutoSyncOptions } from "@/shared/schemas/job";
import type { typSettings, typSettingsPatch } from "@/shared/schemas/settings";
import type { itfAppNotify, itfSchedulerState } from "@/shared/types/scheduler";

/** 이 횟수만큼 연속 실패하면 한 번 더 경고한다 */
export const FAILURE_WARN_COUNT = 3;

export interface itfSchedulerTimers {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
}

export interface itfSchedulerDeps {
    jobs: Pick<clsJobStore, "list" | "setBookkeeping">;
    settings: {
        get(): typSettings;
        update(patch: typSettingsPatch): Promise<typSettings>;
    };
    runs: Pick<clsRunService, "startAuto" | "getActive">;
    logger: Pick<clsLogger, "info" | "warn">;
    /** 자동 실행 결과 알림(창이 보이면 토스트, 아니면 OS 알림은 호출하는 쪽이 정한다) */
    notify: (n: itfAppNotify) => void;
    /** 상태가 바뀌었을 때(화면·트레이) */
    emitState?: (s: itfSchedulerState) => void;
    now?: () => Date;
    timers?: itfSchedulerTimers;
    /** tick 간격. 기본 20초 */
    tickMs?: number;
}

const DEFAULT_TIMERS: itfSchedulerTimers = {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
};

type typReconcile = (auto: typAutoSyncOptions, now: Date) => string | null;

function f_Count(n: number | undefined): number {
    return n ?? 0;
}

/** 자동 실행 결과 알림 문구(작업 이름·수만). noop이면 null */
export function autoOutcomeNotice(o: itfAutoOutcome): itfAppNotify | null {
    const name = `‘${o.jobName}’`;
    switch (o.status) {
        case "success": {
            const copied = f_Count(o.stats?.transfers);
            const deleted = f_Count(o.stats?.deletes);
            const parts = [`복사 ${copied}개`];
            if (deleted > 0) parts.push(`삭제 ${deleted}개`);
            return { level: "success", message: `${name} 자동 실행 완료: ${parts.join(", ")}` };
        }
        case "partial":
            return {
                level: "warning",
                message: `${name} 자동 실행 일부 실패: 오류 ${f_Count(o.stats?.errors)}개. 이력에서 로그를 확인하세요.`,
            };
        case "failed":
            return {
                level: "error",
                message: `${name} 자동 실행 실패: ${o.error ? ERROR_MESSAGES[o.error.code] : ERROR_MESSAGES.INTERNAL} 이력에서 자세히 확인하세요.`,
            };
        case "blocked":
            // 게이트 문구는 수만 담는다(경로 없음)
            return {
                level: "warning",
                message: `${name} 자동 실행을 멈췄습니다: ${o.error?.message ?? ERROR_MESSAGES.SAFETY_BLOCKED}`,
            };
        case "canceled":
            return { level: "info", message: `${name} 자동 실행을 취소했습니다.` };
        default:
            return null;
    }
}

export class clsScheduler {
    private readonly deps: Required<Omit<itfSchedulerDeps, "emitState">> &
        Pick<itfSchedulerDeps, "emitState">;
    private timer: unknown = null;
    /** tick이 자동 실행을 시작하는 중 */
    private ticking = false;
    /** 이 스케줄러가 시작한 진행 중 자동 실행 */
    private current: { jobId: string; runId: string } | null = null;
    /** 락이 차 있어 미룬 것을 이미 로그에 남겼는지 */
    private busyLogged = false;
    private readonly failures = new Map<string, number>();

    constructor(deps: itfSchedulerDeps) {
        this.deps = {
            now: () => new Date(),
            timers: DEFAULT_TIMERS,
            tickMs: SCHEDULER_TICK_MS,
            ...deps,
        };
    }

    /** 앱 시작: 지난 예약을 now + 60초로 맞추고 tick을 건다 */
    async start(): Promise<void> {
        await this.reconcileAll((auto, now) => reconcileNextRun(auto, now, STARTUP_DELAY_MS));
        if (this.timer === null) {
            this.timer = this.deps.timers.setInterval(() => void this.tick(), this.deps.tickMs);
        }
        this.deps.logger.info(`스케줄러 시작: tick=${this.deps.tickMs}ms`);
        this.emitState();
    }

    stop(): void {
        if (this.timer === null) return;
        this.deps.timers.clearInterval(this.timer);
        this.timer = null;
    }

    /** 예약이 지난 작업 1건을 시작한다(테스트에서 직접 부른다) */
    async tick(): Promise<void> {
        if (this.ticking || this.current !== null) return;
        if (this.deps.settings.get().scheduler.paused) return;
        const now = this.deps.now();
        const job = pickDue(this.deps.jobs.list(), now);
        if (!job) return;
        this.ticking = true;
        try {
            let started: Awaited<ReturnType<clsRunService["startAuto"]>>;
            try {
                started = await this.deps.runs.startAuto(job.id);
            } catch (e) {
                if (e instanceof clsAppError && e.code === "BUSY") {
                    // 다른 비교·실행이 끝나면 다음 tick에 다시 본다(예약 유지)
                    if (!this.busyLogged) {
                        this.busyLogged = true;
                        this.deps.logger.info(`자동 실행 대기(다른 작업 진행 중): job=${job.id}`);
                    }
                    return;
                }
                const code = e instanceof clsAppError ? e.code : "INTERNAL";
                this.deps.logger.warn(`자동 실행을 시작하지 못함: job=${job.id} code=${code}`);
                // 같은 오류로 tick마다 반복하지 않도록 다음 주기로 미룬다
                await this.book(job.id, {
                    nextRunAt: addMinutes(now, job.autoSync.intervalMinutes),
                });
                return;
            }
            this.busyLogged = false;
            this.current = { jobId: job.id, runId: started.runId };
            // 중복 방지: 시작하자마자 다음 예약을 먼저 기록한다
            await this.book(job.id, {
                nextRunAt: addMinutes(now, job.autoSync.intervalMinutes),
            });
            this.emitState();
            void started.done.then((o) => this.onFinished(o));
        } finally {
            this.ticking = false;
        }
    }

    getState(): itfSchedulerState {
        const a = this.deps.runs.getActive();
        return {
            paused: this.deps.settings.get().scheduler.paused,
            running: a ? { jobId: a.jobId, jobName: a.jobName, trigger: a.trigger } : null,
            next: nextAutoRun(this.deps.jobs.list()),
        };
    }

    /** 일시정지·해제(진행 중 실행은 그대로). 해제하면 지난 예약을 now + 30초로 미룬다 */
    async setPaused(paused: boolean): Promise<itfSchedulerState> {
        await this.deps.settings.update({ scheduler: { paused } });
        if (!paused) await this.reconcileAll(rescheduleOnUnpause);
        this.deps.logger.info(`자동 실행 ${paused ? "일시정지" : "재개"}`);
        this.emitState();
        return this.getState();
    }

    /** 절전에서 깨어남: 지난 예약을 now + 60초로 미룬다(몰아서 실행하지 않음) */
    async onResume(): Promise<void> {
        await this.reconcileAll((auto, now) => reconcileNextRun(auto, now, RESUME_DELAY_MS));
        this.emitState();
    }

    /** 상태를 다시 알린다(작업 목록·실행 상태가 바뀌었을 때) */
    emitState(): void {
        try {
            this.deps.emitState?.(this.getState());
        } catch {
            // 창·트레이 갱신 실패로 스케줄러를 멈추지 않는다
        }
    }

    private async onFinished(o: itfAutoOutcome): Promise<void> {
        const job = this.deps.jobs.list().find((j) => j.id === o.jobId) ?? null;
        try {
            if (job) {
                await this.book(o.jobId, {
                    nextRunAt: job.autoSync.enabled
                        ? nextAfterFinish(o.finishedAt, job.autoSync.intervalMinutes)
                        : null,
                    lastAutoRunAt: o.finishedAt,
                });
            }
            this.countFailure(o);
            const notice = autoOutcomeNotice(o);
            if (notice) this.safeNotify(notice);
        } finally {
            this.current = null;
            this.emitState();
        }
    }

    private countFailure(o: itfAutoOutcome): void {
        if (o.status === "success" || o.status === "noop") {
            this.failures.delete(o.jobId);
            return;
        }
        if (o.status !== "failed" && o.status !== "partial") return;
        const n = (this.failures.get(o.jobId) ?? 0) + 1;
        this.failures.set(o.jobId, n);
        if (n === FAILURE_WARN_COUNT) {
            this.deps.logger.warn(`자동 실행 연속 실패 ${n}회: job=${o.jobId}`);
            this.safeNotify({
                level: "warning",
                message: `‘${o.jobName}’ 자동 실행이 ${n}번 연속 실패했습니다. 작업 설정과 이력의 로그를 확인하세요.`,
            });
        }
    }

    private async reconcileAll(fn: typReconcile): Promise<void> {
        const now = this.deps.now();
        for (const job of this.deps.jobs.list()) {
            if (this.current?.jobId === job.id) continue;
            const want = fn(job.autoSync, now);
            if (want !== job.autoSync.nextRunAt) await this.book(job.id, { nextRunAt: want });
        }
    }

    private async book(jobId: string, b: itfJobBookkeeping): Promise<void> {
        try {
            await this.deps.jobs.setBookkeeping(jobId, b);
        } catch (e) {
            const code = e instanceof clsAppError ? e.code : "INTERNAL";
            this.deps.logger.warn(`예약 기록 실패: job=${jobId} code=${code}`);
        }
    }

    private safeNotify(n: itfAppNotify): void {
        try {
            this.deps.notify(n);
        } catch {
            // 알림 실패로 스케줄러를 멈추지 않는다
        }
    }
}
