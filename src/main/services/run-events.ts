/**
 * 실행 이벤트 묶음 전송 (MVP_SPEC §8.3). rclone 로그가 많아도 화면으로 보내는 양을 제한한다.
 *
 * - log: 200ms마다 한 번, 한 번에 최대 100줄. 넘치면 오래된 줄을 버리고 dropped로 알린다(파일에는 남음).
 * - stats: 1초에 한 번. 그 사이에 온 값은 마지막 것만 남겨 남은 시간 뒤에 보낸다.
 * - flush: 남은 log·stats를 바로 보낸다(phase·finished 이벤트 전에 부른다).
 * 타이머는 주입할 수 있다(테스트).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typRunStats } from "@/shared/schemas/run";
import type { itfRunLogLine, typRunEvent } from "@/shared/types/run";

export interface itfBatcherTimers {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    now(): number;
}

export interface itfRunEventBatcherOptions {
    runId: string;
    emit: (e: typRunEvent) => void;
    logIntervalMs?: number;
    maxLines?: number;
    statsIntervalMs?: number;
    timers?: itfBatcherTimers;
}

export const DEFAULT_TIMERS: itfBatcherTimers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
    now: () => Date.now(),
};

export class clsRunEventBatcher {
    private readonly runId: string;
    private readonly emit: (e: typRunEvent) => void;
    private readonly logIntervalMs: number;
    private readonly maxLines: number;
    private readonly statsIntervalMs: number;
    private readonly timers: itfBatcherTimers;
    private lines: itfRunLogLine[] = [];
    private dropped = 0;
    private logTimer: unknown = null;
    private pendingStats: typRunStats | null = null;
    private statsTimer: unknown = null;
    private lastStatsAt = Number.NEGATIVE_INFINITY;

    constructor(o: itfRunEventBatcherOptions) {
        this.runId = o.runId;
        this.emit = o.emit;
        this.logIntervalMs = o.logIntervalMs ?? 200;
        this.maxLines = o.maxLines ?? 100;
        this.statsIntervalMs = o.statsIntervalMs ?? 1000;
        this.timers = o.timers ?? DEFAULT_TIMERS;
    }

    pushLog(line: itfRunLogLine): void {
        this.lines.push(line);
        if (this.lines.length > this.maxLines) {
            this.lines.shift();
            this.dropped += 1;
        }
        if (this.logTimer === null) {
            this.logTimer = this.timers.setTimeout(() => {
                this.logTimer = null;
                this.sendLog();
            }, this.logIntervalMs);
        }
    }

    pushStats(stats: typRunStats): void {
        this.pendingStats = stats;
        if (this.statsTimer !== null) return;
        const wait = this.lastStatsAt + this.statsIntervalMs - this.timers.now();
        if (wait <= 0) {
            this.sendStats();
            return;
        }
        this.statsTimer = this.timers.setTimeout(() => {
            this.statsTimer = null;
            this.sendStats();
        }, wait);
    }

    /** 남은 log·stats를 바로 보내고 타이머를 멈춘다 */
    flush(): void {
        if (this.logTimer !== null) {
            this.timers.clearTimeout(this.logTimer);
            this.logTimer = null;
        }
        if (this.statsTimer !== null) {
            this.timers.clearTimeout(this.statsTimer);
            this.statsTimer = null;
        }
        this.sendLog();
        this.sendStats();
    }

    private at(): string {
        return new Date(this.timers.now()).toISOString();
    }

    private sendLog(): void {
        if (this.lines.length === 0 && this.dropped === 0) return;
        const lines = this.lines;
        const dropped = this.dropped;
        this.lines = [];
        this.dropped = 0;
        this.safeEmit({ type: "log", runId: this.runId, lines, dropped, at: this.at() });
    }

    private sendStats(): void {
        const stats = this.pendingStats;
        if (stats === null) return;
        this.pendingStats = null;
        this.lastStatsAt = this.timers.now();
        this.safeEmit({ type: "stats", runId: this.runId, stats, at: this.at() });
    }

    private safeEmit(e: typRunEvent): void {
        try {
            this.emit(e);
        } catch {
            // 창이 닫히는 중 등: 이벤트 실패로 실행을 멈추지 않는다
        }
    }
}
