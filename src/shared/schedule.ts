/**
 * 자동 실행 예약 계산 (MVP_SPEC §10, intent T-10). 순수 함수. 시각은 UTC ISO 문자열로 다룬다.
 *
 * - 편집: 켬 → now + 주기, 주기 변경 → now + 새 주기, 끔 → null, 그 밖에는 기존 값 유지.
 *   새 작업·복제는 켜져 있으면 now + 주기.
 * - 앱 시작·절전 재개: 켜진 작업의 예약이 없거나 지났으면 now + 지연(몰아서 따라잡지 않는다). 꺼진 작업은 null.
 * - 일시정지 해제: 지난 예약만 now + 30초.
 * - 실행할 작업: 켜져 있고 예약 시각이 지난 작업 중 가장 이른 1건.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import type { typAutoSyncOptions } from "@/shared/schemas/job";

/** 스케줄러 확인 간격 */
export const SCHEDULER_TICK_MS = 20_000;
/** 앱 시작 직후 지난 예약을 미루는 시간(시작 직후 폭주 방지) */
export const STARTUP_DELAY_MS = 60_000;
/** 절전에서 깨어난 뒤 지난 예약을 미루는 시간 */
export const RESUME_DELAY_MS = 60_000;
/** 일시정지를 풀었을 때 지난 예약을 미루는 시간 */
export const UNPAUSE_DELAY_MS = 30_000;

type typAutoSyncInput = Pick<typAutoSyncOptions, "enabled" | "intervalMinutes">;
type typAutoSyncState = typAutoSyncInput & Pick<typAutoSyncOptions, "nextRunAt">;

/** 예약 계산에 필요한 작업 정보 */
export interface itfScheduleJob {
    id: string;
    name: string;
    autoSync: typAutoSyncState;
}

/** 다음 자동 실행(표시용) */
export interface itfNextAutoRun {
    jobId: string;
    jobName: string;
    at: string;
}

export function addMs(at: Date, ms: number): string {
    return new Date(at.getTime() + ms).toISOString();
}

export function addMinutes(at: Date, minutes: number): string {
    return addMs(at, minutes * 60_000);
}

/** 예약 시각이 지났는지(같으면 지난 것). 잘못된 값은 지난 것으로 본다 */
function f_IsPast(iso: string, now: Date): boolean {
    const t = Date.parse(iso);
    return Number.isNaN(t) || t <= now.getTime();
}

/**
 * 작업을 만들거나 고친 뒤의 nextRunAt. prev가 null이면 새 작업·복제.
 */
export function nextRunAfterEdit(
    prev: typAutoSyncState | null,
    next: typAutoSyncInput,
    now: Date,
): string | null {
    if (!next.enabled) return null;
    if (
        prev === null ||
        !prev.enabled ||
        prev.intervalMinutes !== next.intervalMinutes ||
        prev.nextRunAt === null
    ) {
        return addMinutes(now, next.intervalMinutes);
    }
    return prev.nextRunAt;
}

/**
 * 앱 시작·절전 재개 때 맞출 nextRunAt. 켜졌는데 없거나 지났으면 now + delayMs, 미래면 그대로, 꺼졌으면 null.
 */
export function reconcileNextRun(
    auto: typAutoSyncState,
    now: Date,
    delayMs: number,
): string | null {
    if (!auto.enabled) return null;
    if (auto.nextRunAt === null || f_IsPast(auto.nextRunAt, now)) return addMs(now, delayMs);
    return auto.nextRunAt;
}

/** 일시정지 해제: 지난 예약만 now + 30초. 없거나 미래면 그대로 */
export function rescheduleOnUnpause(auto: typAutoSyncState, now: Date): string | null {
    if (!auto.enabled) return null;
    if (auto.nextRunAt !== null && f_IsPast(auto.nextRunAt, now)) {
        return addMs(now, UNPAUSE_DELAY_MS);
    }
    return auto.nextRunAt;
}

/** 자동 실행이 끝난 뒤의 다음 예약: 끝난 시각 + 주기 */
export function nextAfterFinish(finishedAt: string, intervalMinutes: number): string {
    return addMinutes(new Date(finishedAt), intervalMinutes);
}

/** 지금 실행할 작업: 켜져 있고 예약 시각이 지난 것 중 가장 이른 1건. 없으면 null */
export function pickDue<T extends itfScheduleJob>(jobs: readonly T[], now: Date): T | null {
    let best: T | null = null;
    let bestAt = Number.POSITIVE_INFINITY;
    for (const job of jobs) {
        const at = job.autoSync.nextRunAt;
        if (!job.autoSync.enabled || at === null) continue;
        const t = Date.parse(at);
        if (Number.isNaN(t) || t > now.getTime()) continue;
        if (t < bestAt) {
            best = job;
            bestAt = t;
        }
    }
    return best;
}

/** 다음 자동 실행(켜진 작업 중 가장 이른 예약). 없으면 null */
export function nextAutoRun(jobs: readonly itfScheduleJob[]): itfNextAutoRun | null {
    let best: itfNextAutoRun | null = null;
    let bestAt = Number.POSITIVE_INFINITY;
    for (const job of jobs) {
        const at = job.autoSync.nextRunAt;
        if (!job.autoSync.enabled || at === null) continue;
        const t = Date.parse(at);
        if (Number.isNaN(t) || t >= bestAt) continue;
        best = { jobId: job.id, jobName: job.name, at };
        bestAt = t;
    }
    return best;
}
