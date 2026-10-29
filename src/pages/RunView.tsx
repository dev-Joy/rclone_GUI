/**
 * 작업 화면의 "실행" 탭 본문. 상태: 실행 없음 / 진행 중(단계·진행률·통계·최근 로그, 취소) / 마지막 결과.
 * 실행 시작 버튼은 작업 화면 헤더(미리보기·복사 실행)에 있다.
 * 실제 실행은 취소해도 이미 복사(·삭제)된 파일이 되돌려지지 않는다는 것을 알린다.
 * 사전 확인 불일치(blocked, PLAN_DRIFT)는 비교 결과와 다른 점을 목록으로 보여 준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import { runStatusText } from "@/lib/run-view";
import { formatDuration, formatLocalDateTime } from "@/shared/format";
import { matchPlanWithDryRun } from "@/shared/run-plan";
import type { typRunMode, typRunPhase } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import { useRunStore } from "@/stores/run-store";
import DryRunSummary from "./DryRunSummary";
import RunLogTail from "./RunLogTail";
import RunStatsGrid from "./RunStatsGrid";
import styles from "./RunView.module.css";

// ========== Props & Types ==========
export interface itfRunViewProps {
    job: typJob;
}

const RUNNING_NOTE: Record<typRunMode, string> = {
    copy: "대상 폴더에 파일을 복사하고 있습니다. 취소해도 이미 복사된 파일은 대상에 남습니다.",
    sync: "대상 폴더를 원본과 같게 바꾸고 있습니다(삭제 포함). 취소해도 이미 복사·삭제된 파일은 되돌리지 않습니다.",
};

function f_PhaseText(phase: typRunPhase, dryRun: boolean, mode: typRunMode): string {
    switch (phase) {
        case "validating":
        case "comparing":
            return "준비 중";
        case "preflight":
            return "사전 확인 중(파일은 바꾸지 않음)";
        case "transferring":
            if (dryRun) return "미리보기 중(파일은 바꾸지 않음)";
            return mode === "sync" ? "동기화 중" : "복사 중";
        case "finalizing":
            return "마무리 중";
    }
}

export default function RunView(props: itfRunViewProps) {
    const { job } = props;

    // ========== hook & state 변수 선언 ==========
    const active = useRunStore((s) => s.active);
    const dropped = useRunStore((s) => s.dropped);
    const last = useRunStore((s) => s.last);
    const error = useRunStore((s) => s.error);
    const cancel = useRunStore((s) => s.cancel);

    // ========== 내부 변수 (_V) ==========
    const mine = active && active.jobId === job.id ? active : null;
    const shownLast = last && last.record.jobId === job.id ? last : null;
    const shownError = error && error.jobId === job.id ? error.payload : null;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Cancel = () => void cancel();

    if (mine) {
        return (
            <div className={styles.RunView}>
                <div className={styles.progress}>
                    <output className={styles.phase} aria-live="polite">
                        {runStatusText("running", mine.dryRun, mine.mode)}:{" "}
                        {mine.cancelRequested
                            ? "취소하는 중…"
                            : f_PhaseText(mine.phase, mine.dryRun, mine.mode)}
                    </output>
                    <p className={styles.note}>
                        {mine.dryRun
                            ? "미리보기는 파일을 바꾸지 않습니다."
                            : mine.phase === "preflight"
                              ? "실행 직전 비교 결과와 같은지 확인하고 있습니다. 다르면 실행하지 않습니다."
                              : RUNNING_NOTE[mine.mode]}
                    </p>
                    <ZBCButton onClick={h_Cancel} disabled={mine.cancelRequested}>
                        {mine.dryRun ? "미리보기 취소" : "실행 취소"}
                    </ZBCButton>
                </div>
                <RunStatsGrid stats={mine.stats} dryRun={mine.dryRun} />
                <RunLogTail lines={mine.tail} dropped={dropped} logFile={mine.logFile} />
            </div>
        );
    }

    return (
        <div className={styles.RunView}>
            {active && (
                <p className={styles.banner} data-level="info">
                    ‘{active.jobName}’ 작업을 실행하는 중입니다. 끝나면 이 작업을 실행할 수
                    있습니다.
                </p>
            )}
            {shownError && (
                <div className={styles.error} role="alert">
                    <p className={styles.errorMessage}>시작하지 못했습니다: {shownError.message}</p>
                </div>
            )}
            {shownLast ? (
                <>
                    <div className={styles.result} data-status={shownLast.record.status}>
                        <p className={styles.resultTitle}>
                            {runStatusText(
                                shownLast.record.status,
                                shownLast.record.dryRun,
                                shownLast.record.mode,
                            )}
                        </p>
                        <p className={styles.note}>
                            {formatLocalDateTime(shownLast.record.startedAt)} 시작
                            {shownLast.record.durationMs !== null &&
                                `, ${formatDuration(shownLast.record.durationMs)} 걸림`}
                        </p>
                        {shownLast.record.error && (
                            <p className={styles.errorMessage}>{shownLast.record.error.message}</p>
                        )}
                        {shownLast.record.error?.code === "PLAN_DRIFT" &&
                            shownLast.record.error.detail && (
                                <ul className={styles.drift} aria-label="비교 결과와 다른 점">
                                    {shownLast.record.error.detail
                                        .split("\n")
                                        .filter(Boolean)
                                        .map((l) => (
                                            <li key={l}>{l}</li>
                                        ))}
                                </ul>
                            )}
                        {shownLast.record.error?.detail &&
                            shownLast.record.error.code !== "PLAN_DRIFT" && (
                                <details>
                                    <summary>자세히</summary>
                                    <pre className={styles.detail}>
                                        {shownLast.record.error.detail}
                                    </pre>
                                </details>
                            )}
                    </div>
                    {shownLast.dryRunSummary && (
                        <DryRunSummary
                            summary={shownLast.dryRunSummary}
                            mode={shownLast.record.mode}
                            match={
                                shownLast.record.plan && shownLast.record.status === "success"
                                    ? matchPlanWithDryRun(
                                          shownLast.record.plan,
                                          shownLast.dryRunSummary,
                                      )
                                    : null
                            }
                        />
                    )}
                    <RunStatsGrid stats={shownLast.record.stats} dryRun={shownLast.record.dryRun} />
                    <RunLogTail
                        lines={shownLast.tail}
                        dropped={0}
                        logFile={shownLast.record.logFile}
                    />
                </>
            ) : (
                !shownError && (
                    <p className={styles.empty}>
                        아직 실행하지 않았습니다. ‘미리보기’를 누르면 파일을 바꾸지 않고 rclone이 할
                        일을 확인합니다. 실제로 실행하려면 먼저 비교한 뒤 ‘
                        {job.mode === "sync" ? "동기화 실행" : "복사 실행"}’을 누르세요.
                    </p>
                )
            )}
        </div>
    );
}
