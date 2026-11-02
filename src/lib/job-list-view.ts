/**
 * 작업 목록(JobSidebar) 한 줄에 보일 문구를 만드는 순수 함수 (INT-002 T-04).
 * 원본 → 대상(가운데 줄임), 자동 실행 요약, 최근 실행 시각, 상태 문구(설정으로 숨김).
 * DOM·window 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-11-02
 */

// ========== Internal imports ==========
import { shortenPath } from "@/lib/path-display";
import { formatLocalDateTime } from "@/shared/format";
import { scheduleText } from "@/shared/schedule";
import type { typRunStatus } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";

/** 최근 실행 상태 문구 */
export const STATUS_LABEL: Record<typRunStatus, string> = {
    running: "실행 중",
    success: "성공",
    partial: "일부 실패",
    failed: "실패",
    canceled: "중지됨",
    blocked: "차단됨",
    noop: "바꿀 것 없음",
    interrupted: "중단됨",
};

export interface itfJobListItem {
    /** "원본 → 대상" (각 경로 가운데 줄임) */
    pathsText: string;
    /** 줄이지 않은 "원본 → 대상" (title) */
    pathsTitle: string;
    /** 자동 실행이 꺼져 있으면 null */
    scheduleText: string | null;
    /** "최근 실행 YYYY-MM-DD HH:mm:ss" 또는 "실행 기록 없음" */
    lastRunText: string;
    /** 상태 문구 표시가 켜져 있고 실행 기록이 있을 때만 */
    statusText: string | null;
}

/**
 * 자동 실행 요약. 꺼져 있으면 null, 켜져 있으면 "30분마다 · 다음 11-02 10:30",
 * "매일 09:00 · 다음 …", "매주 월·수 09:00 · 다음 …".
 */
export function scheduleSummary(job: Pick<typJob, "autoSync">): string | null {
    const a = job.autoSync;
    if (!a.enabled) return null;
    const every = scheduleText(a);
    const next = formatLocalDateTime(a.nextRunAt);
    return next === "-" ? every : `${every} · 다음 ${next.slice(5, 16)}`;
}

/** 작업 목록 한 줄의 문구 */
export function jobListItem(job: typJob, opts: { showStatus: boolean }): itfJobListItem {
    const last = job.lastRun;
    return {
        pathsText: `${shortenPath(job.source)} → ${shortenPath(job.destination)}`,
        pathsTitle: `${job.source} → ${job.destination}`,
        scheduleText: scheduleSummary(job),
        lastRunText: last ? `최근 실행 ${formatLocalDateTime(last.at)}` : "실행 기록 없음",
        statusText: opts.showStatus && last ? STATUS_LABEL[last.status] : null,
    };
}
