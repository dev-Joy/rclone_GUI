// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import type { itfGroup } from "@/shared/schemas/group";
import { useGroupsStore } from "@/stores/groups-store";
import { createFakeApi, type itfFakeApi } from "./fake-api";

function f_Group(id: string, name: string, position: number): itfGroup {
    const at = "2026-11-17T00:00:00.000Z";
    return { id, name, position, createdAt: at, updatedAt: at };
}

let fake: itfFakeApi;

beforeEach(() => {
    useGroupsStore.setState(useGroupsStore.getInitialState(), true);
    fake = createFakeApi();
    vi.stubGlobal("window", { rclonegui: fake.api });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("groups-store", () => {
    it("load: position → 이름 순으로 둔다", async () => {
        fake.setGroups([f_Group("g-2", "나", 1), f_Group("g-1", "가", 0)]);
        await useGroupsStore.getState().load();
        expect(useGroupsStore.getState().groups.map((g) => g.name)).toEqual(["가", "나"]);
        expect(useGroupsStore.getState().loaded).toBe(true);
    });

    it("save 성공 → 목록 반영, 실패 envelope는 그대로 돌려준다", async () => {
        const r = await useGroupsStore.getState().save({ name: " 백업 " });
        expect(r.ok).toBe(true);
        expect(useGroupsStore.getState().groups.map((g) => g.name)).toEqual(["백업"]);
        const dup = await useGroupsStore.getState().save({ name: "백업" });
        expect(dup.ok).toBe(false);
        expect(useGroupsStore.getState().groups).toHaveLength(1);
    });

    it("remove 성공 → 목록에서 빠지고, groups:changed 이벤트로도 갱신된다", async () => {
        fake.setGroups([f_Group("g-1", "백업", 0)]);
        await useGroupsStore.getState().load();
        const off = useGroupsStore.getState().subscribe();
        const r = await useGroupsStore.getState().remove("g-1");
        expect(r.ok).toBe(true);
        expect(useGroupsStore.getState().groups).toEqual([]);
        fake.emitGroupsChanged([f_Group("g-9", "새 그룹", 0)]);
        expect(useGroupsStore.getState().groups.map((g) => g.name)).toEqual(["새 그룹"]);
        off();
    });
});
