/**
 * 한 줄 입력 (text / number). 값은 문자열로 주고받는다(숫자 변환은 쓰는 쪽에서).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { ChangeEvent } from "react";

// ========== Props & Types ==========
export interface itfZBCInputProps {
    id: string;
    /** drive-app 셀렉터용 (input[name=source]) */
    name?: string;
    value: string;
    onChange: (value: string) => void;
    type?: "text" | "number";
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    invalid?: boolean;
    disabled?: boolean;
    spellCheck?: boolean;
    describedBy?: string;
    /** 경로 입력은 고정폭 */
    mono?: boolean;
}

const propsDefault = {
    type: "text",
    invalid: false,
    disabled: false,
    spellCheck: false,
    mono: false,
} satisfies Partial<itfZBCInputProps>;

export default function ZBCInput(props: itfZBCInputProps) {
    const {
        id,
        name,
        value,
        onChange,
        type = propsDefault.type,
        min,
        max,
        step,
        placeholder,
        invalid = propsDefault.invalid,
        disabled = propsDefault.disabled,
        spellCheck = propsDefault.spellCheck,
        describedBy,
        mono = propsDefault.mono,
    } = props;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Change = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value);

    return (
        <input
            id={id}
            name={name}
            className="zbc zbcInput"
            data-mono={mono ? "" : undefined}
            type={type}
            value={value}
            onChange={h_Change}
            min={min}
            max={max}
            step={step}
            placeholder={placeholder}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            spellCheck={spellCheck}
            autoComplete="off"
        />
    );
}
