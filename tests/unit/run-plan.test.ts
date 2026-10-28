// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { expectedDeletes, matchPlanWithDryRun, planFromCompare } from "@/shared/run-plan";
import type { itfCompareSummary } from "@/shared/types/compare";
import type { itfDryRunSummary } from "@/shared/types/run";

const SUMMARY: itfCompareSummary = {
    sourceFiles: 5,
    destFiles: 5,
    createFiles: 2,
    updateFiles: 2,
    deleteFiles: 2,
    sameFiles: 1,
    conflictFiles: 0,
    conflictGroups: 0,
    createBytes: 10,
    updateBytes: 14,
    deleteBytes: 8,
    transferBytes: 24,
    caseOnlyFiles: 0,
    hashComparedFiles: 0,
    hashUnavailableFiles: 0,
};

function f_Dry(over: Partial<itfDryRunSummary> = {}): itfDryRunSummary {
    return {
        copyFiles: 3,
        copyBytes: 24,
        deleteFiles: 2,
        deleteBytes: 8,
        touchFiles: 1,
        removeDirs: 1,
        copySamples: [],
        deleteSamples: [],
        touchSamples: [],
        ...over,
    };
}

describe("planFromCompare / expectedDeletes", () => {
    it("sync는 삭제 수·바이트를 그대로, copy는 0", () => {
        expect(planFromCompare(SUMMARY, "sync")).toMatchObject({
            createFiles: 2,
            updateFiles: 2,
            deleteFiles: 2,
            deleteBytes: 8,
            transferBytes: 24,
        });
        expect(planFromCompare(SUMMARY, "copy")).toMatchObject({ deleteFiles: 0, deleteBytes: 0 });
        expect(expectedDeletes(SUMMARY, "sync")).toBe(2);
        expect(expectedDeletes(SUMMARY, "copy")).toBe(0);
    });
});

describe("matchPlanWithDryRun", () => {
    it("수정시간만 다른 파일(touch)은 변경으로 센다: 복사 3 + touch 1 == 새 2 + 변경 2", () => {
        expect(matchPlanWithDryRun(planFromCompare(SUMMARY, "sync"), f_Dry())).toEqual({
            ok: true,
            mismatches: [],
        });
        expect(
            matchPlanWithDryRun(planFromCompare(SUMMARY, "copy"), f_Dry({ deleteFiles: 0 })).ok,
        ).toBe(true);
    });

    it("복사·삭제 수가 다르면 항목별로 알린다", () => {
        const r = matchPlanWithDryRun(
            planFromCompare(SUMMARY, "sync"),
            f_Dry({ copyFiles: 1, deleteFiles: 3 }),
        );
        expect(r.ok).toBe(false);
        expect(r.mismatches).toHaveLength(2);
        expect(r.mismatches[0]).toContain("계획 4개");
        expect(r.mismatches[1]).toContain("미리보기 3개");
    });
});
