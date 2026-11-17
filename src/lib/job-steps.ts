/**
 * 작업 화면의 순수 로직: 안내 줄(previewNotice), 동기화 단추 문구(syncButtonText),
 * footer 계획 상태 문구(planFooterText), 실행 진행·결과 표시 우선 여부(runPanelShown),
 * 미리보기 신선도·상대 시각.
 * 실행 가능 여부는 여기서 판단하지 않는다(canStartCompare·canStartRun 결과를 받아 문구만 고른다).
 * 다른 작업의 실행·마지막 실행은 무시한다. DOM·window·store 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-11-08
 */

// ========== Internal imports ==========
import { shortenPath } from "@/lib/path-display";
import { realRunConfirmText, runStatusText } from "@/lib/run-view";
import { formatBytes, formatDuration, formatLocalDateTime } from "@/shared/format";
import { hasPlannedChanges, matchPlanWithDryRun, planFromCompare } from "@/shared/run-plan";
import type { typRunMode } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import type { typRunRecord } from "@/shared/schemas/run";
import type { itfCompareResult } from "@/shared/types/compare";
import type { itfDryRunSummary, itfRunSnapshot } from "@/shared/types/run";

/** 이 작업의 마지막으로 끝난 실행(run-store last 중 필요한 것) */
export interface itfStepLastRun {
    record: Pick<
        typRunRecord,
        "jobId" | "dryRun" | "mode" | "status" | "startedAt" | "durationMs" | "plan"
    >;
    dryRunSummary: itfDryRunSummary | null;
}

export interface itfJobStepsInput {
    jobId: string;
    mode: typRunMode;
    /** 이 작업의 비교가 진행 중 */
    comparing: boolean;
    /** 이 작업의 비교 결과(다른 작업 것이면 null로 넘긴다) */
    compare: Pick<itfCompareResult, "createdAt" | "entries"> | null;
    /** compareStaleReason 결과 */
    staleReason: string | null;
    /** 앱 전역 진행 중 실행 */
    run: Pick<itfRunSnapshot, "jobId" | "dryRun" | "stats" | "phase"> | null;
    last: itfStepLastRun | null;
    /** canStartRun({dryRun:false}).ok */
    realReady: boolean;
    nowMs: number;
}

export type typNoticeTone = "info" | "success" | "warning" | "danger";

export interface itfPlanNotice {
    tone: typNoticeTone;
    text: string;
}

export interface itfRunBarText {
    /** 굵은 한 줄: realRunConfirmText 등 */
    headline: string;
    /** 보조 줄: 경로·크기·비교 시각/낡음 기준 */
    detail: string;
}

/** 미리보기 결과와 비교 계획의 관계. unknown = 성공했지만 계획·요약이 없어 맞춰 볼 수 없음 */
type typPreviewMatch = "match" | "mismatch" | "unknown" | "notSuccess";

function f_PreviewMatch(p: itfStepLastRun): typPreviewMatch {
    if (p.record.status !== "success") return "notSuccess";
    if (!p.record.plan || !p.dryRunSummary) return "unknown";
    return matchPlanWithDryRun(p.record.plan, p.dryRunSummary).ok ? "match" : "mismatch";
}

/** "방금"(<1분) / "N분 전"(<60분) / formatLocalDateTime */
export function relativeTimeText(iso: string, nowMs: number): string {
    const age = nowMs - Date.parse(iso);
    if (age < 60_000) return "방금";
    if (age < 60 * 60_000) return `${Math.floor(age / 60_000)}분 전`;
    return formatLocalDateTime(iso);
}

/** 지금 비교 결과 뒤에 끝난 이 작업의 미리보기(없으면 null). startedAt >= compare.createdAt */
export function freshPreview(
    i: Pick<itfJobStepsInput, "jobId" | "compare" | "last">,
): itfStepLastRun | null {
    const { compare, last } = i;
    if (!compare || !last) return null;
    if (last.record.jobId !== i.jobId || !last.record.dryRun) return null;
    return Date.parse(last.record.startedAt) >= Date.parse(compare.createdAt) ? last : null;
}

/**
 * 안내 줄의 미리보기 한 줄. 비교 결과가 없으면 null.
 * 진행 중 → info "미리보기 중(파일은 바꾸지 않음)"
 * 새 미리보기 success + 일치 → success "미리보기가 비교 결과와 같은 일을 합니다."
 * 불일치 → warning "미리보기가 비교 결과와 다릅니다. 다시 비교하세요."
 * 그 밖의 상태 → danger `${runStatusText(...)}` (+ 자세히는 RunView)
 * 새 미리보기 없음 → info "미리보기로 rclone이 실제로 할 일을 한 번 확인할 수 있습니다."
 */
export function previewNotice(
    i: Pick<itfJobStepsInput, "jobId" | "compare" | "run" | "last">,
): itfPlanNotice | null {
    if (!i.compare) return null;
    if (i.run && i.run.jobId === i.jobId && i.run.dryRun) {
        return { tone: "info", text: "미리보기 중(파일은 바꾸지 않음)" };
    }
    const preview = freshPreview(i);
    if (!preview) {
        return {
            tone: "info",
            text: "미리보기로 rclone이 실제로 할 일을 한 번 확인할 수 있습니다.",
        };
    }
    switch (f_PreviewMatch(preview)) {
        case "match":
            return { tone: "success", text: "미리보기가 비교 결과와 같은 일을 합니다." };
        case "mismatch":
            return { tone: "warning", text: "미리보기가 비교 결과와 다릅니다. 다시 비교하세요." };
        case "unknown":
            return { tone: "info", text: runStatusText("success", true, preview.record.mode) };
        case "notSuccess":
            return {
                tone: "danger",
                text: runStatusText(preview.record.status, true, preview.record.mode),
            };
    }
}

/** runBarText·syncButtonText의 입력 */
export interface itfRunBarInput {
    job: Pick<typJob, "source" | "destination" | "mode">;
    compare: itfCompareResult | null;
    staleReason: string | null;
    maxAgeMinutes: number;
    nowMs: number;
    lastReal: itfStepLastRun | null;
}

/**
 * 하단 실행 막대 문장.
 * 비교 결과 있음 → headline = realRunConfirmText(" (총 …)" 없이),
 *   detail = `원본 → 대상 · 전송 크기 · 비교 방금(10분 지나면 다시 비교)`, 낡았으면 끝을 staleReason으로 바꾼다.
 * 결과 없음 + 이 작업의 실제 실행 결과 있음 → headline = runStatusText, detail = 시작 시각·걸린 시간·이력 안내.
 * 둘 다 없음 → "비교 전에는 실행할 수 없습니다".
 * compare·lastReal은 이 작업 것만 넘긴다.
 */
export function runBarText(i: itfRunBarInput): itfRunBarText {
    const { job, compare } = i;
    if (compare) {
        const when =
            i.staleReason ??
            `비교 ${relativeTimeText(compare.createdAt, i.nowMs)}(${i.maxAgeMinutes}분 지나면 다시 비교)`;
        return {
            headline: realRunConfirmText(
                compare.summary,
                job.mode,
                compare.destCanHaveEmptyDirs,
                false,
            ),
            detail: `${shortenPath(job.source)} → ${shortenPath(job.destination)} · ${formatBytes(compare.summary.transferBytes)} · ${when}`,
        };
    }
    const last = i.lastReal;
    if (last && !last.record.dryRun) {
        const parts = [`${formatLocalDateTime(last.record.startedAt)} 시작`];
        if (last.record.durationMs !== null) parts.push(formatDuration(last.record.durationMs));
        parts.push("지난 실행은 ‘이력’에 있습니다");
        return {
            headline: runStatusText(last.record.status, false, last.record.mode),
            detail: parts.join(" · "),
        };
    }
    return {
        headline: "비교 전에는 실행할 수 없습니다",
        detail: "‘비교’는 원본·대상 목록을 읽기만 하고 파일은 바꾸지 않습니다.",
    };
}

/**
 * toolbar의 [동기화] 단추 문구와 비활성 여부.
 * 비교 결과 없음 → "동기화 — 먼저 [비교]를 누르세요"(꺼짐).
 * 바뀔 것 없음 → "동기화: 바뀔 것 없음". 그 밖 → "동기화: " + runBarText(i).headline
 *   (예: "동기화: 대상에 1개 복사, 1개 덮어씀, 1개 삭제").
 * disabled는 realReady(canStartRun({dryRun:false}).ok)를 따른다.
 */
export function syncButtonText(i: itfRunBarInput & { realReady: boolean }): {
    label: string;
    disabled: boolean;
} {
    if (!i.compare) {
        return { label: "동기화 — 먼저 [비교]를 누르세요", disabled: true };
    }
    const plan = planFromCompare(i.compare.summary, i.job.mode);
    const label = hasPlannedChanges(plan, i.compare.destCanHaveEmptyDirs)
        ? `동기화: ${runBarText(i).headline}`
        : "동기화: 바뀔 것 없음";
    return { label, disabled: !i.realReady };
}

/**
 * footer의 계획 상태 한 줄. 비교 결과가 없으면 null.
 * `비교 MM-DD HH:mm:ss · 걸린 시간` + 계획 상태(낡음이면 다시 비교 안내,
 * 바뀔 것이 없으면 "바뀔 것 없음", 그 밖에는 "이 비교 결과로 동기화할 수 있습니다").
 */
export function planFooterText(i: {
    compare: itfCompareResult | null;
    staleReason: string | null;
}): string | null {
    const c = i.compare;
    if (!c) return null;
    const at = formatLocalDateTime(c.createdAt);
    const head = `비교 ${at.length > 5 ? at.slice(5) : at} · ${formatDuration(c.durationMs)}`;
    let state = i.staleReason;
    if (!state) {
        const plan = planFromCompare(c.summary, c.mode);
        state = hasPlannedChanges(plan, c.destCanHaveEmptyDirs)
            ? "이 비교 결과로 동기화할 수 있습니다"
            : "바뀔 것 없음";
    }
    return `${head} · ${state}`;
}

/**
 * 오른쪽(탭 본문)에 실행 진행·결과를 보여야 하는지. 우선순위:
 * 이 작업 실제 실행 진행 중 → true / 이 작업 비교 진행 중 → false /
 * 이 작업 실제 실행 시작 오류(지금 비교 결과 뒤에 난 것) → true / 비교 결과 있음 → false /
 * 이 작업 마지막 실행이 실제 실행 → true / 그 밖 → false
 */
export function runPanelShown(i: {
    jobId: string;
    run: Pick<itfRunSnapshot, "jobId" | "dryRun"> | null;
    comparing: boolean;
    /** 이 작업의 비교 결과 시각(없으면 null) */
    compareCreatedAt: string | null;
    /** run-store의 마지막 시작 실패(at = ISO 시각) */
    startError: { jobId: string; dryRun: boolean; at: string } | null;
    last: Pick<itfStepLastRun, "record"> | null;
}): boolean {
    if (i.run && i.run.jobId === i.jobId && !i.run.dryRun) return true;
    if (i.comparing) return false;
    const err = i.startError;
    if (
        err &&
        err.jobId === i.jobId &&
        !err.dryRun &&
        (i.compareCreatedAt === null || Date.parse(err.at) >= Date.parse(i.compareCreatedAt))
    ) {
        return true;
    }
    if (i.compareCreatedAt !== null) return false;
    return i.last !== null && i.last.record.jobId === i.jobId && !i.last.record.dryRun;
}
