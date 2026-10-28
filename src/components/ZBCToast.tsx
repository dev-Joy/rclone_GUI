/**
 * 토스트 알림 목록. 상태는 색만이 아니라 글자(정보/완료/주의/오류)로도 보여준다.
 *
 * @author dev-Joy 2026-10-28
 */

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

export default function ZBCToast(props: itfZBCToastProps) {
    const { toasts, onDismiss = propsDefault.onDismiss } = props;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Dismiss = (id: number) => () => onDismiss(id);

    if (toasts.length === 0) return null;
    return (
        <output className="zbc zbcToast" aria-live="polite">
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
