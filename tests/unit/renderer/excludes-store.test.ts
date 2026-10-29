// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { useExcludesStore } from "@/stores/excludes-store";
import { createFakeApi, fakeUuid, type itfFakeApi } from "./fake-api";

const AT = "2026-10-29T00:00:00.000Z";
let fake: itfFakeApi;

beforeEach(() => {
    useExcludesStore.setState(useExcludesStore.getInitialState(), true);
    fake = createFakeApi([]);
    fake.setExcludes([
        {
            id: fakeUuid(1),
            pattern: "a/**",
            createdAt: AT,
            updatedAt: AT,
            usedBy: [{ jobId: fakeUuid(9), jobName: "작업", mode: "sync", auto: true }],
        },
    ]);
    vi.stubGlobal("window", { rclonegui: fake.api });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("excludes-store", () => {
    it("load·create(중복이면 created:false) 뒤 목록을 다시 불러온다", async () => {
        await useExcludesStore.getState().load();
        expect(useExcludesStore.getState()).toMatchObject({ loaded: true, error: null });
        const r = await useExcludesStore.getState().create("b/**");
        expect(r.ok && r.data.created).toBe(true);
        expect(useExcludesStore.getState().items.map((i) => i.pattern)).toEqual(["a/**", "b/**"]);
        const again = await useExcludesStore.getState().create(" a/** ");
        expect(again.ok && again.data).toMatchObject({ created: false, item: { id: fakeUuid(1) } });
    });

    it("CONFIRM_REQUIRED면 목록을 다시 불러오고 envelope를 그대로 돌려준다", async () => {
        fake.setExcludeWriteError({ code: "CONFIRM_REQUIRED", message: "다시 확인" });
        const before = fake.calls.filter((c) => c === "excludes.list").length;
        const r = await useExcludesStore.getState().remove(fakeUuid(1), [fakeUuid(9)]);
        expect(r).toMatchObject({ ok: false, error: { code: "CONFIRM_REQUIRED" } });
        expect(fake.calls.filter((c) => c === "excludes.list").length).toBe(before + 1);
    });

    it("remove 성공: 목록에서 빠진다", async () => {
        await useExcludesStore.getState().load();
        const r = await useExcludesStore.getState().remove(fakeUuid(1), [fakeUuid(9)]);
        expect(r.ok).toBe(true);
        expect(useExcludesStore.getState().items).toEqual([]);
    });
});
