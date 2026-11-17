/**
 * 비교 결과 평면 표(고정 높이 30px 행의 가상 목록). 보이는 행만 그리고 위·아래는 빈 행으로 채운다.
 * 열: 항목 · 원본 크기 · 원본 수정 시각 · 할 일(+사유) · 대상 수정 시각 · 대상 크기(rcloud와 같은 차례).
 * 머리글(CompareHead)과 행(CompareRow)은 트리 보기(CompareTree)와 함께 쓴다.
 * 머리글은 스크롤해도 고정되고, 화면 읽기 프로그램용으로 aria-rowcount·aria-rowindex·aria-sort를 둔다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typCompareSortKey, typSortDir } from "@/lib/compare-view";
import { useVirtualRows } from "@/lib/use-virtual-rows";
import type { typRunMode } from "@/shared/schemas/common";
import type { itfDiffEntry } from "@/shared/types/compare";
import type { itfFileMenuTarget } from "./FileRowMenu";
import CompareHead from "./CompareHead";
import { CompareRow } from "./CompareRow";
import styles from "./CompareTable.module.css";

// ========== Props & Types ==========
export interface itfCompareTableProps {
    entries: readonly itfDiffEntry[];
    /** 보여 줄 entries 인덱스(필터·정렬 결과) */
    rows: readonly number[];
    mode: typRunMode;
    sortKey: typCompareSortKey;
    sortDir: typSortDir;
    onSort: (key: typCompareSortKey) => void;
    /** 파일 행 우클릭·메뉴 키로 연다 */
    onFileMenu?: (target: itfFileMenuTarget) => void;
}

/** CompareTable.module.css의 행 높이와 맞춘다 */
const ROW_HEIGHT = 30;

/** 표의 열 수(빈 행 colSpan) */
const COLUMN_COUNT = 6;

export default function CompareTable(props: itfCompareTableProps) {
    const { entries, rows, mode, sortKey, sortDir, onSort, onFileMenu } = props;

    // ========== hook & state 변수 선언 ==========
    const { ref, win } = useVirtualRows<HTMLElement>(rows.length, ROW_HEIGHT, 10, rows);

    // ========== 내부 변수 (_V) ==========
    const visible = rows.slice(win.start, win.end);

    return (
        <div className={styles.CompareTable}>
            <section
                ref={ref}
                className={styles.scroll}
                // 스크롤 영역을 키보드로 움직일 수 있게 한다(행은 가상 목록이라 포커스를 받을 요소가 적다)
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 스크롤 가능한 영역은 포커스할 수 있어야 한다
                tabIndex={0}
                aria-label="비교 결과 목록"
            >
                <table className={styles.table} aria-rowcount={rows.length + 1}>
                    <colgroup>
                        <col />
                        <col className={styles.colSize} />
                        <col className={styles.colTime} />
                        <col className={styles.colStatus} />
                        <col className={styles.colTime} />
                        <col className={styles.colSize} />
                    </colgroup>
                    <CompareHead sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <tbody>
                        {win.padTop > 0 && (
                            <tr className={styles.spacer} aria-hidden="true">
                                <td
                                    colSpan={COLUMN_COUNT}
                                    style={{ height: win.padTop }}
                                    aria-hidden="true"
                                />
                            </tr>
                        )}
                        {visible.map((entryIndex, k) => (
                            <CompareRow
                                key={entryIndex}
                                entry={entries[entryIndex]!}
                                mode={mode}
                                rowIndex={win.start + k + 2}
                                onFileMenu={onFileMenu}
                            />
                        ))}
                        {win.padBottom > 0 && (
                            <tr className={styles.spacer} aria-hidden="true">
                                <td
                                    colSpan={COLUMN_COUNT}
                                    style={{ height: win.padBottom }}
                                    aria-hidden="true"
                                />
                            </tr>
                        )}
                    </tbody>
                </table>
                {rows.length === 0 && <p className={styles.empty}>조건에 맞는 항목이 없습니다.</p>}
            </section>
        </div>
    );
}
