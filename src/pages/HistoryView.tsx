/**
 * 작업 화면의 "이력" 탭: 이 작업의 실행 이력(최신순) 표와 종류·결과 필터.
 * 열: 시작 시각(누르면 상세)·종류(수동·자동·미리보기)·모드·결과·걸린 시간·요약(복사·삭제·크기·오류).
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
import { useHistoryStore } from "@/stores/history-store";
import { useToastStore } from "@/stores/toast-store";
import HistoryDetail from "./HistoryDetail";
import styles from "./HistoryView.module.css";

// ========== Props & Types ==========
export interface itfHistoryViewProps {
    job: typJob;
}

const MODE_LABEL = { copy: "복사", sync: "동기화" } as const;

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
                                <th scope="col">모드</th>
                                <th scope="col">결과</th>
                                <th scope="col">걸린 시간</th>
                                <th scope="col">요약</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} data-status={r.status}>
                                    <td>
                                        <button
                                            type="button"
                                            className={styles.open}
                                            onClick={h_Open(r.id)}
                                            title="자세히 보기(통계·오류·로그)"
                                        >
                                            {formatLocalDateTime(r.startedAt)}
                                        </button>
                                    </td>
                                    <td>{HISTORY_KIND_LABEL[historyKind(r)]}</td>
                                    <td>{MODE_LABEL[r.mode]}</td>
                                    <td>
                                        <ZBCBadge
                                            tone={statusTone(r.status)}
                                            title={r.error?.message}
                                        >
                                            {runStatusText(r.status, r.dryRun, r.mode)}
                                        </ZBCBadge>
                                    </td>
                                    <td>
                                        {r.durationMs === null ? "-" : formatDuration(r.durationMs)}
                                    </td>
                                    <td className={styles.counts}>{historyCounts(r)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <HistoryDetail />
        </div>
    );
}
