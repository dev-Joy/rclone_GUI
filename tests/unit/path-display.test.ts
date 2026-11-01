// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { pathKindBadge, shortenPath } from "@/lib/path-display";

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

describe("shortenPath (INT-002 T-04)", () => {
    it("max 이하면 그대로", () => {
        expect(shortenPath("C:\\tmp\\a", 36)).toBe("C:\\tmp\\a");
        expect(shortenPath("x".repeat(36))).toBe("x".repeat(36));
    });

    it("넘으면 가운데를 …로 줄여 정확히 max자", () => {
        const long = `C:\\${"a".repeat(20)}\\${"b".repeat(20)}\\끝.txt`;
        const short = shortenPath(long, 21);
        expect(short).toHaveLength(21);
        expect(short.startsWith(long.slice(0, 10))).toBe(true);
        expect(short.endsWith(long.slice(-10))).toBe(true);
        expect(short[10]).toBe("…");
    });
});
