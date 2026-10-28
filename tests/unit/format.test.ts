// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { formatBytes, formatDuration, formatLocalDateTime, formatPercent } from "@/shared/format";

describe("format", () => {
    it.each([
        [0, "0 B"],
        [1023, "1023 B"],
        [1536, "1.5 KB"],
        [1024 * 1024 * 150, "150 MB"],
        [-1, "-"],
        [Number.NaN, "-"],
    ])("formatBytes(%d) = %s", (n, s) => expect(formatBytes(n)).toBe(s));

    it.each([
        [450, "0.5초"],
        [1000, "1초"],
        [3_723_000, "1시간 2분 3초"],
        [120_000, "2분"],
        [-5, "-"],
    ])("formatDuration(%d) = %s", (n, s) => expect(formatDuration(n)).toBe(s));

    it("formatPercent", () => {
        expect(formatPercent(1, 3)).toBe("33%");
        expect(formatPercent(1, 0)).toBe("-");
    });

    it("formatLocalDateTime", () => {
        expect(formatLocalDateTime(null)).toBe("-");
        expect(formatLocalDateTime("bad")).toBe("-");
        expect(formatLocalDateTime("2026-10-28T00:00:00.000Z")).toMatch(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
        );
    });
});
