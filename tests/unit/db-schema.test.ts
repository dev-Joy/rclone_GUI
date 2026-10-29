// ========== External imports ==========
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    migrateSchema,
    MIGRATIONS,
    SCHEMA_VERSION,
    type itfMigration,
} from "@/main/store/db-schema";
import { clsSqliteDb, clsSqliteError } from "@/main/store/sqlite-db";

let dir = "";
let db: clsSqliteDb | null = null;

function f_Open(): clsSqliteDb {
    db = clsSqliteDb.open({ file: join(dir, "s.sqlite") });
    return db;
}

function f_Tables(d: clsSqliteDb): string[] {
    return d
        .all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .map((r) => String(r.name));
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-schema-"));
});

afterEach(() => {
    db?.close();
    db = null;
    rmSync(dir, { recursive: true, force: true });
});

describe("migrateSchema", () => {
    it("새 DB는 백업 없이 v1 테이블을 만든다", () => {
        const d = f_Open();
        const backups: number[] = [];
        expect(migrateSchema(d, (v) => backups.push(v))).toEqual({ from: 0, to: SCHEMA_VERSION });
        expect(backups).toEqual([]);
        expect(SCHEMA_VERSION).toBe(1);
        expect(f_Tables(d)).toEqual([
            "exclude_patterns",
            "jobs",
            "meta",
            "remotes",
            "run_records",
            "schedules",
            "settings",
        ]);
        // 이미 최신이면 아무것도 안 한다
        expect(migrateSchema(d, (v) => backups.push(v))).toEqual({ from: 1, to: 1 });
        expect(backups).toEqual([]);
    });

    it("v1 제약: settings id=1, json_valid, 제외 패턴 줄바꿈 거부, schedules는 작업 삭제 시 함께 삭제", () => {
        const d = f_Open();
        migrateSchema(d, () => undefined);
        expect(() =>
            d.run("INSERT INTO settings (id, data, updated_at) VALUES (2, '{}', 'x')"),
        ).toThrow(clsSqliteError);
        expect(() =>
            d.run("INSERT INTO settings (id, data, updated_at) VALUES (1, 'not json', 'x')"),
        ).toThrow(clsSqliteError);
        expect(() =>
            d.run(
                "INSERT INTO exclude_patterns (id, pattern, created_at, updated_at) VALUES ('a', $p, 'x', 'x')",
                { p: "a\nb" },
            ),
        ).toThrow(clsSqliteError);
        d.run(
            "INSERT INTO jobs (id, name, rev, created_at, updated_at, data) VALUES ('j', 'n', 0, 'x', 'x', '{}')",
        );
        d.run(
            "INSERT INTO schedules (job_id, kind, enabled, updated_at) VALUES ('j', 'daily', 1, 'x')",
        );
        expect(() =>
            d.run(
                "INSERT INTO schedules (job_id, kind, enabled, updated_at) VALUES ('없음', 'daily', 1, 'x')",
            ),
        ).toThrow(clsSqliteError);
        d.run("DELETE FROM jobs WHERE id = 'j'");
        expect(d.all("SELECT job_id FROM schedules")).toEqual([]);
    });

    it("기존 데이터가 있는 DB를 올릴 때는 백업을 먼저 부른다", () => {
        const d = f_Open();
        migrateSchema(d, () => undefined);
        const order: string[] = [];
        const v2: itfMigration[] = [
            ...MIGRATIONS,
            { version: 2, statements: ["CREATE TABLE extra (x TEXT) STRICT"] },
        ];
        const r = migrateSchema(
            d,
            (from) => {
                order.push(`backup:${from}`);
                expect(f_Tables(d)).not.toContain("extra");
            },
            v2,
        );
        expect(r).toEqual({ from: 1, to: 2 });
        expect(order).toEqual(["backup:1"]);
        expect(f_Tables(d)).toContain("extra");
    });

    it("v2 실패 시 ROLLBACK하고 user_version을 그대로 둔다", () => {
        const d = f_Open();
        migrateSchema(d, () => undefined);
        const bad: itfMigration[] = [
            ...MIGRATIONS,
            {
                version: 2,
                statements: ["CREATE TABLE half (x TEXT) STRICT", "CREATE TABLE jobs (x TEXT)"],
            },
        ];
        expect(() => migrateSchema(d, () => undefined, bad)).toThrow(clsSqliteError);
        expect(d.getUserVersion()).toBe(1);
        expect(f_Tables(d)).not.toContain("half");
    });

    it("더 새 버전 DB는 거부하고 파일을 바꾸지 않는다", () => {
        const d = f_Open();
        migrateSchema(d, () => undefined);
        d.setUserVersion(9);
        d.close();
        db = null;
        const before = readFileSync(join(dir, "s.sqlite"));
        const again = f_Open();
        expect(() => migrateSchema(again, () => undefined)).toThrow(/더 새 버전/);
        expect(again.getUserVersion()).toBe(9);
        again.close();
        db = null;
        expect(readFileSync(join(dir, "s.sqlite")).equals(before)).toBe(true);
    });
});
