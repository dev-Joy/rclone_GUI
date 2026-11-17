// ========== External imports ==========
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { migrateSchema } from "@/main/store/db-schema";
import { clsGroupStore } from "@/main/store/group-store";
import { clsJobStore } from "@/main/store/job-store";
import { clsSqliteDb } from "@/main/store/sqlite-db";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import type { typJobDraft } from "@/shared/schemas/job";

let dir = "";
const opened: clsSqliteDb[] = [];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-group-store-"));
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

function f_Draft(over: Partial<typJobDraft> = {}): typJobDraft {
    return {
        ...createJobDraft(createDefaultSettings()),
        name: "작업",
        source: "C:\\tmp\\src",
        destination: "test-remote:dst",
        ...over,
    };
}

async function f_Stores(onChange?: () => void) {
    const db = f_Db();
    const jobs = new clsJobStore({ db, caseInsensitive: () => true });
    await jobs.load();
    const groups = new clsGroupStore({ db, ...(onChange ? { onChange } : {}) });
    groups.load();
    return { db, jobs, groups };
}

describe("clsGroupStore", () => {
    it("save: 새 그룹은 g- id와 position(0,1,…) 순서를 갖고, 다시 읽어도 유지된다", async () => {
        const { db, groups } = await f_Stores();
        const a = groups.save({ name: "  백업  " });
        const b = groups.save({ name: "테스트" });
        expect(a.name).toBe("백업");
        expect(a.id).toMatch(/^g-[a-z0-9-]{1,40}$/);
        expect([a.position, b.position]).toEqual([0, 1]);
        expect(groups.list().map((g) => g.name)).toEqual(["백업", "테스트"]);

        const again = new clsGroupStore({ db });
        expect(again.load().map((g) => g.name)).toEqual(["백업", "테스트"]);
    });

    it("save: 같은 이름(대소문자 무시)은 VALIDATION, 이름을 바꿔도 position은 그대로", async () => {
        const { groups } = await f_Stores();
        groups.save({ name: "Backup" });
        const b = groups.save({ name: "기타" });
        expect(() => groups.save({ name: "backup" })).toThrow(
            expect.objectContaining({ code: "VALIDATION" }),
        );
        expect(() => groups.save({ name: "기타" })).toThrow(
            expect.objectContaining({ code: "VALIDATION" }),
        );
        // 같은 그룹의 같은 이름은 그대로 돌려준다
        expect(groups.save({ id: b.id, name: "기타" })).toEqual(b);
        const renamed = groups.save({ id: b.id, name: "다른 이름" });
        expect(renamed.position).toBe(b.position);
        expect(renamed.updatedAt >= b.updatedAt).toBe(true);
        // 자기 자신의 대소문자만 바꾸는 것은 중복이 아니다
        expect(groups.save({ id: renamed.id, name: "다른 이름" }).name).toBe("다른 이름");
    });

    it("remove: 속한 작업을 그룹 없음으로 옮긴 뒤 지운다(한 트랜잭션), onChange를 부른다", async () => {
        const calls: number[] = [];
        const { jobs, groups } = await f_Stores(() => calls.push(1));
        const g = groups.save({ name: "백업" });
        const job = await jobs.create(f_Draft());
        const withGroup = await jobs.setGroup(job.id, g.id);
        expect(withGroup.groupId).toBe(g.id);

        groups.remove(g.id);
        expect(groups.list()).toEqual([]);
        expect(jobs.list()[0]?.groupId).toBe(g.id); // 캐시는 job-store가 새로 읽기 전까지 그대로
        jobs.refreshGroups();
        expect(jobs.list()[0]?.groupId).toBeNull();
        // 그룹 저장(1) + 그룹 삭제(1). 작업 그룹 지정은 작업 저장소의 onChange를 받지 않는다
        expect(calls).toHaveLength(2);
        expect(() => groups.remove(g.id)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    });

    it("setGroup: rev·updatedAt을 올리지 않고, 없는 그룹은 VALIDATION", async () => {
        const { db, jobs, groups } = await f_Stores();
        const g = groups.save({ name: "백업" });
        const job = await jobs.create(f_Draft());
        const next = await jobs.setGroup(job.id, g.id);
        expect(next.rev).toBe(job.rev);
        expect(next.updatedAt).toBe(job.updatedAt);
        expect(next.groupId).toBe(g.id);
        expect(jobs.list()[0]).toEqual(next);
        // 다시 읽어도 group_id 열에서 온다
        const reloaded = new clsJobStore({ db, caseInsensitive: () => true });
        await reloaded.load();
        expect(reloaded.list()[0]?.groupId).toBe(g.id);
        await expect(jobs.setGroup(job.id, "g-missing")).rejects.toMatchObject({
            code: "VALIDATION",
        });
        expect((await jobs.setGroup(job.id, null)).groupId).toBeNull();
    });
});
