/**
 * 자동 실행 예약 계산 (MVP_SPEC §10, intent T-10, INT-002 T-06). 순수 함수. 시각은 UTC ISO 문자열로 다룬다.
 *
 * - 예약 종류: interval(일정 간격), daily(매일 HH:MM), weekly(고른 요일의 HH:MM). HH:MM은 로컬 시각이다.
 * - 편집: 켬·스케줄 변경 → 지금 기준 다음 예약, 끔 → null, 그 밖에는 기존 값 유지.
 *   새 작업·복제는 켜져 있으면 지금 기준 다음 예약.
 * - 앱 시작·절전 재개: 켜진 작업의 예약이 없거나 지났으면 now + 지연(몰아서 따라잡지 않는다). 꺼진 작업은 null.
 *   daily·weekly의 미래 예약은 지연보다 멀면 지금 기준 다음 정시로 다시 맞춘다(시간대 변경 대비).
 * - 일시정지 해제: 지난 예약만 now + 30초.
 * - 실행이 끝난 뒤: daily·weekly가 성공(바꿀 것 없음 포함)으로 끝났으면 1시간 안의 정시는 건너뛴다(놓친 예약 직후 중복 실행 방지).
 * - 실행할 작업: 켜져 있고 예약 시각이 지난 작업 중 가장 이른 1건.
 * - DST: 없는 시각(봄)은 Date 규칙대로 뒤로 밀린 시각에 한 번, 두 번 있는 시각(가을)은 첫 번째에 한 번 실행한다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import { TIME_OF_DAY_RE, WEEKDAYS_ALL, type typAutoSyncOptions } from "@/shared/schemas/job";

/** 스케줄러 확인 간격 */
export const SCHEDULER_TICK_MS = 20_000;
/** 앱 시작 직후 지난 예약을 미루는 시간(시작 직후 폭주 방지) */
export const STARTUP_DELAY_MS = 60_000;
/** 절전에서 깨어난 뒤 지난 예약을 미루는 시간 */
export const RESUME_DELAY_MS = 60_000;
/** 일시정지를 풀었을 때 지난 예약을 미루는 시간 */
export const UNPAUSE_DELAY_MS = 30_000;
/** daily·weekly에서 성공(또는 바꿀 것 없음)으로 끝난 실행 직후 이 시간 안에 오는 정시는 건너뛴다 */
export const NEAR_SLOT_SKIP_MS = 60 * 60_000;

/** 다음 예약을 정하는 값 */
export type typScheduleSpec = Pick<
    typAutoSyncOptions,
    "kind" | "intervalMinutes" | "timeOfDay" | "weekdays"
>;
type typAutoSyncInput = Pick<typAutoSyncOptions, "enabled"> & typScheduleSpec;
type typAutoSyncState = typAutoSyncInput & Pick<typAutoSyncOptions, "nextRunAt">;

/** 예약 고르기·표시에 필요한 작업 정보 */
export interface itfScheduleJob {
    id: string;
    name: string;
    autoSync: Pick<typAutoSyncOptions, "enabled" | "nextRunAt">;
}

/** 요일 이름(Date.getDay() 순서) */
const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"] as const;
/** 표시 순서: 월요일부터 */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const MASK_WEEKDAYS = 0b0111110;
const MASK_WEEKEND = 0b1000001;
const DAY_MS = 86_400_000;

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

/** "HH:MM"을 시·분으로. 형식이 틀리면 null */
export function parseTimeOfDay(hhmm: string): { hour: number; minute: number } | null {
    if (!TIME_OF_DAY_RE.test(hhmm)) return null;
    const [h, m] = hhmm.split(":");
    return { hour: Number(h), minute: Number(m) };
}

/**
 * from보다 엄격히 뒤인 첫 로컬 HH:MM(weekdays bit가 켜진 요일만). 요일이 없거나 시각이 틀리면 null.
 * 로컬 생성자로 날짜마다 만들어 DST에도 벽시계 시각을 지킨다(최대 8일 탐색).
 */
export function nextLocalTimeOfDay(from: Date, hhmm: string, weekdays: number): Date | null {
    const t = parseTimeOfDay(hhmm);
    if (t === null || (weekdays & WEEKDAYS_ALL) === 0) return null;
    for (let i = 0; i <= 7; i++) {
        const d = new Date(
            from.getFullYear(),
            from.getMonth(),
            from.getDate() + i,
            t.hour,
            t.minute,
            0,
            0,
        );
        if ((weekdays & (1 << d.getDay())) === 0) continue;
        if (d.getTime() > from.getTime()) return d;
    }
    return null;
}

/** from 다음의 예약 시각. 결과는 항상 from보다 뒤다(계산이 안 되면 from + 24시간으로 방어) */
export function nextOccurrence(spec: typScheduleSpec, from: Date): string {
    if (spec.kind === "interval") return addMinutes(from, spec.intervalMinutes);
    const mask = spec.kind === "daily" ? WEEKDAYS_ALL : spec.weekdays;
    const at = nextLocalTimeOfDay(from, spec.timeOfDay, mask);
    return at === null ? addMs(from, DAY_MS) : at.toISOString();
}

/** 다음 예약을 정하는 값이 같은지(종류에 따라 쓰는 값만 비교) */
export function isSameSchedule(a: typScheduleSpec, b: typScheduleSpec): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "interval") return a.intervalMinutes === b.intervalMinutes;
    if (a.timeOfDay !== b.timeOfDay) return false;
    return a.kind === "daily" || a.weekdays === b.weekdays;
}

/** 요일 마스크 표시: "매일", "평일", "주말", 그 밖에는 "월·수"(월요일부터) */
export function weekdaysText(mask: number): string {
    const m = mask & WEEKDAYS_ALL;
    if (m === WEEKDAYS_ALL) return "매일";
    if (m === MASK_WEEKDAYS) return "평일";
    if (m === MASK_WEEKEND) return "주말";
    return WEEKDAY_ORDER.filter((d) => (m & (1 << d)) !== 0)
        .map((d) => WEEKDAY_NAMES[d])
        .join("·");
}

/** 예약 표시: "30분마다", "2시간마다", "매일 09:00", "매주 월·수 09:00", "평일 09:00" */
export function scheduleText(spec: typScheduleSpec): string {
    if (spec.kind === "interval") {
        const n = spec.intervalMinutes;
        return n % 60 === 0 ? `${n / 60}시간마다` : `${n}분마다`;
    }
    if (spec.kind === "daily") return `매일 ${spec.timeOfDay}`;
    const days = weekdaysText(spec.weekdays);
    if (days === "매일" || days === "평일" || days === "주말") return `${days} ${spec.timeOfDay}`;
    return `매주 ${days} ${spec.timeOfDay}`;
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
    if (prev === null || !prev.enabled || !isSameSchedule(prev, next) || prev.nextRunAt === null) {
        return nextOccurrence(next, now);
    }
    return prev.nextRunAt;
}

/**
 * 앱 시작·절전 재개 때 맞출 nextRunAt. 켜졌는데 없거나 지났으면 now + delayMs, 꺼졌으면 null.
 * 미래 예약: interval은 그대로, daily·weekly는 delayMs 이내면 그대로, 더 멀면 지금 기준 다음 정시.
 */
export function reconcileNextRun(
    auto: typAutoSyncState,
    now: Date,
    delayMs: number,
): string | null {
    if (!auto.enabled) return null;
    if (auto.nextRunAt === null || f_IsPast(auto.nextRunAt, now)) return addMs(now, delayMs);
    if (auto.kind === "interval") return auto.nextRunAt;
    if (Date.parse(auto.nextRunAt) - now.getTime() <= delayMs) return auto.nextRunAt;
    return nextOccurrence(auto, now);
}

/** 일시정지 해제: 지난 예약만 now + 30초. 없거나 미래면 그대로 */
export function rescheduleOnUnpause(auto: typAutoSyncState, now: Date): string | null {
    if (!auto.enabled) return null;
    if (auto.nextRunAt !== null && f_IsPast(auto.nextRunAt, now)) {
        return addMs(now, UNPAUSE_DELAY_MS);
    }
    return auto.nextRunAt;
}

/**
 * 자동 실행이 끝난 뒤의 다음 예약: interval은 끝난 시각 + 주기, daily·weekly는 끝난 뒤 다음 정시.
 * daily·weekly가 성공했으면 끝난 뒤 NEAR_SLOT_SKIP_MS 안의 정시는 건너뛴다. 실패·차단·중지면 바로 다음 정시를 재시도 기회로 남긴다.
 */
export function nextAfterFinish(
    finishedAt: string,
    spec: typScheduleSpec,
    succeeded: boolean,
): string {
    const at = Date.parse(finishedAt);
    if (spec.kind === "interval" || !succeeded) return nextOccurrence(spec, new Date(at));
    return nextOccurrence(spec, new Date(at + NEAR_SLOT_SKIP_MS));
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

/**
 * 트레이에서 종료할 때 띄울 경고. 일시정지했거나 예약이 없으면 null.
 * formatAt은 표시용 시각 문자열을 만든다(호출하는 쪽이 로컬 형식을 정한다).
 */
export function quitScheduleWarning(
    paused: boolean,
    next: itfNextAutoRun | null,
    formatAt: (iso: string) => string,
): { message: string; detail: string } | null {
    if (paused || next === null) return null;
    return {
        message: `다음 예약: ‘${next.jobName}’ ${formatAt(next.at)} — 종료하면 실행되지 않습니다.`,
        detail: "앱이 꺼져 있는 동안에는 자동 실행이 돌지 않습니다. 다시 켜면 놓친 예약은 한 번만 실행합니다.",
    };
}
