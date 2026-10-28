/**
 * 여러 줄 입력. 값은 문자열로 주고받는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { ChangeEvent } from "react";

// ========== Props & Types ==========
export interface itfZBCTextareaProps {
    id: string;
    name?: string;
    value: string;
    onChange: (value: string) => void;
    /** 포커스를 잃을 때 (입력 정리용) */
    onBlur?: () => void;
    rows?: number;
    invalid?: boolean;
    describedBy?: string;
    placeholder?: string;
    /** 제외 규칙 등은 고정폭 */
    mono?: boolean;
}

const propsDefault = {
    rows: 4,
    invalid: false,
    mono: false,
} satisfies Partial<itfZBCTextareaProps>;

export default function ZBCTextarea(props: itfZBCTextareaProps) {
    const {
        id,
        name,
        value,
        onChange,
        onBlur,
        rows = propsDefault.rows,
        invalid = propsDefault.invalid,
        describedBy,
        placeholder,
        mono = propsDefault.mono,
    } = props;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Change = (e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value);

    return (
        <textarea
            id={id}
            name={name}
            className="zbc zbcTextarea"
            data-mono={mono ? "" : undefined}
            value={value}
            onChange={h_Change}
            onBlur={onBlur}
            rows={rows}
            placeholder={placeholder}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            spellCheck={false}
        />
    );
}
