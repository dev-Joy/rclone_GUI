/**
 * 제외 패턴 순수 도우미 (INT-002 T-03·T-09). main과 화면이 같이 쓴다(Node·DOM 의존 없음).
 *
 * - rclone --exclude-from 파일은 #·; 시작 줄을 주석으로, 줄 앞뒤 공백을 지우고 읽는다(rclone-notes #18).
 *   그런 패턴은 파일에 넣지 않고 항상 --exclude 인자로 넘긴다.
 * - 전달 방식은 패턴만으로 정한다(명령 종류와 무관) → 비교와 실행이 항상 같은 방식.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import {
    EXCLUDE_ARG_ONLY_BUDGET,
    EXCLUDE_FILE_MIN_CHARS,
    EXCLUDE_FILE_MIN_COUNT,
    EXCLUDE_PATTERN_MAX_LEN,
    EXCLUDES_TOTAL_MAX,
} from "@/shared/option-limits";

/** 인자 하나의 길이 추정: 패턴 + "--exclude " + 따옴표·공백 */
const ARG_OVERHEAD = 12;

// oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export interface itfExcludeTransport {
    /** --exclude 인자로 넘길 패턴(순서 유지) */
    argPatterns: string[];
    /** --exclude-from 파일에 넣을 패턴(순서 유지). 비면 파일을 쓰지 않는다 */
    filePatterns: string[];
}

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
        return "#·;로 시작하는 패턴은 공용으로 저장할 수 없습니다(rclone 제외 파일에서 주석으로 읽힘). 이 작업 전용 패턴으로 쓰세요.";
    return null;
}

/** --exclude-from 파일에 넣어도 같은 뜻으로 읽히는지 (#·; 시작, 앞뒤 공백이면 false) */
export function isFileSafePattern(p: string): boolean {
    return p.length > 0 && !p.startsWith("#") && !p.startsWith(";") && p === p.trim();
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

function f_ArgChars(patterns: readonly string[]): number {
    return patterns.reduce((sum, p) => sum + p.length + ARG_OVERHEAD, 0);
}

/**
 * 전달 방식. 패턴이 EXCLUDE_FILE_MIN_COUNT개를 넘거나 인자 길이 합이 EXCLUDE_FILE_MIN_CHARS를 넘으면
 * 파일에 넣을 수 있는 패턴은 파일로, 나머지는 인자로. 아니면 모두 인자.
 */
export function planExcludeTransport(patterns: readonly string[]): itfExcludeTransport {
    const useFile =
        patterns.length > EXCLUDE_FILE_MIN_COUNT || f_ArgChars(patterns) > EXCLUDE_FILE_MIN_CHARS;
    if (!useFile) return { argPatterns: [...patterns], filePatterns: [] };
    const argPatterns: string[] = [];
    const filePatterns: string[] = [];
    for (const p of patterns) (isFileSafePattern(p) ? filePatterns : argPatterns).push(p);
    return { argPatterns, filePatterns };
}

/**
 * 작업 저장 전 제외 패턴 합계 검사. 문제가 없으면 null.
 * - 공용 + 작업 전용 > EXCLUDES_TOTAL_MAX
 * - 파일에 넣을 수 없는 작업 전용 패턴의 인자 길이 합 > EXCLUDE_ARG_ONLY_BUDGET
 */
export function excludesSaveIssue(jobOnly: readonly string[], libraryCount: number): string | null {
    if (jobOnly.length + libraryCount > EXCLUDES_TOTAL_MAX) {
        return `제외 패턴은 공용과 이 작업 전용을 합쳐 ${EXCLUDES_TOTAL_MAX}개까지 쓸 수 있습니다(지금 ${jobOnly.length + libraryCount}개).`;
    }
    const argOnly = jobOnly.filter((p) => !isFileSafePattern(p));
    if (f_ArgChars(argOnly) > EXCLUDE_ARG_ONLY_BUDGET) {
        return "#·;로 시작하거나 앞뒤 공백이 있는 패턴이 너무 길어 rclone 명령에 다 넣을 수 없습니다. 줄이거나 바꾸세요.";
    }
    return null;
}
