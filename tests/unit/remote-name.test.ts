// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    driveLetterRemoteWarning,
    findDriveLetterRemotes,
    isDriveLetterRemoteName,
    looksLikeDriveLetterRemotePath,
    validateNewRemoteName,
} from "@/shared/remote-name";

describe("한 글자 리모트 이름", () => {
    it.each([
        ["a", true],
        ["Z", true],
        ["ab", false],
        ["1", false],
        ["가", false],
        ["", false],
    ])("isDriveLetterRemoteName(%j) → %s", (name, expected) => {
        expect(isDriveLetterRemoteName(name)).toBe(expected);
    });

    it("목록에서 한 글자 이름만 원래 순서대로 고른다", () => {
        expect(findDriveLetterRemotes(["gdrive", "x", "ab", "Y"])).toEqual(["x", "Y"]);
    });

    it("경고 문구", () => {
        expect(driveLetterRemoteWarning([])).toBeNull();
        const one = driveLetterRemoteWarning(["x"]);
        expect(one).toContain("‘x:’");
        expect(one).toContain("두 글자 이상");
        expect(driveLetterRemoteWarning(["a", "b"])).toContain("‘a:’, ‘b:’ 리모트는");
    });

    it.each([
        ["x:folder", true],
        ["  x:folder  ", true],
        ["x:\\folder", false],
        ["x:/f", false],
        ["ab:f", false],
        ["x:", false],
    ])("looksLikeDriveLetterRemotePath(%j) → %s", (raw, expected) => {
        expect(looksLikeDriveLetterRemotePath(raw)).toBe(expected);
    });
});

describe("새 리모트 이름 검사(INT-006 FR-5)", () => {
    it.each([
        ["gdrive", null],
        ["ab", null],
        ["한글", null],
        ["a.b+c@d_e-f", null],
        ["my-remote", null],
    ])("%j는 쓸 수 있다", (name, expected) => {
        expect(validateNewRemoteName(name)).toBe(expected);
    });

    it.each([
        ["x", "두 글자"],
        ["a b", "공백"],
        [" ab", "앞뒤"],
        ["ab ", "앞뒤"],
        ["-ab", "-로 시작"],
        ["ab-", "-로 시작"],
        ["a:b", "글자·숫자"],
        ["a/b", "글자·숫자"],
        ["a\\b", "글자·숫자"],
        ["", "두 글자"],
    ])("%j는 거부한다", (name, contains) => {
        expect(validateNewRemoteName(name)).toContain(contains);
    });

    it("기존 이름과 대소문자만 달라도 거부한다", () => {
        expect(validateNewRemoteName("AB", ["ab"])).toContain("이미 있습니다");
        expect(validateNewRemoteName("ab2", ["ab"])).toBeNull();
    });
});
