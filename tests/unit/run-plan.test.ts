// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    checkPreflight,
    expectedDeleteDirs,
    expectedDeletes,
    hasPlannedChanges,
    matchPlanWithDryRun,
    planFromCompare,
    plannedDeleteCount,
} from "@/shared/run-plan";
import type { typRunStats } from "@/shared/schemas/run";
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
    createDirs: 0,
    deleteDirs: 0,
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

    it("폴더: 생성은 그대로, 삭제는 sync만 (INT-002 T-05)", () => {
        const dirs = { ...SUMMARY, createDirs: 3, deleteDirs: 2 };
        expect(planFromCompare(dirs, "sync")).toMatchObject({ createDirs: 3, deleteDirs: 2 });
        expect(planFromCompare(dirs, "copy")).toMatchObject({ createDirs: 3, deleteDirs: 0 });
        expect(expectedDeleteDirs(dirs, "sync")).toBe(2);
        expect(expectedDeleteDirs(dirs, "copy")).toBe(0);
        expect(plannedDeleteCount(planFromCompare(dirs, "sync"))).toBe(4);
    });
});

describe("hasPlannedChanges (INT-003 FR-33)", () => {
    const NONE = { createFiles: 0, updateFiles: 0, createDirs: 0, deleteFiles: 0, deleteDirs: 0 };

    it("모두 0이면 대상과 관계없이 false", () => {
        expect(hasPlannedChanges(NONE, true)).toBe(false);
        expect(hasPlannedChanges(NONE, false)).toBe(false);
        expect(hasPlannedChanges(NONE, null)).toBe(false);
    });

    it("폴더 생성만: 빈 폴더를 못 만드는 대상(false)이면 false, true·null은 true", () => {
        const dirsOnly = { ...NONE, createDirs: 3 };
        expect(hasPlannedChanges(dirsOnly, false)).toBe(false);
        expect(hasPlannedChanges(dirsOnly, true)).toBe(true);
        expect(hasPlannedChanges(dirsOnly, null)).toBe(true);
    });

    it.each(["createFiles", "updateFiles", "deleteFiles", "deleteDirs"] as const)(
        "false여도 %s가 있으면 true(폴더 생성 말고는 그대로 센다)",
        (key) => {
            expect(hasPlannedChanges({ ...NONE, createDirs: 2, [key]: 1 }, false)).toBe(true);
        },
    );
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

function f_Stats(over: Partial<typRunStats> = {}): typRunStats {
    return {
        bytes: 24,
        totalBytes: 24,
        transfers: 3,
        totalTransfers: 3,
        deletes: 2,
        deletedDirs: 1,
        checks: 5,
        totalChecks: 5,
        listed: 12,
        errors: 0,
        speedBps: 0,
        etaSeconds: null,
        partialFiles: 0,
        etaPending: false,
        elapsedMs: 10,
        fatalError: false,
        lastError: null,
        ...over,
    };
}

describe("checkPreflight (사전 확인, S14)", () => {
    const plan = planFromCompare(SUMMARY, "sync");

    it("수집기·stats 삭제 수가 같고 오류 0이면 일치(바이트는 보지 않음)", () => {
        expect(checkPreflight(plan, f_Dry({ copyBytes: 999 }), f_Stats({ bytes: 1 }))).toEqual({
            ok: true,
            mismatches: [],
        });
    });

    it("stats 삭제 수가 다르면 불일치(수집기는 같아도)", () => {
        const r = checkPreflight(plan, f_Dry(), f_Stats({ deletes: 3 }));
        expect(r.ok).toBe(false);
        expect(r.mismatches).toEqual(["삭제(통계): 계획 2개, 사전 확인 3개"]);
    });

    it("오류가 있거나 stats가 없으면 불일치, matchPlanWithDryRun 차이도 포함", () => {
        expect(checkPreflight(plan, f_Dry(), f_Stats({ errors: 1 })).mismatches).toEqual([
            "사전 확인 중 오류 1건",
        ]);
        expect(checkPreflight(plan, f_Dry(), null).ok).toBe(false);
        const r = checkPreflight(plan, f_Dry({ deleteFiles: 3 }), f_Stats({ deletes: 3 }));
        expect(r.mismatches).toHaveLength(2);
    });

    it("compareDirs면 폴더 삭제 수(수집기·stats)도 맞춰 본다 (INT-002 T-05)", () => {
        const dirPlan = planFromCompare({ ...SUMMARY, deleteDirs: 4 }, "sync");
        const ok = checkPreflight(dirPlan, f_Dry({ removeDirs: 4 }), f_Stats({ deletedDirs: 4 }), {
            compareDirs: true,
        });
        expect(ok).toEqual({ ok: true, mismatches: [] });
        const r = checkPreflight(dirPlan, f_Dry({ removeDirs: 3 }), f_Stats({ deletedDirs: 5 }), {
            compareDirs: true,
        });
        expect(r.mismatches).toEqual([
            "폴더 삭제: 계획 4개, 사전 확인 3개",
            "폴더 삭제(통계): 계획 4개, 사전 확인 5개",
        ]);
        // 파일만 범위(compareDirs 없음)는 폴더 수를 보지 않는다
        expect(checkPreflight(dirPlan, f_Dry({ removeDirs: 3 }), f_Stats()).ok).toBe(true);
    });
});
