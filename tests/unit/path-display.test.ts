// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { pathKindBadge } from "@/lib/path-display";

describe("경로 종류 배지", () => {
    it("빈 값은 배지 없음", () => {
        expect(pathKindBadge("")).toBeNull();
        expect(pathKindBadge("   ")).toBeNull();
    });

    it.each([
        ["C:\\tmp\\a", "로컬", "local"],
        ["\\\\srv\\s\\a", "UNC", "unc"],
        ["r:x", "remote", "remote"],
        ["/home/a", "형식 오류", null],
    ])("%j → %s", (raw, text, kind) => {
        expect(pathKindBadge(raw)).toEqual({ text, kind });
    });
});
