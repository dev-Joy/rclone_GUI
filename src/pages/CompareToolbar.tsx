/**
 * 비교 목록 도구 막대: 상태 필터, 경로 검색, 동일 숨기기, 표시 개수.
 * 검색어는 바로 반영하고(입력란), 목록 거르기는 쓰는 쪽에서 디바운스한 값으로 한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import ZBCCheckbox from "@/components/ZBCCheckbox";
import ZBCInput from "@/components/ZBCInput";
import ZBCSelect, { type itfZBCSelectOption } from "@/components/ZBCSelect";
import {
    FILTER_LABELS,
    type itfCompareViewState,
    type typCompareFilterStatus,
} from "@/lib/compare-view";
import styles from "./CompareToolbar.module.css";

// ========== Props & Types ==========
export interface itfCompareToolbarProps {
    view: itfCompareViewState;
    onChange: (patch: Partial<itfCompareViewState>) => void;
    /** 지금 보이는 행 수 */
    shown: number;
    /** 전체 행 수 */
    total: number;
}

const STATUS_OPTIONS: readonly itfZBCSelectOption[] = (
    Object.keys(FILTER_LABELS) as typCompareFilterStatus[]
).map((value) => ({ value, label: FILTER_LABELS[value] }));

function f_IsFilter(v: string): v is typCompareFilterStatus {
    return v in FILTER_LABELS;
}

export default function CompareToolbar(props: itfCompareToolbarProps) {
    const { view, onChange, shown, total } = props;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Status = (v: string) => {
        if (f_IsFilter(v)) onChange({ status: v });
    };
    const h_Query = (query: string) => onChange({ query });
    const h_HideEqual = (hideEqual: boolean) => onChange({ hideEqual });

    return (
        <div className={styles.CompareToolbar}>
            <label className={styles.label} htmlFor="compare-status">
                상태
            </label>
            <ZBCSelect
                id="compare-status"
                name="compare-status"
                value={view.status}
                options={STATUS_OPTIONS}
                onChange={h_Status}
            />
            <label className={styles.label} htmlFor="compare-query">
                경로 검색
            </label>
            <div className={styles.query}>
                <ZBCInput
                    id="compare-query"
                    name="compare-query"
                    value={view.query}
                    onChange={h_Query}
                    placeholder="경로 일부 (대소문자 무시)"
                    mono
                />
            </div>
            <ZBCCheckbox
                id="compare-hide-equal"
                name="compare-hide-equal"
                checked={view.hideEqual}
                onChange={h_HideEqual}
                label="동일 숨기기"
                disabled={view.status === "equal"}
            />
            <output className={styles.count} aria-live="polite">
                {shown.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")}개 표시
            </output>
        </div>
    );
}
