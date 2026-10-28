// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    appendTail,
    canStartRun,
    dryRunHeadline,
    progressPercent,
    realRunConfirmText,
    runStatusText,
    type itfCanStartRunInput,
} from "@/lib/run-view";
import { normalizeStats } from "@/main/parsers/log-parser";
import { createDefaultSettings } from "@/shared/defaults";
import type { typJob } from "@/shared/schemas/job";
import type { itfCompareResult, itfCompareSummary } from "@/shared/types/compare";
import type { itfRunLogLine } from "@/shared/types/run";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const T0 = Date.parse("2026-10-28T00:00:00.000Z");

function f_Job(over: Partial<typJob> = {}): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: JOB_ID,
        name: "작업",
        notes: "",
        source: "C:\\tmp\\src",
        destination: "D:\\tmp\\dst",
        mode: "copy",
        excludes: [...excludes],
        options,
        configPathOverride: null,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 0,
        createdAt: "2026-10-28T00:00:00.000Z",
        updatedAt: "2026-10-28T00:00:00.000Z",
        lastRun: null,
        ...over,
    };
}

function f_Summary(over: Partial<itfCompareSummary> = {}): itfCompareSummary {
    return {
        sourceFiles: 3,
        destFiles: 2,
        createFiles: 1,
        updateFiles: 1,
        deleteFiles: 1,
        sameFiles: 1,
        conflictFiles: 0,
        conflictGroups: 0,
        createBytes: 3,
        updateBytes: 14,
        deleteBytes: 5,
        transferBytes: 17,
        caseOnlyFiles: 0,
        hashComparedFiles: 0,
        hashUnavailableFiles: 0,
        ...over,
    };
}

function f_Result(over: Partial<itfCompareResult> = {}): itfCompareResult {
    return {
        jobId: JOB_ID,
        jobRev: 0,
        createdAt: new Date(T0).toISOString(),
        durationMs: 1,
        mode: "copy",
        method: { checkHashes: false, modtimeToleranceMs: 2000, caseInsensitive: true },
        destMissing: false,
        summary: f_Summary(),
        entries: [],
        warnings: [],
        planToken: "a".repeat(32),
        ...over,
    };
}

function f_Input(over: Partial<itfCanStartRunInput> = {}): itfCanStartRunInput {
    return {
        job: f_Job(),
        dirty: false,
        caseInsensitive: true,
        comparing: null,
        runningJobId: null,
        dryRun: false,
        compare: f_Result(),
        maxAgeMinutes: 10,
        nowMs: T0 + 60_000,
        ...over,
    };
}

function f_LogLine(n: number): itfRunLogLine {
    return { at: "", level: "info", message: String(n) };
}

function f_Reason(input: itfCanStartRunInput): string | null {
    const r = canStartRun(input);
    return r.ok ? null : r.reason;
}

describe("canStartRun", () => {
    it("유효한 비교 결과가 있는 copy 작업은 실행 가능", () => {
        expect(canStartRun(f_Input())).toEqual({ ok: true });
    });

    it("공통 차단: 저장 안 됨 → 변경 중 → 경로 오류 → 비교 중 → 실행 중", () => {
        expect(f_Reason(f_Input({ job: null }))).toContain("저장");
        expect(f_Reason(f_Input({ dirty: true }))).toContain("저장하지 않은 변경");
        expect(
            f_Reason(f_Input({ job: f_Job({ destination: "C:\\tmp\\src\\sub" }) })),
        ).toBeTruthy();
        const comparing = {
            jobId: JOB_ID,
            phase: "list" as const,
            startedAt: "",
            sourceFiles: 0,
            destFiles: 0,
        };
        expect(f_Reason(f_Input({ comparing }))).toContain("비교가 끝난 뒤");
        expect(f_Reason(f_Input({ runningJobId: JOB_ID }))).toBe("실행 중입니다.");
        expect(f_Reason(f_Input({ runningJobId: "other" }))).toContain("다른 작업");
    });

    it("미리보기는 비교 결과 없이·sync에서도 가능", () => {
        expect(canStartRun(f_Input({ dryRun: true, compare: null })).ok).toBe(true);
        expect(canStartRun(f_Input({ dryRun: true, job: f_Job({ mode: "sync" }) })).ok).toBe(true);
    });

    it("실제 실행 차단: sync → 비교 없음/다른 작업 → 낡음·rev 변경 → 충돌 → 바꿀 파일 없음", () => {
        expect(f_Reason(f_Input({ job: f_Job({ mode: "sync" }) }))).toContain(
            "아직 지원하지 않습니다",
        );
        expect(f_Reason(f_Input({ compare: null }))).toBe("먼저 비교하세요.");
        expect(f_Reason(f_Input({ compare: f_Result({ jobId: "x" }) }))).toBe("먼저 비교하세요.");
        expect(f_Reason(f_Input({ nowMs: T0 + 11 * 60_000 }))).toContain("11분");
        expect(f_Reason(f_Input({ job: f_Job({ rev: 1 }) }))).toContain("작업 설정이 바뀌었습니다");
        expect(
            f_Reason(f_Input({ compare: f_Result({ summary: f_Summary({ conflictFiles: 1 }) }) })),
        ).toContain("겹치거나");
        expect(
            f_Reason(f_Input({ compare: f_Result({ summary: f_Summary({ caseOnlyFiles: 1 }) }) })),
        ).toContain("대소문자");
        expect(
            f_Reason(
                f_Input({
                    compare: f_Result({ summary: f_Summary({ createFiles: 0, updateFiles: 0 }) }),
                }),
            ),
        ).toContain("복사할 파일이 없습니다");
    });
});

describe("progressPercent", () => {
    it("바이트 기준, 없으면 파일 수 기준, 둘 다 없으면 null, 0~100으로 자른다", () => {
        expect(progressPercent(null)).toBeNull();
        expect(progressPercent(normalizeStats({ bytes: 1, totalBytes: 4 }))).toBe(25);
        expect(progressPercent(normalizeStats({ transfers: 1, totalTransfers: 3 }))).toBe(33);
        expect(progressPercent(normalizeStats({}))).toBeNull();
        expect(progressPercent(normalizeStats({ bytes: 9, totalBytes: 4 }))).toBe(100);
    });
});

describe("appendTail", () => {
    it("최근 max줄만 남기고 원본은 바꾸지 않는다", () => {
        const tail = [f_LogLine(1), f_LogLine(2)];
        const next = appendTail(tail, [f_LogLine(3), f_LogLine(4)], 3);
        expect(next.map((l) => l.message)).toEqual(["2", "3", "4"]);
        expect(tail).toHaveLength(2);
    });
});

describe("문구", () => {
    it("runStatusText: 미리보기·복사·동기화와 상태", () => {
        expect(runStatusText("success", true, "sync")).toBe("미리보기 완료");
        expect(runStatusText("success", false, "copy")).toBe("복사 완료");
        expect(runStatusText("canceled", false, "copy")).toBe("복사 취소됨");
        expect(runStatusText("partial", false, "sync")).toBe("동기화 일부 실패");
        expect(runStatusText("interrupted", true, "copy")).toContain("중단됨");
    });

    it("dryRunHeadline: 일어날 일만, 없으면 바뀌는 파일 없음", () => {
        const base = {
            copyFiles: 3,
            copyBytes: 24,
            deleteFiles: 2,
            deleteBytes: 8,
            touchFiles: 1,
            removeDirs: 1,
            copySamples: [],
            deleteSamples: [],
            touchSamples: [],
        };
        expect(dryRunHeadline(base)).toBe(
            "실행하면 대상에 3개 복사(24 B), 1개 수정시간만 맞춤, 2개 삭제",
        );
        expect(dryRunHeadline({ ...base, copyFiles: 0, deleteFiles: 0, touchFiles: 0 })).toContain(
            "바뀌는 파일이 없습니다",
        );
    });

    it("realRunConfirmText: copy는 삭제를 말하지 않는다", () => {
        expect(realRunConfirmText(f_Summary(), "copy")).toBe(
            "대상에 1개 복사, 1개 덮어씀 (총 17 B)",
        );
        expect(realRunConfirmText(f_Summary(), "sync")).toContain("1개 삭제");
        expect(realRunConfirmText(f_Summary({ createFiles: 0, updateFiles: 0 }), "copy")).toContain(
            "바뀌는 파일이 없습니다",
        );
    });
});
