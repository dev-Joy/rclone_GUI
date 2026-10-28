// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { computeRowWindow } from "@/lib/virtual-rows";

describe("computeRowWindow (행 30px, 여유 10행)", () => {
    it("0행", () => {
        expect(computeRowWindow(0, 600, 30, 0, 10)).toEqual({
            start: 0,
            end: 0,
            padTop: 0,
            padBottom: 0,
            totalHeight: 0,
        });
    });

    it("첫 화면: 보이는 20행 + 아래 여유 10행", () => {
        const w = computeRowWindow(0, 600, 30, 5000, 10);
        expect(w).toMatchObject({ start: 0, end: 30, padTop: 0, totalHeight: 150_000 });
        expect(w.padTop + (w.end - w.start) * 30 + w.padBottom).toBe(w.totalHeight);
    });

    it("중간 스크롤: 위·아래 여유 행", () => {
        const w = computeRowWindow(3000, 600, 30, 5000, 10);
        expect(w).toMatchObject({ start: 90, end: 130, padTop: 2700 });
        expect(w.padBottom).toBe((5000 - 130) * 30);
    });

    it("끝(넘친 스크롤 포함)", () => {
        const w = computeRowWindow(10_000_000, 600, 30, 100, 10);
        expect(w.end).toBe(100);
        expect(w.start).toBe(89);
        expect(w.padBottom).toBe(0);
    });

    it("행 수가 화면보다 적으면 전부", () => {
        expect(computeRowWindow(0, 600, 30, 5, 10)).toMatchObject({
            start: 0,
            end: 5,
            padBottom: 0,
        });
    });

    it("viewport 0(측정 전)은 여유 행만", () => {
        expect(computeRowWindow(0, 0, 30, 5000, 10)).toMatchObject({ start: 0, end: 10 });
    });

    it("음수 스크롤은 0으로", () => {
        expect(computeRowWindow(-50, 300, 30, 100, 0)).toMatchObject({ start: 0, end: 10 });
    });
});
