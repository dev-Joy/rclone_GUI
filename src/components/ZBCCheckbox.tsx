/**
 * 체크박스 + 라벨 + 설명. 라벨을 눌러도 바뀐다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { ChangeEvent, ReactNode } from "react";

// ========== Props & Types ==========
export interface itfZBCCheckboxProps {
    id: string;
    name?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: ReactNode;
    description?: string;
    disabled?: boolean;
}

const propsDefault = {
    disabled: false,
} satisfies Partial<itfZBCCheckboxProps>;

export default function ZBCCheckbox(props: itfZBCCheckboxProps) {
    const {
        id,
        name,
        checked,
        onChange,
        label,
        description,
        disabled = propsDefault.disabled,
    } = props;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Change = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked);

    return (
        <div className="zbc zbcCheckbox">
            <input
                id={id}
                name={name}
                className="zbcCheckboxInput"
                type="checkbox"
                checked={checked}
                onChange={h_Change}
                disabled={disabled}
                aria-describedby={description ? `${id}-desc` : undefined}
            />
            <div className="zbcCheckboxText">
                <label className="zbcCheckboxLabel" htmlFor={id}>
                    {label}
                </label>
                {description && (
                    <p id={`${id}-desc`} className="zbcCheckboxDescription">
                        {description}
                    </p>
                )}
            </div>
        </div>
    );
}
