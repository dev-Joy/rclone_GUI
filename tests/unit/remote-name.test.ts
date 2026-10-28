// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    driveLetterRemoteWarning,
    findDriveLetterRemotes,
    isDriveLetterRemoteName,
    looksLikeDriveLetterRemotePath,
} from "@/shared/remote-name";

describe("한 글자 remote 이름", () => {
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
        expect(driveLetterRemoteWarning(["a", "b"])).toContain("‘a:’, ‘b:’ remote는");
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
