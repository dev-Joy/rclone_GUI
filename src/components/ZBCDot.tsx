/**
 * 상태 점. 실행 결과를 색으로만 알리고, 뜻은 옆의 글자가 전한다.
 *
 * @author dev-Joy 2026-11-17
 * @description
 *      - 공용 상태 점 (ZBCDot)
 *      - 실행 상태(typRunStatus)를 색으로 보여 준다. 색만으로 뜻을 전하지 않도록 항상 글자와 함께 쓴다
 */

// ========== Internal imports ==========
import type { typRunStatus } from "@/shared/schemas/common";

// ========== Props & Types ==========
export type typZBCDotTone = "none" | typRunStatus;

export interface itfZBCDotProps {
    /** none이면 실행 상태 없음(회색 점) */
    tone?: typZBCDotTone;
    className?: string;
}

const propsDefault = {
    tone: "none",
} satisfies Partial<itfZBCDotProps>;

export default function ZBCDot(props: itfZBCDotProps) {
    const { tone = propsDefault.tone, className } = props;

    return (
        <span
            className={className ? `zbc zbcDot ${className}` : "zbc zbcDot"}
            data-tone={tone}
            aria-hidden="true"
        />
    );
}
