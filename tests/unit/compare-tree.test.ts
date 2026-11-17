// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { buildTreeRows, collectFolderPaths, type typTreeRow } from "@/lib/compare-tree";
import type { itfDiffEntry, typCompareStatus } from "@/shared/types/compare";

/** 폴더 트리 테스트용 항목. 크기·시각은 이 파일에서 쓰지 않는다 */
function f_E(path: string, status: typCompareStatus): itfDiffEntry {
    return {
        path,
        status,
        reasons: [],
        source: status === "onlyDest" ? null : { path, size: 1, modTimeMs: 0 },
        dest: status === "onlySource" ? null : { path, size: 1, modTimeMs: 0 },
        caseOnly: false,
        hashAlgo: null,
        hashUnavailable: false,
    };
}

/** rows를 "f:경로" · "d:경로" 문자열로 줄여 비교한다 */
function f_Shape(rows: readonly typTreeRow[]): string[] {
    return rows.map((r) => (r.kind === "folder" ? `d:${r.path}` : `f:${r.path}`));
}

function f_Folder(rows: readonly typTreeRow[], path: string) {
    const row = rows.find((r) => r.kind === "folder" && r.path === path);
    if (!row || row.kind !== "folder") throw new Error(`폴더 행이 없습니다: ${path}`);
    return row;
}

describe("buildTreeRows", () => {
    const ENTRIES: itfDiffEntry[] = [
        f_E("a/b/c.txt", "onlySource"),
        f_E("root.txt", "onlySource"),
        f_E("a/d.txt", "modified"),
        f_E("a/e.txt", "equal"),
    ];
    const ROWS = [0, 1, 2, 3];

    it("접힌 폴더는 폴더 행만 남기고 하위 파일을 감춘다", () => {
        const rows = buildTreeRows(ENTRIES, ROWS, new Set());
        expect(f_Shape(rows)).toEqual(["d:a", "f:root.txt"]);
        expect(f_Folder(rows, "a")).toMatchObject({
            name: "a",
            depth: 0,
            fileCount: 3,
            changeCount: 2,
        });
    });

    it("펼친 폴더의 하위만 펼치고 들여쓰기 단계를 센다", () => {
        const rows = buildTreeRows(ENTRIES, ROWS, new Set(["a"]));
        expect(f_Shape(rows)).toEqual(["d:a", "d:a/b", "f:a/d.txt", "f:a/e.txt", "f:root.txt"]);
        expect(rows[1]).toMatchObject({ kind: "folder", depth: 1, fileCount: 1, changeCount: 1 });
        expect(rows[2]).toMatchObject({ kind: "file", depth: 1, entryIndex: 2 });
    });

    it("중첩 폴더는 그 폴더도 펼쳐야 안쪽 파일이 보인다", () => {
        const rows = buildTreeRows(ENTRIES, ROWS, new Set(["a", "a/b"]));
        expect(f_Shape(rows)).toEqual([
            "d:a",
            "d:a/b",
            "f:a/b/c.txt",
            "f:a/d.txt",
            "f:a/e.txt",
            "f:root.txt",
        ]);
        expect(rows[2]).toMatchObject({ kind: "file", depth: 2, entryIndex: 0 });
    });

    it("changeCount는 같음(equal)을 빼고 센다", () => {
        const rows = buildTreeRows(ENTRIES, ROWS, new Set());
        expect(f_Folder(rows, "a").changeCount).toBe(2);
        expect(f_Folder(rows, "a").fileCount).toBe(3);
    });

    it("형제 순서는 입력 rows 순서를 그대로 따르고, 폴더는 첫 파일이 나온 자리에 놓인다", () => {
        const entries = [
            f_E("z/a.txt", "onlySource"),
            f_E("a.txt", "modified"),
            f_E("y/b.txt", "onlySource"),
        ];
        const rows = buildTreeRows(entries, [0, 1, 2], new Set());
        expect(f_Shape(rows)).toEqual(["d:z", "f:a.txt", "d:y"]);
    });

    it("대소문자가 다른 경로는 별도 노드로 둔다", () => {
        const entries = [f_E("a/x.txt", "onlySource"), f_E("A/y.txt", "onlySource")];
        const rows = buildTreeRows(entries, [0, 1], new Set());
        expect(f_Shape(rows)).toEqual(["d:a", "d:A"]);
    });

    it("루트 파일은 depth 0 파일 행이다", () => {
        const entries = [f_E("x.txt", "onlySource"), f_E("y.txt", "equal")];
        const rows = buildTreeRows(entries, [0, 1], new Set());
        expect(rows).toMatchObject([
            { kind: "file", path: "x.txt", depth: 0, entryIndex: 0 },
            { kind: "file", path: "y.txt", depth: 0, entryIndex: 1 },
        ]);
    });

    it("rows가 비면 행도 비다", () => {
        expect(buildTreeRows(ENTRIES, [], new Set())).toEqual([]);
    });

    it("1만 파일에서 폴더 집계와 행 수가 맞는다", () => {
        const entries: itfDiffEntry[] = [];
        const rows: number[] = [];
        for (let f = 0; f < 10; f += 1) {
            for (let i = 0; i < 1000; i += 1) {
                rows.push(entries.length);
                entries.push(f_E(`f${f}/${String(i).padStart(4, "0")}.txt`, "onlySource"));
            }
        }
        const collapsed = buildTreeRows(entries, rows, new Set());
        expect(collapsed).toHaveLength(10);
        for (const row of collapsed) {
            expect(row).toMatchObject({ kind: "folder", fileCount: 1000, changeCount: 1000 });
        }

        const folders = collectFolderPaths(entries, rows);
        expect(folders).toHaveLength(10);
        const expanded = buildTreeRows(entries, rows, new Set(folders));
        expect(expanded).toHaveLength(10 + 10_000);
        expect(expanded.filter((r) => r.kind === "file")).toHaveLength(10_000);
        expect(expanded[0]).toMatchObject({ kind: "folder", path: "f0" });
        expect(expanded[1]).toMatchObject({ kind: "file", path: "f0/0000.txt", depth: 1 });
    });
});

describe("collectFolderPaths", () => {
    it("접힘과 무관하게 rows에 나온 모든 폴더 경로를 돌려준다", () => {
        const entries = [f_E("a/b/c.txt", "onlySource"), f_E("root.txt", "onlySource")];
        expect(collectFolderPaths(entries, [0, 1])).toEqual(["a", "a/b"]);
        expect(collectFolderPaths(entries, [1])).toEqual([]);
    });
});
