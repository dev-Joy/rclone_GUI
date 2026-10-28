// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { selectRemotesFor, useRcloneEnvStore } from "@/stores/rclone-env-store";
import { createFakeApi, type itfFakeApi } from "./fake-api";

let fake: itfFakeApi;

beforeEach(() => {
    useRcloneEnvStore.setState(useRcloneEnvStore.getInitialState(), true);
    fake = createFakeApi();
    vi.stubGlobal("window", { rclonegui: fake.api });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("rclone-env-store loadRemotes", () => {
    it("기본 설정(null)은 IPC를 부르지 않고 감지 결과를 쓴다", async () => {
        await useRcloneEnvStore.getState().loadRemotes(null);
        expect(fake.calls).toEqual([]);
        expect(selectRemotesFor(useRcloneEnvStore.getState(), null).remotes).toBeNull();
    });

    it("경로를 지정하면 listRemotes(configPath)를 부르고 캐시한다", async () => {
        const conf = "C:\\tmp\\other.conf";
        const pending = useRcloneEnvStore.getState().loadRemotes(conf);
        expect(selectRemotesFor(useRcloneEnvStore.getState(), conf).loading).toBe(true);
        fake.remotesResolvers[0]!.resolve(["a1", "b2"]);
        await pending;
        expect(selectRemotesFor(useRcloneEnvStore.getState(), conf)).toEqual({
            remotes: ["a1", "b2"],
            loading: false,
            error: null,
        });
        await useRcloneEnvStore.getState().loadRemotes(conf);
        expect(fake.calls).toEqual([`rclone.listRemotes:${conf}`]);
    });

    it("늦게 온 이전 응답은 무시한다", async () => {
        const conf = "C:\\tmp\\race.conf";
        const first = useRcloneEnvStore.getState().loadRemotes(conf, true);
        const second = useRcloneEnvStore.getState().loadRemotes(conf, true);
        fake.remotesResolvers[1]!.resolve(["new"]);
        await second;
        fake.remotesResolvers[0]!.resolve(["old"]);
        await first;
        expect(selectRemotesFor(useRcloneEnvStore.getState(), conf).remotes).toEqual(["new"]);
    });
});
