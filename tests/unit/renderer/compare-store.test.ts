// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { emptySummary } from "@/shared/diff-engine";
import type { itfCompareResult } from "@/shared/types/compare";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { useToastStore } from "@/stores/toast-store";
import { createFakeApi, fakeUuid, type itfFakeApi } from "./fake-api";

const J1 = fakeUuid(1);
const J2 = fakeUuid(2);
let fake: itfFakeApi;

function f_Result(jobId: string, sourceFiles = 1): itfCompareResult {
    return {
        jobId,
        jobRev: 0,
        createdAt: "2026-10-28T00:00:00.000Z",
        durationMs: 1,
        mode: "copy",
        method: { checkHashes: false, modtimeToleranceMs: 2000, caseInsensitive: true },
        destMissing: false,
        summary: { ...emptySummary(), sourceFiles },
        entries: [],
        warnings: [],
        planToken: "0".repeat(32),
    };
}

function f_S() {
    return useCompareStore.getState();
}

/** 대기 중인 microtask를 비운다 */
function f_Flush(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
    useCompareStore.setState(useCompareStore.getInitialState(), true);
    useToastStore.setState(useToastStore.getInitialState(), true);
    fake = createFakeApi();
    vi.stubGlobal("window", { rclonegui: fake.api });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("compare-store run", () => {
    it("성공 → result, runningJobId 해제", async () => {
        const shown = f_S().show(J1);
        fake.compareGetResolvers[0]!.resolve(null);
        await shown;
        const pending = f_S().run(J1);
        expect(f_S().runningJobId).toBe(J1);
        expect(runningCompare(f_S().active, f_S().runningJobId)?.jobId).toBe(J1);
        fake.compareRunResolvers[0]!.resolve({ ok: true, data: f_Result(J1) });
        await pending;
        expect(f_S().result?.jobId).toBe(J1);
        expect(f_S().runningJobId).toBeNull();
        expect(f_S().error).toBeNull();
    });

    it("실패 → error + 오류 토스트, CANCELED → 안내 토스트", async () => {
        void f_S().show(J1);
        const p1 = f_S().run(J1);
        fake.compareRunResolvers[0]!.resolve({
            ok: false,
            error: { code: "RCLONE_FAILED", message: "원본 목록을 읽지 못했습니다" },
        });
        await p1;
        expect(f_S().error?.code).toBe("RCLONE_FAILED");
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ level: "error" });

        const p2 = f_S().run(J1);
        fake.compareRunResolvers[1]!.resolve({
            ok: false,
            error: { code: "CANCELED", message: "취소" },
        });
        await p2;
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
            level: "info",
            message: "비교를 취소했습니다.",
        });
    });

    it("BUSY는 결과를 지우지 않고 경고 토스트만", async () => {
        useCompareStore.setState({ jobId: J1, result: f_Result(J1) });
        const p = f_S().run(J1);
        fake.compareRunResolvers[0]!.resolve({
            ok: false,
            error: { code: "BUSY", message: "다른 작업을 비교하는 중입니다." },
        });
        await p;
        expect(f_S().result?.jobId).toBe(J1);
        expect(f_S().error).toBeNull();
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ level: "warning" });
    });

    it("다른 작업으로 바꾼 뒤 도착한 run 결과는 화면에 넣지 않는다", async () => {
        void f_S().show(J1);
        const p = f_S().run(J1);
        void f_S().show(J2);
        fake.compareRunResolvers[0]!.resolve({ ok: true, data: f_Result(J1) });
        await p;
        expect(f_S().jobId).toBe(J2);
        expect(f_S().result).toBeNull();
    });

    it("run 성공은 진행 중이던 compare:get(이전 결과)보다 우선한다", async () => {
        const shown = f_S().show(J1);
        const p = f_S().run(J1);
        fake.compareRunResolvers[0]!.resolve({ ok: true, data: f_Result(J1, 9) });
        await p;
        fake.compareGetResolvers[0]!.resolve(f_Result(J1, 1));
        await shown;
        expect(f_S().result?.summary.sourceFiles).toBe(9);
    });
});

describe("compare-store show", () => {
    it("빠른 전환 시 마지막 요청만 반영", async () => {
        const a = f_S().show(J1);
        const b = f_S().show(J2);
        expect(f_S().loading).toBe(true);
        fake.compareGetResolvers[1]!.resolve(f_Result(J2));
        await b;
        fake.compareGetResolvers[0]!.resolve(f_Result(J1));
        await a;
        expect(f_S().jobId).toBe(J2);
        expect(f_S().result?.jobId).toBe(J2);
        expect(f_S().loading).toBe(false);
    });

    it("작업 전환 시 검색어만 비우고 필터는 유지", async () => {
        f_S().setView({ query: "abc", status: "modified" });
        void f_S().show(J1);
        expect(f_S().view).toMatchObject({ query: "", status: "modified" });
        f_S().setView({ query: "x" });
        void f_S().show(J1);
        expect(f_S().view.query).toBe("x");
    });

    it("null이면 IPC 없이 비운다", async () => {
        await f_S().show(null);
        expect(fake.calls).toEqual([]);
        expect(f_S()).toMatchObject({ jobId: null, result: null, loading: false });
    });
});

describe("compare-store 진행 이벤트", () => {
    it("subscribe 시 getActive로 복구, 진행 이벤트 → active", async () => {
        fake.setCompareActive({
            jobId: J2,
            phase: "list",
            startedAt: "2026-10-28T00:00:00.000Z",
            sourceFiles: 3,
            destFiles: 1,
        });
        const off = f_S().subscribe();
        await f_Flush();
        expect(f_S().active?.jobId).toBe(J2);
        fake.emitCompareProgress({
            jobId: J2,
            phase: "list",
            sourceFiles: 10,
            destFiles: 4,
            at: "2026-10-28T00:00:05.000Z",
        });
        expect(f_S().active).toMatchObject({
            sourceFiles: 10,
            startedAt: "2026-10-28T00:00:00.000Z",
        });
        fake.emitCompareProgress({
            jobId: J2,
            phase: "canceled",
            sourceFiles: 10,
            destFiles: 4,
            at: "2026-10-28T00:00:06.000Z",
        });
        expect(f_S().active).toBeNull();
        off();
    });

    it("done 이벤트(이 창이 기다리지 않던 비교) → 현재 작업이면 get 재호출", async () => {
        void f_S().show(J1);
        fake.compareGetResolvers[0]!.resolve(null);
        await f_Flush();
        const off = f_S().subscribe();
        fake.emitCompareProgress({
            jobId: J1,
            phase: "done",
            sourceFiles: 1,
            destFiles: 0,
            at: "2026-10-28T00:00:00.000Z",
        });
        expect(fake.calls.filter((c) => c === `compare.get:${J1}`)).toHaveLength(2);
        fake.compareGetResolvers[1]!.resolve(f_Result(J1));
        await f_Flush();
        expect(f_S().result?.jobId).toBe(J1);
        off();
    });

    it("cancel은 진행 중인 작업으로 compare:cancel", async () => {
        await f_S().cancel();
        expect(fake.calls).toEqual([]);
        void f_S().run(J1);
        await f_S().cancel();
        expect(fake.calls).toContain(`compare.cancel:${J1}`);
    });
});
