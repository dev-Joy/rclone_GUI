/**
 * 탭 목록 (role="tablist"). ←/→ 키로 이동하고 비활성 탭은 건너뛴다. 패널은 쓰는 쪽에서 그린다.
 * 탭 id는 `${id}-tab-${탭}`, 패널 id는 `${id}-panel-${탭}`로 맞춘다
 * (패널: <div role="tabpanel" id={`${id}-panel-${탭}`} aria-labelledby={`${id}-tab-${탭}`}>).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { KeyboardEvent } from "react";

// ========== Props & Types ==========
export interface itfZBCTab<T extends string> {
    id: T;
    label: string;
    disabled?: boolean;
    /** 탭 옆 짧은 표시 (예: "준비 중") */
    badge?: string;
}

export interface itfZBCTabsProps<T extends string> {
    /** 탭·패널 id 접두사 */
    id: string;
    tabs: readonly itfZBCTab<T>[];
    active: T;
    onChange: (id: T) => void;
    "aria-label": string;
}

export default function ZBCTabs<T extends string>(props: itfZBCTabsProps<T>) {
    const { id, tabs, active, onChange } = props;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    /** 방향(step)으로 다음 활성 탭을 찾는다 */
    function f_Next(from: number, step: number): T | null {
        for (let i = 1; i <= tabs.length; i += 1) {
            const tab = tabs[(from + step * i + tabs.length * i) % tabs.length];
            if (tab && !tab.disabled) return tab.id;
        }
        return null;
    }

    const h_KeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const index = tabs.findIndex((t) => t.id === active);
        const next = f_Next(index, e.key === "ArrowRight" ? 1 : -1);
        if (next === null || next === active) return;
        onChange(next);
        e.currentTarget.parentElement
            ?.querySelector<HTMLElement>(`[data-tab-id="${next}"]`)
            ?.focus();
    };

    const h_Click = (tabId: T) => () => onChange(tabId);

    return (
        <div className="zbc zbcTabs" role="tablist" aria-label={props["aria-label"]}>
            {tabs.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`${id}-tab-${t.id}`}
                    aria-controls={t.id === active ? `${id}-panel-${t.id}` : undefined}
                    className="zbcTabsTab"
                    data-tab-id={t.id}
                    aria-selected={t.id === active}
                    tabIndex={t.id === active ? 0 : -1}
                    disabled={t.disabled}
                    onClick={h_Click(t.id)}
                    onKeyDown={h_KeyDown}
                >
                    {t.label}
                    {t.badge && <span className="zbcTabsBadge">{t.badge}</span>}
                </button>
            ))}
        </div>
    );
}
