// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { useSchedulerStore } from "@/stores/scheduler-store";
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
});
