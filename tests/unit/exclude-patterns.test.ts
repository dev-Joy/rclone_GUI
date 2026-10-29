// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    excludesSaveIssue,
    isFileSafePattern,
    libraryPatternIssue,
    mergeExcludePatterns,
    normalizeExcludePattern,
    planExcludeTransport,
} from "@/shared/exclude-patterns";
import { EXCLUDE_FILE_MIN_COUNT } from "@/shared/option-limits";
import { zExcludeCreateInput } from "@/shared/schemas/excludes";

describe("공용 패턴 검사", () => {
    it.each([
        ["", "입력"],
        ["#a", "주석"],
        [";a", "주석"],
        ["a\nb", "제어문자"],
        ["a\tb", "제어문자"],
        [" a", "공백"],
        ["a".repeat(513), "512자"],
    ])("%j 는 거부", (p, word) => {
        expect(libraryPatternIssue(p)).toContain(word);
    });

    it("보통 패턴은 통과, 입력은 앞뒤 공백만 지운다", () => {
        expect(libraryPatternIssue("node_modules/**")).toBeNull();
        expect(libraryPatternIssue("a".repeat(512))).toBeNull();
        expect(normalizeExcludePattern("  *.tmp  ")).toBe("*.tmp");
        expect(zExcludeCreateInput.parse({ pattern: "  *.tmp " })).toEqual({ pattern: "*.tmp" });
        expect(zExcludeCreateInput.safeParse({ pattern: "  #a" }).success).toBe(false);
        expect(zExcludeCreateInput.safeParse({ pattern: "   " }).success).toBe(false);
    });

    it("파일에 넣을 수 있는 패턴", () => {
        expect(isFileSafePattern("a")).toBe(true);
        expect(isFileSafePattern("\\#a")).toBe(true);
        expect(isFileSafePattern("#a")).toBe(false);
        expect(isFileSafePattern(";a")).toBe(false);
        expect(isFileSafePattern(" a")).toBe(false);
        expect(isFileSafePattern("a ")).toBe(false);
    });
});

describe("mergeExcludePatterns", () => {
    it("공용은 코드포인트 오름차순, 그 뒤 작업 전용(입력 순서), 중복은 처음 것만", () => {
        expect(mergeExcludePatterns(["b", "B", "a", "가"], ["z", "a", "y", "z"])).toEqual([
            "B",
            "a",
            "b",
            "가",
            "z",
            "y",
        ]);
    });

    it("보조 평면 문자는 BMP 사설 영역보다 뒤(코드포인트 기준)", () => {
        expect(mergeExcludePatterns(["😀", "\uFF01"], [])).toEqual(["\uFF01", "😀"]);
    });

    it("공백만 다른 패턴은 다른 패턴으로 남긴다", () => {
        expect(mergeExcludePatterns(["a"], [" a", "a "])).toEqual(["a", " a", "a "]);
    });
});

describe("planExcludeTransport", () => {
    it("적으면 모두 인자", () => {
        expect(planExcludeTransport(["a", "#b"])).toEqual({
            argPatterns: ["a", "#b"],
            filePatterns: [],
        });
    });

    it("64개를 넘으면 파일 가능한 것은 파일, #·;·공백 패턴은 인자", () => {
        const many = Array.from({ length: EXCLUDE_FILE_MIN_COUNT }, (_v, i) => `p${i}`);
        const r = planExcludeTransport([...many, "#a", ";b", " c"]);
        expect(r.filePatterns).toEqual(many);
        expect(r.argPatterns).toEqual(["#a", ";b", " c"]);
        expect(planExcludeTransport(many).filePatterns).toEqual([]);
    });

    it("개수가 적어도 길이 합이 8000자를 넘으면 파일", () => {
        const long = Array.from({ length: 20 }, (_v, i) => `${i}${"x".repeat(400)}`);
        expect(planExcludeTransport(long).filePatterns).toHaveLength(20);
    });
});

describe("excludesSaveIssue", () => {
    it("합계 500 초과", () => {
        expect(excludesSaveIssue(["a"], 499)).toBeNull();
        expect(excludesSaveIssue(["a"], 500)).toContain("500개");
    });

    it("인자로만 넘길 패턴의 길이 예산 초과", () => {
        const argOnly = Array.from({ length: 40 }, (_v, i) => `#${i}${"x".repeat(450)}`);
        expect(excludesSaveIssue(argOnly, 0)).toContain("너무 길어");
        const fileSafe = argOnly.map((p) => p.slice(1));
        expect(excludesSaveIssue(fileSafe, 0)).toBeNull();
    });
});
