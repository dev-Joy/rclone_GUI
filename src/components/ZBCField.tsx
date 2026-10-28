/**
 * 입력 필드 묶음: 라벨·도움말·오류·경고. 자식 입력은 aria-describedby로 `${htmlFor}-desc`를 가리킨다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { ReactNode } from "react";

// ========== Props & Types ==========
export interface itfZBCFieldProps {
    label: string;
    htmlFor: string;
    children: ReactNode;
    hint?: string;
    error?: string | null;
    warnings?: readonly string[];
    required?: boolean;
}

const propsDefault = {
    error: null,
    warnings: [],
    required: false,
} satisfies Partial<itfZBCFieldProps>;

export default function ZBCField(props: itfZBCFieldProps) {
    const {
        label,
        htmlFor,
        children,
        hint,
        error = propsDefault.error,
        warnings = propsDefault.warnings,
        required = propsDefault.required,
    } = props;

    return (
        <div className="zbc zbcField" data-invalid={error ? "" : undefined}>
            <label className="zbcFieldLabel" htmlFor={htmlFor}>
                {label}
                {required && <span className="zbcFieldRequired"> (필수)</span>}
            </label>
            {children}
            {/* 비어 있어도 둔다: 입력의 aria-describedby가 항상 가리킬 수 있게 */}
            <div id={`${htmlFor}-desc`} className="zbcFieldDesc">
                {error && (
                    <p className="zbcFieldError" role="alert">
                        {error}
                    </p>
                )}
                {warnings.map((w) => (
                    <p key={w} className="zbcFieldWarning">
                        주의: {w}
                    </p>
                ))}
                {hint && <p className="zbcFieldHint">{hint}</p>}
            </div>
        </div>
    );
}
