// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { emptySummary } from "@/shared/diff-engine";
import type { typRunRecord } from "@/shared/schemas/run";
import type { itfCompareResult } from "@/shared/types/compare";
import type { itfRunSnapshot } from "@/shared/types/run";
import { useCompareStore } from "@/stores/compare-store";
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useRunStore } from "@/stores/run-store";
import { useToastStore } from "@/stores/toast-store";
import { useUiStore } from "@/stores/ui-store";
import { createFakeApi, fakeUuid, makeJob, type itfFakeApi } from "./fake-api";

const J1 = fakeUuid(1);
const J2 = fakeUuid(2);
const RUN = fakeUuid(9001);
const TOKEN = "a".repeat(32);
let fake: itfFakeApi;

function f_Compare(jobId: string, mode: "copy" | "sync" = "copy"): itfCompareResult {
    return {
        jobId,
        jobRev: 0,
        createdAt: "2026-10-28T00:00:00.000Z",
        durationMs: 1,
        mode,
        method: { checkHashes: false, modtimeToleranceMs: 2000, caseInsensitive: true },
        destMissing: false,
        summary: { ...emptySummary(), createFiles: 2, deleteFiles: 3 },
        entries: [],
        warnings: [],
        planToken: TOKEN,
    };
}

function f_Snapshot(over: Partial<itfRunSnapshot> = {}): itfRunSnapshot {
    return {
        runId: RUN,
        jobId: J1,
        jobName: "작업",
        mode: "copy",
        dryRun: true,
        trigger: "manual",
        status: "running",
        phase: "validating",
        startedAt: "2026-10-28T00:00:00.000Z",
        stats: null,
        logFile: "run-x.log",
        tail: [],
        dryRunSummary: null,
        cancelRequested: false,
        ...over,
    };
}

function f_Record(over: Partial<typRunRecord> = {}): typRunRecord {
    return {
        id: RUN,
        jobId: J1,
        jobName: "작업",
        mode: "copy",
        dryRun: false,
        trigger: "manual",
        status: "success",
        phase: "finalizing",
        startedAt: "2026-10-28T00:00:00.000Z",
        finishedAt: "2026-10-28T00:00:01.000Z",
        durationMs: 1000,
        plan: null,
        preflight: null,
        stats: null,
        exitCode: 0,
        pid: 1,
        error: null,
        logFile: "run-x.log",
        ...over,
    };
}

function f_S() {
    return useRunStore.getState();
}

function f_CompareRuns(): string[] {
    return fake.calls.filter((c) => c.startsWith("compare.run"));
}

function f_Flush(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
    useRunStore.setState(useRunStore.getInitialState(), true);
    useCompareStore.setState(useCompareStore.getInitialState(), true);
    useToastStore.setState(useToastStore.getInitialState(), true);
    useJobsStore.setState(useJobsStore.getInitialState(), true);
    useJobEditorStore.setState(useJobEditorStore.getInitialState(), true);
    useUiStore.setState(useUiStore.getInitialState(), true);
    fake = createFakeApi();
    vi.stubGlobal("window", { rclonegui: fake.api });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("run-store start", () => {
    it("미리보기는 토큰 없이 보낸다", async () => {
        useCompareStore.setState({ jobId: J1, result: f_Compare(J1) });
        expect(await f_S().start(J1, true)).toBe(true);
        expect(fake.runStartInputs).toEqual([{ jobId: J1, dryRun: true }]);
        expect(f_S().startingJobId).toBeNull();
    });

    it("실제 실행은 그 작업의 비교 결과 토큰과 삭제 예정 수(copy는 0)를 보낸다", async () => {
        useCompareStore.setState({ jobId: J1, result: f_Compare(J1) });
        await f_S().start(J1, false);
        expect(fake.runStartInputs.at(-1)).toEqual({
            jobId: J1,
            dryRun: false,
            planToken: TOKEN,
            confirmedDeletes: 0,
        });
        useCompareStore.setState({ result: f_Compare(J1, "sync") });
        await f_S().start(J1, false);
        expect(fake.runStartInputs.at(-1)?.confirmedDeletes).toBe(3);
    });

    it("대량 삭제 확인은 confirmLargeDeletes:true로만 보낸다(false·없음은 키 없음)", async () => {
        useCompareStore.setState({ jobId: J1, result: f_Compare(J1, "sync") });
        await f_S().start(J1, false, { largeDeletes: true });
        expect(fake.runStartInputs.at(-1)).toEqual({
            jobId: J1,
            dryRun: false,
            planToken: TOKEN,
            confirmedDeletes: 3,
            confirmLargeDeletes: true,
        });
        await f_S().start(J1, false, { largeDeletes: false });
        expect(fake.runStartInputs.at(-1)).not.toHaveProperty("confirmLargeDeletes");
        await f_S().start(J1, true, { largeDeletes: true });
        expect(fake.runStartInputs.at(-1)).toEqual({ jobId: J1, dryRun: true });
    });

    it("다른 작업의 비교 결과는 쓰지 않는다", async () => {
        useCompareStore.setState({ jobId: J2, result: f_Compare(J2) });
        await f_S().start(J1, false);
        expect(fake.runStartInputs.at(-1)).toEqual({ jobId: J1, dryRun: false });
    });

    it("실패하면 error(작업별)와 토스트, BUSY는 경고", async () => {
        fake.setRunStartResult({ ok: false, error: { code: "BUSY", message: "바쁨" } });
        expect(await f_S().start(J1, true)).toBe(false);
        expect(f_S().error).toEqual({ jobId: J1, payload: { code: "BUSY", message: "바쁨" } });
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ level: "warning" });
        fake.setRunStartResult({
            ok: false,
            error: { code: "PLAN_REQUIRED", message: "먼저 비교" },
        });
        await f_S().start(J1, false);
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ level: "error" });
    });
});

describe("run-store 이벤트", () => {
    it("started → phase → stats → log → finished 순서로 반영", async () => {
        const off = f_S().subscribe();
        fake.emitRunEvent({ type: "started", snapshot: f_Snapshot() });
        expect(f_S().active?.runId).toBe(RUN);
        fake.emitRunEvent({ type: "phase", runId: RUN, phase: "transferring", at: "" });
        expect(f_S().active?.phase).toBe("transferring");
        const stats = { ...f_Record().stats, bytes: 1 } as never;
        fake.emitRunEvent({ type: "stats", runId: RUN, stats, at: "" });
        expect(f_S().active?.stats).toBe(stats);
        const line = { at: "2026-10-28T00:00:00.000Z", level: "info" as const, message: "Copied" };
        fake.emitRunEvent({ type: "log", runId: RUN, lines: [line, line], dropped: 5, at: "" });
        expect(f_S().active?.tail).toHaveLength(2);
        expect(f_S().dropped).toBe(5);
        // 다른 실행의 이벤트는 무시
        fake.emitRunEvent({ type: "phase", runId: fakeUuid(7), phase: "finalizing", at: "" });
        expect(f_S().active?.phase).toBe("transferring");
        fake.emitRunEvent({
            type: "finished",
            runId: RUN,
            record: f_Record({ dryRun: true }),
            dryRunSummary: null,
        });
        expect(f_S().active).toBeNull();
        expect(f_S().last?.tail).toHaveLength(2);
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
            level: "success",
            message: "미리보기 완료",
        });
        off();
    });

    it("자동 실행(trigger scheduler)이 끝나면 토스트를 띄우지 않는다(main이 app:notify로 알림)", () => {
        const off = f_S().subscribe();
        fake.emitRunEvent({
            type: "started",
            snapshot: f_Snapshot({ dryRun: false, trigger: "scheduler", phase: "comparing" }),
        });
        expect(f_S().active?.phase).toBe("comparing");
        fake.emitRunEvent({
            type: "finished",
            runId: RUN,
            record: f_Record({ trigger: "scheduler", status: "blocked" }),
            dryRunSummary: null,
        });
        expect(f_S().active).toBeNull();
        expect(f_S().last?.record.trigger).toBe("scheduler");
        expect(useToastStore.getState().toasts).toEqual([]);
        off();
    });

    it("실제 실행이 끝나면 보이는 작업의 비교 결과를 다시 불러온다(dry-run은 그대로)", async () => {
        const off = f_S().subscribe();
        useCompareStore.setState({ jobId: J1, result: f_Compare(J1) });
        fake.emitRunEvent({
            type: "finished",
            runId: RUN,
            record: f_Record({ dryRun: true }),
            dryRunSummary: null,
        });
        expect(fake.calls.filter((c) => c === `compare.get:${J1}`)).toHaveLength(0);
        fake.emitRunEvent({
            type: "finished",
            runId: RUN,
            record: f_Record(),
            dryRunSummary: null,
        });
        expect(fake.calls.filter((c) => c === `compare.get:${J1}`)).toHaveLength(1);
        expect(useCompareStore.getState().result).toBeNull();
        off();
    });

    it("PLAN_DRIFT로 막히면 driftNotice, dismissDrift로 닫는다. 다른 차단은 알리지 않는다", () => {
        const off = f_S().subscribe();
        fake.emitRunEvent({
            type: "finished",
            runId: RUN,
            record: f_Record({
                mode: "sync",
                status: "blocked",
                error: { code: "SAFETY_BLOCKED", message: "x" },
            }),
            dryRunSummary: null,
        });
        expect(f_S().driftNotice).toBeNull();
        const drift = f_Record({
            mode: "sync",
            status: "blocked",
            error: { code: "PLAN_DRIFT", message: "바뀜", detail: "삭제: 계획 1개, 미리보기 2개" },
        });
        fake.emitRunEvent({ type: "finished", runId: RUN, record: drift, dryRunSummary: null });
        expect(f_S().driftNotice).toEqual(drift);
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ level: "error" });
        f_S().dismissDrift();
        expect(f_S().driftNotice).toBeNull();
        off();
    });

    it("sync 취소 토스트는 복사·삭제를 되돌리지 않는다고 알리고, 사전 확인 중 취소는 덧붙이지 않는다", () => {
        const off = f_S().subscribe();
        fake.emitRunEvent({
            type: "finished",
            runId: RUN,
            record: f_Record({
                mode: "sync",
                status: "canceled",
                error: { code: "CANCELED", message: "실행을 취소했습니다." },
            }),
            dryRunSummary: null,
        });
        expect(useToastStore.getState().toasts.at(-1)?.message).toContain("되돌리지 않습니다");
        fake.emitRunEvent({
            type: "finished",
            runId: RUN,
            record: f_Record({
                mode: "sync",
                status: "canceled",
                error: { code: "CANCELED", message: "사전 확인 중 취소했습니다." },
            }),
            dryRunSummary: null,
        });
        expect(useToastStore.getState().toasts.at(-1)?.message).toBe("동기화 취소됨");
        off();
    });

    it("취소 결과 토스트에 부분 반영 안내", () => {
        const off = f_S().subscribe();
        fake.emitRunEvent({
            type: "finished",
            runId: RUN,
            record: f_Record({ status: "canceled" }),
            dryRunSummary: null,
        });
        expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
            "이미 복사된 파일은 대상에 남습니다",
        );
        off();
    });

    it("subscribe 때 getActive로 진행 중 실행을 복구한다", async () => {
        fake.setRunActive(f_Snapshot({ phase: "transferring" }));
        const off = f_S().subscribe();
        await f_Flush();
        expect(f_S().active?.phase).toBe("transferring");
        off();
    });
});

describe("run-store cancel", () => {
    it("진행 중이면 한 번만 run.cancel, 없으면 아무것도 하지 않는다", async () => {
        await f_S().cancel();
        expect(fake.calls.filter((c) => c.startsWith("run.cancel"))).toEqual([]);
        useRunStore.setState({ active: f_Snapshot() });
        await f_S().cancel();
        await f_S().cancel();
        expect(fake.calls.filter((c) => c.startsWith("run.cancel"))).toEqual([`run.cancel:${RUN}`]);
        expect(f_S().active?.cancelRequested).toBe(true);
    });
});

describe("run-store recompareDrift (다시 비교)", () => {
    const DRIFT = f_Record({
        mode: "sync",
        status: "blocked",
        error: { code: "PLAN_DRIFT", message: "바뀜" },
    });

    /** 막힌 작업 J1과 지금 보고 있는 작업 J2(작업 설정 탭) */
    function f_Setup() {
        const j1 = makeJob({ id: J1, name: "작업" });
        const j2 = makeJob({ id: J2, name: "다른 작업" });
        useJobsStore.setState({ jobs: [j1, j2], selectedJobId: J2 });
        useJobEditorStore.getState().openJob(j2);
        useUiStore.setState({ view: "job", tab: "edit" });
        useRunStore.setState({ driftNotice: DRIFT });
    }

    it("다른 작업을 보고 있어도 막힌 작업을 선택하고 비교 탭으로 옮긴 뒤 그 작업을 비교한다", () => {
        f_Setup();
        f_S().recompareDrift();
        expect(f_S().driftNotice).toBeNull();
        expect(useJobsStore.getState().selectedJobId).toBe(J1);
        expect(useUiStore.getState()).toMatchObject({ view: "job", tab: "compare" });
        expect(f_CompareRuns()).toEqual([`compare.run:${J1}`]);
    });

    it("다른 작업에 저장하지 않은 변경이 있으면 버리기 확인 → 취소는 그대로 / 확인하면 옮겨서 비교", () => {
        f_Setup();
        useJobEditorStore.getState().setField("name", "편집 중");
        f_S().recompareDrift();
        expect(f_S().driftNotice).toBeNull();
        expect(useJobEditorStore.getState().pendingAction).not.toBeNull();
        expect(useJobsStore.getState().selectedJobId).toBe(J2);
        expect(useUiStore.getState().tab).toBe("edit");
        expect(f_CompareRuns()).toEqual([]);
        useJobEditorStore.getState().cancelDiscard();
        expect(useJobEditorStore.getState().draft?.name).toBe("편집 중");
        expect(f_CompareRuns()).toEqual([]);

        useRunStore.setState({ driftNotice: DRIFT });
        f_S().recompareDrift();
        useJobEditorStore.getState().confirmDiscard();
        expect(useJobsStore.getState().selectedJobId).toBe(J1);
        expect(useUiStore.getState().tab).toBe("compare");
        expect(f_CompareRuns()).toEqual([`compare.run:${J1}`]);
    });

    it("설정 화면에 저장하지 않은 변경이 있으면 설정 떠나기 확인을 먼저 거친다", () => {
        f_Setup();
        useUiStore.setState({ view: "settings", settingsDirty: true });
        f_S().recompareDrift();
        expect(useUiStore.getState().pendingLeave).not.toBeNull();
        expect(f_CompareRuns()).toEqual([]);
        useUiStore.getState().confirmLeave();
        expect(useUiStore.getState()).toMatchObject({ view: "job", tab: "compare" });
        expect(useJobsStore.getState().selectedJobId).toBe(J1);
        expect(f_CompareRuns()).toEqual([`compare.run:${J1}`]);
    });

    it("막힌 작업이 지워졌으면 비교하지 않고 알린다. 안내가 없으면 아무것도 하지 않는다", () => {
        f_Setup();
        useJobsStore.setState({ jobs: useJobsStore.getState().jobs.filter((j) => j.id !== J1) });
        f_S().recompareDrift();
        expect(f_S().driftNotice).toBeNull();
        expect(useJobsStore.getState().selectedJobId).toBe(J2);
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ level: "warning" });
        expect(f_CompareRuns()).toEqual([]);
        f_S().recompareDrift();
        expect(f_CompareRuns()).toEqual([]);
    });
});
