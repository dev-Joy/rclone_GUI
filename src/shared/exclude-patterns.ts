/**
 * 제외 패턴 순수 도우미 (INT-002 T-03·T-09, INT-007). main과 화면이 같이 쓴다(Node·DOM 의존 없음).
 *
 * - rclone에는 작업 설정 파일이 없어 제외 패턴은 실행마다 만든 --filter-from 파일 하나로 넘긴다.
 *   모든 줄은 "- <패턴>"이고, 패턴 끝의 공백 문자는 rclone이 지우므로 "[<문자>]"로 바꿔 쓴다(rclone-notes #47·#48).
 * - 전달 방식은 패턴만으로 정한다(명령 종류와 무관) → 비교와 실행이 항상 같은 방식.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import { EXCLUDE_PATTERN_MAX_LEN, EXCLUDES_TOTAL_MAX } from "@/shared/option-limits";

// oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** 입력 정규화: 앞뒤 공백만 지운다(NFC 변환 없음) */
export function normalizeExcludePattern(raw: string): string {
    return raw.trim();
}

/** 공용 라이브러리 패턴 오류 문구. 문제가 없으면 null */
export function libraryPatternIssue(p: string): string | null {
    if (p.length === 0) return "패턴을 입력하세요.";
    if (p.length > EXCLUDE_PATTERN_MAX_LEN)
        return `패턴은 ${EXCLUDE_PATTERN_MAX_LEN}자까지 쓸 수 있습니다.`;
    if (CONTROL_RE.test(p)) return "제어문자(줄바꿈·탭 포함)는 쓸 수 없습니다.";
    if (p !== p.trim()) return "패턴 앞뒤에 공백을 둘 수 없습니다.";
    if (p.startsWith("#") || p.startsWith(";"))
        return "공용 패턴은 #·;로 시작할 수 없습니다. 이 작업 전용 패턴으로 쓰세요.";
    return null;
}

/** 코드포인트 오름차순 비교(localeCompare를 쓰지 않는다) */
function f_CompareCodePoint(a: string, b: string): number {
    const ia = a[Symbol.iterator]();
    const ib = b[Symbol.iterator]();
    for (;;) {
        const x = ia.next();
        const y = ib.next();
        if (x.done || y.done) return x.done && y.done ? 0 : x.done ? -1 : 1;
        const cx = x.value.codePointAt(0) ?? 0;
        const cy = y.value.codePointAt(0) ?? 0;
        if (cx !== cy) return cx - cy;
    }
}

/**
 * 적용할 패턴 목록: 공용(코드포인트 오름차순) 뒤에 작업 전용(입력 순서).
 * 완전히 같은 패턴은 처음 것만 남긴다.
 */
export function mergeExcludePatterns(
    library: readonly string[],
    jobOnly: readonly string[],
): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of [...library.toSorted(f_CompareCodePoint), ...jobOnly]) {
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
    }
    return out;
}

/** rclone(Go unicode.IsSpace)이 패턴 끝에서 지우는 공백 문자인지. JS \s는 쓰지 않는다(U+0085 누락·U+FEFF 포함) */
function f_IsRcloneSpace(ch: string): boolean {
    const c = ch.charCodeAt(0);
    return (
        c === 0x09 ||
        c === 0x0a ||
        c === 0x0b ||
        c === 0x0c ||
        c === 0x0d ||
        c === 0x20 ||
        c === 0x85 ||
        c === 0xa0 ||
        c === 0x1680 ||
        (c >= 0x2000 && c <= 0x200a) ||
        c === 0x2028 ||
        c === 0x2029 ||
        c === 0x202f ||
        c === 0x205f ||
        c === 0x3000
    );
}

/**
 * 패턴 하나를 --filter-from 제외 줄로 바꾼다: "- " + 끝 공백 문자 → "[c]" (INT-007 FR-3).
 * 끝 공백 직전의 연속 역슬래시가 홀수면 그 역슬래시 하나를 지운다(사용자가 쓴 "\ " 이스케이프).
 */
export function toFilterExcludeLine(pattern: string): string {
    let end = pattern.length;
    while (end > 0 && f_IsRcloneSpace(pattern[end - 1]!)) end -= 1;
    if (end === pattern.length) return `- ${pattern}`;
    let head = pattern.slice(0, end);
    const trailing = pattern.slice(end);
    let backslashes = 0;
    while (backslashes < head.length && head[head.length - 1 - backslashes] === "\\")
        backslashes += 1;
    if (backslashes % 2 === 1) head = head.slice(0, -1);
    const escaped = Array.from(trailing, (c) => `[${c}]`).join("");
    return `- ${head}${escaped}`;
}

/** 적용 순서 패턴 → 필터 파일 내용(LF, 마지막 LF). 패턴이 없으면 null (INT-007 FR-1·2) */
export function buildFilterFileContent(patterns: readonly string[]): string | null {
    if (patterns.length === 0) return null;
    return `${patterns.map(toFilterExcludeLine).join("\n")}\n`;
}

/** 작업 저장 전 제외 패턴 합계 검사. 문제가 없으면 null (공용 + 작업 전용 > EXCLUDES_TOTAL_MAX) */
export function excludesSaveIssue(jobOnly: readonly string[], libraryCount: number): string | null {
    if (jobOnly.length + libraryCount > EXCLUDES_TOTAL_MAX) {
        return `제외 패턴은 공용과 이 작업 전용을 합쳐 ${EXCLUDES_TOTAL_MAX}개까지 쓸 수 있습니다(지금 ${jobOnly.length + libraryCount}개).`;
    }
    return null;
}
