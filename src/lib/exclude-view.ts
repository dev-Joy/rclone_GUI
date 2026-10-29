/**
 * 공용 제외 패턴 화면용 순수 도우미 (INT-002 T-03). DOM·window 의존 없음.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import type { itfExcludePatternUsage } from "@/shared/schemas/excludes";

export type typExcludeChangeKind = "update" | "delete";

/** 확인 버튼 문구(일어날 일). 예: "패턴 지우고 작업 3개의 비교 결과 버리기" */
export function excludeChangeConfirmText(kind: typExcludeChangeKind, userCount: number): string {
    const what = kind === "delete" ? "패턴 지우" : "패턴 바꾸";
    return userCount > 0 ? `${what}고 작업 ${userCount}개의 비교 결과 버리기` : `${what}기`;
}

/** 선택한 id 중 라이브러리에 없는 것(편집 중 지워진 패턴) */
export function missingPatternIds(
    selected: readonly string[],
    items: readonly itfExcludePatternUsage[],
): string[] {
    const known = new Set(items.map((i) => i.id));
    return selected.filter((id) => !known.has(id));
}

/** 선택 토글. 결과는 정렬한다(저장소가 정렬해 돌려주므로 변경 여부 비교가 맞게) */
export function togglePatternId(selected: readonly string[], id: string, on: boolean): string[] {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    return [...next].toSorted();
}

/** 이 작업 전용 패턴 중 공용으로 둘 수 없는 줄(#·; 시작) */
export function jobOnlyCommentLike(patterns: readonly string[]): string[] {
    return patterns.filter((p) => p.startsWith("#") || p.startsWith(";"));
}
