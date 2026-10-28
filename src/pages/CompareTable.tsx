/**
 * 비교 결과 표(고정 높이 30px 행의 가상 목록). 보이는 행만 그리고 위·아래는 빈 행으로 채운다.
 * 열: 상태(+사유) · 경로 · 원본 크기·수정시간 · 대상 크기·수정시간. 머리글 버튼으로 정렬한다.
 * 화면 읽기 프로그램용으로 aria-rowcount·aria-rowindex·aria-sort를 둔다. 머리글은 스크롤해도 고정된다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { memo } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import {
    reasonText,
    statusLabel,
    statusTone,
    type typCompareSortKey,
    type typSortDir,
} from "@/lib/compare-view";
import { useVirtualRows } from "@/lib/use-virtual-rows";
import { formatBytes, formatModTime } from "@/shared/format";
import type { typRunMode } from "@/shared/schemas/common";
import type { itfDiffEntry } from "@/shared/types/compare";
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
}

interface itfRowProps {
    entry: itfDiffEntry;
    mode: typRunMode;
    rowIndex: number;
}

/** CompareTable.module.css의 행 높이와 맞춘다 */
const ROW_HEIGHT = 30;

const COLUMNS: ReadonlyArray<{ key: typCompareSortKey; label: string }> = [
    { key: "status", label: "상태" },
    { key: "path", label: "경로" },
    { key: "srcSize", label: "원본 크기" },
    { key: "srcTime", label: "원본 수정시간" },
    { key: "dstSize", label: "대상 크기" },
    { key: "dstTime", label: "대상 수정시간" },
];

function f_Size(side: itfDiffEntry["source"]): string {
    return side ? formatBytes(side.size) : "—";
}

function f_Time(side: itfDiffEntry["source"]): string {
    return side ? formatModTime(side.modTimeMs) : "—";
}

const CompareRow = memo(function CompareRow(props: itfRowProps) {
    const { entry, mode, rowIndex } = props;
    const reasons = entry.status === "modified" ? reasonText(entry.reasons) : "";
    const pathTitle =
        entry.dest && entry.source && entry.dest.path !== entry.source.path
            ? `원본: ${entry.source.path}\n대상: ${entry.dest.path}`
            : entry.path;
    return (
        <tr className={styles.row} aria-rowindex={rowIndex} data-status={entry.status}>
            <td className={styles.status}>
                <ZBCBadge tone={statusTone(entry.status, mode)}>
                    {statusLabel(entry.status, mode)}
                </ZBCBadge>
                {reasons && <span className={styles.reason}>{reasons}</span>}
            </td>
            <td className={styles.path} title={pathTitle}>
                {entry.path}
                {entry.caseOnly && <span className={styles.caseOnly}> 대소문자만 다름</span>}
            </td>
            <td className={styles.num}>{f_Size(entry.source)}</td>
            <td className={styles.time}>{f_Time(entry.source)}</td>
            <td className={styles.num}>{f_Size(entry.dest)}</td>
            <td className={styles.time}>{f_Time(entry.dest)}</td>
        </tr>
    );
});

export default function CompareTable(props: itfCompareTableProps) {
    const { entries, rows, mode, sortKey, sortDir, onSort } = props;

    // ========== hook & state 변수 선언 ==========
    const { ref, win } = useVirtualRows<HTMLElement>(rows.length, ROW_HEIGHT, 10, rows);

    // ========== 내부 변수 (_V) ==========
    const visible = rows.slice(win.start, win.end);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Sort = (key: typCompareSortKey) => () => onSort(key);
    function f_AriaSort(key: typCompareSortKey): "ascending" | "descending" | "none" {
        if (key !== sortKey) return "none";
        return sortDir === "asc" ? "ascending" : "descending";
    }

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
                        <col className={styles.colStatus} />
                        <col />
                        <col className={styles.colSize} />
                        <col className={styles.colTime} />
                        <col className={styles.colSize} />
                        <col className={styles.colTime} />
                    </colgroup>
                    <thead className={styles.head}>
                        <tr className={styles.row} aria-rowindex={1}>
                            {COLUMNS.map((c) => (
                                <th key={c.key} scope="col" aria-sort={f_AriaSort(c.key)}>
                                    <button
                                        type="button"
                                        className={styles.sort}
                                        data-sort-key={c.key}
                                        onClick={h_Sort(c.key)}
                                    >
                                        {c.label}
                                        {c.key === sortKey && (
                                            <span aria-hidden="true">
                                                {sortDir === "asc" ? " ▲" : " ▼"}
                                            </span>
                                        )}
                                    </button>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {win.padTop > 0 && (
                            <tr className={styles.spacer} aria-hidden="true">
                                <td
                                    colSpan={COLUMNS.length}
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
                            />
                        ))}
                        {win.padBottom > 0 && (
                            <tr className={styles.spacer} aria-hidden="true">
                                <td
                                    colSpan={COLUMNS.length}
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
