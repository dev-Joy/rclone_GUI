// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    freshPreview,
    planFooterText,
    previewNotice,
    relativeTimeText,
    runBarText,
    runPanelShown,
    syncButtonText,
    type itfStepLastRun,
} from "@/lib/job-steps";
import { formatBytes, formatDuration, formatLocalDateTime } from "@/shared/format";
import type { typRunPlan } from "@/shared/schemas/run";
import type { itfCompareResult, itfCompareSummary, itfDiffEntry } from "@/shared/types/compare";
import type { itfDryRunSummary } from "@/shared/types/run";

const JOB = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const T0 = Date.parse("2026-11-08T00:00:00.000Z");
const ISO0 = new Date(T0).toISOString();

function f_Iso(offsetMs: number): string {
    return new Date(T0 + offsetMs).toISOString();
}

function f_Summary(over: Partial<itfCompareSummary> = {}): itfCompareSummary {
    return {
        sourceFiles: 8,
        destFiles: 3,
        createFiles: 6,
        updateFiles: 1,
        deleteFiles: 1,
        sameFiles: 1,
        conflictFiles: 0,
        conflictGroups: 0,
        createBytes: 40,
        updateBytes: 10,
        deleteBytes: 4,
        transferBytes: 51_200,
        caseOnlyFiles: 0,
        hashComparedFiles: 0,
        hashUnavailableFiles: 0,
        createDirs: 0,
        deleteDirs: 0,
        ...over,
    };
}

function f_Entries(n: number): itfDiffEntry[] {
    return Array.from({ length: n }, (_, k) => ({
        path: `f${k}.txt`,
        status: "equal" as const,
        reasons: [],
        source: { path: `f${k}.txt`, size: 1, modTimeMs: 0 },
        dest: { path: `f${k}.txt`, size: 1, modTimeMs: 0 },
        caseOnly: false,
        hashAlgo: null,
        hashUnavailable: false,
    }));
}

function f_Result(over: Partial<itfCompareResult> = {}): itfCompareResult {
    return {
        jobId: JOB,
        jobRev: 0,
        createdAt: ISO0,
        durationMs: 300,
        mode: "copy",
        scope: "files",
        method: { checkHashes: false, modtimeToleranceMs: 2000, caseInsensitive: true },
        destMissing: false,
        destCanHaveEmptyDirs: true,
        summary: f_Summary(),
        entries: f_Entries(9),
        dirChanges: [],
        warnings: [],
        planToken: "a".repeat(32),
        excludeHash: "0".repeat(32),
        ...over,
    };
}

function f_Plan(over: Partial<typRunPlan> = {}): typRunPlan {
    return {
        sourceFiles: 8,
        destFiles: 3,
        createFiles: 6,
        updateFiles: 1,
        deleteFiles: 0,
        transferBytes: 51_200,
        deleteBytes: 0,
        conflictFiles: 0,
        caseOnlyFiles: 0,
        createDirs: 0,
        deleteDirs: 0,
        ...over,
    };
}

function f_Dry(over: Partial<itfDryRunSummary> = {}): itfDryRunSummary {
    return {
        copyFiles: 7,
        copyBytes: 51_200,
        deleteFiles: 0,
        deleteBytes: 0,
        touchFiles: 0,
        removeDirs: 0,
        copySamples: [],
        deleteSamples: [],
        touchSamples: [],
        ...over,
    };
}

function f_Last(over: Partial<itfStepLastRun["record"]> = {}, dry: itfDryRunSummary | null = null) {
    const record: itfStepLastRun["record"] = {
        jobId: JOB,
        dryRun: true,
        mode: "copy",
        status: "success",
        startedAt: f_Iso(5_000),
        durationMs: 72_000,
        plan: f_Plan(),
        ...over,
    };
    return { record, dryRunSummary: dry ?? (record.dryRun ? f_Dry() : null) };
}

const STALE = "비교한 지 11분 지났습니다. 실행 전 다시 비교하세요.";

describe("relativeTimeText", () => {
    it("1분 안이면 ‘방금’", () => {
        expect(relativeTimeText(ISO0, T0 + 30_000)).toBe("방금");
        expect(relativeTimeText(ISO0, T0 + 59_900)).toBe("방금");
    });

    it("60분 안이면 ‘N분 전’", () => {
        expect(relativeTimeText(ISO0, T0 + 3 * 60_000)).toBe("3분 전");
        expect(relativeTimeText(ISO0, T0 + 59 * 60_000)).toBe("59분 전");
    });

    it("60분 이상이면 로컬 시각", () => {
        expect(relativeTimeText(ISO0, T0 + 60 * 60_000)).toBe(formatLocalDateTime(ISO0));
    });

    it("미래 시각(시계 차)은 ‘방금’", () => {
        expect(relativeTimeText(ISO0, T0 - 5 * 60_000)).toBe("방금");
    });
});

describe("freshPreview", () => {
    const compare = f_Result();

    it("다른 작업·실제 실행은 null", () => {
        expect(freshPreview({ jobId: JOB, compare, last: f_Last({ jobId: OTHER }) })).toBeNull();
        expect(freshPreview({ jobId: JOB, compare, last: f_Last({ dryRun: false }) })).toBeNull();
    });

    it("비교보다 먼저 시작한 미리보기는 null, 같거나 뒤면 그 실행", () => {
        expect(
            freshPreview({ jobId: JOB, compare, last: f_Last({ startedAt: f_Iso(-1) }) }),
        ).toBeNull();
        const same = f_Last({ startedAt: ISO0 });
        expect(freshPreview({ jobId: JOB, compare, last: same })).toBe(same);
        const after = f_Last();
        expect(freshPreview({ jobId: JOB, compare, last: after })).toBe(after);
    });

    it("비교 결과가 없으면 null", () => {
        expect(freshPreview({ jobId: JOB, compare: null, last: f_Last() })).toBeNull();
    });
});

describe("previewNotice", () => {
    const compare = f_Result();

    it("비교 결과가 없으면 null", () => {
        expect(previewNotice({ jobId: JOB, compare: null, run: null, last: f_Last() })).toBeNull();
    });

    it("미리보기 진행 중 → info", () => {
        const run = { jobId: JOB, dryRun: true, stats: null, phase: "transferring" as const };
        expect(previewNotice({ jobId: JOB, compare, run, last: null })?.tone).toBe("info");
    });

    it("일치 → success, 불일치 → warning, 실패 → danger", () => {
        expect(previewNotice({ jobId: JOB, compare, run: null, last: f_Last() })).toEqual({
            tone: "success",
            text: "미리보기가 비교 결과와 같은 일을 합니다.",
        });
        const mismatch = f_Last({ plan: f_Plan({ deleteFiles: 3 }) });
        expect(previewNotice({ jobId: JOB, compare, run: null, last: mismatch })?.tone).toBe(
            "warning",
        );
        const failed = previewNotice({
            jobId: JOB,
            compare,
            run: null,
            last: f_Last({ status: "failed" }),
        });
        expect(failed?.tone).toBe("danger");
        expect(failed?.text).toContain("미리보기 실패");
    });

    it("새 미리보기 없음·오래된 미리보기만 → 권장 문구", () => {
        const hint = "미리보기로 rclone이 실제로 할 일을 한 번 확인할 수 있습니다.";
        expect(previewNotice({ jobId: JOB, compare, run: null, last: null })?.text).toBe(hint);
        const old = f_Last({ startedAt: f_Iso(-60_000) });
        expect(previewNotice({ jobId: JOB, compare, run: null, last: old })?.text).toBe(hint);
    });
});

describe("runBarText", () => {
    const job = { source: "C:\\tmp\\src", destination: "D:\\tmp\\dst", mode: "copy" as const };
    const base = { job, staleReason: null, maxAgeMinutes: 10, nowMs: T0 + 1_000, lastReal: null };

    it("copy 결과: 총 꼬리 없는 문장, 크기·비교 시각", () => {
        const t = runBarText({ ...base, compare: f_Result() });
        expect(t.headline).toBe("대상에 6개 복사, 1개 덮어씀");
        expect(t.detail).toContain("비교 방금(10분 지나면 다시 비교)");
        expect(t.detail).toContain(formatBytes(51_200));
        expect(t.detail).toContain("C:\\tmp\\src → D:\\tmp\\dst");
    });

    it("sync 삭제 포함", () => {
        const t = runBarText({
            ...base,
            job: { ...job, mode: "sync" },
            compare: f_Result({ mode: "sync" }),
        });
        expect(t.headline).toContain("1개 삭제");
    });

    it("낡음이면 끝을 낡음 이유로 바꾼다", () => {
        const t = runBarText({ ...base, staleReason: STALE, compare: f_Result() });
        expect(t.detail).toContain(STALE);
        expect(t.detail).not.toContain("지나면 다시 비교");
    });

    it("바뀔 것이 없으면 그렇게 말한다", () => {
        const t = runBarText({
            ...base,
            compare: f_Result({ summary: f_Summary({ createFiles: 0, updateFiles: 0 }) }),
        });
        expect(t.headline).toBe("바뀌는 파일이 없습니다.");
    });

    it("긴 경로는 가운데를 줄인다", () => {
        const long = `C:\\${"a".repeat(80)}\\src`;
        const t = runBarText({ ...base, job: { ...job, source: long }, compare: f_Result() });
        expect(t.detail).not.toContain(long);
        expect(t.detail).toContain("…");
    });

    it("결과 없음: 실제 실행 결과 또는 비교 전 안내", () => {
        const real = runBarText({
            ...base,
            compare: null,
            lastReal: f_Last({ dryRun: false }),
        });
        expect(real.headline).toBe("복사 완료");
        expect(real.detail).toContain("‘이력’");
        const none = runBarText({ ...base, compare: null });
        expect(none.headline).toBe("비교 전에는 실행할 수 없습니다");
    });
});

/** 비교·실행 없음, 결과 없음일 때 */
function f_IdlePanel(last: itfStepLastRun) {
    return runPanelShown({
        jobId: JOB,
        run: null,
        comparing: false,
        compareCreatedAt: null,
        startError: null,
        last,
    });
}

describe("runPanelShown", () => {
    const real = { jobId: JOB, dryRun: false };

    it("이 작업 실제 실행 중이면 true (비교 결과가 있어도)", () => {
        expect(
            runPanelShown({
                jobId: JOB,
                run: real,
                comparing: false,
                compareCreatedAt: ISO0,
                startError: null,
                last: null,
            }),
        ).toBe(true);
    });

    it("이 작업 미리보기 중이면 false", () => {
        expect(
            runPanelShown({
                jobId: JOB,
                run: { ...real, dryRun: true },
                comparing: false,
                compareCreatedAt: ISO0,
                startError: null,
                last: null,
            }),
        ).toBe(false);
    });

    it("비교 중·결과 있음은 false", () => {
        const lastReal = f_Last({ dryRun: false });
        expect(
            runPanelShown({
                jobId: JOB,
                run: null,
                comparing: true,
                compareCreatedAt: null,
                startError: null,
                last: lastReal,
            }),
        ).toBe(false);
        expect(
            runPanelShown({
                jobId: JOB,
                run: null,
                comparing: false,
                compareCreatedAt: ISO0,
                startError: null,
                last: lastReal,
            }),
        ).toBe(false);
    });

    it("결과 없음: 이 작업 마지막 실제 실행이면 true, 다른 작업·미리보기면 false", () => {
        expect(f_IdlePanel(f_Last({ dryRun: false }))).toBe(true);
        expect(f_IdlePanel(f_Last({ dryRun: false, jobId: OTHER }))).toBe(false);
        expect(f_IdlePanel(f_Last())).toBe(false);
    });

    it("이 작업 실제 실행 시작 오류가 비교 결과 뒤에 났으면 true, 미리보기·다른 작업·옛 오류는 아님", () => {
        const base = {
            jobId: JOB,
            run: null,
            comparing: false,
            compareCreatedAt: ISO0,
            last: null,
        };
        const err = { jobId: JOB, dryRun: false, at: f_Iso(1_000) };
        expect(runPanelShown({ ...base, startError: err })).toBe(true);
        expect(runPanelShown({ ...base, compareCreatedAt: null, startError: err })).toBe(true);
        expect(runPanelShown({ ...base, startError: { ...err, dryRun: true } })).toBe(false);
        expect(runPanelShown({ ...base, startError: { ...err, jobId: OTHER } })).toBe(false);
        expect(runPanelShown({ ...base, startError: { ...err, at: f_Iso(-1_000) } })).toBe(false);
        expect(runPanelShown({ ...base, comparing: true, startError: err })).toBe(false);
    });
});

describe("syncButtonText", () => {
    const job = { source: "C:\\tmp\\src", destination: "D:\\tmp\\dst", mode: "sync" as const };
    const base = {
        job,
        staleReason: null,
        maxAgeMinutes: 10,
        nowMs: T0 + 1_000,
        lastReal: null,
        realReady: true,
    };

    it("비교 결과가 없으면 꺼지고 비교를 안내한다", () => {
        expect(syncButtonText({ ...base, compare: null })).toEqual({
            label: "동기화 — 먼저 [비교]를 누르세요",
            disabled: true,
        });
    });

    it("비교 결과가 있으면 일어날 일을 붙이고 실행 가능 여부를 따른다", () => {
        const compare = f_Result({
            mode: "sync",
            summary: f_Summary({ createFiles: 1, updateFiles: 1, deleteFiles: 1 }),
        });
        expect(syncButtonText({ ...base, compare })).toEqual({
            label: "동기화: 대상에 1개 복사, 1개 덮어씀, 1개 삭제",
            disabled: false,
        });
        expect(syncButtonText({ ...base, compare, realReady: false }).disabled).toBe(true);
    });

    it("바뀔 것이 없으면 그렇게 말한다", () => {
        const compare = f_Result({
            summary: f_Summary({ createFiles: 0, updateFiles: 0, deleteFiles: 0 }),
        });
        expect(syncButtonText({ ...base, compare }).label).toBe("동기화: 바뀔 것 없음");
    });
});

describe("planFooterText", () => {
    it("비교 결과가 없으면 null", () => {
        expect(planFooterText({ compare: null, staleReason: null })).toBeNull();
    });

    it("비교 시각·걸린 시간과 계획 상태를 적는다", () => {
        const text = planFooterText({ compare: f_Result(), staleReason: null });
        expect(text).toContain("비교 ");
        expect(text).toContain(formatDuration(300));
        expect(text).toContain("이 비교 결과로 동기화할 수 있습니다");
    });

    it("낡았으면 다시 비교 안내를 쓴다", () => {
        const text = planFooterText({ compare: f_Result(), staleReason: STALE });
        expect(text).toContain(STALE);
        expect(text).not.toContain("이 비교 결과로 동기화할 수 있습니다");
    });

    it("바뀔 것이 없으면 그렇게 말한다", () => {
        const text = planFooterText({
            compare: f_Result({
                summary: f_Summary({ createFiles: 0, updateFiles: 0, deleteFiles: 0 }),
            }),
            staleReason: null,
        });
        expect(text).toContain("바뀔 것 없음");
    });
});
