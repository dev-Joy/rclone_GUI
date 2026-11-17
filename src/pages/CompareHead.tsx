/**
 * 비교 결과 표의 6열 머리글. 평면 표(CompareTable)와 트리 표(CompareTree)가 함께 쓴다.
 * 머리글 버튼으로 정렬하고, aria-sort로 지금 정렬 방향을 알린다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== Internal imports ==========
import type { typCompareSortKey, typSortDir } from "@/lib/compare-view";
import styles from "./CompareTable.module.css";

// ========== Props & Types ==========
export interface itfCompareHeadProps {
    sortKey: typCompareSortKey;
    sortDir: typSortDir;
    onSort: (key: typCompareSortKey) => void;
}

/** rcloud와 같은 6열 차례 */
const COLUMNS: ReadonlyArray<{ key: typCompareSortKey; label: string }> = [
    { key: "path", label: "항목" },
    { key: "srcSize", label: "원본 크기" },
    { key: "srcTime", label: "원본 수정 시각" },
    { key: "status", label: "할 일" },
    { key: "dstTime", label: "대상 수정 시각" },
    { key: "dstSize", label: "대상 크기" },
];

export default function CompareHead(props: itfCompareHeadProps) {
    const { sortKey, sortDir, onSort } = props;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Sort = (key: typCompareSortKey) => () => onSort(key);
    function f_AriaSort(key: typCompareSortKey): "ascending" | "descending" | "none" {
        if (key !== sortKey) return "none";
        return sortDir === "asc" ? "ascending" : "descending";
    }

    return (
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
                                <span aria-hidden="true">{sortDir === "asc" ? " ▲" : " ▼"}</span>
                            )}
                        </button>
                    </th>
                ))}
            </tr>
        </thead>
    );
}
