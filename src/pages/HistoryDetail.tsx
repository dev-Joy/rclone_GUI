/**
 * 이력 상세 창(ZBCModal): 결과·오류·계획·사전 확인·rclone 통계와 실행 로그 끝부분(기본 256KB).
 * 이력 표에서 시작 시각을 누르면 열린다(history-store.selectedId). 로그 폴더를 열 수 있다.
 * 전송 중 실패·취소한 기록이면 대상에 임시 파일(.partial)이 남을 수 있다고 알린다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import { errorText, getApi, unwrap } from "@/lib/api";
import { HISTORY_KIND_LABEL, historyKind } from "@/lib/history-view";
import { runStatusText } from "@/lib/run-view";
import { formatBytes, formatDuration, formatLocalDateTime } from "@/shared/format";
import { mayLeavePartial, PARTIAL_LEFT_NOTICE } from "@/shared/partial-files";
import { useHistoryStore } from "@/stores/history-store";
import { useToastStore } from "@/stores/toast-store";
import RunLogTail from "./RunLogTail";
import RunStatsGrid from "./RunStatsGrid";
import styles from "./HistoryDetail.module.css";

export default function HistoryDetail() {
    // ========== hook & state 변수 선언 ==========
    const selectedId = useHistoryStore((s) => s.selectedId);
    const records = useHistoryStore((s) => s.records);
    const log = useHistoryStore((s) => s.log);
    const logLoading = useHistoryStore((s) => s.logLoading);
    const logError = useHistoryStore((s) => s.logError);
    const select = useHistoryStore((s) => s.select);
    const pushToast = useToastStore((s) => s.push);

    // ========== 내부 변수 (_V) ==========
    const rec = selectedId === null ? null : (records.find((r) => r.id === selectedId) ?? null);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Close = () => void select(null);
    const h_OpenLogs = () => {
        unwrap(getApi().app.openLogsFolder()).catch((e: unknown) =>
            pushToast("error", errorText(e)),
        );
    };

    return (
        <ZBCModal
            open={rec !== null}
            title="실행 기록"
            onClose={h_Close}
            footer={
                <>
                    <ZBCButton onClick={h_OpenLogs}>로그 폴더 열기</ZBCButton>
                    <ZBCButton variant="primary" onClick={h_Close} initialFocus>
                        닫기
                    </ZBCButton>
                </>
            }
        >
            {rec && (
                <div className={styles.HistoryDetail}>
                    <p className={styles.headline} data-status={rec.status}>
                        {runStatusText(rec.status, rec.dryRun, rec.mode)} ·{" "}
                        {HISTORY_KIND_LABEL[historyKind(rec)]} · ‘{rec.jobName}’
                    </p>
                    <dl className={styles.meta}>
                        <dt>시작</dt>
                        <dd>{formatLocalDateTime(rec.startedAt)}</dd>
                        <dt>끝</dt>
                        <dd>{formatLocalDateTime(rec.finishedAt)}</dd>
                        <dt>걸린 시간</dt>
                        <dd>{rec.durationMs === null ? "-" : formatDuration(rec.durationMs)}</dd>
                        {rec.exitCode !== null && (
                            <>
                                <dt>rclone 종료 코드</dt>
                                <dd>{rec.exitCode}</dd>
                            </>
                        )}
                        {rec.plan && (
                            <>
                                <dt>비교 계획</dt>
                                <dd>
                                    새 파일 {rec.plan.createFiles} · 변경 {rec.plan.updateFiles} ·
                                    삭제 {rec.plan.deleteFiles} (복사{" "}
                                    {formatBytes(rec.plan.transferBytes)})
                                </dd>
                            </>
                        )}
                        {rec.preflight && (
                            <>
                                <dt>사전 확인</dt>
                                <dd>
                                    복사 예정 {rec.preflight.transfers} · 삭제 예정{" "}
                                    {rec.preflight.deletes} · 오류 {rec.preflight.errors}
                                </dd>
                            </>
                        )}
                    </dl>
                    {rec.error && (
                        <div className={styles.error} role="alert">
                            <p className={styles.errorMessage}>{rec.error.message}</p>
                            {rec.error.detail && (
                                <pre className={styles.detail}>{rec.error.detail}</pre>
                            )}
                        </div>
                    )}
                    {mayLeavePartial(rec) && (
                        <p className={styles.warning} role="note">
                            {PARTIAL_LEFT_NOTICE}
                        </p>
                    )}
                    {rec.stats ? (
                        <RunStatsGrid stats={rec.stats} dryRun={rec.dryRun} />
                    ) : (
                        <p className={styles.muted}>rclone 통계가 없습니다.</p>
                    )}
                    {logLoading ? (
                        <p className={styles.muted}>로그를 읽는 중…</p>
                    ) : logError ? (
                        <p className={styles.errorMessage}>로그를 읽지 못했습니다: {logError}</p>
                    ) : log && !log.exists ? (
                        <p className={styles.muted}>
                            {log.fileName === null
                                ? "rclone을 실행하지 않아 실행 로그가 없습니다."
                                : "로그 파일이 없습니다(보관 기간이 지나 지워졌을 수 있습니다)."}
                        </p>
                    ) : (
                        log && (
                            <>
                                {log.truncated && (
                                    <p className={styles.muted}>
                                        로그가 커서 끝부분만 보여 줍니다(전체{" "}
                                        {formatBytes(log.sizeBytes)}). 전체는 로그 폴더의 파일을
                                        여세요.
                                    </p>
                                )}
                                <RunLogTail lines={log.lines} dropped={0} logFile={log.fileName} />
                            </>
                        )
                    )}
                </div>
            )}
        </ZBCModal>
    );
}
