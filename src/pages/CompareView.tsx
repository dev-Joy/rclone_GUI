/**
 * 작업 화면 오른쪽 "파일 목록" 열. 상태: 결과 없음 / 진행 중(단계·파일 수) / 오류 / 결과(도구 막대 → 가상 목록 표).
 * 요약 카드·안내 배너·비교 방식·폴더 변화는 왼쪽 ‘대상에 일어날 일’ 패널(ComparePlanPanel)에 있고,
 * 비교 중지는 하단 실행 막대의 공통 중지(JobActivityBar)에 있다.
 * 비교는 원본·대상 목록을 읽기만 하고 파일은 바꾸지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useMemo } from "react";

// ========== Internal imports ==========
import {
    selectRowIndexes,
    type itfCompareViewState,
    type typCompareSortKey,
} from "@/lib/compare-view";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { typJob } from "@/shared/schemas/job";
import type { itfCompareActive } from "@/shared/types/compare";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import CompareTable from "./CompareTable";
import CompareToolbar from "./CompareToolbar";
import styles from "./CompareView.module.css";

// ========== Props & Types ==========
export interface itfCompareViewProps {
    job: typJob;
}

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
    const query = useDebouncedValue(view.query, SEARCH_DEBOUNCE_MS);

    // ========== 내부 변수 (_V) ==========
    const shown = result && result.jobId === job.id ? result : null;
    const running = runningCompare(active, runningJobId);
    const { status, hideEqual, sortKey, sortDir } = view;
    const rows = useMemo(() => {
        if (!shown) return [];
        const v: itfCompareViewState = { status, hideEqual, sortKey, sortDir, query };
        return selectRowIndexes(shown.entries, v);
    }, [shown, status, hideEqual, sortKey, sortDir, query]);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
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
        <section className={styles.CompareView} aria-label="파일 목록">
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
        </section>
    );
}
