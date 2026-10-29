// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { resolveEffectiveExcludes } from "@/main/services/effective-excludes";

const LIB = new Map([
    ["id-b", "b/**"],
    ["id-a", "a/**"],
]);
const lib = { patternsFor: (ids: readonly string[]) => ids.map((id) => LIB.get(id) ?? "") };

describe("resolveEffectiveExcludes", () => {
    it("공용(정렬) + 작업 전용, 적으면 모두 인자·파일 없음", () => {
        const r = resolveEffectiveExcludes(
            { excludes: ["z", "a/**"], excludePatternIds: ["id-b", "id-a"] },
            lib,
        );
        expect(r.patterns).toEqual(["a/**", "b/**", "z"]);
        expect(r.argPatterns).toEqual(["a/**", "b/**", "z"]);
        expect(r.filePatterns).toEqual([]);
        expect(r.fileContent).toBeNull();
        expect(r.snapshotHash).toMatch(/^[0-9a-f]{32}$/);
    });

    it("많으면 파일 내용(LF, 빈 줄 없음), #·; 패턴은 인자", () => {
        const many = Array.from({ length: 70 }, (_v, i) => `p${i}`);
        const r = resolveEffectiveExcludes(
            { excludes: [...many, ";x"], excludePatternIds: [] },
            lib,
        );
        expect(r.argPatterns).toEqual([";x"]);
        expect(r.fileContent).toBe(`${many.join("\n")}\n`);
    });

    it("해시: 같은 입력은 같고, 공용 패턴 내용·순서·전달 방식이 바뀌면 달라진다", () => {
        const job = { excludes: ["x"], excludePatternIds: ["id-a"] };
        const h = resolveEffectiveExcludes(job, lib).snapshotHash;
        expect(resolveEffectiveExcludes(job, lib).snapshotHash).toBe(h);
        const other = { patternsFor: () => ["a2/**"] };
        expect(resolveEffectiveExcludes(job, other).snapshotHash).not.toBe(h);
        expect(
            resolveEffectiveExcludes({ ...job, excludes: ["x", "y"] }, lib).snapshotHash,
        ).not.toBe(h);
    });

    it("없는 공용 패턴이면 저장소 오류를 그대로 던진다", () => {
        const strict = {
            patternsFor: () => {
                throw new Error("없음");
            },
        };
        expect(() =>
            resolveEffectiveExcludes({ excludes: [], excludePatternIds: ["x"] }, strict),
        ).toThrow("없음");
    });
});
