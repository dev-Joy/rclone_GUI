/**
 * 작업 화면 왼쪽 ‘대상에 일어날 일’ 패널. 비교 결과를 요약 카드(세로, 누르면 목록 거르기)로 보여 주고,
 * 그 아래 안내(낡음·형식 충돌·경고·빈 폴더를 못 만드는 대상, INT-003 FR-31)와 미리보기가 비교 결과와
 * 같은 일을 하는지 한 줄, 미리보기 자세히(RunView kind="preview"를 접어 둠), 비교 방식·시각·범위·폴더 변화를 둔다.
 * 비교 결과가 없으면 짧은 안내만 보인다. 파일 목록은 오른쪽 열(CompareView)에 있다.
 *
 * @author dev-Joy 2026-11-08
 */

// ========== Internal imports ==========
import {
    compareStaleReason,
    dirSummaryText,
    emptyDirsUnsupportedText,
    type typCompareFilterStatus,
} from "@/lib/compare-view";
import { previewNotice } from "@/lib/job-steps";
import { formatDuration, formatLocalDateTime } from "@/shared/format";
import type { typJob } from "@/shared/schemas/job";
import type { itfCompareResult } from "@/shared/types/compare";
import { useCompareStore } from "@/stores/compare-store";
import { useRunStore } from "@/stores/run-store";
import { useSettingsStore } from "@/stores/settings-store";
import CompareSummary from "./CompareSummary";
import RunView from "./RunView";
import styles from "./ComparePlanPanel.module.css";

// ========== Props & Types ==========
export interface itfComparePlanPanelProps {
    job: typJob;
    /** 낡음 판정 기준 시각(JobWorkspace의 30초 tick) */
    nowMs: number;
}

/** 비교 방식 한 줄. 해시를 못 쓴 파일이 있으면 함께 적는다 */
function f_MethodText(r: itfCompareResult): string {
    const method = r.method.checkHashes
        ? "비교 방식: 크기+해시"
        : `비교 방식: 크기+수정시간(허용 ${r.method.modtimeToleranceMs / 1000}초)`;
    if (r.method.checkHashes && r.summary.hashUnavailableFiles > 0) {
        return `${method} · 해시 없음 ${r.summary.hashUnavailableFiles}개(크기만 비교)`;
    }
    return method;
}

export default function ComparePlanPanel(props: itfComparePlanPanelProps) {
    const { job, nowMs } = props;

    // ========== hook & state 변수 선언 ==========
    const result = useCompareStore((s) => s.result);
    const status = useCompareStore((s) => s.view.status);
    const setView = useCompareStore((s) => s.setView);
    const runActive = useRunStore((s) => s.active);
    const last = useRunStore((s) => s.last);
    const runError = useRunStore((s) => s.error);
    const maxAgeMinutes = useSettingsStore((s) => s.settings?.safety.compareMaxAgeMinutes ?? 10);

    // ========== 내부 변수 (_V) ==========
    const shown = result && result.jobId === job.id ? result : null;
    const stale = shown ? compareStaleReason(shown, job, maxAgeMinutes, nowMs) : null;
    const dirText = shown
        ? dirSummaryText(shown.summary, shown.mode, shown.destCanHaveEmptyDirs)
        : null;
    const emptyText = shown
        ? emptyDirsUnsupportedText(shown.summary, shown.destCanHaveEmptyDirs)
        : null;
    const notice = previewNotice({ jobId: job.id, compare: shown, run: runActive, last });
    // RunView kind="preview"가 그릴 것이 있을 때만 접힌 자세히를 둔다
    const hasPreviewDetail =
        (runActive !== null && runActive.jobId === job.id && runActive.dryRun) ||
        (last !== null && last.record.jobId === job.id && last.record.dryRun) ||
        (runError !== null && runError.jobId === job.id && runError.dryRun);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Pick = (filter: typCompareFilterStatus) => setView({ status: filter });

    const previewDetail = hasPreviewDetail && (
        <details className={styles.previewDetail}>
            <summary>미리보기 자세히</summary>
            <RunView job={job} kind="preview" />
        </details>
    );

    return (
        <aside id="job-plan" className={styles.ComparePlanPanel} aria-labelledby="job-plan-title">
            <h3 id="job-plan-title" className={styles.title}>
                대상에 일어날 일
            </h3>
            {shown ? (
                <>
                    <CompareSummary
                        layout="column"
                        summary={shown.summary}
                        mode={shown.mode}
                        active={status}
                        onPick={h_Pick}
                    />
                    {stale && (
                        <p className={styles.banner} data-level="warning" data-kind="stale">
                            {stale}
                        </p>
                    )}
                    {shown.summary.conflictFiles > 0 && (
                        <p className={styles.banner} data-level="danger">
                            파일과 폴더 이름이 겹치는 항목 {shown.summary.conflictFiles}개는 직접
                            정리해야 합니다.
                        </p>
                    )}
                    {shown.warnings.map((w) => (
                        <p key={w} className={styles.banner} data-level="warning">
                            {w}
                        </p>
                    ))}
                    {emptyText && (
                        <p
                            className={styles.banner}
                            data-level="warning"
                            data-kind="emptyDirsUnsupported"
                            id="compare-empty-dirs-unsupported"
                        >
                            {emptyText}
                        </p>
                    )}
                    {notice && (
                        <p
                            className={styles.banner}
                            data-level={notice.tone}
                            id="plan-preview-notice"
                            aria-live="polite"
                        >
                            {notice.text}
                        </p>
                    )}
                    {previewDetail}
                    <ul className={styles.meta}>
                        <li>{f_MethodText(shown)}</li>
                        <li>
                            {formatLocalDateTime(shown.createdAt)} 비교 ·{" "}
                            {formatDuration(shown.durationMs)} 걸림
                        </li>
                        {shown.scope === "files" && (
                            <li>파일만 비교(빈 폴더 차이는 표시하지 않습니다)</li>
                        )}
                        {dirText && <li data-kind="dirs">폴더: {dirText}</li>}
                    </ul>
                </>
            ) : (
                <>
                    <p className={styles.empty}>비교하면 대상에 일어날 일이 여기에 정리됩니다.</p>
                    {previewDetail}
                </>
            )}
        </aside>
    );
}
