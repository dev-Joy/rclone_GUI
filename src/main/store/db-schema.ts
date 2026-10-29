/**
 * SQLite 저장소 스키마와 마이그레이션 (INT-002 T-01).
 *
 * - 스키마 버전은 PRAGMA user_version으로 관리한다.
 * - 0(새 DB)이면 백업 없이 v1을 만든다. 0 < 현재 < 최신이면 먼저 backup(현재)을 부르고,
 *   버전마다 한 트랜잭션에서 DDL과 user_version을 함께 바꾼다(실패하면 그 버전은 ROLLBACK).
 * - 현재가 최신보다 크면(더 새 앱이 만든 데이터) DB를 바꾸지 않고 거부한다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsSqliteDb } from "@/main/store/sqlite-db";

export interface itfMigration {
    version: number;
    statements: readonly string[];
}

/** v1: 설정·작업·실행 이력 + 이후 단계(T-02~T-04)가 쓸 remotes·exclude_patterns·schedules */
const V1: readonly string[] = [
    `CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL CHECK (json_valid(data)),
        updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE jobs (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        rev INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL CHECK (json_valid(data))
    ) STRICT`,
    // jobs FK 없음: 작업을 지워도 실행 이력은 남긴다
    `CREATE TABLE run_records (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        log_file TEXT,
        data TEXT NOT NULL CHECK (json_valid(data))
    ) STRICT`,
    "CREATE INDEX run_records_job_seq ON run_records (job_id, seq DESC)",
    "CREATE INDEX run_records_running ON run_records (status) WHERE status = 'running'",
    `CREATE TABLE remotes (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL UNIQUE,
        remote_name TEXT NOT NULL,
        base_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE exclude_patterns (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL UNIQUE CHECK (
            length(pattern) BETWEEN 1 AND 512
            AND instr(pattern, char(10)) = 0
            AND instr(pattern, char(13)) = 0
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE schedules (
        job_id TEXT PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('interval', 'daily', 'weekly')),
        interval_minutes INTEGER,
        time_of_day TEXT,
        weekdays INTEGER,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        next_run_at TEXT,
        last_run_at TEXT,
        updated_at TEXT NOT NULL
    ) STRICT`,
];

export const MIGRATIONS: readonly itfMigration[] = [{ version: 1, statements: V1 }];

export const SCHEMA_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/**
 * 스키마를 최신으로 올린다. backup은 기존 데이터가 있는 DB(0 < 현재 < 최신)에서만,
 * 첫 변경 전에 한 번 부른다. 돌려주는 값: 시작·끝 버전.
 */
export function migrateSchema(
    db: clsSqliteDb,
    backup: (fromVersion: number) => void,
    migrations: readonly itfMigration[] = MIGRATIONS,
): { from: number; to: number } {
    const latest = migrations[migrations.length - 1]?.version ?? 0;
    const from = db.getUserVersion();
    if (from > latest) {
        throw new clsAppError(
            "STORE_ERROR",
            `더 새 버전 앱이 만든 데이터입니다(데이터 구조 v${from}, 이 앱은 v${latest}까지 지원). 앱을 최신 버전으로 업데이트하세요.`,
            db.file,
        );
    }
    if (from === latest) return { from, to: from };
    if (from > 0) backup(from);
    let current = from;
    for (const m of migrations) {
        if (m.version <= current) continue;
        db.transaction(() => {
            for (const sql of m.statements) db.exec(sql);
            db.setUserVersion(m.version);
        });
        current = m.version;
    }
    return { from, to: current };
}
