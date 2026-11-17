/**
 * 비교 목록 도구 막대: 상태 칩 5개(추가·변경·삭제/대상만·오류·같음), 보기 select, 경로 검색,
 * 오른쪽 `트리 | 평면` 토글(트리일 때 `모두 펼치기`·`모두 접기`), 표시 개수.
 * 칩은 켠 상태의 행만 목록에 보인다(같음은 기본 꺼짐). 보기 select는 rcloud와 같은 자리에 `상태별` 하나만 둔다
 * (spec Q-2). 검색어는 바로 반영하고(입력란), 목록 거르기는 쓰는 쪽에서 디바운스한 값으로 한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import ZBCInput from "@/components/ZBCInput";
import ZBCSelect, { type itfZBCSelectOption } from "@/components/ZBCSelect";
import { compareChips, type itfCompareViewState, type typCompareChip } from "@/lib/compare-view";
import type { typRunMode } from "@/shared/schemas/common";
import type { itfCompareSummary } from "@/shared/types/compare";
import styles from "./CompareToolbar.module.css";

// ========== Props & Types ==========
export interface itfCompareToolbarProps {
    view: itfCompareViewState;
    onChange: (patch: Partial<itfCompareViewState>) => void;
    /** 칩 개수를 셀 비교 요약 */
    summary: itfCompareSummary;
    /** 삭제/대상만 칩 이름을 가르는 작업 모드 */
    mode: typRunMode;
    /** 지금 보이는 행 수 */
    shown: number;
    /** 전체 행 수 */
    total: number;
    /** 트리 보기의 모두 펼치기 */
    onExpandAll?: () => void;
    /** 트리 보기의 모두 접기 */
    onCollapseAll?: () => void;
    /** 펼칠 폴더가 있는지(트리 보기에서만 쓴다) */
    canExpand?: boolean;
}

const propsDefault = {
    onExpandAll: () => undefined,
    onCollapseAll: () => undefined,
    canExpand: false,
} satisfies Partial<itfCompareToolbarProps>;

/** 대응 데이터가 있는 보기는 `상태별` 하나뿐이다(나머지 4종은 범위 밖) */
const VIEW_OPTIONS: readonly itfZBCSelectOption[] = [{ value: "status", label: "상태별" }];

/** 보기가 하나뿐이라 고를 것이 없다. 자리·모양만 rcloud와 같게 둔다 */
function f_NoopView(): void {
    return undefined;
}

export default function CompareToolbar(props: itfCompareToolbarProps) {
    const { view, onChange, summary, mode, shown, total } = props;
    const {
        onExpandAll = propsDefault.onExpandAll,
        onCollapseAll = propsDefault.onCollapseAll,
        canExpand = propsDefault.canExpand,
    } = props;

    // ========== 내부 변수 (_V) ==========
    const chips = compareChips(summary, mode);
    const isTree = view.layout === "tree";

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_ToggleChip = (key: typCompareChip) => () =>
        onChange({ chips: { ...view.chips, [key]: !view.chips[key] } });
    const h_Query = (query: string) => onChange({ query });

    return (
        <div className={styles.CompareToolbar}>
            <div className={styles.chips}>
                {chips.map((c) => (
                    <button
                        type="button"
                        key={c.key}
                        className={styles.chip}
                        data-tone={c.tone}
                        aria-pressed={view.chips[c.key]}
                        onClick={h_ToggleChip(c.key)}
                    >
                        <span className={styles.dot} aria-hidden="true" />
                        {c.label}
                        <span className={styles.chipCount}>{c.count.toLocaleString("ko-KR")}</span>
                    </button>
                ))}
            </div>
            <div className={styles.controls}>
                <label className={styles.label} htmlFor="compare-view">
                    보기
                </label>
                <ZBCSelect
                    id="compare-view"
                    name="compare-view"
                    value="status"
                    options={VIEW_OPTIONS}
                    onChange={f_NoopView}
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
                <fieldset className={styles.modes} aria-label="보기 방식">
                    <button
                        type="button"
                        className={styles.mode}
                        aria-pressed={isTree}
                        onClick={() => onChange({ layout: "tree" })}
                    >
                        트리
                    </button>
                    <button
                        type="button"
                        className={styles.mode}
                        aria-pressed={!isTree}
                        onClick={() => onChange({ layout: "flat" })}
                    >
                        평면
                    </button>
                </fieldset>
                {isTree && (
                    <div className={styles.actions}>
                        <button
                            type="button"
                            className={styles.action}
                            disabled={!canExpand}
                            onClick={onExpandAll}
                        >
                            모두 펼치기
                        </button>
                        <button
                            type="button"
                            className={styles.action}
                            disabled={!canExpand}
                            onClick={onCollapseAll}
                        >
                            모두 접기
                        </button>
                    </div>
                )}
                <output className={styles.count} aria-live="polite">
                    {shown.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")}개 표시
                </output>
            </div>
        </div>
    );
}
