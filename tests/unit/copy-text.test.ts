/**
 * app:copyText 입력 검증(INT-008 FR-7): 8KB 상한.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { COPY_TEXT_MAX, zCopyTextInput } from "@/shared/schemas/system";

describe("zCopyTextInput", () => {
    it("8KB까지 받는다", () => {
        expect(zCopyTextInput.safeParse({ text: "가".repeat(COPY_TEXT_MAX) }).success).toBe(true);
    });

    it("8KB를 넘으면 거부한다", () => {
        expect(zCopyTextInput.safeParse({ text: "가".repeat(COPY_TEXT_MAX + 1) }).success).toBe(
            false,
        );
    });
});
