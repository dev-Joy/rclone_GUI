/**
 * 비교 요약 카드. 일어날 일(복사·덮어씀·삭제 또는 유지·동일·형식 충돌)을 개수·크기로 보여 주고,
 * 카드를 누르면 그 상태로 목록을 거른다(다시 누르면 전체).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { summaryCards, type typCompareFilterStatus } from "@/lib/compare-view";
import { formatBytes } from "@/shared/format";
import type { typRunMode } from "@/shared/schemas/common";
import type { itfCompareSummary } from "@/shared/types/compare";
import styles from "./CompareSummary.module.css";

// ========== Props & Types ==========
export interface itfCompareSummaryProps {
    summary: itfCompareSummary;
    mode: typRunMode;
    /** 지금 걸린 상태 필터 */
    active: typCompareFilterStatus;
    onPick: (filter: typCompareFilterStatus) => void;
}

export default function CompareSummary(props: itfCompareSummaryProps) {
    const { summary, mode, active, onPick } = props;

    // ========== 내부 변수 (_V) ==========
    const cards = summaryCards(summary, mode);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Pick = (filter: typCompareFilterStatus) => () =>
        onPick(active === filter ? "all" : filter);

    return (
        <ul className={styles.CompareSummary} aria-label="비교 요약">
            {cards.map((c) => (
                <li key={c.filter}>
                    <button
                        type="button"
                        className={styles.card}
                        data-tone={c.tone}
                        aria-pressed={active === c.filter}
                        onClick={h_Pick(c.filter)}
                    >
                        <span className={styles.label}>{c.label}</span>
                        {c.bytes !== null && c.count > 0 && (
                            <span className={styles.bytes}>{formatBytes(c.bytes)}</span>
                        )}
                    </button>
                </li>
            ))}
        </ul>
    );
}
