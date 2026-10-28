/**
 * 작업·설정 폼이 같이 쓰는 도우미: 숫자 입력 변환, zod 오류의 한국어 문구, 값 비교.
 * zod 스키마의 기본(영어) 메시지는 main 오류 detail과 테스트가 쓰므로 바꾸지 않고 화면에서 문구를 만든다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { z } from "zod";

export interface itfNumberRange {
    min: number;
    max: number;
    /** 정수만 허용 */
    int: boolean;
}

/** 숫자 입력란 문자열 → number. 빈칸·숫자가 아니면 NaN (저장 전 검증에서 막힌다) */
export function toNumber(text: string): number {
    return text.trim() === "" ? Number.NaN : Number(text);
}

/** number → 입력란 문자열. NaN은 빈칸 */
export function numberText(value: number): string {
    return Number.isNaN(value) ? "" : String(value);
}

/** 숫자 필드 오류 문구 */
export function numberIssueText(value: unknown, range: itfNumberRange): string {
    if (typeof value !== "number" || Number.isNaN(value)) return "숫자를 입력하세요.";
    return `${range.min}~${range.max} 사이의 ${range.int ? "정수" : "숫자"}를 입력하세요.`;
}

/** 제외 규칙(zExcludes) 오류 문구. issue.path는 excludes 기준 상대 경로 */
export function excludesIssueText(
    issue: z.core.$ZodIssue,
    relPath: readonly PropertyKey[],
): string {
    if (relPath.length === 0) {
        return issue.code === "too_big"
            ? "제외 규칙은 100개까지 쓸 수 있습니다."
            : "제외 규칙을 확인하세요.";
    }
    const line = typeof relPath[0] === "number" ? `${relPath[0] + 1}번째 줄: ` : "";
    if (issue.code === "too_big") return `${line}제외 규칙 한 줄은 512자까지 쓸 수 있습니다.`;
    if (issue.code === "too_small") return `${line}빈 제외 규칙이 있습니다.`;
    return `${line}${issue.message}`;
}

/** 키 순서와 무관한 JSON 직렬화 (NaN은 null로 같아진다) */
export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
