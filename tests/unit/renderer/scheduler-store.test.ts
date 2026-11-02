// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { osTaskOf, useSchedulerStore } from "@/stores/scheduler-store";
import { useToastStore } from "@/stores/toast-store";
import { createFakeApi, fakeUuid, type itfFakeApi } from "./fake-api";

let fake: itfFakeApi;

function f_S() {
    return useSchedulerStore.getState();
}

function f_Flush(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
    useSchedulerStore.setState(useSchedulerStore.getInitialState(), true);
    useToastStore.setState(useToastStore.getInitialState(), true);
    fake = createFakeApi();
    vi.stubGlobal("window", { rclonegui: fake.api });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("scheduler-store", () => {
    it("subscribe: getState 1회, 이후 scheduler:state 이벤트로 갱신", async () => {
        fake.setSchedulerState({
            paused: false,
            running: null,
            next: { jobId: fakeUuid(1), jobName: "백업", at: "2026-10-29T01:00:00.000Z" },
        });
        const off = f_S().subscribe();
        await f_Flush();
        expect(f_S().state?.next?.jobName).toBe("백업");
        fake.emitSchedulerState({ paused: true, running: null, next: null });
        expect(f_S().state).toEqual({ paused: true, running: null, next: null });
        off();
        fake.emitSchedulerState({ paused: false, running: null, next: null });
        expect(f_S().state?.paused).toBe(true);
    });

    it("setPaused: scheduler.setPaused를 부르고 상태·안내 토스트", async () => {
        await f_S().setPaused(true);
        expect(fake.calls).toContain("scheduler.setPaused:true");
        expect(f_S()).toMatchObject({ pending: false, state: { paused: true } });
        expect(useToastStore.getState().toasts.at(-1)?.message).toContain("일시정지");
    });

    it("subscribe: osStatus 1회, 이후 scheduler:osStatusChanged로 갱신하고 해제하면 멈춤", async () => {
        const off = f_S().subscribe();
        await f_Flush();
        expect(fake.calls).toContain("scheduler.osStatus");
        expect(f_S().osStatus?.available).toBe(false);
        expect(f_S().osStatus?.reason).toContain("설치한 앱");
        const next = {
            available: true,
            reason: null,
            tasks: [{ jobId: fakeUuid(1), registered: true, exeMatches: true, error: null }],
        };
        fake.emitOsStatus(next);
        expect(f_S().osStatus).toEqual(next);
        expect(osTaskOf(f_S().osStatus, fakeUuid(1).toUpperCase())?.registered).toBe(true);
        expect(osTaskOf(f_S().osStatus, fakeUuid(2))).toBeNull();
        expect(useToastStore.getState().toasts).toHaveLength(0);
        off();
        fake.emitOsStatus({ available: true, reason: null, tasks: [] });
        expect(f_S().osStatus?.tasks).toHaveLength(1);
    });

    it("새 등록 실패 문구가 생기면 토스트 한 번(같은 문구 반복은 무시)", async () => {
        const off = f_S().subscribe();
        await f_Flush();
        const failed = {
            available: true,
            reason: null,
            tasks: [
                {
                    jobId: fakeUuid(1),
                    registered: false,
                    exeMatches: null,
                    error: "Windows 작업 스케줄러에 등록하지 못했습니다(exit 1).",
                },
            ],
        };
        fake.emitOsStatus(failed);
        fake.emitOsStatus(failed);
        const errors = useToastStore.getState().toasts.filter((t) => t.level === "error");
        expect(errors).toHaveLength(1);
        expect(errors[0]?.message).toContain("등록하지 못했습니다");
        off();
    });
});
