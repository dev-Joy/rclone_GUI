// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { TEXT_DIFF_MAX_EDITS, diffLines, splitLines, toSideBySide } from "@/shared/text-diff";
import type { typDiffOp } from "@/shared/text-diff";

/** 연산 목록을 읽기 쉬운 코드로: " 공통" / "-삭제" / "+추가", null이면 "<null>" */
function f_Show(a: readonly string[], b: readonly string[], ops: typDiffOp[] | null): string[] {
    if (ops === null) return ["<null>"];
    const out: string[] = [];
    for (const op of ops) {
        if (op.op === "equal") out.push(` ${a[op.aIndex!]!}`);
        else if (op.op === "delete") out.push(`-${a[op.aIndex!]!}`);
        else out.push(`+${b[op.bIndex!]!}`);
    }
    return out;
}

describe("splitLines (FR-7)", () => {
    it.each([
        ["", []],
        ["a", ["a"]],
        ["a\nb", ["a", "b"]],
        ["a\nb\n", ["a", "b"]],
        ["a\r\nb\r\n", ["a", "b"]],
        ["a\rb", ["a", "b"]],
        ["a\r\nb\nc\rd", ["a", "b", "c", "d"]],
        ["a\n\nb", ["a", "", "b"]],
        ["a\n\n", ["a", ""]],
        ["\n", [""]],
    ])("%j → %j", (text: string, lines: string[]) => {
        expect(splitLines(text)).toEqual(lines);
    });
});

describe("diffLines (FR-7, AC-5)", () => {
    it.each([
        ["빈 입력", [], [], []],
        ["완전 동일", ["a", "b", "c"], ["a", "b", "c"], [" a", " b", " c"]],
        ["앞 삽입", ["b", "c"], ["a", "b", "c"], ["+a", " b", " c"]],
        ["뒤 삽입", ["a", "b"], ["a", "b", "c"], [" a", " b", "+c"]],
        ["가운데 삽입", ["a", "c"], ["a", "b", "c"], [" a", "+b", " c"]],
        ["앞 삭제", ["a", "b"], ["b"], ["-a", " b"]],
        ["뒤 삭제", ["a", "b"], ["a"], [" a", "-b"]],
        ["가운데 삭제", ["a", "b", "c"], ["a", "c"], [" a", "-b", " c"]],
        ["가운데 교체", ["a", "b", "c"], ["a", "x", "c"], [" a", "-b", "+x", " c"]],
        ["모두 삭제", ["a", "b"], [], ["-a", "-b"]],
        ["모두 추가", [], ["a", "b"], ["+a", "+b"]],
        ["마지막 한 줄만 다름", ["a", "b"], ["a", "z"], [" a", "-b", "+z"]],
    ])("%s", (_label: string, a: string[], b: string[], expected: string[]) => {
        expect(f_Show(a, b, diffLines(a, b))).toEqual(expected);
    });

    it("연산의 인덱스는 원래 줄 번호를 가리킨다(공통 앞뒤를 잘라도)", () => {
        const ops = diffLines(["h1", "h2", "old", "t1", "t2"], ["h1", "h2", "new", "t1", "t2"]);
        expect(ops).not.toBeNull();
        expect(ops).toEqual([
            { op: "equal", aIndex: 0, bIndex: 0 },
            { op: "equal", aIndex: 1, bIndex: 1 },
            { op: "delete", aIndex: 2, bIndex: null },
            { op: "insert", aIndex: null, bIndex: 2 },
            { op: "equal", aIndex: 3, bIndex: 3 },
            { op: "equal", aIndex: 4, bIndex: 4 },
        ]);
    });

    it("D가 상한을 넘으면 null", () => {
        const a = ["a", "b", "c", "d"];
        const b = ["w", "x", "y", "z"];
        expect(diffLines(a, b, 7)).toBeNull();
        expect(diffLines(a, b, 8)).not.toBeNull();
    });

    it("상한 기본값은 2000이고, 한쪽만 남는 경우도 상한을 넘으면 null", () => {
        expect(TEXT_DIFF_MAX_EDITS).toBe(2000);
        const atLimit = Array.from({ length: TEXT_DIFF_MAX_EDITS }, (_, i) => `줄 ${i}`);
        const overLimit = Array.from({ length: TEXT_DIFF_MAX_EDITS + 1 }, (_, i) => `줄 ${i}`);
        expect(diffLines(atLimit, [])).toHaveLength(TEXT_DIFF_MAX_EDITS);
        expect(diffLines(overLimit, [])).toBeNull();
        expect(diffLines([], overLimit)).toBeNull();
    });

    it("diffLines([], [])는 빈 목록이고, 끝 빈 줄은 splitLines가 먼저 버린다", () => {
        expect(diffLines([], [])).toEqual([]);
        expect(
            f_Show(
                splitLines("a\nb\n"),
                splitLines("a\nb"),
                diffLines(splitLines("a\nb\n"), splitLines("a\nb")),
            ),
        ).toEqual([" a", " b"]);
    });
});

describe("toSideBySide (FR-7, AC-5)", () => {
    it("삭제 2 + 추가 3 → changed 2 + insert 1", () => {
        const a = ["s", "1", "2", "e"];
        const b = ["s", "a", "b", "c", "e"];
        const ops = diffLines(a, b);
        expect(ops).not.toBeNull();
        expect(toSideBySide(ops!)).toEqual([
            { kind: "equal", left: 0, right: 0 },
            { kind: "changed", left: 1, right: 1 },
            { kind: "changed", left: 2, right: 2 },
            { kind: "insert", left: null, right: 3 },
            { kind: "equal", left: 3, right: 4 },
        ]);
    });

    it("삭제 3 + 추가 1 → changed 1 + delete 2", () => {
        const a = ["s", "1", "2", "3", "e"];
        const b = ["s", "a", "e"];
        const ops = diffLines(a, b);
        expect(ops).not.toBeNull();
        expect(toSideBySide(ops!)).toEqual([
            { kind: "equal", left: 0, right: 0 },
            { kind: "changed", left: 1, right: 1 },
            { kind: "delete", left: 2, right: null },
            { kind: "delete", left: 3, right: null },
            { kind: "equal", left: 4, right: 2 },
        ]);
    });

    it("변경이 없으면 모두 equal, 빈 연산은 빈 목록", () => {
        expect(toSideBySide([])).toEqual([]);
        expect(toSideBySide(diffLines(["a", "b"], ["a", "b"])!)).toEqual([
            { kind: "equal", left: 0, right: 0 },
            { kind: "equal", left: 1, right: 1 },
        ]);
    });

    it("떨어진 변경 묶음은 따로 접는다", () => {
        const a = ["a", "b", "c", "d", "e"];
        const b = ["a", "x", "c", "d", "z"];
        expect(toSideBySide(diffLines(a, b)!)).toEqual([
            { kind: "equal", left: 0, right: 0 },
            { kind: "changed", left: 1, right: 1 },
            { kind: "equal", left: 2, right: 2 },
            { kind: "equal", left: 3, right: 3 },
            { kind: "changed", left: 4, right: 4 },
        ]);
    });
});

describe("성능 (NFR-7, AC-5)", () => {
    it("5만 줄 · D 2000(가운데 블록 1000줄 교체)이 1초 안에 끝난다", () => {
        const a = Array.from({ length: 50_000 }, (_, i) => `줄 ${i} 공통 내용`);
        const b = a.slice();
        for (let i = 20_000; i < 21_000; i++) b[i] = `바뀐 줄 ${i}`;

        const t0 = performance.now();
        const ops = diffLines(a, b);
        if (ops === null) throw new Error("D가 상한 안이므로 null이면 안 됩니다");
        const rows = toSideBySide(ops);
        const elapsed = performance.now() - t0;

        expect(rows).toHaveLength(50_000);
        expect(rows.filter((r) => r.kind === "changed")).toHaveLength(1000);
        expect(elapsed).toBeLessThan(1000);
    });
});
