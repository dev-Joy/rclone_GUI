/**
 * 재사용 드롭다운 메뉴 (INT-008 FR-7·FR-13).
 * 역할 menu/menuitem, Escape·바깥 클릭 닫기, ↑↓·Home·End 이동, 열릴 때 첫 항목 포커스,
 * 닫힐 때 연 곳(트리거)으로 포커스 복귀. 작업 header의 ⋯ 메뉴와 파일 줄 우클릭 메뉴가 함께 쓴다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { useEffect, useRef, type KeyboardEvent as typReactKeyboardEvent } from "react";

// ========== Internal imports ==========
import styles from "./ItemMenu.module.css";

// ========== Props & Types ==========
export interface itfItemMenuEntry {
    label: string;
    onSelect: () => void;
    /** 지금 고를 수 없는 항목 */
    disabled?: boolean;
    /** 항목 DOM id (E2E 선택자 유지 등) */
    id?: string;
    /** 비활성 사유 등 (title) */
    title?: string;
}

export interface itfItemMenuProps {
    /** 열림 여부. false면 아무것도 그리지 않는다 */
    open: boolean;
    items: itfItemMenuEntry[];
    onClose: () => void;
    /** 화면 좌표(px). 없으면 왼쪽 위 */
    x?: number;
    y?: number;
    /** 메뉴 이름(스크린리더·툴팁) */
    label?: string;
    /** 메뉴 폭(px). 화면 밖으로 넘치지 않게 자리를 잡을 때 쓴다 */
    width?: number;
}

const propsDefault = {
    x: 0,
    y: 0,
    label: "메뉴",
    width: 240,
} satisfies Partial<itfItemMenuProps>;

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

export default function ItemMenu(iProps: itfItemMenuProps) {
    const {
        open,
        items,
        onClose,
        x = propsDefault.x,
        y = propsDefault.y,
        label = propsDefault.label,
        width = propsDefault.width,
    } = iProps;

    // ========== hook & state 변수 선언 ==========
    const menuRef = useRef<HTMLDivElement>(null);

    // ========== Effect (부수 효과) ==========
    // 열릴 때 첫 항목에 초점을 두고, 닫히면 연 곳으로 초점을 돌려준다(키보드 사용자가 자리를 잃지 않게)
    useEffect(() => {
        if (!open) return;
        const opener =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        menuRef.current?.querySelector<HTMLButtonElement>(ITEM_SELECTOR)?.focus();
        return () => {
            if (opener?.isConnected) opener.focus();
        };
    }, [open]);

    // 바깥 클릭 · Escape · 스크롤 · 창 크기 변경이면 닫는다
    useEffect(() => {
        if (!open) return;
        const f_Outside = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) onClose();
        };
        const f_Key = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", f_Outside);
        document.addEventListener("keydown", f_Key);
        window.addEventListener("resize", onClose);
        document.addEventListener("scroll", onClose, true);
        return () => {
            document.removeEventListener("mousedown", f_Outside);
            document.removeEventListener("keydown", f_Key);
            window.removeEventListener("resize", onClose);
            document.removeEventListener("scroll", onClose, true);
        };
    }, [open, onClose]);

    if (!open) return null;

    // ========== 내부 변수 (_V) ==========
    const menuPos = {
        /** 화면 오른쪽·아래로 넘치지 않게 */
        left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - (items.length * 32 + 16) - 8)),
    };

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const f_Buttons = (): HTMLButtonElement[] => [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? []),
    ];
    /** 항목을 고르고 닫는다 */
    const h_Select = (entry: itfItemMenuEntry) => {
        onClose();
        entry.onSelect();
    };
    /** ↑↓·Home·End로 항목 사이를 옮긴다 */
    const h_KeyDown = (event: typReactKeyboardEvent<HTMLDivElement>) => {
        const buttons = f_Buttons();
        if (buttons.length === 0) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next: number;
        if (event.key === "ArrowDown") next = index + 1;
        else if (event.key === "ArrowUp") next = index - 1;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else return;
        event.preventDefault();
        buttons[(next + buttons.length) % buttons.length]?.focus();
    };

    return (
        <div
            ref={menuRef}
            className={styles.ItemMenu}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            style={{ left: menuPos.left, top: menuPos.top, width }}
            onKeyDown={h_KeyDown}
        >
            {items.map((entry) => (
                <button
                    type="button"
                    key={entry.label}
                    role="menuitem"
                    id={entry.id}
                    className={styles.entry}
                    disabled={entry.disabled ?? false}
                    title={entry.title}
                    onClick={() => h_Select(entry)}
                >
                    {entry.label}
                </button>
            ))}
        </div>
    );
}
