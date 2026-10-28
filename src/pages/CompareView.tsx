/**
 * 작업 화면의 "비교" 탭 본문. 상태: 결과 없음 / 진행 중(단계·파일 수, 비교 취소) / 오류 / 결과.
 * 결과: 안내 배너(낡음·형식 충돌·경고) → 비교 방식 → 요약 카드 → 도구 막대 → 가상 목록 표.
 * 비교는 원본·대상 목록을 읽기만 하고 파일은 바꾸지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useMemo, useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import {
    compareStaleReason,
    selectRowIndexes,
    type itfCompareViewState,
    type typCompareFilterStatus,
    type typCompareSortKey,
} from "@/lib/compare-view";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { formatDuration, formatLocalDateTime } from "@/shared/format";
import type { typJob } from "@/shared/schemas/job";
import type { itfCompareActive, itfCompareResult } from "@/shared/types/compare";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { useSettingsStore } from "@/stores/settings-store";
import CompareSummary from "./CompareSummary";
import CompareTable from "./CompareTable";
import CompareToolbar from "./CompareToolbar";
import styles from "./CompareView.module.css";

// ========== Props & Types ==========
export interface itfCompareViewProps {
    job: typJob;
}

/** 낡음 판정을 다시 하는 간격 */
const STALE_TICK_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 150;

function f_PhaseText(a: itfCompareActive): string {
    switch (a.phase) {
        case "check":
            return "경로 확인 중";
        case "list":
            return `목록 읽는 중: 원본 ${a.sourceFiles.toLocaleString("ko-KR")}개 · 대상 ${a.destFiles.toLocaleString("ko-KR")}개`;
        case "diff":
            return "차이 계산 중";
    }
}

function f_MethodText(r: itfCompareResult): string {
    const parts = [
        r.method.checkHashes
            ? "비교 방식: 크기+해시"
            : `비교 방식: 크기+수정시간(허용 ${r.method.modtimeToleranceMs / 1000}초)`,
    ];
    if (r.method.checkHashes && r.summary.hashUnavailableFiles > 0) {
        parts.push(`해시 없음 ${r.summary.hashUnavailableFiles}개(크기만 비교)`);
    }
    parts.push(`${formatLocalDateTime(r.createdAt)} 비교, ${formatDuration(r.durationMs)} 걸림`);
    parts.push("빈 폴더 차이는 표시하지 않습니다");
    return parts.join(" · ");
}

export default function CompareView(props: itfCompareViewProps) {
    const { job } = props;

    // ========== hook & state 변수 선언 ==========
    const result = useCompareStore((s) => s.result);
    const loading = useCompareStore((s) => s.loading);
    const active = useCompareStore((s) => s.active);
    const runningJobId = useCompareStore((s) => s.runningJobId);
    const error = useCompareStore((s) => s.error);
    const view = useCompareStore((s) => s.view);
    const setView = useCompareStore((s) => s.setView);
    const cancel = useCompareStore((s) => s.cancel);
    const maxAgeMinutes = useSettingsStore((s) => s.settings?.safety.compareMaxAgeMinutes ?? 10);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const query = useDebouncedValue(view.query, SEARCH_DEBOUNCE_MS);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        const timer = setInterval(() => setNowMs(Date.now()), STALE_TICK_MS);
        return () => clearInterval(timer);
    }, []);

    // ========== 내부 변수 (_V) ==========
    const shown = result && result.jobId === job.id ? result : null;
    const running = runningCompare(active, runningJobId);
    const { status, hideEqual, sortKey, sortDir } = view;
    const rows = useMemo(() => {
        if (!shown) return [];
        const v: itfCompareViewState = { status, hideEqual, sortKey, sortDir, query };
        return selectRowIndexes(shown.entries, v);
    }, [shown, status, hideEqual, sortKey, sortDir, query]);
    const stale = shown ? compareStaleReason(shown, job, maxAgeMinutes, nowMs) : null;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Cancel = () => void cancel();
    const h_Pick = (filter: typCompareFilterStatus) => setView({ status: filter });
    const h_Sort = (key: typCompareSortKey) =>
        setView(
            key === sortKey
                ? { sortDir: sortDir === "asc" ? "desc" : "asc" }
                : { sortKey: key, sortDir: "asc" },
        );

    if (running && running.jobId === job.id) {
        return (
            <div className={styles.CompareView}>
                <div className={styles.progress}>
                    <output className={styles.phase} aria-live="polite">
                        {f_PhaseText(running)}
                    </output>
                    <p className={styles.note}>
                        원본·대상 목록을 읽기만 하고 파일은 바꾸지 않습니다.
                    </p>
                    <ZBCButton onClick={h_Cancel}>비교 취소</ZBCButton>
                </div>
            </div>
        );
    }

    if (!shown) {
        return (
            <div className={styles.CompareView}>
                {running && (
                    <p className={styles.banner} data-level="info">
                        다른 작업을 비교하는 중입니다. 끝나면 이 작업을 비교할 수 있습니다.
                    </p>
                )}
                {error ? (
                    <div className={styles.error} role="alert">
                        <p className={styles.errorMessage}>비교하지 못했습니다: {error.message}</p>
                        {error.detail && (
                            <details>
                                <summary>자세히</summary>
                                <pre className={styles.detail}>{error.detail}</pre>
                            </details>
                        )}
                    </div>
                ) : (
                    <p className={styles.empty}>
                        {loading
                            ? "비교 결과를 불러오는 중…"
                            : "아직 비교하지 않았습니다. ‘비교’를 누르면 원본·대상 목록을 읽기만 하고 파일은 바꾸지 않습니다."}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className={styles.CompareView}>
            {stale && (
                <p className={styles.banner} data-level="warning" data-kind="stale">
                    {stale}
                </p>
            )}
            {shown.summary.conflictFiles > 0 && (
                <p className={styles.banner} data-level="danger">
                    파일과 폴더 이름이 겹치는 항목 {shown.summary.conflictFiles}개는 직접 정리해야
                    합니다.
                </p>
            )}
            {shown.warnings.map((w) => (
                <p key={w} className={styles.banner} data-level="warning">
                    {w}
                </p>
            ))}
            <p className={styles.method}>{f_MethodText(shown)}</p>
            <CompareSummary
                summary={shown.summary}
                mode={shown.mode}
                active={status}
                onPick={h_Pick}
            />
            <CompareToolbar
                view={view}
                onChange={setView}
                shown={rows.length}
                total={shown.entries.length}
            />
            <CompareTable
                entries={shown.entries}
                rows={rows}
                mode={shown.mode}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={h_Sort}
            />
        </div>
    );
}
