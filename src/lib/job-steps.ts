/**
 * 작업 화면(비교 → 미리보기 → 실행)의 순수 로직: 단계 막대 상태, 계획 패널의 미리보기 한 줄,
 * 하단 실행 막대 문장, 오른쪽 열(파일 목록 또는 실행 진행·결과) 결정.
 * 실행 가능 여부는 여기서 판단하지 않는다(canStartCompare·canStartRun 결과를 받아 문구만 고른다).
 * 다른 작업의 실행·마지막 실행은 무시한다. DOM·window·store 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-11-08
 */

// ========== Internal imports ==========
import { shortenPath } from "@/lib/path-display";
import { progressPercent, realRunConfirmText, runStatusText } from "@/lib/run-view";
import { formatBytes, formatDuration, formatLocalDateTime } from "@/shared/format";
import { matchPlanWithDryRun } from "@/shared/run-plan";
import type { typRunMode } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import type { typRunRecord } from "@/shared/schemas/run";
import type { itfCompareResult } from "@/shared/types/compare";
import type { itfDryRunSummary, itfRunSnapshot } from "@/shared/types/run";

export type typJobStepId = "compare" | "preview" | "run";
export type typJobStepState = "done" | "current" | "pending" | "running";

export interface itfJobStep {
    id: typJobStepId;
    /** "비교" | "미리보기" | "실행" */
    label: string;
    state: typJobStepState;
    /** 짧은 설명. 없으면 "" */
    note: string;
}

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

const LABELS: Record<typJobStepId, string> = { compare: "비교", preview: "미리보기", run: "실행" };

/** 미리보기 결과와 비교 계획의 관계. unknown = 성공했지만 계획·요약이 없어 맞춰 볼 수 없음 */
type typPreviewMatch = "match" | "mismatch" | "unknown" | "notSuccess";

function f_Step(id: typJobStepId, state: typJobStepState, note: string): itfJobStep {
    return { id, label: LABELS[id], state, note };
}

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

/** ① 비교 → ② 미리보기 → ③ 실행. "current"·"running"은 합쳐 최대 1개 */
export function jobSteps(i: itfJobStepsInput): readonly [itfJobStep, itfJobStep, itfJobStep] {
    const run = i.run && i.run.jobId === i.jobId ? i.run : null;
    const last = i.last && i.last.record.jobId === i.jobId ? i.last : null;
    const compare = i.compare;
    const compareNote = compare
        ? `${relativeTimeText(compare.createdAt, i.nowMs)} · ${compare.entries.length.toLocaleString("ko-KR")}개 확인`
        : "";
    const preview = freshPreview(i);
    const blockedNote = i.realReady ? "미리보기 후 권장" : "실행할 수 없음";

    // 실제 실행 준비·비교 중(자동 실행·OS 예약은 comparing으로 시작): 옛 비교·미리보기는 쓰지 않는다
    if (run && !run.dryRun && (run.phase === "validating" || run.phase === "comparing")) {
        return [
            f_Step("compare", "running", run.phase === "comparing" ? "목록 읽는 중" : "준비 중"),
            f_Step("preview", "pending", ""),
            f_Step("run", "pending", "비교 후 실행"),
        ];
    }

    // 실제 실행 진행 중
    if (run && !run.dryRun) {
        let previewStep = f_Step("preview", "pending", "건너뜀");
        if (preview) {
            const m = f_PreviewMatch(preview);
            if (m === "match") previewStep = f_Step("preview", "done", "계획과 일치");
            else if (m === "unknown") previewStep = f_Step("preview", "done", "미리보기 완료");
            else if (m === "mismatch") previewStep = f_Step("preview", "pending", "계획과 다름");
            else
                previewStep = f_Step(
                    "preview",
                    "pending",
                    runStatusText(preview.record.status, true, preview.record.mode),
                );
        }
        const pct = progressPercent(run.stats);
        let runNote = "진행 중";
        if (run.phase === "preflight") runNote = "사전 확인 중";
        else if (pct !== null) runNote = `${pct}%`;
        return [
            f_Step("compare", "done", compare ? compareNote : "실행에 사용"),
            previewStep,
            f_Step("run", "running", runNote),
        ];
    }

    // 비교 중
    if (i.comparing) {
        return [
            f_Step("compare", "running", "목록 읽는 중"),
            f_Step("preview", "pending", "선택 · 권장"),
            f_Step("run", "pending", "비교 후 가능"),
        ];
    }

    // 미리보기 진행 중
    if (run && run.dryRun) {
        const compareStep =
            compare && !i.staleReason
                ? f_Step("compare", "done", compareNote)
                : f_Step(
                      "compare",
                      "pending",
                      i.staleReason ? "다시 비교 필요" : "원본·대상 목록 읽기",
                  );
        return [
            compareStep,
            f_Step("preview", "running", "미리보기 중"),
            f_Step("run", "pending", compare ? "미리보기 후 권장" : "비교 후 가능"),
        ];
    }

    // 비교 결과 없음
    if (!compare) {
        if (last && !last.record.dryRun) {
            const ok = last.record.status === "success" || last.record.status === "noop";
            const when = relativeTimeText(last.record.startedAt, i.nowMs);
            const runStep = ok
                ? f_Step(
                      "run",
                      "done",
                      last.record.durationMs === null
                          ? when
                          : `${when} · ${formatDuration(last.record.durationMs)}`,
                  )
                : f_Step(
                      "run",
                      "pending",
                      runStatusText(last.record.status, false, last.record.mode),
                  );
            return [
                f_Step("compare", "current", "다시 비교"),
                f_Step("preview", "pending", ""),
                runStep,
            ];
        }
        return [
            f_Step("compare", "current", "원본·대상 목록 읽기"),
            f_Step("preview", "pending", "선택 · 권장"),
            f_Step("run", "pending", "비교 후 가능"),
        ];
    }

    // 비교 결과 낡음
    if (i.staleReason) {
        return [
            f_Step("compare", "current", "다시 비교 필요"),
            f_Step("preview", "pending", "선택 · 권장"),
            f_Step("run", "pending", "비교 후 가능"),
        ];
    }

    const compareDone = f_Step("compare", "done", compareNote);
    if (!preview) {
        return [
            compareDone,
            f_Step("preview", "current", "선택 · 권장"),
            f_Step("run", "pending", blockedNote),
        ];
    }
    const m = f_PreviewMatch(preview);
    if (m === "match" || m === "unknown") {
        return [
            compareDone,
            f_Step("preview", "done", m === "match" ? "계획과 일치" : "미리보기 완료"),
            i.realReady
                ? f_Step("run", "current", "준비됨")
                : f_Step("run", "pending", "실행할 수 없음"),
        ];
    }
    if (m === "mismatch") {
        return [
            compareDone,
            f_Step("preview", "current", "계획과 다름 · 다시 비교"),
            f_Step("run", "pending", i.realReady ? "다시 비교 권장" : "실행할 수 없음"),
        ];
    }
    return [
        compareDone,
        f_Step(
            "preview",
            "current",
            runStatusText(preview.record.status, true, preview.record.mode),
        ),
        f_Step("run", "pending", blockedNote),
    ];
}

/**
 * 계획 패널의 미리보기 한 줄. 비교 결과가 없으면 null.
 * 진행 중 → info "미리보기 중(파일은 바꾸지 않음)"
 * 새 미리보기 success + 일치 → success "미리보기가 비교 결과와 같은 일을 합니다."
 * 불일치 → warning "미리보기가 비교 결과와 다릅니다. 다시 비교하세요."
 * 그 밖의 상태 → danger `${runStatusText(...)}` (+ 자세히는 details의 RunView)
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

/**
 * 하단 실행 막대 문장.
 * 비교 결과 있음 → headline = realRunConfirmText(" (총 …)" 없이),
 *   detail = `원본 → 대상 · 전송 크기 · 비교 방금(10분 지나면 다시 비교)`, 낡았으면 끝을 staleReason으로 바꾼다.
 * 결과 없음 + 이 작업의 실제 실행 결과 있음 → headline = runStatusText, detail = 시작 시각·걸린 시간·이력 안내.
 * 둘 다 없음 → "비교 전에는 실행할 수 없습니다".
 * compare·lastReal은 이 작업 것만 넘긴다.
 */
export function runBarText(i: {
    job: Pick<typJob, "source" | "destination" | "mode">;
    compare: itfCompareResult | null;
    staleReason: string | null;
    maxAgeMinutes: number;
    nowMs: number;
    lastReal: itfStepLastRun | null;
}): itfRunBarText {
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
 * 오른쪽 열에 무엇을 그릴지. 우선순위:
 * 이 작업 실제 실행 진행 중 → "run" / 이 작업 비교 진행 중 → "compare" /
 * 이 작업 실제 실행 시작 오류(지금 비교 결과 뒤에 난 것) → "run" / 비교 결과 있음 → "compare" /
 * 이 작업 마지막 실행이 실제 실행 → "run" / 그 밖 → "compare"(빈 상태)
 */
export function workMainPanel(i: {
    jobId: string;
    run: Pick<itfRunSnapshot, "jobId" | "dryRun"> | null;
    comparing: boolean;
    /** 이 작업의 비교 결과 시각(없으면 null) */
    compareCreatedAt: string | null;
    /** run-store의 마지막 시작 실패(at = ISO 시각) */
    startError: { jobId: string; dryRun: boolean; at: string } | null;
    last: Pick<itfStepLastRun, "record"> | null;
}): "run" | "compare" {
    if (i.run && i.run.jobId === i.jobId && !i.run.dryRun) return "run";
    if (i.comparing) return "compare";
    const err = i.startError;
    if (
        err &&
        err.jobId === i.jobId &&
        !err.dryRun &&
        (i.compareCreatedAt === null || Date.parse(err.at) >= Date.parse(i.compareCreatedAt))
    ) {
        return "run";
    }
    if (i.compareCreatedAt !== null) return "compare";
    if (i.last && i.last.record.jobId === i.jobId && !i.last.record.dryRun) return "run";
    return "compare";
}
