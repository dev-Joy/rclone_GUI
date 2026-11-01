// ========== External imports ==========
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { migrateSchema } from "@/main/store/db-schema";
import { clsRemoteStore } from "@/main/store/remote-store";
import { clsSqliteDb } from "@/main/store/sqlite-db";
import { REMOTE_BOOKMARKS_MAX } from "@/shared/option-limits";

let dir = "";
const opened: clsSqliteDb[] = [];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-remote-store-"));
});

afterEach(() => {
    for (const db of opened.splice(0)) db.close();
    rmSync(dir, { recursive: true, force: true });
});

function f_Store(): clsRemoteStore {
    const db = clsSqliteDb.open({ file: join(dir, "store.sqlite") });
    opened.push(db);
    migrateSchema(db, () => undefined);
    const store = new clsRemoteStore({ db });
    store.load();
    return store;
}

const INPUT = { alias: "테스트", remoteName: "test-remote", basePath: "base/a" };

describe("clsRemoteStore", () => {
    it("create: 경로를 파생하고 별칭 순으로 정렬한다", () => {
        const store = f_Store();
        const b = store.create({ ...INPUT, alias: "  b  " });
        const a = store.create({ alias: "a", remoteName: "test-remote", basePath: "" });
        expect(b).toMatchObject({
            alias: "b",
            remoteName: "test-remote",
            basePath: "base/a",
            path: "test-remote:base/a",
        });
        expect(a.path).toBe("test-remote:");
        expect(store.list().map((x) => x.alias)).toEqual(["a", "b"]);
        expect(store.get(b.id)).toEqual(b);
        expect(() => store.get("00000000-0000-4000-8000-0000000000ff")).toThrow(
            expect.objectContaining({ code: "NOT_FOUND" }),
        );
    });

    it("DB에서 다시 읽어도 같은 목록·정렬이다", () => {
        const db = clsSqliteDb.open({ file: join(dir, "store.sqlite") });
        opened.push(db);
        migrateSchema(db, () => undefined);
        const first = new clsRemoteStore({ db });
        first.load();
        first.create({ ...INPUT, alias: "가" });
        first.create({ ...INPUT, alias: "A" });
        first.create({ ...INPUT, alias: "a" });

        const again = new clsRemoteStore({ db });
        expect(again.load().map((x) => x.alias)).toEqual(["A", "a", "가"]);
    });

    it("별칭은 대소문자를 구분하고, 중복·빈 값·제어문자는 VALIDATION", () => {
        const store = f_Store();
        store.create({ ...INPUT, alias: "a" });
        expect(() => store.create({ ...INPUT, alias: "a" })).toThrow(
            expect.objectContaining({ code: "VALIDATION" }),
        );
        expect(() => store.create({ ...INPUT, alias: "A" })).not.toThrow();
        for (const alias of ["", "   ", "a\tb"]) {
            expect(() => store.create({ ...INPUT, alias })).toThrow(
                expect.objectContaining({ code: "VALIDATION" }),
            );
        }
    });

    it("remote 이름: 한 글자·경로 포함·형식 오류는 VALIDATION", () => {
        const store = f_Store();
        for (const remoteName of ["x", "test-remote:base", "a/b", ""]) {
            expect(() => store.create({ ...INPUT, remoteName })).toThrow(
                expect.objectContaining({ code: "VALIDATION" }),
            );
        }
    });

    it("기준 경로는 정규화하고 .·.. 는 VALIDATION", () => {
        const store = f_Store();
        expect(store.create({ ...INPUT, basePath: " base/ " }).basePath).toBe("base");
        expect(store.create({ ...INPUT, alias: "abs", basePath: "/base/" }).basePath).toBe("/base");
        for (const basePath of [".", "..", "a/../b"]) {
            expect(() => store.create({ ...INPUT, basePath })).toThrow(
                expect.objectContaining({ code: "VALIDATION" }),
            );
        }
    });

    it("update: 값이 같으면 그대로, 바꾸면 정렬을 다시 하고 없는 id는 NOT_FOUND", () => {
        const store = f_Store();
        const a = store.create({ ...INPUT, alias: "a" });
        const same = store.update({
            id: a.id,
            alias: "a",
            remoteName: "test-remote",
            basePath: "base/a",
        });
        expect(same).toEqual(a);
        const renamed = store.update({
            id: a.id,
            alias: "z",
            remoteName: "test-remote",
            basePath: "base/b",
        });
        expect(renamed.path).toBe("test-remote:base/b");
        expect(() =>
            store.update({
                id: "00000000-0000-4000-8000-0000000000ff",
                alias: "q",
                remoteName: "test-remote",
                basePath: "",
            }),
        ).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
        expect(() => store.remove("00000000-0000-4000-8000-0000000000ff")).toThrow(
            expect.objectContaining({ code: "NOT_FOUND" }),
        );
    });

    it("remove는 목록에서 지우고 DB에서도 지운다", () => {
        const store = f_Store();
        const a = store.create({ ...INPUT, alias: "a" });
        const b = store.create({ ...INPUT, alias: "b" });
        store.remove(a.id);
        expect(store.list()).toEqual([b]);
        const again = new clsRemoteStore({ db: opened[0]! });
        expect(again.load()).toEqual([b]);
    });

    it(`북마크는 ${REMOTE_BOOKMARKS_MAX}개까지`, () => {
        const store = f_Store();
        for (let i = 0; i < REMOTE_BOOKMARKS_MAX; i += 1) {
            store.create({ ...INPUT, alias: `a${i}` });
        }
        expect(() => store.create({ ...INPUT, alias: "over" })).toThrow(
            expect.objectContaining({ code: "VALIDATION" }),
        );
    });
});
