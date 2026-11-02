/**
 * 미리보기·실행의 진행과 결과 (INT-002 T-08 단계 화면).
 * - kind="preview": ‘비교·미리보기’ 탭 위쪽. 미리보기 진행·결과·오류가 없으면 아무것도 그리지 않는다.
 * - kind="real": ‘실행’ 탭 본문. 상태: 실행 없음 / 진행 중(단계·진행률·통계·최근 로그) / 마지막 결과.
 * 실행 시작 버튼은 작업 화면 헤더에, 중지 버튼은 공통 중지 막대(JobActivityBar)에 있다.
 * 실제 실행은 중지해도 이미 복사(·삭제)된 파일이 되돌려지지 않는다는 것을 알린다.
 * 사전 확인 불일치(blocked, PLAN_DRIFT)는 비교 결과와 다른 점을 목록으로 보여 준다.
 * 전송 중 실패·취소로 끝났으면 대상에 임시 파일(.partial)이 남을 수 있다고 알린다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { runStatusText } from "@/lib/run-view";
import { formatDuration, formatLocalDateTime } from "@/shared/format";
import { mayLeavePartial, PARTIAL_LEFT_NOTICE } from "@/shared/partial-files";
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
    /** preview: 미리보기만, real: 실제 실행만 */
    kind: "preview" | "real";
}

const RUNNING_NOTE: Record<typRunMode, string> = {
    copy: "대상 폴더에 파일을 복사하고 있습니다. 중지해도 이미 복사된 파일은 대상에 남습니다.",
    sync: "대상 폴더를 원본과 같게 바꾸고 있습니다(삭제 포함). 중지해도 이미 복사·삭제된 파일은 되돌리지 않습니다.",
};

function f_PhaseText(phase: typRunPhase, dryRun: boolean, mode: typRunMode): string {
    switch (phase) {
        case "validating":
            return "준비 중";
        case "comparing":
            return "비교 중(자동 실행, 파일은 바꾸지 않음)";
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
    const { job, kind } = props;

    // ========== hook & state 변수 선언 ==========
    const active = useRunStore((s) => s.active);
    const dropped = useRunStore((s) => s.dropped);
    const last = useRunStore((s) => s.last);
    const error = useRunStore((s) => s.error);

    // ========== 내부 변수 (_V) ==========
    const preview = kind === "preview";
    const mine = active && active.jobId === job.id && active.dryRun === preview ? active : null;
    const shownLast =
        last && last.record.jobId === job.id && last.record.dryRun === preview ? last : null;
    const shownError = error && error.jobId === job.id ? error.payload : null;

    // 미리보기 영역은 보일 것이 없으면 그리지 않는다
    if (preview && !mine && !shownLast && !shownError) return null;

    if (mine) {
        return (
            <div className={styles.RunView}>
                <div className={styles.progress}>
                    <output className={styles.phase} aria-live="polite">
                        {runStatusText("running", mine.dryRun, mine.mode)}:{" "}
                        {mine.cancelRequested
                            ? "중지하는 중…"
                            : f_PhaseText(mine.phase, mine.dryRun, mine.mode)}
                    </output>
                    <p className={styles.note}>
                        {mine.dryRun
                            ? "미리보기는 파일을 바꾸지 않습니다."
                            : mine.phase === "comparing"
                              ? "자동 실행: 비교 결과가 자동 실행 조건(삭제 허용·한도·사전 확인)을 만족할 때만 실행합니다."
                              : mine.phase === "preflight"
                                ? "실행 직전 비교 결과와 같은지 확인하고 있습니다. 다르면 실행하지 않습니다."
                                : RUNNING_NOTE[mine.mode]}
                    </p>
                </div>
                <RunStatsGrid stats={mine.stats} dryRun={mine.dryRun} />
                <RunLogTail lines={mine.tail} dropped={dropped} logFile={mine.logFile} />
            </div>
        );
    }

    return (
        <div className={styles.RunView}>
            {active && !preview && (
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
                        {mayLeavePartial(shownLast.record) && (
                            <p className={styles.warning} role="note">
                                {PARTIAL_LEFT_NOTICE}
                            </p>
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
                        아직 실행하지 않았습니다. 먼저 ‘비교’한 뒤 ‘
                        {job.mode === "sync" ? "동기화 실행" : "복사 실행"}’을 누르세요. 최근
                        미리보기는 ‘비교·미리보기’에, 지난 실행은 ‘결과·이력’에 있습니다.
                    </p>
                )
            )}
        </div>
    );
}
