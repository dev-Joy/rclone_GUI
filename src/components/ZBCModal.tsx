/**
 * 모달 대화상자 (<dialog> showModal). 포커스 가둠·Esc는 브라우저 기본 동작을 쓰고,
 * Esc·닫기 버튼·바깥 클릭은 모두 onClose(= 취소)로 보낸다. 바깥 클릭은 누른 곳과 뗀 곳이 모두 바깥일 때만.
 * 다른 이유로 dialog가 닫혀도(close 이벤트) onClose로 알려 open 상태를 맞춘다.
 * 처음 포커스는 data-autofocus가 있는 요소(ZBCButton initialFocus), 없으면 첫 입력·버튼.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import {
    useEffect,
    useId,
    useRef,
    type MouseEvent,
    type ReactNode,
    type SyntheticEvent,
} from "react";

// ========== Props & Types ==========
export interface itfZBCModalProps {
    open: boolean;
    title: string;
    children: ReactNode;
    /** Esc·닫기·바깥(backdrop) 클릭 → onClose. 파괴 확인 모달에서도 Esc는 "취소" */
    onClose: () => void;
    footer?: ReactNode;
}

const FOCUSABLE = "input, select, textarea, button:not(.zbcModalClose)";

export default function ZBCModal(props: itfZBCModalProps) {
    const { open, title, children, onClose, footer } = props;

    // ========== hook & state 변수 선언 ==========
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    /** mousedown이 바깥(backdrop)에서 시작했는지. 안에서 끌어 바깥에서 떼면 닫지 않는다 */
    const downOutside = useRef(false);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        // StrictMode 이중 실행에서 이미 열린 dialog에 showModal()을 다시 부르면 예외가 난다
        if (open && !el.open) {
            el.showModal();
            const target =
                el.querySelector<HTMLElement>("[data-autofocus]") ??
                el.querySelector<HTMLElement>(FOCUSABLE);
            target?.focus();
        } else if (!open && el.open) {
            el.close();
        }
    }, [open]);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Cancel = (e: SyntheticEvent<HTMLDialogElement>) => {
        e.preventDefault();
        onClose();
    };

    /** 네이티브 close 이벤트: 우리가 닫은 경우(open=false)가 아니면 상태를 맞춘다 */
    const h_NativeClose = () => {
        if (open) onClose();
    };

    /** 바깥(backdrop) 클릭은 dialog 자신이 target이 된다 */
    const h_MouseDown = (e: MouseEvent<HTMLDialogElement>) => {
        downOutside.current = e.target === e.currentTarget;
    };
    const h_Click = (e: MouseEvent<HTMLDialogElement>) => {
        const outside = downOutside.current && e.target === e.currentTarget;
        downOutside.current = false;
        if (outside) onClose();
    };

    return (
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- 바깥 클릭 닫기. 키보드는 Esc(cancel)로 같은 동작
        <dialog
            ref={ref}
            className="zbc zbcModal"
            aria-labelledby={titleId}
            onCancel={h_Cancel}
            onClose={h_NativeClose}
            onMouseDown={h_MouseDown}
            onClick={h_Click}
        >
            {open && (
                <div className="zbcModalBody">
                    <header className="zbcModalHeader">
                        <h2 id={titleId} className="zbcModalTitle">
                            {title}
                        </h2>
                        <button
                            type="button"
                            className="zbcModalClose"
                            aria-label="닫기"
                            onClick={onClose}
                        >
                            ×
                        </button>
                    </header>
                    <div className="zbcModalContent">{children}</div>
                    {footer && <footer className="zbcModalFooter">{footer}</footer>}
                </div>
            )}
        </dialog>
    );
}
