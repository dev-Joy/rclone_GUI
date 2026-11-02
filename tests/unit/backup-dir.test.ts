// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { buildBackupSubdir, nextBackupTime } from "@/main/services/backup-dir";
import { parseBackendFeatures } from "@/main/parsers/backend-features-parser";
import { readFixture } from "./fixtures";

describe("buildBackupSubdir (INT-003 FR-25)", () => {
    it("로컬 시각·0 채움·jobId 앞 8자", () => {
        const at = new Date(2026, 0, 2, 3, 4, 5);
        expect(buildBackupSubdir(at, "1a2b3c4d-0000-4000-8000-000000000001")).toBe(
            "2026-01-02_030405_1a2b3c4d",
        );
        expect(buildBackupSubdir(new Date(2026, 10, 30, 23, 59, 59), "abcdef12-x")).toBe(
            "2026-11-30_235959_abcdef12",
        );
    });
});

/** 2026-11-02T01:00:<s>.<ms>Z */
function f_T(s: number, ms = 0): Date {
    return new Date(Date.UTC(2026, 10, 2, 1, 0, s, ms));
}

describe("nextBackupTime (INT-003 E-11)", () => {
    it("이전 시각이 없으면 지금(초 아래 버림)", () => {
        expect(nextBackupTime(f_T(5, 700), null)).toEqual(f_T(5));
    });

    it("같은 초면 1초 뒤, 지금이 더 늦으면 지금", () => {
        expect(nextBackupTime(f_T(5, 900), f_T(5))).toEqual(f_T(6));
        expect(nextBackupTime(f_T(9), f_T(5))).toEqual(f_T(9));
    });

    it("시계가 뒤로 가도 이전보다 1초 뒤", () => {
        expect(nextBackupTime(f_T(1), f_T(5))).toEqual(f_T(6));
    });
});

describe("parseBackendFeatures (fixture)", () => {
    it.each([
        ["features-local", { canMove: true, canHaveEmptyDirs: true }],
        ["features-memory", { canMove: false, canHaveEmptyDirs: false }],
        ["features-alias-local", { canMove: true, canHaveEmptyDirs: true }],
        ["backup-s3-features", { canMove: false, canHaveEmptyDirs: false }],
        ["features-missing-remote", { canMove: null, canHaveEmptyDirs: null }],
    ] as const)("%s", (name, expected) => {
        expect(parseBackendFeatures(readFixture(name, "stdout"))).toEqual(expected);
    });

    it("JSON이 아니거나 값이 boolean이 아니면 null", () => {
        expect(parseBackendFeatures("not json")).toEqual({ canMove: null, canHaveEmptyDirs: null });
        expect(parseBackendFeatures('{"Features":{"Move":"yes"}}')).toEqual({
            canMove: null,
            canHaveEmptyDirs: null,
        });
        expect(parseBackendFeatures('{"Name":"x"}')).toEqual({
            canMove: null,
            canHaveEmptyDirs: null,
        });
    });
});
