/**
 * 작업 화면 "파일 목록" 탭. 상태: 결과 없음 / 진행 중(단계·파일 수) / 오류 / 결과(칩·검색 도구 막대 → 폴더 안내 → 가상 목록 표).
 * 목록은 평면(CompareTable)과 폴더 트리(CompareTree) 두 모양이고, 트리 펼침 상태는 이 컴포넌트가 들고 있다가
 * 필터·정렬·작업·결과가 바뀌면 접는다. 파일 행 우클릭 메뉴(경로 복사)도 여기서 한 번만 그린다.
 * 요약·안내 줄(미리보기 안내·빈 폴더 불가)은 작업 화면(JobWorkspace)에 있고,
 * 비교 중지는 실행 배너의 공통 중지(JobActivityBar)에 있다.
 * 비교는 원본·대상 목록을 읽기만 하고 파일은 바꾸지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useMemo, useState } from "react";

// ========== Internal imports ==========
import { collectFolderPaths } from "@/lib/compare-tree";
import {
    dirSummaryText,
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
import CompareTree from "./CompareTree";
import FileRowMenu, { type itfFileMenuTarget } from "./FileRowMenu";
import styles from "./CompareView.module.css";

// ========== Props & Types ==========
export interface itfCompareViewProps {
    job: typJob;
}

const SEARCH_DEBOUNCE_MS = 150;

/** 아직 펼친 폴더가 없을 때 쓰는 빈 집합(변경하지 않고 복사해서 쓴다) */
const EMPTY_EXPANDED: ReadonlySet<string> = new Set<string>();

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

    /** 펼친 폴더 경로(트리 보기). resetKey가 바뀌면(필터·정렬·작업·결과) 저절로 접힌다 */
    const [treeState, setTreeState] = useState<{
        key: string;
        expanded: ReadonlySet<string>;
    } | null>(null);
    /** 파일 행 줄 메뉴(경로 복사). 평면·트리가 함께 쓴다 */
    const [menuState, setMenuState] = useState<{
        key: string;
        target: itfFileMenuTarget;
    } | null>(null);

    // ========== 내부 변수 (_V) ==========
    const shown = result && result.jobId === job.id ? result : null;
    const running = runningCompare(active, runningJobId);
    const { chips, sortKey, sortDir } = view;
    const rows = useMemo(() => {
        if (!shown) return [];
        const v: itfCompareViewState = { chips, sortKey, sortDir, query, layout: view.layout };
        return selectRowIndexes(shown.entries, v);
    }, [shown, chips, sortKey, sortDir, query, view.layout]);
    const folderPaths = useMemo(
        () => (shown ? collectFolderPaths(shown.entries, rows) : []),
        [shown, rows],
    );
    const dirText = shown
        ? dirSummaryText(shown.summary, shown.mode, shown.destCanHaveEmptyDirs)
        : null;
    /** 이 값이 바뀌면 접힘·메뉴를 그대로 두지 않는다(effect 없이 상태를 키로 가른다) */
    const resetKey = JSON.stringify([
        job.id,
        query,
        sortKey,
        sortDir,
        chips,
        shown?.createdAt ?? "",
    ]);
    const expanded = treeState?.key === resetKey ? treeState.expanded : EMPTY_EXPANDED;
    const menu = menuState?.key === resetKey ? menuState.target : null;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Sort = (key: typCompareSortKey) =>
        setView(
            key === sortKey
                ? { sortDir: sortDir === "asc" ? "desc" : "asc" }
                : { sortKey: key, sortDir: "asc" },
        );
    const h_ToggleFolder = (path: string) =>
        setTreeState((prev) => {
            const base = prev?.key === resetKey ? prev.expanded : EMPTY_EXPANDED;
            const next = new Set(base);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return { key: resetKey, expanded: next };
        });
    const h_ExpandAll = () => setTreeState({ key: resetKey, expanded: new Set(folderPaths) });
    const h_CollapseAll = () => setTreeState({ key: resetKey, expanded: EMPTY_EXPANDED });
    const h_OpenMenu = (target: itfFileMenuTarget) => setMenuState({ key: resetKey, target });
    const h_CloseMenu = () => setMenuState(null);

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
                summary={shown.summary}
                mode={shown.mode}
                shown={rows.length}
                total={shown.entries.length}
                onExpandAll={h_ExpandAll}
                onCollapseAll={h_CollapseAll}
                canExpand={folderPaths.length > 0}
            />
            {dirText && <p className={styles.dirs}>{dirText}</p>}
            {view.layout === "tree" ? (
                <CompareTree
                    entries={shown.entries}
                    rows={rows}
                    mode={shown.mode}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={h_Sort}
                    expanded={expanded}
                    onToggle={h_ToggleFolder}
                    onFileMenu={h_OpenMenu}
                />
            ) : (
                <CompareTable
                    entries={shown.entries}
                    rows={rows}
                    mode={shown.mode}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={h_Sort}
                    onFileMenu={h_OpenMenu}
                />
            )}
            <FileRowMenu target={menu} onClose={h_CloseMenu} />
        </section>
    );
}
