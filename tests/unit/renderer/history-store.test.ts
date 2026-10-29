// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import type { typRunRecord } from "@/shared/schemas/run";
import { useHistoryStore } from "@/stores/history-store";
import { useToastStore } from "@/stores/toast-store";
import { createFakeApi, fakeUuid, type itfFakeApi } from "./fake-api";

const J1 = fakeUuid(1);
const J2 = fakeUuid(2);
let fake: itfFakeApi;

function f_Rec(n: number, over: Partial<typRunRecord> = {}): typRunRecord {
    return {
        id: fakeUuid(9000 + n),
        jobId: J1,
        jobName: "작업",
        mode: "copy",
        dryRun: false,
        trigger: "manual",
        status: "success",
        phase: "finalizing",
        startedAt: "2026-10-29T00:00:00.000Z",
        finishedAt: "2026-10-29T00:00:01.000Z",
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
    return useHistoryStore.getState();
}

function f_Flush(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
    useHistoryStore.setState(useHistoryStore.getInitialState(), true);
    useToastStore.setState(useToastStore.getInitialState(), true);
    fake = createFakeApi();
    vi.stubGlobal("window", { rclonegui: fake.api });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("history-store", () => {
    it("load: 작업별로 받는다(jobId·limit), 작업을 바꾸면 선택·로그를 비운다", async () => {
        fake.setHistory([f_Rec(1), f_Rec(2, { jobId: J2 })]);
        await f_S().load(J1);
        expect(f_S().records.map((r) => r.id)).toEqual([fakeUuid(9001)]);
        expect(fake.historyQueries.at(-1)).toMatchObject({ jobId: J1 });
        fake.setLogView(fakeUuid(9001), {
            fileName: "run-x.log",
            exists: true,
            sizeBytes: 3,
            truncated: false,
            lines: [],
        });
        await f_S().select(fakeUuid(9001));
        expect(f_S().log?.exists).toBe(true);
        await f_S().load(J2);
        expect(f_S()).toMatchObject({ jobId: J2, selectedId: null, log: null });
        expect(f_S().records.map((r) => r.jobId)).toEqual([J2]);
    });

    it("select: 로그 실패는 logError, null이면 닫는다", async () => {
        fake.setHistory([f_Rec(1)]);
        await f_S().load(J1);
        await f_S().select(fakeUuid(9001));
        expect(f_S().logError).not.toBeNull();
        await f_S().select(null);
        expect(f_S()).toMatchObject({ selectedId: null, logError: null });
    });

    it("늦게 도착한 이전 작업의 목록은 반영하지 않는다", async () => {
        fake.setHistory([f_Rec(1), f_Rec(2, { jobId: J2 })]);
        const first = f_S().load(J1);
        const second = f_S().load(J2);
        await Promise.all([first, second]);
        expect(f_S().records.map((r) => r.jobId)).toEqual([J2]);
    });

    it("run:event finished(같은 작업)면 다시 받는다", async () => {
        fake.setHistory([f_Rec(1)]);
        await f_S().load(J1);
        const off = f_S().subscribe();
        fake.setHistory([f_Rec(2), f_Rec(1)]);
        fake.emitRunEvent({
            type: "finished",
            runId: fakeUuid(9002),
            record: f_Rec(2),
            dryRunSummary: null,
        });
        await f_Flush();
        expect(f_S().records).toHaveLength(2);
        const before = fake.historyQueries.length;
        fake.emitRunEvent({
            type: "finished",
            runId: fakeUuid(9003),
            record: f_Rec(3, { jobId: J2 }),
            dryRunSummary: null,
        });
        await f_Flush();
        expect(fake.historyQueries).toHaveLength(before);
        off();
    });

    it("clear: 성공 토스트(로그 삭제 여부 문구)·다시 받기, BUSY는 경고 토스트·false", async () => {
        fake.setHistory([f_Rec(1), f_Rec(2, { status: "running" })]);
        await f_S().load(J1);
        expect(await f_S().clear(false)).toBe(true);
        expect(fake.calls).toContain("history.clear:false");
        expect(useToastStore.getState().toasts.at(-1)?.message).toContain("로그 파일은 남겨");
        expect(f_S().records.map((r) => r.status)).toEqual(["running"]);
        fake.setHistoryClearError({
            code: "BUSY",
            message: "실행 중에는 이력을 지울 수 없습니다.",
        });
        expect(await f_S().clear(true)).toBe(false);
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ level: "warning" });
    });
});
