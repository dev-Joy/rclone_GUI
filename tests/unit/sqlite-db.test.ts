// ========== External imports ==========
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsSqliteDb, clsSqliteError, isSqliteCorruption } from "@/main/store/sqlite-db";

let dir = "";
const opened: clsSqliteDb[] = [];

function f_Open(name = "t.sqlite", readOnly = false): clsSqliteDb {
    const db = clsSqliteDb.open({ file: join(dir, name), readOnly });
    opened.push(db);
    return db;
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-sqlite-"));
});

afterEach(() => {
    // Windows는 열린 파일을 지울 수 없으므로 먼저 닫는다
    for (const db of opened.splice(0)) db.close();
    rmSync(dir, { recursive: true, force: true });
});

describe("clsSqliteDb", () => {
    it("쓰기 모드는 WAL·외래 키·synchronous=FULL로 연다", () => {
        const db = f_Open();
        expect(db.get("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
        expect(db.get("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });
        expect(db.get("PRAGMA synchronous")).toEqual({ synchronous: 2 });
        expect(db.isOpen).toBe(true);
    });

    it("이름 있는 파라미터로 run·get·all", () => {
        const db = f_Open();
        db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL) STRICT");
        expect(db.run("INSERT INTO t (id, n) VALUES ($id, $n)", { id: "a", n: 1 })).toEqual({
            changes: 1,
        });
        db.run("INSERT INTO t (id, n) VALUES ($id, $n)", { id: "b", n: 2 });
        expect(db.get("SELECT n FROM t WHERE id = $id", { id: "b" })).toEqual({ n: 2 });
        expect(db.get("SELECT n FROM t WHERE id = $id", { id: "x" })).toBeUndefined();
        expect(db.all("SELECT id FROM t ORDER BY id")).toEqual([{ id: "a" }, { id: "b" }]);
    });

    it("transaction: 예외면 ROLLBACK 후 다시 던지고, 중첩·Promise 본문은 거부", () => {
        const db = f_Open();
        db.exec("CREATE TABLE t (n INTEGER) STRICT");
        expect(() =>
            db.transaction(() => {
                db.run("INSERT INTO t VALUES (1)");
                throw new Error("boom");
            }),
        ).toThrow("boom");
        expect(db.all("SELECT n FROM t")).toEqual([]);
        expect(() => db.transaction(() => db.transaction(() => 1))).toThrow(
            expect.objectContaining({ code: "INTERNAL" }),
        );
        expect(() => db.transaction(() => Promise.resolve(1))).toThrow(
            expect.objectContaining({ code: "INTERNAL" }),
        );
        expect(db.transaction(() => db.run("INSERT INTO t VALUES (2)").changes)).toBe(1);
        expect(db.all("SELECT n FROM t")).toEqual([{ n: 2 }]);
    });

    it("SQL 오류는 STORE_ERROR(clsSqliteError)로 감싼다", () => {
        const db = f_Open();
        expect(() => db.all("SELECT * FROM missing")).toThrow(clsSqliteError);
        expect(() => db.all("SELECT * FROM missing")).toThrow(
            expect.objectContaining({ code: "STORE_ERROR" }),
        );
    });

    it("user_version: 정수만 받는다", () => {
        const db = f_Open();
        expect(db.getUserVersion()).toBe(0);
        db.setUserVersion(3);
        expect(db.getUserVersion()).toBe(3);
        expect(() => db.setUserVersion(1.5)).toThrow(expect.objectContaining({ code: "INTERNAL" }));
        expect(() => db.setUserVersion(-1)).toThrow(expect.objectContaining({ code: "INTERNAL" }));
    });

    it("vacuumInto: 체크포인트 전 WAL 내용까지 사본에 들어가고, 대상이 있으면 거부", () => {
        const db = f_Open();
        db.exec("PRAGMA wal_autocheckpoint = 0");
        db.exec("CREATE TABLE t (n INTEGER) STRICT");
        db.run("INSERT INTO t VALUES (7)");
        const target = join(dir, "copy.sqlite");
        db.vacuumInto(target);
        const copy = f_Open("copy.sqlite", true);
        expect(copy.all("SELECT n FROM t")).toEqual([{ n: 7 }]);
        expect(copy.integrityCheck()).toEqual(["ok"]);
        expect(() => db.vacuumInto(target)).toThrow(clsSqliteError);
        expect(() => db.transaction(() => db.vacuumInto(join(dir, "c2.sqlite")))).toThrow(
            expect.objectContaining({ code: "INTERNAL" }),
        );
        expect(existsSync(join(dir, "c2.sqlite"))).toBe(false);
    });

    it("SQLite가 아닌 파일은 열 때 손상 오류", () => {
        writeFileSync(join(dir, "bad.sqlite"), "이것은 SQLite 파일이 아닙니다".repeat(50));
        let err: unknown;
        try {
            f_Open("bad.sqlite");
        } catch (e) {
            err = e;
        }
        expect(isSqliteCorruption(err)).toBe(true);
    });

    it("close는 멱등이고 닫은 뒤 호출은 STORE_ERROR", () => {
        const db = f_Open();
        db.close();
        db.close();
        expect(db.isOpen).toBe(false);
        expect(() => db.get("SELECT 1")).toThrow(expect.objectContaining({ code: "STORE_ERROR" }));
    });
});
