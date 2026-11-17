/**
 * 비교 결과 트리 표(INT-008 FR-12). 폴더 행과 파일 행을 1차원으로 펼쳐 30px 고정 높이 가상 목록으로 그린다.
 * 머리글은 평면 표와 같은 6열(CompareHead)이고, 파일 행 렌더도 CompareRow를 그대로 쓴다.
 * 폴더 행은 ▸/▾ 단추로 접고 펼치며(aria-expanded), 하위 파일 수·변경 수를 보여 준다. 나머지 셀은 "—"다.
 * 데이터가 1만 행이어도 그리는 행은 보이는 행 + 여유분뿐이다(NFR-3).
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { useMemo } from "react";

// ========== Internal imports ==========
import { buildTreeRows } from "@/lib/compare-tree";
import type { typCompareSortKey, typSortDir } from "@/lib/compare-view";
import { useVirtualRows } from "@/lib/use-virtual-rows";
import type { typRunMode } from "@/shared/schemas/common";
import type { itfDiffEntry } from "@/shared/types/compare";
import type { itfFileDiffTarget } from "@/shared/types/file-diff";
import type { itfFileMenuTarget } from "./FileRowMenu";
import CompareHead from "./CompareHead";
import { CompareRow } from "./CompareRow";
import tableStyles from "./CompareTable.module.css";
import styles from "./CompareTree.module.css";

// ========== Props & Types ==========
export interface itfCompareTreeProps {
    entries: readonly itfDiffEntry[];
    /** 보여 줄 entries 인덱스(필터·정렬 결과) */
    rows: readonly number[];
    mode: typRunMode;
    sortKey: typCompareSortKey;
    sortDir: typSortDir;
    onSort: (key: typCompareSortKey) => void;
    /** 펼친 폴더 경로 */
    expanded: ReadonlySet<string>;
    onToggle: (path: string) => void;
    /** 파일 행 우클릭·메뉴 키로 연다 */
    onFileMenu?: (target: itfFileMenuTarget) => void;
    /** 비교할 수 있는 파일 행 더블클릭으로 원본·대상 내용 비교를 연다 */
    onFileDiff?: (target: itfFileDiffTarget) => void;
}

/** CompareTable.module.css의 행 높이와 맞춘다 */
const ROW_HEIGHT = 30;

/** 표의 열 수(빈 행 colSpan) */
const COLUMN_COUNT = 6;

/** 폴더 이름 앞에 두는 문자 기호(새 아이콘 라이브러리를 들이지 않는다) */
const FOLDER_ICON = "📁";

/** 넘어온 값이 없는 항목만 쓰는 기본값 */
const propsDefault = {
    onFileMenu: undefined,
    onFileDiff: undefined,
} satisfies Partial<itfCompareTreeProps>;

export default function CompareTree(props: itfCompareTreeProps) {
    const {
        entries,
        rows,
        mode,
        sortKey,
        sortDir,
        onSort,
        expanded,
        onToggle,
        onFileMenu = propsDefault.onFileMenu,
        onFileDiff = propsDefault.onFileDiff,
    } = props;

    // ========== hook & state 변수 선언 ==========
    /** 필터·정렬·펼침이 바뀔 때만 트리를 다시 만든다(스크롤로 다시 그릴 때는 기억한 값을 쓴다) */
    const treeRows = useMemo(
        () => buildTreeRows(entries, rows, expanded),
        [entries, rows, expanded],
    );
    /** 접힘·펼침은 훅의 resetKey에 넣지 않는다(접고 펼칠 때 스크롤을 맨 위로 되돌리지 않는다) */
    const { ref, win } = useVirtualRows<HTMLElement>(treeRows.length, ROW_HEIGHT, 10, rows);

    // ========== 내부 변수 (_V) ==========
    const visible = treeRows.slice(win.start, win.end);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Toggle = (path: string) => () => onToggle(path);

    return (
        <div className={`${tableStyles.CompareTable} ${styles.CompareTree}`}>
            <section
                ref={ref}
                className={tableStyles.scroll}
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 스크롤 가능한 영역은 포커스할 수 있어야 한다
                tabIndex={0}
                aria-label="비교 결과 목록"
            >
                <table className={tableStyles.table} aria-rowcount={treeRows.length + 1}>
                    <colgroup>
                        <col />
                        <col className={tableStyles.colSize} />
                        <col className={tableStyles.colTime} />
                        <col className={tableStyles.colStatus} />
                        <col className={tableStyles.colTime} />
                        <col className={tableStyles.colSize} />
                    </colgroup>
                    <CompareHead sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <tbody>
                        {win.padTop > 0 && (
                            <tr className={tableStyles.spacer} aria-hidden="true">
                                <td
                                    colSpan={COLUMN_COUNT}
                                    style={{ height: win.padTop }}
                                    aria-hidden="true"
                                />
                            </tr>
                        )}
                        {visible.map((row, k) => {
                            const rowIndex = win.start + k + 2;
                            if (row.kind === "file") {
                                return (
                                    <CompareRow
                                        key={`f:${row.entryIndex}`}
                                        entry={entries[row.entryIndex]!}
                                        mode={mode}
                                        rowIndex={rowIndex}
                                        depth={row.depth}
                                        onFileMenu={onFileMenu}
                                        onFileDiff={onFileDiff}
                                    />
                                );
                            }
                            const open = expanded.has(row.path);
                            return (
                                <tr
                                    key={`d:${row.path}`}
                                    className={tableStyles.row}
                                    aria-rowindex={rowIndex}
                                    data-kind="folder"
                                >
                                    <td
                                        className={tableStyles.path}
                                        style={{ paddingLeft: 8 + row.depth * 14 }}
                                        title={row.path}
                                    >
                                        <button
                                            type="button"
                                            className={styles.toggle}
                                            aria-expanded={open}
                                            onClick={h_Toggle(row.path)}
                                        >
                                            <span className={styles.arrow} aria-hidden="true">
                                                {open ? "▾" : "▸"}
                                            </span>
                                            <span className={styles.folderIcon} aria-hidden="true">
                                                {FOLDER_ICON}
                                            </span>
                                            <span className={styles.name}>{row.name}</span>
                                        </button>
                                        <span className={styles.summary}>
                                            (하위 {row.fileCount}개, 변경 {row.changeCount}개)
                                        </span>
                                    </td>
                                    <td className={tableStyles.num}>—</td>
                                    <td className={tableStyles.time}>—</td>
                                    <td>—</td>
                                    <td className={tableStyles.time}>—</td>
                                    <td className={tableStyles.num}>—</td>
                                </tr>
                            );
                        })}
                        {win.padBottom > 0 && (
                            <tr className={tableStyles.spacer} aria-hidden="true">
                                <td
                                    colSpan={COLUMN_COUNT}
                                    style={{ height: win.padBottom }}
                                    aria-hidden="true"
                                />
                            </tr>
                        )}
                    </tbody>
                </table>
                {treeRows.length === 0 && (
                    <p className={tableStyles.empty}>조건에 맞는 항목이 없습니다.</p>
                )}
            </section>
        </div>
    );
}
