// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    freshPreview,
    jobSteps,
    previewNotice,
    relativeTimeText,
    runBarText,
    workMainPanel,
    type itfJobStepsInput,
    type itfStepLastRun,
} from "@/lib/job-steps";
import { formatBytes, formatLocalDateTime } from "@/shared/format";
import type { typRunPlan, typRunStats } from "@/shared/schemas/run";
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

function f_Stats(over: Partial<typRunStats> = {}): typRunStats {
    return {
        bytes: 42,
        totalBytes: 100,
        transfers: 0,
        totalTransfers: 0,
        deletes: 0,
        deletedDirs: 0,
        checks: 0,
        totalChecks: 0,
        listed: 0,
        errors: 0,
        speedBps: null,
        etaSeconds: null,
        partialFiles: 0,
        etaPending: false,
        elapsedMs: 0,
        fatalError: false,
        lastError: null,
        ...over,
    };
}

function f_In(over: Partial<itfJobStepsInput> = {}): itfJobStepsInput {
    return {
        jobId: JOB,
        mode: "copy",
        comparing: false,
        compare: null,
        staleReason: null,
        run: null,
        last: null,
        realReady: false,
        nowMs: T0 + 10_000,
        ...over,
    };
}

function f_States(i: itfJobStepsInput): string[] {
    return jobSteps(i).map((s) => `${s.state}:${s.note}`);
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

describe("jobSteps", () => {
    const compare = f_Result();

    it("결과 없음·활동 없음", () => {
        expect(f_States(f_In())).toEqual([
            "current:원본·대상 목록 읽기",
            "pending:선택 · 권장",
            "pending:비교 후 가능",
        ]);
    });

    it("비교 중", () => {
        expect(f_States(f_In({ comparing: true }))).toEqual([
            "running:목록 읽는 중",
            "pending:선택 · 권장",
            "pending:비교 후 가능",
        ]);
    });

    it("결과 있음·새 미리보기 없음 (실행 가능 여부에 따라 ③ 문구)", () => {
        expect(f_States(f_In({ compare, realReady: true }))).toEqual([
            "done:방금 · 9개 확인",
            "current:선택 · 권장",
            "pending:미리보기 후 권장",
        ]);
        expect(f_States(f_In({ compare }))[2]).toBe("pending:실행할 수 없음");
    });

    it("결과 낡음", () => {
        expect(f_States(f_In({ compare, staleReason: STALE, realReady: false }))).toEqual([
            "current:다시 비교 필요",
            "pending:선택 · 권장",
            "pending:비교 후 가능",
        ]);
    });

    it("미리보기 진행 중", () => {
        const run = { jobId: JOB, dryRun: true, stats: null, phase: "transferring" as const };
        expect(f_States(f_In({ compare, run, realReady: false }))).toEqual([
            "done:방금 · 9개 확인",
            "running:미리보기 중",
            "pending:미리보기 후 권장",
        ]);
    });

    it("새 미리보기 성공·일치", () => {
        expect(f_States(f_In({ compare, last: f_Last(), realReady: true }))).toEqual([
            "done:방금 · 9개 확인",
            "done:계획과 일치",
            "current:준비됨",
        ]);
        expect(f_States(f_In({ compare, last: f_Last(), realReady: false }))[2]).toBe(
            "pending:실행할 수 없음",
        );
    });

    it("새 미리보기 성공·불일치", () => {
        const last = f_Last({ plan: f_Plan({ deleteFiles: 2 }) });
        expect(f_States(f_In({ compare, last, realReady: true }))).toEqual([
            "done:방금 · 9개 확인",
            "current:계획과 다름 · 다시 비교",
            "pending:다시 비교 권장",
        ]);
        expect(f_States(f_In({ compare, last, realReady: false }))[2]).toBe(
            "pending:실행할 수 없음",
        );
        expect(previewNotice(f_In({ compare, last }))).toEqual({
            tone: "warning",
            text: "미리보기가 비교 결과와 다릅니다. 다시 비교하세요.",
        });
    });

    it("새 미리보기 실패", () => {
        const last = f_Last({ status: "failed" });
        expect(f_States(f_In({ compare, last, realReady: true }))).toEqual([
            "done:방금 · 9개 확인",
            "current:미리보기 실패",
            "pending:미리보기 후 권장",
        ]);
    });

    it("실제 실행 진행 중: 진행률·사전 확인·진행 중", () => {
        const base = {
            jobId: JOB,
            dryRun: false,
            stats: f_Stats(),
            phase: "transferring" as const,
        };
        expect(f_States(f_In({ compare, run: base }))).toEqual([
            "done:방금 · 9개 확인",
            "pending:건너뜀",
            "running:42%",
        ]);
        expect(f_States(f_In({ compare, run: base, last: f_Last() }))[1]).toBe("done:계획과 일치");
        const unknown = { ...f_Last(), dryRunSummary: null };
        expect(f_States(f_In({ compare, run: base, last: unknown }))[1]).toBe("done:미리보기 완료");
        expect(f_States(f_In({ run: { ...base, stats: null } }))).toEqual([
            "done:실행에 사용",
            "pending:건너뜀",
            "running:진행 중",
        ]);
        expect(f_States(f_In({ run: { ...base, phase: "preflight" } }))[2]).toBe(
            "running:사전 확인 중",
        );
    });

    it("실제 실행 비교 중(자동 실행·OS 예약): 옛 비교·미리보기를 쓰지 않는다", () => {
        const run = { jobId: JOB, dryRun: false, stats: null, phase: "comparing" as const };
        expect(f_States(f_In({ compare, run, last: f_Last(), realReady: true }))).toEqual([
            "running:목록 읽는 중",
            "pending:",
            "pending:비교 후 실행",
        ]);
    });

    it("실제 실행 준비 중(validating): ① 준비 중, ②③ 대기", () => {
        const run = { jobId: JOB, dryRun: false, stats: null, phase: "validating" as const };
        expect(f_States(f_In({ compare, run, last: f_Last() }))).toEqual([
            "running:준비 중",
            "pending:",
            "pending:비교 후 실행",
        ]);
        expect(f_States(f_In({ run }))[0]).toBe("running:준비 중");
    });

    it("결과 없음 + 마지막 실제 실행 성공 → 다시 비교, ③ 완료", () => {
        const last = f_Last({ dryRun: false, startedAt: ISO0 });
        expect(f_States(f_In({ last }))).toEqual([
            "current:다시 비교",
            "pending:",
            "done:방금 · 1분 12초",
        ]);
    });

    it("결과 없음 + 마지막 실제 실행 실패 → ③ 상태 문구", () => {
        const last = f_Last({ dryRun: false, status: "failed" });
        expect(f_States(f_In({ last }))).toEqual([
            "current:다시 비교",
            "pending:",
            "pending:복사 실패",
        ]);
    });

    it("불변식: current+running ≤ 1, 레이블·id 순서 고정", () => {
        const runReal = { jobId: JOB, dryRun: false, stats: null, phase: "transferring" as const };
        const runDry = { ...runReal, dryRun: true };
        const cases: itfJobStepsInput[] = [
            f_In(),
            f_In({ comparing: true }),
            f_In({ compare }),
            f_In({ compare, realReady: true }),
            f_In({ compare, staleReason: STALE }),
            f_In({ compare, run: runDry }),
            f_In({ run: runDry }),
            f_In({ compare, last: f_Last(), realReady: true }),
            f_In({ compare, last: f_Last({ plan: f_Plan({ createFiles: 1 }) }) }),
            f_In({ compare, last: f_Last({ status: "canceled" }) }),
            f_In({ compare, run: runReal }),
            f_In({ compare, run: { ...runReal, phase: "comparing" }, last: f_Last() }),
            f_In({ compare, run: { ...runReal, phase: "validating" } }),
            f_In({ last: f_Last({ dryRun: false }) }),
            f_In({ last: f_Last({ dryRun: false, status: "partial" }) }),
        ];
        for (const c of cases) {
            const steps = jobSteps(c);
            const active = steps.filter((s) => s.state === "current" || s.state === "running");
            expect(active.length).toBeLessThanOrEqual(1);
            expect(steps.map((s) => s.label)).toEqual(["비교", "미리보기", "실행"]);
            expect(steps.map((s) => s.id)).toEqual(["compare", "preview", "run"]);
        }
    });

    it("다른 작업의 실행·마지막 실행은 무시한다", () => {
        const run = {
            jobId: OTHER,
            dryRun: false,
            stats: f_Stats(),
            phase: "transferring" as const,
        };
        const steps = jobSteps(f_In({ compare, run, last: f_Last({ jobId: OTHER }) }));
        expect(steps.some((s) => s.state === "running")).toBe(false);
        expect(steps[1].state).toBe("current");
    });

    it("항목 수는 ko-KR 구분자로 쓴다", () => {
        const big = f_Result({ entries: f_Entries(1231) });
        expect(jobSteps(f_In({ compare: big }))[0].note).toBe("방금 · 1,231개 확인");
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

/** 비교·실행 없음, 결과 없음일 때 오른쪽 열 */
function f_IdlePanel(last: itfStepLastRun) {
    return workMainPanel({
        jobId: JOB,
        run: null,
        comparing: false,
        compareCreatedAt: null,
        startError: null,
        last,
    });
}

describe("workMainPanel", () => {
    const real = { jobId: JOB, dryRun: false };

    it("이 작업 실제 실행 중이면 run (비교 결과가 있어도)", () => {
        expect(
            workMainPanel({
                jobId: JOB,
                run: real,
                comparing: false,
                compareCreatedAt: ISO0,
                startError: null,
                last: null,
            }),
        ).toBe("run");
    });

    it("이 작업 미리보기 중이면 compare", () => {
        expect(
            workMainPanel({
                jobId: JOB,
                run: { ...real, dryRun: true },
                comparing: false,
                compareCreatedAt: ISO0,
                startError: null,
                last: null,
            }),
        ).toBe("compare");
    });

    it("비교 중·결과 있음은 compare", () => {
        const lastReal = f_Last({ dryRun: false });
        expect(
            workMainPanel({
                jobId: JOB,
                run: null,
                comparing: true,
                compareCreatedAt: null,
                startError: null,
                last: lastReal,
            }),
        ).toBe("compare");
        expect(
            workMainPanel({
                jobId: JOB,
                run: null,
                comparing: false,
                compareCreatedAt: ISO0,
                startError: null,
                last: lastReal,
            }),
        ).toBe("compare");
    });

    it("결과 없음: 이 작업 마지막 실제 실행이면 run, 다른 작업·미리보기면 compare", () => {
        expect(f_IdlePanel(f_Last({ dryRun: false }))).toBe("run");
        expect(f_IdlePanel(f_Last({ dryRun: false, jobId: OTHER }))).toBe("compare");
        expect(f_IdlePanel(f_Last())).toBe("compare");
    });

    it("이 작업 실제 실행 시작 오류가 비교 결과 뒤에 났으면 run, 미리보기·다른 작업·옛 오류는 아님", () => {
        const base = {
            jobId: JOB,
            run: null,
            comparing: false,
            compareCreatedAt: ISO0,
            last: null,
        };
        const err = { jobId: JOB, dryRun: false, at: f_Iso(1_000) };
        expect(workMainPanel({ ...base, startError: err })).toBe("run");
        expect(workMainPanel({ ...base, compareCreatedAt: null, startError: err })).toBe("run");
        expect(workMainPanel({ ...base, startError: { ...err, dryRun: true } })).toBe("compare");
        expect(workMainPanel({ ...base, startError: { ...err, jobId: OTHER } })).toBe("compare");
        expect(workMainPanel({ ...base, startError: { ...err, at: f_Iso(-1_000) } })).toBe(
            "compare",
        );
        expect(workMainPanel({ ...base, comparing: true, startError: err })).toBe("compare");
    });
});
