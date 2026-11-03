// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    buildFilterFileContent,
    excludesSaveIssue,
    libraryPatternIssue,
    mergeExcludePatterns,
    normalizeExcludePattern,
    toFilterExcludeLine,
} from "@/shared/exclude-patterns";
import { zExcludeCreateInput } from "@/shared/schemas/excludes";

describe("공용 패턴 검사", () => {
    it.each([
        ["", "입력"],
        ["#a", "공용"],
        [";a", "공용"],
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

describe("toFilterExcludeLine (INT-007 FR-3)", () => {
    it.each([
        ["#a", "- #a"],
        [";a", "- ;a"],
        [" lead", "-  lead"],
        ["!a", "- !a"],
        ["x/**", "- x/**"],
        ["a  ", "- a[ ][ ]"],
        ["  ", "- [ ][ ]"],
        ["a\\ ", "- a[ ]"],
        ["a\\\\ ", "- a\\\\[ ]"],
        ["c\\\\[ ]", "- c\\\\[ ]"],
        ["a[ ]", "- a[ ]"],
    ])("%j → %j", (p, line) => {
        expect(toFilterExcludeLine(p)).toBe(line);
    });

    it("rclone이 지우는 유니코드 공백은 [c]로, U+FEFF는 그대로 둔다", () => {
        for (const c of [
            "\t",
            "\u000b",
            "\u00a0",
            "\u2003",
            "\u202f",
            "\u2028",
            "\u0085",
            "\u3000",
        ])
            expect(toFilterExcludeLine(`a${c}`)).toBe(`- a[${c}]`);
        expect(toFilterExcludeLine("a\uFEFF")).toBe("- a\uFEFF");
        // 끝 공백 직전 역슬래시가 홀수면 하나 지운다
        expect(toFilterExcludeLine("a\\\u0085")).toBe("- a[\u0085]");
        expect(toFilterExcludeLine("a\\\\\u0085")).toBe("- a\\\\[\u0085]");
    });

    it("모든 줄은 '- '로 시작하고 +·! 규칙 줄을 만들지 않는다", () => {
        const patterns = ["#a", ";a", " lead", "!a", "a  ", "x/**", "a\\ ", "  "];
        const lines = patterns.map(toFilterExcludeLine);
        for (const line of lines) {
            expect(line.startsWith("- ")).toBe(true);
            expect(line.startsWith("+ ")).toBe(false);
            expect(line.startsWith("! ")).toBe(false);
        }
    });
});

describe("buildFilterFileContent (INT-007 FR-1·2)", () => {
    it("적용 순서대로 한 줄씩, 마지막도 LF", () => {
        expect(buildFilterFileContent(["#a", ";a", " lead", "!a", "a  ", "x/**"])).toBe(
            "- #a\n- ;a\n-  lead\n- !a\n- a[ ][ ]\n- x/**\n",
        );
    });

    it("패턴이 없으면 null", () => {
        expect(buildFilterFileContent([])).toBeNull();
    });
});

describe("excludesSaveIssue", () => {
    it("합계 500 초과", () => {
        expect(excludesSaveIssue(["a"], 499)).toBeNull();
        expect(excludesSaveIssue(["a"], 500)).toContain("500개");
    });

    it("길이 예산은 없다: #·;로 시작하는 긴 작업 전용 패턴도 저장된다(AC-11)", () => {
        const long = Array.from({ length: 40 }, (_v, i) => `#${i}${"x".repeat(450)}`);
        expect(excludesSaveIssue(long, 0)).toBeNull();
    });
});
