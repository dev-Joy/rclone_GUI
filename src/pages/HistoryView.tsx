/**
 * 작업 화면의 "기록" 탭: 이 작업의 실행 이력(최신순) 표와 종류·결과 필터.
 * 열: 시작 · 종류 · 결과 · 건수 · 걸린 시간 · 내용 · 링크(목록·정보·로그).
 * `목록`은 파일 목록 탭으로, `정보`는 실행 기록 상세 창(HistoryDetail)으로, `로그`는 로그 폴더로 간다.
 * 실행이 끝나면 목록을 다시 받는다(history-store.subscribe, HomePage에서 구독).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { useEffect } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCSelect from "@/components/ZBCSelect";
import { errorText, getApi, unwrap } from "@/lib/api";
import {
    filterHistory,
    HISTORY_KIND_LABEL,
    HISTORY_KIND_OPTIONS,
    HISTORY_STATUS_OPTIONS,
    historyCounts,
    historyKind,
    statusTone,
    type typHistoryKindFilter,
    type typHistoryStatusFilter,
} from "@/lib/history-view";
import { runStatusText } from "@/lib/run-view";
import { formatDuration, formatLocalDateTime } from "@/shared/format";
import type { typJob } from "@/shared/schemas/job";
import type { typRunRecord } from "@/shared/schemas/run";
import { useHistoryStore } from "@/stores/history-store";
import { useToastStore } from "@/stores/toast-store";
import { useUiStore } from "@/stores/ui-store";
import HistoryDetail from "./HistoryDetail";
import styles from "./HistoryView.module.css";

// ========== Props & Types ==========
export interface itfHistoryViewProps {
    job: typJob;
}

/** 표의 내용 칸: 실패 사유(없으면 rclone이 남긴 마지막 오류, 둘 다 없으면 "-") */
function f_Message(r: typRunRecord): string {
    return r.error?.message ?? r.stats?.lastError ?? "-";
}

export default function HistoryView(props: itfHistoryViewProps) {
    const { job } = props;

    // ========== hook & state 변수 선언 ==========
    const records = useHistoryStore((s) => s.records);
    const shownJobId = useHistoryStore((s) => s.jobId);
    const loading = useHistoryStore((s) => s.loading);
    const error = useHistoryStore((s) => s.error);
    const filter = useHistoryStore((s) => s.filter);
    const load = useHistoryStore((s) => s.load);
    const setFilter = useHistoryStore((s) => s.setFilter);
    const select = useHistoryStore((s) => s.select);
    const setTab = useUiStore((s) => s.setTab);
    const pushToast = useToastStore((s) => s.push);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        void load(job.id);
    }, [job.id, load]);

    // ========== 내부 변수 (_V) ==========
    const mine = shownJobId === job.id ? records : [];
    const rows = filterHistory(mine, filter);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Kind = (v: string) => setFilter({ kind: v as typHistoryKindFilter });
    const h_Status = (v: string) => setFilter({ status: v as typHistoryStatusFilter });
    const h_Reload = () => void load(job.id);
    const h_OpenLogs = () => {
        unwrap(getApi().app.openLogsFolder()).catch((e: unknown) =>
            pushToast("error", errorText(e)),
        );
    };
    const h_ShowFiles = () => setTab("files");
    const h_Open = (runId: string) => () => void select(runId);

    return (
        <div className={styles.HistoryView}>
            <div className={styles.toolbar}>
                <ZBCSelect
                    id="history-kind"
                    name="historyKind"
                    value={filter.kind}
                    options={HISTORY_KIND_OPTIONS}
                    onChange={h_Kind}
                />
                <ZBCSelect
                    id="history-status"
                    name="historyStatus"
                    value={filter.status}
                    options={HISTORY_STATUS_OPTIONS}
                    onChange={h_Status}
                />
                <ZBCButton onClick={h_Reload} disabled={loading}>
                    새로 고침
                </ZBCButton>
                <ZBCButton onClick={h_OpenLogs}>로그 폴더 열기</ZBCButton>
                <output className={styles.count}>
                    {loading ? "불러오는 중…" : `${rows.length}건 / 전체 ${mine.length}건`}
                </output>
            </div>
            {error && (
                <p className={styles.error} role="alert">
                    이력을 불러오지 못했습니다: {error}
                </p>
            )}
            {!loading && mine.length === 0 && !error ? (
                <p className={styles.empty}>
                    아직 실행 이력이 없습니다. 미리보기·실행·자동 실행이 끝나면 여기에 남습니다
                    (바꿀 파일이 없던 자동 실행은 남기지 않습니다).
                </p>
            ) : (
                <div className={styles.tableWrap}>
                    <table className={styles.table} aria-label="실행 이력">
                        <thead>
                            <tr>
                                <th scope="col">시작</th>
                                <th scope="col">종류</th>
                                <th scope="col">결과</th>
                                <th scope="col">건수</th>
                                <th scope="col">걸린 시간</th>
                                <th scope="col">내용</th>
                                <th scope="col">
                                    <span className={styles.srOnly}>링크</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => {
                                const message = f_Message(r);
                                return (
                                    <tr key={r.id} data-status={r.status}>
                                        <td>{formatLocalDateTime(r.startedAt)}</td>
                                        <td>{HISTORY_KIND_LABEL[historyKind(r)]}</td>
                                        <td>
                                            <ZBCBadge
                                                tone={statusTone(r.status)}
                                                title={r.error?.message}
                                            >
                                                {runStatusText(r.status, r.dryRun, r.mode)}
                                            </ZBCBadge>
                                        </td>
                                        <td className={styles.counts}>{historyCounts(r)}</td>
                                        <td>
                                            {r.durationMs === null
                                                ? "-"
                                                : formatDuration(r.durationMs)}
                                        </td>
                                        <td className={styles.message} title={message}>
                                            {message}
                                        </td>
                                        <td className={styles.links}>
                                            <button
                                                type="button"
                                                className={styles.link}
                                                onClick={h_ShowFiles}
                                            >
                                                목록
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.link}
                                                onClick={h_Open(r.id)}
                                            >
                                                정보
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.link}
                                                onClick={h_OpenLogs}
                                            >
                                                로그
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <HistoryDetail />
        </div>
    );
}
