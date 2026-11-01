// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { diffFileLists, type itfDiffOptions } from "@/shared/diff-engine";
import type { itfFileMeta } from "@/shared/types/compare";
import { parseLsjsonOutput } from "@/main/parsers/lsjson-parser";
import { readFixture } from "./fixtures";

const OPTS: itfDiffOptions = {
    caseInsensitive: true,
    checkHashes: false,
    modtimeToleranceMs: 2000,
};
const T0 = Date.UTC(2026, 0, 1);

function f_File(
    path: string,
    size = 1,
    modTimeMs: number | null = T0,
    hashes: Record<string, string> | null = null,
): itfFileMeta {
    return { path, size, modTimeMs, hashes };
}

function f_Diff(src: itfFileMeta[], dst: itfFileMeta[], opts: Partial<itfDiffOptions> = {}) {
    const r = diffFileLists(src, dst, { ...OPTS, ...opts });
    if (!r.ok) throw new Error("diff 실패");
    return r;
}

describe("diffFileLists 상태 분류", () => {
    it("원본만·대상만·동일·크기 변경을 나눈다", () => {
        const r = f_Diff(
            [f_File("new.txt", 3), f_File("same.txt", 4), f_File("big.txt", 10)],
            [f_File("same.txt", 4), f_File("big.txt", 5), f_File("extra.txt", 7)],
        );
        const byPath = Object.fromEntries(r.entries.map((e) => [e.path, [e.status, e.reasons]]));
        expect(byPath).toEqual({
            "big.txt": ["modified", ["size"]],
            "extra.txt": ["onlyDest", []],
            "new.txt": ["onlySource", []],
            "same.txt": ["equal", []],
        });
        expect(r.summary).toMatchObject({
            sourceFiles: 3,
            destFiles: 3,
            createFiles: 1,
            updateFiles: 1,
            deleteFiles: 1,
            sameFiles: 1,
            createBytes: 3,
            updateBytes: 10,
            deleteBytes: 7,
            transferBytes: 13,
        });
    });

    it("결과는 경로 키 오름차순", () => {
        const r = f_Diff([f_File("b"), f_File("a/z"), f_File("A/b")], []);
        expect(r.entries.map((e) => e.path)).toEqual(["A/b", "a/z", "b"]);
    });

    it.each([
        [0, "equal"],
        [2000, "equal"],
        [2001, "modified"],
        [-2001, "modified"],
    ])("수정시간 차이 %ims (허용 2000ms) → %s", (delta, status) => {
        const r = f_Diff([f_File("a", 1, T0 + delta)], [f_File("a", 1, T0)]);
        expect(r.entries[0]!.status).toBe(status);
    });

    it("허용오차 0은 정확히 같아야 동일", () => {
        expect(
            f_Diff([f_File("a", 1, T0 + 1)], [f_File("a", 1, T0)], { modtimeToleranceMs: 0 })
                .entries[0]!.status,
        ).toBe("modified");
    });

    it("수정시간을 모르면 보수적으로 변경", () => {
        const r = f_Diff([f_File("a", 1, null)], [f_File("a", 1, T0)]);
        expect(r.entries[0]).toMatchObject({ status: "modified", reasons: ["mtimeUnknown"] });
    });
});

describe("해시 비교", () => {
    it("우선순위의 첫 공통 해시를 쓰고 대소문자를 무시한다", () => {
        const r = f_Diff(
            [f_File("a", 1, T0, { md5: "AB", crc32: "1" })],
            [f_File("a", 1, T0 + 99_999, { md5: "ab", crc32: "2" })],
            { checkHashes: true },
        );
        expect(r.entries[0]).toMatchObject({ status: "equal", hashAlgo: "md5" });
        expect(r.summary.hashComparedFiles).toBe(1);
    });

    it("해시가 다르면 변경", () => {
        const r = f_Diff([f_File("a", 1, T0, { sha1: "x" })], [f_File("a", 1, T0, { sha1: "y" })], {
            checkHashes: true,
        });
        expect(r.entries[0]).toMatchObject({
            status: "modified",
            reasons: ["hash"],
            hashAlgo: "sha1",
        });
    });

    it("공통 해시가 없으면 크기만 비교(동일) + 통계·경고", () => {
        const r = f_Diff([f_File("a", 1, T0, { md5: "x" })], [f_File("a", 1, T0 + 99_999, null)], {
            checkHashes: true,
        });
        expect(r.entries[0]).toMatchObject({
            status: "equal",
            hashUnavailable: true,
            hashAlgo: null,
        });
        expect(r.summary.hashUnavailableFiles).toBe(1);
        expect(r.warnings).toHaveLength(1);
    });

    it("크기가 다르면 해시 없이도 변경", () => {
        const r = f_Diff([f_File("a", 2)], [f_File("a", 1)], { checkHashes: true });
        expect(r.entries[0]!.reasons).toEqual(["size"]);
    });
});

describe("형식 충돌·대소문자", () => {
    it("대상 파일이 원본 폴더 자리를 막으면 하위 전체가 typeConflict", () => {
        const r = f_Diff(
            [f_File("docs/a.txt", 5), f_File("docs/sub/b.txt", 6), f_File("x", 1)],
            [f_File("docs", 9), f_File("x", 1)],
        );
        const conflicts = r.entries.filter((e) => e.status === "typeConflict").map((e) => e.path);
        expect(conflicts).toEqual(["docs", "docs/a.txt", "docs/sub/b.txt"]);
        expect(r.summary).toMatchObject({
            conflictGroups: 1,
            conflictFiles: 3,
            createFiles: 0,
            deleteFiles: 0,
            sameFiles: 1,
        });
    });

    it("반대 방향(원본 파일이 대상 폴더 자리)도 충돌", () => {
        const r = f_Diff([f_File("docs", 1)], [f_File("docs/a.txt", 1)]);
        expect(r.entries.every((e) => e.status === "typeConflict")).toBe(true);
    });

    it("대소문자만 다른 쌍은 caseOnly로 표시", () => {
        const r = f_Diff([f_File("Readme.md")], [f_File("README.md")]);
        expect(r.entries[0]).toMatchObject({ path: "Readme.md", caseOnly: true, status: "equal" });
        expect(r.summary.caseOnlyFiles).toBe(1);
    });

    it("대소문자 구분 모드에서는 별개 파일", () => {
        const r = f_Diff([f_File("Readme.md")], [f_File("README.md")], { caseInsensitive: false });
        expect(r.summary).toMatchObject({ createFiles: 1, deleteFiles: 1, caseOnlyFiles: 0 });
    });

    it("한쪽 목록에 대소문자만 다른 두 파일이 있으면 CASE_COLLISION", () => {
        const r = diffFileLists([f_File("a.txt"), f_File("A.txt")], [], OPTS);
        expect(r).toEqual({
            ok: false,
            code: "CASE_COLLISION",
            side: "source",
            paths: ["a.txt", "A.txt"],
        });
    });

    it("크기 음수(Google 문서)는 0으로 계산하고 경고", () => {
        const r = f_Diff([f_File("doc", -1)], []);
        expect(r.summary.createBytes).toBe(0);
        expect(r.warnings).toHaveLength(1);
    });
});

describe("실제 rclone 출력 기반", () => {
    it("lsjson fixture 두 개로 rclone dry-run과 같은 복사·삭제 수를 낸다", () => {
        const src = parseLsjsonOutput(readFixture("lsjson-src", "stdout"));
        const dst = parseLsjsonOutput(readFixture("lsjson-dst-after-sync", "stdout"));
        const r = f_Diff(src, dst);
        // sync 직후이므로 모두 동일해야 한다
        expect(r.summary).toMatchObject({
            createFiles: 0,
            updateFiles: 0,
            deleteFiles: 0,
            sameFiles: 5,
        });
    });
});

function f_DirDiff(
    src: itfFileMeta[],
    dst: itfFileMeta[],
    dirs: { source: string[]; dest: string[] },
    opts: Partial<itfDiffOptions> = {},
) {
    const r = diffFileLists(src, dst, { ...OPTS, ...opts }, dirs);
    if (!r.ok) throw new Error("diff 실패");
    return r;
}

/** 폴더 포함 lsjson fixture → 파일 목록과 폴더 경로 */
function f_Split(name: string) {
    const all = JSON.parse(readFixture(name, "stdout")) as { Path: string; IsDir: boolean }[];
    return {
        files: parseLsjsonOutput(readFixture(name, "stdout")),
        dirs: all.filter((e) => e.IsDir).map((e) => e.Path),
    };
}

describe("폴더 변화 (전체 범위, INT-002 T-05)", () => {
    it("dirs가 null이면 폴더 수 0, dirChanges []", () => {
        const r = f_Diff([f_File("a/b.txt")], []);
        expect(r.summary).toMatchObject({ createDirs: 0, deleteDirs: 0 });
        expect(r.dirChanges).toEqual([]);
    });

    it("빈 폴더 체인은 모두 생성, 파일이 든 폴더(조상)는 세지 않는다", () => {
        const r = f_DirDiff([f_File("new/sub/n.txt")], [], {
            source: ["e", "e/a", "e/a/b", "new", "new/sub"],
            dest: [],
        });
        expect(r.summary.createDirs).toBe(3);
        expect(r.dirChanges).toEqual([
            { path: "e", action: "create" },
            { path: "e/a", action: "create" },
            { path: "e/a/b", action: "create" },
        ]);
    });

    it("대상에만 있는 폴더는 모두 삭제, 양쪽에 있는 폴더는 그대로", () => {
        const r = f_DirDiff(
            [f_File("keep/a.txt")],
            [f_File("keep/a.txt"), f_File("gone/old.txt")],
            {
                source: ["keep", "both"],
                dest: ["keep", "both", "gone", "x", "x/y"],
            },
        );
        expect(r.summary).toMatchObject({ createDirs: 0, deleteDirs: 3, deleteFiles: 1 });
        expect(r.dirChanges.map((c) => c.path)).toEqual(["gone", "x", "x/y"]);
    });

    it("실제 rclone 출력(scope-lsjson-*-all): 생성 4·삭제 4가 dry-run과 같다 (rclone-notes #22·#23)", () => {
        const s = f_Split("scope-lsjson-src-all");
        const d = f_Split("scope-lsjson-dst-all");
        const r = f_DirDiff(s.files, d.files, { source: s.dirs, dest: d.dirs });
        expect(r.dirChanges.filter((c) => c.action === "create").map((c) => c.path)).toEqual([
            "empty-src",
            "nest",
            "nest/a",
            "nest/a/b",
        ]);
        expect(r.dirChanges.filter((c) => c.action === "delete").map((c) => c.path)).toEqual([
            "dst-only-empty",
            "dst-only-nest",
            "dst-only-nest/x",
            "gone",
        ]);
    });

    it("원본 폴더 ↔ 대상 파일이 겹치면 typeConflict, 그 아래 폴더는 세지 않는다", () => {
        const r = f_DirDiff([], [f_File("docs", 3)], { source: ["docs", "docs/sub"], dest: [] });
        expect(r.entries[0]).toMatchObject({ path: "docs", status: "typeConflict" });
        expect(r.summary).toMatchObject({ conflictGroups: 1, conflictFiles: 1, createDirs: 0 });
        expect(r.dirChanges).toEqual([]);
    });

    it("대상 폴더 ↔ 원본 파일이 겹쳐도 typeConflict", () => {
        const r = f_DirDiff([f_File("docs", 3)], [], { source: [], dest: ["docs"] });
        expect(r.entries[0]).toMatchObject({ status: "typeConflict" });
        expect(r.summary.deleteDirs).toBe(0);
    });

    it("대소문자만 다른 폴더는 caseOnlyFiles로 세고 경고한다", () => {
        const r = f_DirDiff([], [], { source: ["Docs"], dest: ["docs"] });
        expect(r.summary).toMatchObject({ caseOnlyFiles: 1, createDirs: 0, deleteDirs: 0 });
        expect(r.warnings).toContain("대소문자만 다른 폴더: ‘Docs’ ↔ ‘docs’");
    });

    it("한쪽 폴더 키가 겹치면 CASE_COLLISION", () => {
        const r = diffFileLists([], [], OPTS, { source: [], dest: ["a", "A"] });
        expect(r).toEqual({ ok: false, code: "CASE_COLLISION", side: "dest", paths: ["a", "A"] });
    });
});
