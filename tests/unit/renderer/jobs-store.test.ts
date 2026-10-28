// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import type { typJobDraft } from "@/shared/schemas/job";
import { useJobsStore } from "@/stores/jobs-store";
import { createFakeApi, fakeUuid, makeJob, type itfFakeApi } from "./fake-api";

function f_Use(fake: itfFakeApi): itfFakeApi {
    vi.stubGlobal("window", { rclonegui: fake.api });
    return fake;
}

function f_Draft(over: Partial<typJobDraft> = {}): typJobDraft {
    return {
        ...createJobDraft(createDefaultSettings()),
        name: "새 작업",
        source: "C:\\tmp\\a",
        destination: "D:\\tmp\\b",
        ...over,
    };
}

beforeEach(() => {
    useJobsStore.setState(useJobsStore.getInitialState(), true);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("jobs-store load·선택", () => {
    it("선택이 없으면 이름순 첫 작업을 고른다", async () => {
        f_Use(
            createFakeApi([
                makeJob({ id: fakeUuid(1), name: "나" }),
                makeJob({ id: fakeUuid(2), name: "가" }),
            ]),
        );
        await useJobsStore.getState().load();
        expect(useJobsStore.getState().jobs).toHaveLength(2);
        expect(useJobsStore.getState().selectedJobId).toBe(fakeUuid(2));
    });

    it("선택한 id가 사라졌으면 보정, 남아 있으면 유지", async () => {
        f_Use(
            createFakeApi([
                makeJob({ id: fakeUuid(1), name: "a" }),
                makeJob({ id: fakeUuid(2), name: "b" }),
            ]),
        );
        useJobsStore.setState({ selectedJobId: fakeUuid(2) });
        await useJobsStore.getState().load();
        expect(useJobsStore.getState().selectedJobId).toBe(fakeUuid(2));
        useJobsStore.setState({ selectedJobId: fakeUuid(9) });
        await useJobsStore.getState().load();
        expect(useJobsStore.getState().selectedJobId).toBe(fakeUuid(1));
    });
});

describe("jobs-store CRUD", () => {
    it("create 성공 → 목록·선택 갱신", async () => {
        f_Use(createFakeApi());
        const r = await useJobsStore.getState().create(f_Draft());
        expect(r.ok).toBe(true);
        const s = useJobsStore.getState();
        expect(s.jobs).toHaveLength(1);
        expect(s.selectedJobId).toBe(r.ok ? r.data.id : "");
    });

    it("create SAFETY_BLOCKED → envelope 그대로, 목록 무변경", async () => {
        f_Use(createFakeApi());
        const r = await useJobsStore.getState().create(f_Draft({ destination: "C:\\tmp\\a\\sub" }));
        expect(r).toMatchObject({ ok: false, error: { code: "SAFETY_BLOCKED" } });
        expect(useJobsStore.getState().jobs).toEqual([]);
        expect(useJobsStore.getState().selectedJobId).toBeNull();
    });

    it("update는 목록의 해당 작업을 교체한다", async () => {
        f_Use(createFakeApi([makeJob({ id: fakeUuid(1), name: "a" })]));
        await useJobsStore.getState().load();
        const r = await useJobsStore.getState().update(fakeUuid(1), { name: "b" });
        expect(r.ok).toBe(true);
        expect(useJobsStore.getState().jobs[0]).toMatchObject({ name: "b", rev: 1 });
    });

    it("duplicate → 사본 선택 / remove → 다음 항목, 마지막이면 null", async () => {
        f_Use(createFakeApi([makeJob({ id: fakeUuid(1), name: "a" })]));
        await useJobsStore.getState().load();
        const copy = await useJobsStore.getState().duplicate(fakeUuid(1));
        expect(copy.ok).toBe(true);
        const copyId = copy.ok ? copy.data.id : "";
        expect(useJobsStore.getState().selectedJobId).toBe(copyId);
        // 정렬: "a" < "a (복사)" → 사본을 지우면 이전(a)
        await useJobsStore.getState().remove(copyId);
        expect(useJobsStore.getState().selectedJobId).toBe(fakeUuid(1));
        await useJobsStore.getState().remove(fakeUuid(1));
        expect(useJobsStore.getState().jobs).toEqual([]);
        expect(useJobsStore.getState().selectedJobId).toBeNull();
    });

    it("IPC reject는 INTERNAL envelope", async () => {
        const fake = createFakeApi();
        fake.api.jobs.create = () => Promise.reject(new Error("closed"));
        f_Use(fake);
        const r = await useJobsStore.getState().create(f_Draft());
        expect(r).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    });
});

describe("jobs-store subscribe", () => {
    it("jobs:changed 반영, 해제 후 무반영, 선택이 사라지면 보정", async () => {
        const fake = f_Use(
            createFakeApi([
                makeJob({ id: fakeUuid(1), name: "a" }),
                makeJob({ id: fakeUuid(2), name: "b" }),
            ]),
        );
        await useJobsStore.getState().load();
        const off = useJobsStore.getState().subscribe();
        fake.emitJobsChanged([makeJob({ id: fakeUuid(2), name: "b" })]);
        expect(useJobsStore.getState().jobs.map((j) => j.id)).toEqual([fakeUuid(2)]);
        expect(useJobsStore.getState().selectedJobId).toBe(fakeUuid(2));
        off();
        fake.emitJobsChanged([]);
        expect(useJobsStore.getState().jobs).toHaveLength(1);
    });

    it("새 작업 편집 중(선택 null)이면 선택을 바꾸지 않는다", async () => {
        const fake = f_Use(createFakeApi());
        const off = useJobsStore.getState().subscribe();
        fake.emitJobsChanged([makeJob({ id: fakeUuid(3) })]);
        expect(useJobsStore.getState().selectedJobId).toBeNull();
        off();
    });
});
