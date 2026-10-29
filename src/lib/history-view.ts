/**
 * 이력 화면의 순수 로직: 실행 종류(수동·자동·미리보기)·상태 필터, 배지 색, 요약 문구, 다음 자동 실행 문구.
 * DOM·window 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import { formatBytes } from "@/shared/format";
import type { typRunStatus } from "@/shared/schemas/common";
import type { typRunRecord } from "@/shared/schemas/run";
import type { itfSchedulerState } from "@/shared/types/scheduler";

export type typHistoryKind = "manual" | "auto" | "dryRun";
/** ZBCBadge tone과 같은 값 */
export type typHistoryTone = "neutral" | "accent" | "success" | "warning" | "danger";
export type typHistoryKindFilter = "all" | typHistoryKind;
/** failed에는 일부 실패·중단됨도 들어간다 */
export type typHistoryStatusFilter = "all" | "success" | "failed" | "blocked" | "canceled";

export interface itfHistoryFilter {
    kind: typHistoryKindFilter;
    status: typHistoryStatusFilter;
}

export const DEFAULT_HISTORY_FILTER: itfHistoryFilter = { kind: "all", status: "all" };

export const HISTORY_KIND_LABEL: Record<typHistoryKind, string> = {
    manual: "수동",
    auto: "자동",
    dryRun: "미리보기",
};

export const HISTORY_KIND_OPTIONS: ReadonlyArray<{ value: typHistoryKindFilter; label: string }> = [
    { value: "all", label: "모든 실행" },
    { value: "manual", label: "수동 실행" },
    { value: "auto", label: "자동 실행" },
    { value: "dryRun", label: "미리보기" },
];

export const HISTORY_STATUS_OPTIONS: ReadonlyArray<{
    value: typHistoryStatusFilter;
    label: string;
}> = [
    { value: "all", label: "모든 결과" },
    { value: "success", label: "완료" },
    { value: "failed", label: "실패·일부 실패·중단됨" },
    { value: "blocked", label: "차단됨" },
    { value: "canceled", label: "취소됨" },
];

const STATUS_GROUP: Record<typRunStatus, typHistoryStatusFilter | null> = {
    running: null,
    success: "success",
    partial: "failed",
    failed: "failed",
    interrupted: "failed",
    blocked: "blocked",
    canceled: "canceled",
    noop: null,
};

/** 미리보기 > 자동 > 수동 */
export function historyKind(r: Pick<typRunRecord, "dryRun" | "trigger">): typHistoryKind {
    if (r.dryRun) return "dryRun";
    return r.trigger === "scheduler" ? "auto" : "manual";
}

export function filterHistory(
    records: readonly typRunRecord[],
    f: itfHistoryFilter,
): typRunRecord[] {
    return records.filter(
        (r) =>
            (f.kind === "all" || historyKind(r) === f.kind) &&
            (f.status === "all" || STATUS_GROUP[r.status] === f.status),
    );
}

export function statusTone(status: typRunStatus): typHistoryTone {
    switch (status) {
        case "success":
            return "success";
        case "partial":
        case "blocked":
            return "warning";
        case "failed":
        case "interrupted":
            return "danger";
        case "running":
            return "accent";
        default:
            return "neutral";
    }
}

/** 표의 결과 요약. 예: "복사 3 · 삭제 1 · 1.5 KB · 오류 0". 통계가 없으면 계획, 둘 다 없으면 "-" */
export function historyCounts(r: Pick<typRunRecord, "stats" | "plan" | "dryRun">): string {
    const s = r.stats;
    if (s) {
        const copy = r.dryRun ? "복사 예정" : "복사";
        return `${copy} ${s.transfers} · 삭제 ${s.deletes} · ${formatBytes(s.bytes)} · 오류 ${s.errors}`;
    }
    const p = r.plan;
    if (p) {
        return `계획: 새 ${p.createFiles} · 변경 ${p.updateFiles} · 삭제 ${p.deleteFiles}`;
    }
    return "-";
}

/** 다음 자동 실행 문구(상단 막대). formatTime은 ISO → 표시 시각 */
export function nextAutoRunText(
    state: itfSchedulerState | null,
    formatTime: (iso: string) => string,
): string {
    if (!state) return "";
    if (state.paused) return "자동 실행 일시정지됨";
    if (state.running?.trigger === "scheduler") return `자동 실행 중: ‘${state.running.jobName}’`;
    if (!state.next) return "예약된 자동 실행 없음";
    return `다음 자동 실행 ${formatTime(state.next.at)} ‘${state.next.jobName}’`;
}
