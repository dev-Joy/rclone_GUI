// ========== External imports ==========
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import type { typActivity } from "@/main/services/activity-lock";
import { clsExcludeService } from "@/main/services/exclude-service";
import { migrateSchema } from "@/main/store/db-schema";
import { clsExcludeStore } from "@/main/store/exclude-store";
import { clsJobStore } from "@/main/store/job-store";
import { clsSqliteDb } from "@/main/store/sqlite-db";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";

let dir = "";
const opened: clsSqliteDb[] = [];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-excl-svc-"));
});

afterEach(() => {
    for (const db of opened.splice(0)) db.close();
    rmSync(dir, { recursive: true, force: true });
});

async function f_Setup() {
    const db = clsSqliteDb.open({ file: join(dir, "store.sqlite") });
    opened.push(db);
    migrateSchema(db, () => undefined);
    const store = new clsExcludeStore({ db });
    store.load();
    let jobChanges = 0;
    const jobs = new clsJobStore({
        db,
        caseInsensitive: () => true,
        onChange: () => {
            jobChanges += 1;
        },
    });
    await jobs.load();
    const invalidated: string[] = [];
    const logs: string[] = [];
    let current: typActivity | null = null;
    const svc = new clsExcludeService({
        store,
        jobs,
        compare: { invalidate: (id) => invalidated.push(id) },
        activity: { current: () => current },
        logger: { info: (m: string) => logs.push(m) },
    });
    const pattern = store.create("secret-name/**").item;
    const other = store.create("other").item;
    const base = { ...createJobDraft(createDefaultSettings()), destination: "C:\\tmp\\dst" };
    const syncJob = await jobs.create({
        ...base,
        name: "나 작업",
        source: "C:\\tmp\\a",
        mode: "sync",
        excludePatternIds: [pattern.id],
        autoSync: { enabled: true, intervalMinutes: 60, allowDeletes: false },
    });
    const copyJob = await jobs.create({
        ...base,
        name: "가 작업",
        source: "C:\\tmp\\b",
        excludePatternIds: [pattern.id, other.id],
    });
    return {
        svc,
        store,
        jobs,
        pattern,
        other,
        syncJob,
        copyJob,
        invalidated,
        logs,
        jobChanges: () => jobChanges,
        setCurrent: (a: typActivity | null) => {
            current = a;
        },
    };
}

describe("clsExcludeService", () => {
    it("list: 사용 작업을 이름순으로(모드·자동 실행 포함)", async () => {
        const t = await f_Setup();
        const item = t.svc.list().find((p) => p.id === t.pattern.id);
        expect(item?.usedBy).toEqual([
            { jobId: t.copyJob.id, jobName: "가 작업", mode: "copy", auto: false },
            { jobId: t.syncJob.id, jobName: "나 작업", mode: "sync", auto: true },
        ]);
    });

    it("update: 확인 목록이 다르면 CONFIRM_REQUIRED, 같으면 바꾸고 사용 작업 비교를 버린다", async () => {
        const t = await f_Setup();
        expect(() =>
            t.svc.update({ id: t.pattern.id, pattern: "x/**", confirmedJobIds: [t.copyJob.id] }),
        ).toThrow(expect.objectContaining({ code: "CONFIRM_REQUIRED" }));
        expect(() =>
            t.svc.update({ id: t.pattern.id, pattern: "x/**", confirmedJobIds: [] }),
        ).toThrow(expect.objectContaining({ code: "CONFIRM_REQUIRED" }));
        expect(t.store.list().find((p) => p.id === t.pattern.id)?.pattern).toBe("secret-name/**");
        expect(t.invalidated).toEqual([]);
        t.svc.update({
            id: t.pattern.id,
            pattern: "x/**",
            confirmedJobIds: [t.syncJob.id, t.copyJob.id],
        });
        expect(t.store.patternsFor([t.pattern.id])).toEqual(["x/**"]);
        expect(t.invalidated.toSorted()).toEqual([t.copyJob.id, t.syncJob.id].toSorted());
        // 로그에는 패턴 문자열을 남기지 않는다
        expect(t.logs.join("\n")).not.toContain("secret-name");
        expect(t.logs.join("\n")).not.toContain("x/**");
    });

    it("확인한 뒤 사용 작업이 바뀌면 다시 확인(CONFIRM_REQUIRED)", async () => {
        const t = await f_Setup();
        const confirmed = [t.copyJob.id, t.syncJob.id];
        await t.jobs.update(t.syncJob.id, { excludePatternIds: [] });
        expect(() => t.svc.remove({ id: t.pattern.id, confirmedJobIds: confirmed })).toThrow(
            expect.objectContaining({ code: "CONFIRM_REQUIRED" }),
        );
        t.svc.remove({ id: t.pattern.id, confirmedJobIds: [t.copyJob.id] });
        expect(t.jobs.get(t.copyJob.id).excludePatternIds).toEqual([t.other.id]);
        expect(t.invalidated).toEqual([t.copyJob.id]);
    });

    it("사용 작업이 비교·실행 중이면 BUSY, 다른 작업 실행 중이면 진행", async () => {
        const t = await f_Setup();
        t.setCurrent({ kind: "run", jobId: t.syncJob.id, runId: "r", startedAt: "x" });
        const confirmed = [t.copyJob.id, t.syncJob.id];
        expect(() => t.svc.remove({ id: t.pattern.id, confirmedJobIds: confirmed })).toThrow(
            expect.objectContaining({ code: "BUSY", message: expect.stringContaining("나 작업") }),
        );
        expect(t.store.list()).toHaveLength(2);
        t.setCurrent({ kind: "compare", jobId: t.syncJob.id, startedAt: "x" });
        expect(() =>
            t.svc.update({ id: t.other.id, pattern: "o2", confirmedJobIds: [t.copyJob.id] }),
        ).not.toThrow();
    });

    it("remove: 연결 캐시 갱신(jobs:changed)·사용 작업 비교 버림, 쓰는 작업이 없으면 확인 없이", async () => {
        const t = await f_Setup();
        const before = t.jobChanges();
        t.svc.remove({ id: t.pattern.id, confirmedJobIds: [t.syncJob.id, t.copyJob.id] });
        expect(t.jobs.get(t.syncJob.id).excludePatternIds).toEqual([]);
        expect(t.jobChanges()).toBe(before + 1);
        expect(t.invalidated.toSorted()).toEqual([t.copyJob.id, t.syncJob.id].toSorted());
        const lone = t.svc.create({ pattern: "lone" });
        t.svc.remove({ id: lone.item.id, confirmedJobIds: [] });
        expect(() => t.svc.remove({ id: lone.item.id, confirmedJobIds: [] })).toThrow(
            expect.objectContaining({ code: "NOT_FOUND" }),
        );
    });

    it("create: 중복이면 created:false로 기존 패턴", async () => {
        const t = await f_Setup();
        expect(t.svc.create({ pattern: "other" })).toEqual({ item: t.other, created: false });
    });
});
