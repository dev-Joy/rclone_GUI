/**
 * 토스트 알림 목록. 상태는 색만이 아니라 글자(정보/완료/주의/오류)로도 보여준다.
 * 설정 모달(<dialog>) 위에도 보이도록 popover로 띄운다(popover를 모르는 환경은 그대로 그린다).
 * 모달이 나중에 열리거나 닫혀 dialog가 top layer 위로 올라오면 popover를 다시 올려 가려지지 않게 한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useRef } from "react";

// ========== Internal imports ==========
import type { itfToast, typToastLevel } from "@/stores/toast-store";

// ========== Props & Types ==========
export interface itfZBCToastProps {
    toasts: itfToast[];
    onDismiss?: (id: number) => void;
}

const propsDefault = {
    onDismiss: () => undefined,
} satisfies Partial<itfZBCToastProps>;

const LEVEL_LABEL: Record<typToastLevel, string> = {
    info: "정보",
    success: "완료",
    warning: "주의",
    error: "오류",
};

/** popover 미지원 환경(구형 Chromium)은 그냥 그린다 */
const SUPPORTS_POPOVER =
    typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function";

export default function ZBCToast(props: itfZBCToastProps) {
    const { toasts, onDismiss = propsDefault.onDismiss } = props;

    // ========== hook & state 변수 선언 ==========
    const ref = useRef<HTMLOutputElement>(null);
    const visible = toasts.length > 0;

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        const el = ref.current;
        if (!el || !SUPPORTS_POPOVER || !visible) return;

        /** popover를 top layer 맨 위로 다시 올린다(닫고 다시 열어야 순서가 올라간다) */
        const f_Promote = () => {
            try {
                if (el.matches(":popover-open")) el.hidePopover();
                el.showPopover();
            } catch {
                // 화면에서 빠지는 중이거나 이미 닫힌 경우 — 다음 렌더가 다시 연다
            }
        };

        /** 설정 모달(<dialog>)이 열리거나 닫히면 dialog가 top layer 위로 올라와 토스트를 가린다 */
        const h_ModalToggle = (e: Event) => {
            // popover 자신의 toggle에는 반응하지 않는다(승격이 다시 toggle을 일으키는 무한 루프 방지)
            if (e.target instanceof HTMLDialogElement) f_Promote();
        };

        try {
            // StrictMode 이중 실행에서 이미 열린 popover를 다시 열면 예외가 난다
            if (!el.matches(":popover-open")) el.showPopover();
        } catch {
            // popover가 이미 닫힌(element가 화면에서 빠지는 중) 경우 — 다음 렌더가 다시 연다
        }
        document.addEventListener("toggle", h_ModalToggle, true);
        return () => document.removeEventListener("toggle", h_ModalToggle, true);
    }, [visible]);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Dismiss = (id: number) => () => onDismiss(id);

    if (!visible) return null;
    return (
        <output ref={ref} popover="manual" className="zbc zbcToast" aria-live="polite">
            {toasts.map((t) => (
                <div key={t.id} className="zbcToastItem" data-level={t.level}>
                    <span className="zbcToastLabel">{LEVEL_LABEL[t.level]}</span>
                    <span className="zbcToastMessage">{t.message}</span>
                    <button
                        type="button"
                        className="zbcToastClose"
                        aria-label="알림 닫기"
                        onClick={h_Dismiss(t.id)}
                    >
                        ×
                    </button>
                </div>
            ))}
        </output>
    );
}
