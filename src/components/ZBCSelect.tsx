/**
 * 목록에서 하나 고르기 (네이티브 select). 값은 문자열.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { ChangeEvent } from "react";

// ========== Props & Types ==========
export interface itfZBCSelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

export interface itfZBCSelectProps {
    id: string;
    name?: string;
    value: string;
    options: readonly itfZBCSelectOption[];
    onChange: (value: string) => void;
    /** value "" 옵션의 문구 */
    placeholder?: string;
    disabled?: boolean;
    describedBy?: string;
}

const propsDefault = {
    disabled: false,
} satisfies Partial<itfZBCSelectProps>;

export default function ZBCSelect(props: itfZBCSelectProps) {
    const {
        id,
        name,
        value,
        options,
        onChange,
        placeholder,
        disabled = propsDefault.disabled,
        describedBy,
    } = props;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Change = (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value);

    return (
        <select
            id={id}
            name={name}
            className="zbc zbcSelect"
            value={value}
            onChange={h_Change}
            disabled={disabled}
            aria-describedby={describedBy}
        >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                </option>
            ))}
        </select>
    );
}
