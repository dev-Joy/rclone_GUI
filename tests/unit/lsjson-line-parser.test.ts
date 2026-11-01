// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    clsLsjsonParseError,
    createLsjsonLineParser,
    parseLsjsonOutput,
} from "@/main/parsers/lsjson-parser";
import { readFixture } from "./fixtures";

function f_Feed(lines: readonly string[]) {
    const parser = createLsjsonLineParser();
    for (const line of lines) parser.push(line);
    return parser;
}

function f_Lines(text: string): string[] {
    return text.split(/\r?\n/);
}

describe("createLsjsonLineParser (실제 rclone 1.75.1 출력)", () => {
    it.each(["lsjson-src", "lsjson-src-hash", "lsjson-src-hashtype", "lsjson-dst-after-sync"])(
        "%s: 줄 단위 결과가 parseLsjsonOutput과 같다",
        (name) => {
            const stdout = readFixture(name, "stdout");
            const parser = f_Feed(f_Lines(stdout));
            const files = parser.finish();
            expect(files).toEqual(parseLsjsonOutput(stdout));
            expect(parser.count).toBe(files.length);
        },
    );

    it("hash-type md5·sha1만 받는다", () => {
        const files = f_Feed(f_Lines(readFixture("lsjson-src-hashtype", "stdout"))).finish();
        for (const f of files)
            expect(Object.keys(f.hashes ?? {}).toSorted()).toEqual(["md5", "sha1"]);
    });

    it("없는 경로(exit 3)의 stdout '[' 만으로는 finish가 실패한다", () => {
        const parser = f_Feed(f_Lines(readFixture("lsjson-missing", "stdout")));
        expect(() => parser.finish()).toThrow(clsLsjsonParseError);
    });

    it("빈 목록: '[]' 한 줄 또는 '[' + ']'", () => {
        expect(f_Feed(["[]"]).finish()).toEqual([]);
        expect(f_Feed(["", "[", "]", ""]).finish()).toEqual([]);
    });

    it("count는 파일만 센다(폴더 제외)", () => {
        const parser = f_Feed([
            "[",
            '{"Path":"d","Name":"d","Size":-1,"IsDir":true},',
            '{"Path":"d/a","Name":"a","Size":1,"ModTime":"2026-01-01T00:00:00Z","IsDir":false}',
        ]);
        expect(parser.count).toBe(1);
        parser.push("]");
        expect(parser.finish().map((f) => f.path)).toEqual(["d/a"]);
    });

    it.each([
        ["'[' 전 내용", ["x", "["]],
        ["']' 뒤 내용", ["[", "]", "{}"]],
        ["깨진 줄", ["[", '{"Path":']],
        ["필수 필드 없음", ["[", '{"Path":"a","IsDir":false}']],
    ])("%s → clsLsjsonParseError", (_label, lines) => {
        expect(() => f_Feed(lines).finish()).toThrow(clsLsjsonParseError);
    });

    it("']' 없이 끝나면 finish 오류", () => {
        const parser = f_Feed([
            "[",
            '{"Path":"a","Name":"a","Size":1,"ModTime":"2026-01-01T00:00:00Z","IsDir":false},',
        ]);
        expect(() => parser.finish()).toThrow("끝나지 않았습니다");
    });
});

describe("폴더 포함 목록 listing() (INT-002 T-05)", () => {
    it("scope-lsjson-src-all: 폴더는 dirs, 파일은 files로 나눈다", () => {
        const parser = f_Feed(f_Lines(readFixture("scope-lsjson-src-all", "stdout")));
        const listing = parser.listing();
        expect(listing.dirs.toSorted()).toEqual([
            "both-empty",
            "empty-src",
            "keep",
            "nest",
            "nest/a",
            "nest/a/b",
            "newdir",
            "newdir/sub",
        ]);
        expect(listing.files.map((f) => f.path).toSorted()).toEqual([
            "file.txt",
            "keep/a.txt",
            "newdir/sub/n.txt",
        ]);
        expect(parser.finish()).toEqual(listing.files);
        expect(parser.count).toBe(3);
    });

    it("--files-only 출력이면 dirs는 비어 있다", () => {
        expect(f_Feed(f_Lines(readFixture("lsjson-src", "stdout"))).listing().dirs).toEqual([]);
    });

    it("']' 전에 listing()을 부르면 오류", () => {
        expect(() => f_Feed(["["]).listing()).toThrow(clsLsjsonParseError);
    });
});
