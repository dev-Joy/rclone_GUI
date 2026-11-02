/**
 * OS 예약 실행 대기열 (INT-003 T-01, spec FR-12·FR-16·FR-17·FR-18·FR-22·FR-34).
 *
 * - Windows 작업 스케줄러가 띄운 `--run-job <id>`(헤드리스 첫 프로세스 또는 second-instance로 넘겨받은 요청)를
 *   한 번에 하나씩 FIFO로 돌린다. 같은 jobId가 대기·실행 중이면 무시한다(작업 스케줄러 IgnoreNew와 같은 의미).
 * - 진입 검사(작업 있음 → 켜짐 → 예약 방식 os → 일시정지 아님)는 시작할 때마다 다시 한다(락을 기다리는 사이 바뀔 수 있음).
 *   작업이 없으면 이력 없이 끝내고, 그 밖의 차단은 blocked 이력(SCHEDULE_SKIPPED)을 남긴다. 일시정지 차단은 알리지 않는다.
 * - 다른 실행이 락을 쥐고 있으면(BUSY) 5초마다 다시 보고, 60분이 넘으면 blocked(BUSY)로 끝낸다(실행 시작 뒤에는 세지 않음).
 * - 전송 전에 락 밖에서 경로 접근을 확인하고, 재시도할 오류(경로 없음·네트워크)는 2분 간격 3번 다시 본다.
 *   그래도 안 되면 그대로 startAuto로 진행해 비교 단계가 정확한 failed 이력을 남긴다. 전송을 시작한 뒤에는 재시도하지 않는다.
 * - 실행 시작 뒤 12시간이 지나면 cancel(runId, "timeLimit")로 멈춘다.
 * - 실제 전송은 run-service의 startAuto(자동 게이트)만 거친다(AGENTS.md 안전 규칙 2).
 * - app.log에는 jobId·코드·횟수만 남긴다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsLogger } from "@/main/lib/logger";
import { checkDestProbe, checkSourceProbe } from "@/main/services/compare-service";
import type { clsPathService } from "@/main/services/path-service";
import type { clsRunService, itfAutoOutcome } from "@/main/services/run-service";
import { autoOutcomeNotice } from "@/main/services/scheduler";
import type { clsJobStore } from "@/main/store/job-store";
import type { typErrorCode } from "@/shared/errors";
import { checkRunPaths, parsePath } from "@/shared/path-utils";
import type { typAppErrorPayload, typRunStatus } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";
import type { itfAppNotify } from "@/shared/types/scheduler";

/**
 *  Types · 상수
 */
/** 다른 실행이 끝나기를 기다리는 최대 시간(FR-16) */
export const OS_RUN_MAX_WAIT_MS = 60 * 60_000;
/** 락 해제 감지 간격 */
export const OS_RUN_BUSY_POLL_MS = 5_000;
/** 경로 확인 재시도 간격·횟수(FR-22) */
export const OS_RUN_PATH_RETRY_MS = 2 * 60_000;
export const OS_RUN_PATH_RETRIES = 3;
/** 실행 시간 제한(FR-34). OS 쪽 ExecutionTimeLimit(13시간)보다 짧다 */
export const OS_RUN_TIME_LIMIT_MS = 12 * 60 * 60_000;

/** 헤드리스 종료 코드: 0 성공·바꿀 것 없음, 1 실패·일부 실패·중지, 2 인자 오류·차단, 3 시작 실패 */
export type typHeadlessExitCode = 0 | 1 | 2 | 3;

export type typOsRunBlockReason = "disabled" | "notOsBackend" | "paused";

export type typOsRunEntry =
    | { ok: true; job: typJob }
    | { ok: false; reason: "notFound" }
    | { ok: false; reason: typOsRunBlockReason; job: typJob };

export type typPathCheck = { ok: true } | { ok: false; retryable: boolean; code: typErrorCode };

export interface itfOsRunClock {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(h: unknown): void;
}

export interface itfOsRunLimits {
    maxWaitMs: number;
    busyPollMs: number;
    pathRetryMs: number;
    pathRetries: number;
    timeLimitMs: number;
}

export interface itfOsRunQueueDeps {
    jobs: Pick<clsJobStore, "list" | "setBookkeeping">;
    settings: { get(): typSettings };
    runs: Pick<clsRunService, "startAuto" | "cancel" | "recordAutoBlocked">;
    checkPaths: (job: typJob) => Promise<typPathCheck>;
    notify: (n: itfAppNotify) => void;
    logger: Pick<clsLogger, "info" | "warn">;
    /** 기본: Date.now + 전역 타이머 */
    clock?: itfOsRunClock;
    limits?: Partial<itfOsRunLimits>;
    /** 실행 중·대기 항목이 모두 비었을 때. 인자는 첫 항목(argv)의 종료 코드(없으면 null) */
    onIdle?: (firstExit: typHeadlessExitCode | null) => void;
}

interface itfQueueItem {
    jobId: string;
    enqueuedAt: number;
    first: boolean;
    pathChecked: boolean;
}

/** 한 번 처리한 결과: 끝남 / 같은 항목을 처음부터 다시 / 정리되어 멈춤 */
type typStep = "done" | "again" | "stop";

const DEFAULT_LIMITS: itfOsRunLimits = {
    maxWaitMs: OS_RUN_MAX_WAIT_MS,
    busyPollMs: OS_RUN_BUSY_POLL_MS,
    pathRetryMs: OS_RUN_PATH_RETRY_MS,
    pathRetries: OS_RUN_PATH_RETRIES,
    timeLimitMs: OS_RUN_TIME_LIMIT_MS,
};

const DEFAULT_CLOCK: itfOsRunClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

const BLOCK_TEXT: Record<typOsRunBlockReason, string> = {
    disabled: "자동 실행이 꺼져 있어 Windows 예약 실행을 하지 않았습니다.",
    notOsBackend: "예약 방식이 ‘앱이 켜져 있을 때’라 Windows 예약 실행을 하지 않았습니다.",
    paused: "자동 실행이 일시정지되어 Windows 예약 실행을 하지 않았습니다.",
};

export const OS_RUN_WAIT_TIMEOUT_TEXT = "다른 실행이 60분 넘게 끝나지 않아 실행하지 않았습니다.";

/**
 *  export 함수(순수)
 */

/** FR-12 진입 검사: 작업 있음 → 켜짐 → 예약 방식 os → 일시정지 아님 */
export function checkOsRunEntry(job: typJob | null, paused: boolean): typOsRunEntry {
    if (job === null) return { ok: false, reason: "notFound" };
    if (!job.autoSync.enabled) return { ok: false, reason: "disabled", job };
    if (job.autoSync.backend !== "os") return { ok: false, reason: "notOsBackend", job };
    if (paused) return { ok: false, reason: "paused", job };
    return { ok: true, job };
}

/** 차단 이유 → 이력 오류(SCHEDULE_SKIPPED, 문구에 경로 없음) */
export function entryBlockError(reason: typOsRunBlockReason): typAppErrorPayload {
    return { code: "SCHEDULE_SKIPPED", message: BLOCK_TEXT[reason] };
}

/** FR-17: success·noop 0, failed·partial·canceled 1(running·interrupted도 1), blocked 2 */
export function exitCodeForStatus(status: typRunStatus): typHeadlessExitCode {
    switch (status) {
        case "success":
        case "noop":
            return 0;
        case "blocked":
            return 2;
        default:
            return 1;
    }
}

/**
 * 헤드리스 종료를 이어갈지(index.ts f_HeadlessExit가 대기 전후에 본다).
 * 헤드리스가 아니거나(GUI로 바뀜) 이미 종료 중이면 stay. 대기열이 비지 않았으면(대기 중 새 요청) stay —
 * 그 요청이 끝나면 onIdle이 다시 부른다. force(종료 요청)면 대기열과 무관하게 exit.
 */
export function headlessExitDecision(s: {
    headless: boolean;
    quitting: boolean;
    queueIdle: boolean;
    force: boolean;
}): "exit" | "stay" {
    if (!s.headless || s.quitting) return "stay";
    return s.force || s.queueIdle ? "exit" : "stay";
}

/** 재시도할 경로 오류: PATH_NOT_FOUND(없음·시간 초과·권한 대기)·RCLONE_FAILED(네트워크). 형식·설정·rclone 없음은 아님 */
export function isRetryablePathError(code: typErrorCode): boolean {
    return code === "PATH_NOT_FOUND" || code === "RCLONE_FAILED";
}

/** 전송 전 경로 접근 확인: checkRunPaths(형식) → 원본·대상 probe → 비교와 같은 판정(checkSourceProbe/checkDestProbe) */
export async function precheckJobPaths(
    job: typJob,
    deps: { pathService: Pick<clsPathService, "probe">; settings: { get(): typSettings } },
): Promise<typPathCheck> {
    const check = checkRunPaths(
        job.source,
        job.destination,
        deps.settings.get().compare.caseInsensitivePaths,
    );
    const first = check.errors[0];
    if (first) return { ok: false, retryable: false, code: first.code };
    const src = parsePath(job.source);
    const dst = parsePath(job.destination);
    if (!src.ok || !dst.ok) return { ok: false, retryable: false, code: "PATH_INVALID" };
    try {
        const [sp, dp] = await Promise.all([
            deps.pathService.probe({ path: job.source, configPath: job.configPathOverride }),
            deps.pathService.probe({ path: job.destination, configPath: job.configPathOverride }),
        ]);
        checkSourceProbe(src.path, sp);
        checkDestProbe(dst.path, dp);
        return { ok: true };
    } catch (e) {
        const code: typErrorCode = e instanceof clsAppError ? e.code : "INTERNAL";
        return { ok: false, retryable: isRetryablePathError(code), code };
    }
}

/**
 *  메인 클래스
 */
export class clsOsRunQueue {
    private readonly deps: itfOsRunQueueDeps;
    private readonly clock: itfOsRunClock;
    private readonly limits: itfOsRunLimits;
    /** head가 처리 중(실행 중 포함)인 항목 */
    private readonly queue: itfQueueItem[] = [];
    private readonly sleeps = new Map<unknown, (v: boolean) => void>();
    private pumping = false;
    private disposed = false;
    private enqueuedAny = false;
    private headStarted = false;
    private timeLimitTimer: unknown = null;
    private firstExit: typHeadlessExitCode | null = null;

    constructor(deps: itfOsRunQueueDeps) {
        this.deps = deps;
        this.clock = deps.clock ?? DEFAULT_CLOCK;
        this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
    }

    /** 같은 jobId가 대기·실행 중이면 "duplicate". 정리(dispose) 뒤에는 받지 않는다(duplicate) */
    enqueue(jobId: string): "queued" | "duplicate" {
        const id = jobId.toLowerCase();
        if (this.disposed || this.queue.some((q) => q.jobId === id)) {
            this.deps.logger.info(`OS 예약 요청 무시(중복·종료 중): job=${id}`);
            return "duplicate";
        }
        this.queue.push({
            jobId: id,
            enqueuedAt: this.clock.now(),
            first: !this.enqueuedAny,
            pathChecked: false,
        });
        this.enqueuedAny = true;
        this.deps.logger.info(`OS 예약 요청: job=${id} 대기 ${this.queue.length}건`);
        void this.pump();
        return "queued";
    }

    activeJobIds(): ReadonlySet<string> {
        return new Set(this.queue.map((q) => q.jobId));
    }

    isIdle(): boolean {
        return this.queue.length === 0 && !this.pumping;
    }

    /** 타이머·대기를 모두 멈추고 남은 대기 항목 수(실행 중 제외)를 돌려준다(앱 종료) */
    dispose(): number {
        if (this.disposed) return 0;
        this.disposed = true;
        if (this.timeLimitTimer !== null) this.clock.clearTimeout(this.timeLimitTimer);
        this.timeLimitTimer = null;
        for (const [h, resolve] of this.sleeps) {
            this.clock.clearTimeout(h);
            resolve(false);
        }
        this.sleeps.clear();
        const left = this.queue.length - (this.headStarted ? 1 : 0);
        if (left > 0) this.deps.logger.info(`OS 예약 대기열 정리: 버린 대기 ${left}건`);
        return left;
    }

    /** 한 번에 하나(직렬). 이미 돌고 있으면 아무것도 하지 않는다 */
    private async pump(): Promise<void> {
        if (this.pumping) return;
        this.pumping = true;
        try {
            while (this.queue.length > 0 && !this.disposed) {
                const head = this.queue[0]!;
                let step: typStep;
                try {
                    step = await this.runOne(head);
                } catch (e) {
                    // 예상하지 못한 오류: 이 항목을 실패(1)로 끝내고 다음 항목·onIdle로 넘어간다
                    this.deps.logger.warn(`OS 예약 대기열 오류: job=${head.jobId}`, e);
                    if (this.timeLimitTimer !== null) this.clock.clearTimeout(this.timeLimitTimer);
                    this.timeLimitTimer = null;
                    this.finish(head, 1);
                    continue;
                }
                if (step === "stop") return;
            }
        } finally {
            this.pumping = false;
        }
        if (this.disposed || this.queue.length > 0) return;
        try {
            this.deps.onIdle?.(this.firstExit);
        } catch (e) {
            this.deps.logger.warn("OS 예약 대기열 onIdle 오류", e);
        }
    }

    private async runOne(item: itfQueueItem): Promise<typStep> {
        // (a) 60분 넘게 기다림(실행 시작 전만 센다)
        if (this.clock.now() - item.enqueuedAt > this.limits.maxWaitMs) {
            await this.block(item, { code: "BUSY", message: OS_RUN_WAIT_TIMEOUT_TEXT }, true);
            return "done";
        }
        // (b) 진입 검사(락이 풀릴 때마다 다시)
        const job = this.deps.jobs.list().find((j) => j.id.toLowerCase() === item.jobId) ?? null;
        const entry = checkOsRunEntry(job, this.deps.settings.get().scheduler.paused);
        if (!entry.ok) {
            if (entry.reason === "notFound") {
                this.deps.logger.info(`OS 예약 작업 없음: job=${item.jobId}`);
                this.finish(item, 2);
                return "done";
            }
            // 일시정지 중에는 예약마다 알림이 쌓이지 않도록 알리지 않는다(이력은 남김)
            await this.block(item, entryBlockError(entry.reason), entry.reason !== "paused");
            return "done";
        }
        // (c) 경로 사전 확인: 항목당 한 번, 락 밖, 전송 전만
        if (!item.pathChecked) {
            for (let attempt = 0; ; attempt += 1) {
                const r = await this.safeCheckPaths(entry.job);
                if (r.ok || !r.retryable || attempt >= this.limits.pathRetries) break;
                this.deps.logger.info(
                    `경로 확인 재시도 ${attempt + 1}/${this.limits.pathRetries}: job=${item.jobId} code=${r.code}`,
                );
                if (!(await this.sleep(this.limits.pathRetryMs))) return "stop";
            }
            item.pathChecked = true;
            // 기다리는 동안 설정이 바뀌었을 수 있으므로 진입 검사부터 다시
            return "again";
        }
        // (d) 시작(락이 차 있으면 기다렸다 다시)
        let started: { runId: string; done: Promise<itfAutoOutcome> };
        try {
            started = await this.deps.runs.startAuto(entry.job.id, "os-scheduler");
        } catch (e) {
            if (e instanceof clsAppError && e.code === "BUSY") {
                return (await this.sleep(this.limits.busyPollMs)) ? "again" : "stop";
            }
            const code = e instanceof clsAppError ? e.code : "INTERNAL";
            this.deps.logger.warn(`OS 예약 실행 시작 실패: job=${item.jobId} code=${code}`);
            this.finish(item, 2);
            return "done";
        }
        // (e) 시간 제한: 실행 시작 시각 기준
        this.headStarted = true;
        const runId = started.runId;
        this.timeLimitTimer = this.clock.setTimeout(() => {
            this.timeLimitTimer = null;
            this.deps.logger.warn(`OS 예약 실행 시간 제한: run=${runId} job=${item.jobId}`);
            this.deps.runs.cancel(runId, "timeLimit");
        }, this.limits.timeLimitMs);
        const outcome = await started.done;
        if (this.timeLimitTimer !== null) this.clock.clearTimeout(this.timeLimitTimer);
        this.timeLimitTimer = null;
        // OS 예약은 nextRunAt을 두지 않는다(null 유지)
        await this.deps.jobs
            .setBookkeeping(entry.job.id, { lastAutoRunAt: outcome.finishedAt })
            .catch((e: unknown) => this.deps.logger.warn(`작업 기록 실패: job=${item.jobId}`, e));
        this.safeNotify(autoOutcomeNotice(outcome));
        this.finish(item, exitCodeForStatus(outcome.status));
        return "done";
    }

    /** 실행하지 않고 blocked 이력을 남긴다(작업이 그 사이 지워졌으면 이력 없이) */
    private async block(
        item: itfQueueItem,
        error: typAppErrorPayload,
        notify: boolean,
    ): Promise<void> {
        try {
            const o = await this.deps.runs.recordAutoBlocked(item.jobId, "os-scheduler", error);
            if (notify) this.safeNotify(autoOutcomeNotice(o));
        } catch (e) {
            const code = e instanceof clsAppError ? e.code : "INTERNAL";
            this.deps.logger.warn(`OS 예약 차단 기록 실패: job=${item.jobId} code=${code}`);
        }
        this.deps.logger.info(`OS 예약 차단: job=${item.jobId} code=${error.code}`);
        this.finish(item, 2);
    }

    private finish(item: itfQueueItem, code: typHeadlessExitCode): void {
        if (this.queue[0] === item) this.queue.shift();
        this.headStarted = false;
        if (item.first) this.firstExit = code;
        this.deps.logger.info(`OS 예약 처리 끝: job=${item.jobId} exit=${code}`);
    }

    private async safeCheckPaths(job: typJob): Promise<typPathCheck> {
        try {
            return await this.deps.checkPaths(job);
        } catch {
            return { ok: false, retryable: false, code: "INTERNAL" };
        }
    }

    private safeNotify(n: itfAppNotify | null): void {
        if (!n) return;
        try {
            this.deps.notify(n);
        } catch {
            // 알림 실패로 대기열을 멈추지 않는다
        }
    }

    /** ms 뒤 true. 그 전에 정리(dispose)되면 false */
    private sleep(ms: number): Promise<boolean> {
        if (this.disposed) return Promise.resolve(false);
        return new Promise((resolve) => {
            const h = this.clock.setTimeout(() => {
                this.sleeps.delete(h);
                resolve(!this.disposed);
            }, ms);
            this.sleeps.set(h, resolve);
        });
    }
}
