// ========== External imports ==========
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { resolveEffectiveExcludes } from "@/main/services/effective-excludes";

const LIB = new Map([
    ["id-b", "b/**"],
    ["id-a", "a/**"],
]);
const lib = { patternsFor: (ids: readonly string[]) => ids.map((id) => LIB.get(id) ?? "") };

describe("resolveEffectiveExcludes", () => {
    it("공용(정렬) + 작업 전용, 패턴이 있으면 모두 필터 파일 내용", () => {
        const r = resolveEffectiveExcludes(
            { excludes: ["z", "a/**"], excludePatternIds: ["id-b", "id-a"] },
            lib,
        );
        expect(r.patterns).toEqual(["a/**", "b/**", "z"]);
        expect(r.fileContent).toBe("- a/**\n- b/**\n- z\n");
        expect(r.snapshotHash).toMatch(/^[0-9a-f]{32}$/);
    });

    it("패턴이 없으면 파일 내용은 null", () => {
        expect(
            resolveEffectiveExcludes({ excludes: [], excludePatternIds: [] }, lib),
        ).toMatchObject({ patterns: [], fileContent: null });
    });

    it("끝 공백·#·;·! 패턴도 저장한 그대로 [c] 변환해 파일에 쓴다", () => {
        const r = resolveEffectiveExcludes(
            { excludes: ["#a", ";b", " lead", "!a", "a  "], excludePatternIds: [] },
            lib,
        );
        expect(r.fileContent).toBe("- #a\n- ;b\n-  lead\n- !a\n- a[ ][ ]\n");
    });

    it("해시: 같은 입력은 같고, 공용 패턴 내용·순서·파일 내용이 바뀌면 달라진다", () => {
        const job = { excludes: ["x"], excludePatternIds: ["id-a"] };
        const h = resolveEffectiveExcludes(job, lib).snapshotHash;
        expect(resolveEffectiveExcludes(job, lib).snapshotHash).toBe(h);
        const other = { patternsFor: () => ["a2/**"] };
        expect(resolveEffectiveExcludes(job, other).snapshotHash).not.toBe(h);
        expect(
            resolveEffectiveExcludes({ ...job, excludes: ["x", "y"] }, lib).snapshotHash,
        ).not.toBe(h);
    });

    it("해시 버전이 1에서 2로 바뀌어 같은 패턴도 이전 해시와 다르다(AC-7)", () => {
        const job = { excludes: ["x"], excludePatternIds: ["id-a"] };
        const patterns = ["a/**", "x"];
        const v1 = createHash("sha256")
            .update(JSON.stringify([1, patterns, patterns, [], false]))
            .digest("hex")
            .slice(0, 32);
        expect(resolveEffectiveExcludes(job, lib).snapshotHash).not.toBe(v1);
    });

    it("제어문자가 든 패턴은 VALIDATION으로 거부한다(AC-4)", () => {
        expect(() =>
            resolveEffectiveExcludes({ excludes: ["a\nb"], excludePatternIds: [] }, lib),
        ).toThrow(expect.objectContaining({ code: "VALIDATION" }));
        expect(() =>
            resolveEffectiveExcludes({ excludes: ["a\u007fb"], excludePatternIds: [] }, lib),
        ).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    });

    it("U+0085는 줄을 나누지 않으므로 막지 않고 [c]로 바꾼다", () => {
        const r = resolveEffectiveExcludes({ excludes: ["a\u0085"], excludePatternIds: [] }, lib);
        expect(r.fileContent).toBe("- a[\u0085]\n");
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
