/**
 * 공용 버튼. variant로 역할(주요·보조·위험·글자만)을 나타내고, 비활성 이유는 title로 알려 준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { ReactNode } from "react";

// ========== Props & Types ==========
export type typZBCButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface itfZBCButtonProps {
    children: ReactNode;
    variant?: typZBCButtonVariant;
    type?: "button" | "submit";
    disabled?: boolean;
    /** 비활성 이유 등 (title) */
    title?: string;
    "aria-label"?: string;
    /** 모달이 열릴 때 처음 포커스를 받는다 (ZBCModal이 data-autofocus를 찾는다) */
    initialFocus?: boolean;
    onClick?: () => void;
}

const propsDefault = {
    variant: "secondary",
    type: "button",
    disabled: false,
    initialFocus: false,
} satisfies Partial<itfZBCButtonProps>;

export default function ZBCButton(props: itfZBCButtonProps) {
    const {
        children,
        variant = propsDefault.variant,
        type = propsDefault.type,
        disabled = propsDefault.disabled,
        title,
        initialFocus = propsDefault.initialFocus,
        onClick,
    } = props;

    return (
        <button
            // oxlint-disable-next-line react/button-has-type -- type은 "button" | "submit"으로 제한된 prop
            type={type}
            className="zbc zbcButton"
            data-variant={variant}
            disabled={disabled}
            title={title}
            aria-label={props["aria-label"]}
            data-autofocus={initialFocus ? "" : undefined}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
