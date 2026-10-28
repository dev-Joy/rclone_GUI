// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { createLatestGate } from "@/shared/latest-request";

describe("createLatestGate", () => {
    it("늦게 도착한 이전 요청은 최신이 아니다", async () => {
        const gate = createLatestGate();
        const applied: string[] = [];
        const f_Request = async (name: string, ms: number) => {
            const isLatest = gate.next();
            await new Promise((r) => setTimeout(r, ms));
            if (isLatest()) applied.push(name);
        };
        // detect(false)가 늦게, detect(true)가 먼저 끝나는 경우
        await Promise.all([f_Request("detect(false)", 40), f_Request("detect(true)", 5)]);
        expect(applied).toEqual(["detect(true)"]);
    });

    it("invalidate 뒤에는 진행 중 요청을 반영하지 않는다(확인 중 경로 변경)", () => {
        const gate = createLatestGate();
        const isLatest = gate.next();
        expect(isLatest()).toBe(true);
        gate.invalidate();
        expect(isLatest()).toBe(false);
        expect(gate.next()()).toBe(true);
    });
});
