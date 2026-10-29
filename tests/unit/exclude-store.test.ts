// ========== External imports ==========
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { migrateSchema } from "@/main/store/db-schema";
import { clsExcludeStore } from "@/main/store/exclude-store";
import { clsJobStore } from "@/main/store/job-store";
import { clsSqliteDb } from "@/main/store/sqlite-db";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";

let dir = "";
const opened: clsSqliteDb[] = [];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-excl-store-"));
});

afterEach(() => {
    for (const db of opened.splice(0)) db.close();
    rmSync(dir, { recursive: true, force: true });
});

function f_Db(): clsSqliteDb {
    const db = clsSqliteDb.open({ file: join(dir, "store.sqlite") });
    opened.push(db);
    migrateSchema(db, () => undefined);
    return db;
}

describe("clsExcludeStore", () => {
    it("create: 앞뒤 공백을 지우고, 같은 패턴은 기존 행(created:false), 패턴 순 정렬", () => {
        const store = new clsExcludeStore({ db: f_Db() });
        store.load();
        const a = store.create("  b/**  ");
        expect(a.created).toBe(true);
        expect(a.item.pattern).toBe("b/**");
        const again = store.create("b/**");
        expect(again).toEqual({ item: a.item, created: false });
        store.create("A");
        store.create("a");
        expect(store.list().map((p) => p.pattern)).toEqual(["A", "a", "b/**"]);
        const reloaded = new clsExcludeStore({ db: f_Db() });
        expect(reloaded.load().map((p) => p.pattern)).toEqual(["A", "a", "b/**"]);
    });

    it("create: #·;·제어문자는 VALIDATION", () => {
        const store = new clsExcludeStore({ db: f_Db() });
        store.load();
        for (const bad of ["#a", ";a", "a\tb", ""]) {
            expect(() => store.create(bad)).toThrow(
                expect.objectContaining({ code: "VALIDATION" }),
            );
        }
        expect(store.list()).toEqual([]);
    });

    it("update: 다른 행과 같으면 VALIDATION, 없는 id는 NOT_FOUND", () => {
        const store = new clsExcludeStore({ db: f_Db() });
        store.load();
        const a = store.create("a").item;
        store.create("b");
        expect(() => store.update(a.id, "b")).toThrow(
            expect.objectContaining({ code: "VALIDATION" }),
        );
        expect(store.update(a.id, "c").pattern).toBe("c");
        expect(() => store.update("00000000-0000-4000-8000-0000000000ff", "x")).toThrow(
            expect.objectContaining({ code: "NOT_FOUND" }),
        );
    });

    it("patternsFor·usageJobIds·remove(연결도 함께)", async () => {
        const db = f_Db();
        const store = new clsExcludeStore({ db });
        store.load();
        const a = store.create("a").item;
        const b = store.create("b").item;
        const jobs = new clsJobStore({ db, caseInsensitive: () => true });
        await jobs.load();
        const job = await jobs.create({
            ...createJobDraft(createDefaultSettings()),
            name: "작업",
            source: "C:\\tmp\\src",
            destination: "C:\\tmp\\dst",
            excludePatternIds: [a.id, b.id],
        });
        expect(store.patternsFor([b.id, a.id])).toEqual(["b", "a"]);
        expect(() => store.patternsFor(["00000000-0000-4000-8000-0000000000ff"])).toThrow(
            expect.objectContaining({ code: "VALIDATION" }),
        );
        expect(store.usageJobIds(a.id)).toEqual([job.id]);
        store.remove(a.id);
        expect(store.usageJobIds(a.id)).toEqual([]);
        expect(store.list().map((p) => p.id)).toEqual([b.id]);
        jobs.refreshExcludeLinks();
        expect(jobs.get(job.id).excludePatternIds).toEqual([b.id]);
    });
});
