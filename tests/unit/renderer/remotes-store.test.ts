// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { useRemotesStore } from "@/stores/remotes-store";
import type { itfPathProbe } from "@/shared/ipc-contract";
import type { itfRemoteBookmark } from "@/shared/types/remotes";
import { createFakeApi, fakeUuid, type itfFakeApi } from "./fake-api";

const AT = "2026-10-30T00:00:00.000Z";

const PROBE: itfPathProbe = {
    kind: "remote",
    displayPath: "r:base",
    normalizedPath: "r:base",
    exists: true,
    isDirectory: true,
    readable: null,
    isRoot: false,
    message: "폴더가 있습니다.",
    warnings: [],
};

function f_Bookmark(over: Partial<itfRemoteBookmark> = {}): itfRemoteBookmark {
    return {
        id: fakeUuid(1),
        alias: "가",
        remoteName: "r",
        basePath: "base",
        path: "r:base",
        createdAt: AT,
        updatedAt: AT,
        ...over,
    };
}

let fake: itfFakeApi;

beforeEach(() => {
    useRemotesStore.setState(useRemotesStore.getInitialState(), true);
    fake = createFakeApi();
    vi.stubGlobal("window", { rclonegui: fake.api });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("remotes-store", () => {
    it("load는 별칭 순 목록을 그대로 담는다", async () => {
        fake.setRemotes([f_Bookmark(), f_Bookmark({ id: fakeUuid(2), alias: "나", path: "r:" })]);
        await useRemotesStore.getState().load();
        const s = useRemotesStore.getState();
        expect(s).toMatchObject({ loaded: true, loading: false, error: null });
        expect(s.items.map((b) => b.alias)).toEqual(["가", "나"]);
    });

    it("load 실패는 error에 남기고 loaded를 바꾸지 않는다", async () => {
        fake.api.remotes.list = () =>
            Promise.resolve({ ok: false, error: { code: "STORE_ERROR", message: "읽기 실패" } });
        await useRemotesStore.getState().load();
        const s = useRemotesStore.getState();
        expect(s).toMatchObject({ loaded: false, loading: false, error: "읽기 실패" });
    });

    it("create 성공 뒤 목록을 다시 불러온다", async () => {
        fake.setRemotes([f_Bookmark()]);
        await useRemotesStore.getState().load();
        const r = await useRemotesStore
            .getState()
            .create({ alias: "나", remoteName: "r", basePath: "base/b" });
        expect(r.ok && r.data).toMatchObject({ alias: "나", path: "r:base/b" });
        expect(useRemotesStore.getState().items.map((b) => b.alias)).toEqual(["가", "나"]);
        expect(fake.calls.filter((c) => c === "remotes.list")).toHaveLength(2);
        expect(useRemotesStore.getState().items[1]!.id).toBe(r.ok ? r.data.id : "");
    });

    it("쓰기 실패는 envelope를 그대로 돌려주고 목록을 다시 부르지 않는다", async () => {
        fake.setRemotes([f_Bookmark()]);
        fake.setRemoteWriteError({ code: "VALIDATION", message: "별칭 중복" });
        const r = await useRemotesStore
            .getState()
            .create({ alias: "가", remoteName: "r", basePath: "" });
        expect(r).toMatchObject({ ok: false, error: { code: "VALIDATION", message: "별칭 중복" } });
        expect(fake.calls.filter((c) => c === "remotes.list")).toEqual([]);
        expect(useRemotesStore.getState().items).toEqual([]);
    });

    it("update·remove 성공도 목록을 다시 불러온다", async () => {
        fake.setRemotes([f_Bookmark()]);
        await useRemotesStore.getState().load();
        const u = await useRemotesStore
            .getState()
            .update({ id: fakeUuid(1), alias: "바뀜", remoteName: "r", basePath: "" });
        expect(u.ok).toBe(true);
        expect(useRemotesStore.getState().items[0]).toMatchObject({ alias: "바뀜", path: "r:" });
        const d = await useRemotesStore.getState().remove({ id: fakeUuid(1) });
        expect(d.ok).toBe(true);
        expect(useRemotesStore.getState().items).toEqual([]);
        expect(fake.calls.filter((c) => c === "remotes.list")).toHaveLength(3);
    });

    it("연결 테스트는 결과만 돌려주고 목록을 다시 부르지 않는다", async () => {
        fake.setRemoteTestResult(fakeUuid(1), PROBE);
        const r = await useRemotesStore.getState().test({ id: fakeUuid(1) });
        expect(r).toEqual({ ok: true, data: PROBE });
        expect(fake.calls).toEqual(["remotes.test"]);
    });
});
