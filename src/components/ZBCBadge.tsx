/**
 * 짧은 상태 표시. 색만으로 뜻을 전하지 않도록 글자 자체가 상태를 말하게 쓴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { ReactNode } from "react";

// ========== Props & Types ==========
export type typZBCBadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface itfZBCBadgeProps {
    children: ReactNode;
    tone?: typZBCBadgeTone;
    title?: string;
}

const propsDefault = {
    tone: "neutral",
} satisfies Partial<itfZBCBadgeProps>;

export default function ZBCBadge(props: itfZBCBadgeProps) {
    const { children, tone = propsDefault.tone, title } = props;

    return (
        <span className="zbc zbcBadge" data-tone={tone} title={title}>
            {children}
        </span>
    );
}
