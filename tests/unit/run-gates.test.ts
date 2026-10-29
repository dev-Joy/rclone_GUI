// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { createDefaultSettings } from "@/shared/defaults";
import { checkPlanSafety, isLargeDelete, needsPreflight } from "@/shared/run-gates";
import type { typRunPlan } from "@/shared/schemas/run";

const SAFETY = { deleteConfirmFiles: 50, deleteConfirmPercent: 10 };

function f_Plan(over: Partial<typRunPlan> = {}): typRunPlan {
    return {
        sourceFiles: 10,
        destFiles: 10,
        createFiles: 1,
        updateFiles: 1,
        deleteFiles: 1,
        transferBytes: 10,
        deleteBytes: 5,
        conflictFiles: 0,
        caseOnlyFiles: 0,
        ...over,
    };
}

function f_Job(mode: "copy" | "sync", over: { ignoreErrors?: boolean; preflight?: boolean } = {}) {
    return {
        mode,
        options: {
            ignoreErrors: over.ignoreErrors ?? false,
            preflightBeforeDestructive: over.preflight ?? true,
        },
    };
}

describe("isLargeDelete (S11, 엄격한 초과)", () => {
    it("개수 기준 50/51 (비율은 넘지 않게 대상 10000개)", () => {
        expect(isLargeDelete({ deleteFiles: 50, destFiles: 10_000 }, SAFETY)).toBe(false);
        expect(isLargeDelete({ deleteFiles: 51, destFiles: 10_000 }, SAFETY)).toBe(true);
    });

    it("비율 기준: 정확히 10%는 대량 아님, 넘으면 대량", () => {
        expect(isLargeDelete({ deleteFiles: 10, destFiles: 100 }, SAFETY)).toBe(false);
        expect(isLargeDelete({ deleteFiles: 11, destFiles: 100 }, SAFETY)).toBe(true);
        expect(isLargeDelete({ deleteFiles: 1, destFiles: 9 }, SAFETY)).toBe(true);
    });

    it("삭제 0은 대량 아님, 대상 0인데 삭제가 있으면 대량", () => {
        expect(isLargeDelete({ deleteFiles: 0, destFiles: 0 }, SAFETY)).toBe(false);
        expect(isLargeDelete({ deleteFiles: 1, destFiles: 0 }, SAFETY)).toBe(true);
    });

    it("기준값 0이면 삭제 1개도 대량", () => {
        const big = { deleteFiles: 1, destFiles: 1_000_000 };
        expect(isLargeDelete(big, { deleteConfirmFiles: 0, deleteConfirmPercent: 10 })).toBe(true);
        expect(isLargeDelete(big, { deleteConfirmFiles: 50, deleteConfirmPercent: 0 })).toBe(true);
        expect(
            isLargeDelete({ deleteFiles: 0, destFiles: 5 }, { ...SAFETY, deleteConfirmFiles: 0 }),
        ).toBe(false);
    });

    it("기본 설정은 50개·10%", () => {
        const { deleteConfirmFiles, deleteConfirmPercent } = createDefaultSettings().safety;
        expect({ deleteConfirmFiles, deleteConfirmPercent }).toEqual(SAFETY);
    });
});

describe("checkPlanSafety", () => {
    it("통과하면 null (copy·sync)", () => {
        expect(checkPlanSafety(f_Plan(), f_Job("copy"))).toBeNull();
        expect(checkPlanSafety(f_Plan(), f_Job("sync"))).toBeNull();
    });

    it("S5 형식 충돌·S6 대소문자 → SAFETY_BLOCKED (copy도)", () => {
        expect(checkPlanSafety(f_Plan({ conflictFiles: 1 }), f_Job("copy"))?.code).toBe(
            "SAFETY_BLOCKED",
        );
        expect(checkPlanSafety(f_Plan({ caseOnlyFiles: 2 }), f_Job("sync"))).toMatchObject({
            code: "SAFETY_BLOCKED",
            message: expect.stringContaining("대소문자"),
        });
    });

    it("S7 빈 원본: sync는 EMPTY_SOURCE_BLOCKED, copy는 통과, 대상도 비면 통과", () => {
        const empty = f_Plan({ sourceFiles: 0, createFiles: 0, updateFiles: 0, deleteFiles: 10 });
        expect(checkPlanSafety(empty, f_Job("sync"))?.code).toBe("EMPTY_SOURCE_BLOCKED");
        expect(checkPlanSafety({ ...empty, deleteFiles: 0 }, f_Job("copy"))).toBeNull();
        expect(
            checkPlanSafety(
                f_Plan({ sourceFiles: 0, destFiles: 0, deleteFiles: 0 }),
                f_Job("sync"),
            ),
        ).toBeNull();
    });

    it("S15 sync + ignoreErrors → SAFETY_BLOCKED, copy + ignoreErrors는 통과", () => {
        expect(checkPlanSafety(f_Plan(), f_Job("sync", { ignoreErrors: true }))?.code).toBe(
            "SAFETY_BLOCKED",
        );
        expect(checkPlanSafety(f_Plan(), f_Job("copy", { ignoreErrors: true }))).toBeNull();
    });

    it("순서: 충돌이 빈 원본보다 먼저", () => {
        const p = f_Plan({ conflictFiles: 1, sourceFiles: 0 });
        expect(checkPlanSafety(p, f_Job("sync"))?.code).toBe("SAFETY_BLOCKED");
    });
});

describe("needsPreflight", () => {
    it("sync + 삭제 > 0 + 옵션 켜짐일 때만", () => {
        expect(needsPreflight(f_Plan(), f_Job("sync"))).toBe(true);
        expect(needsPreflight(f_Plan({ deleteFiles: 0 }), f_Job("sync"))).toBe(false);
        expect(needsPreflight(f_Plan(), f_Job("sync", { preflight: false }))).toBe(false);
        expect(needsPreflight(f_Plan(), f_Job("copy"))).toBe(false);
    });
});
