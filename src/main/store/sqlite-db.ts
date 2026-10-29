/**
 * node:sqlite(DatabaseSync) 얇은 어댑터. 앱에서 node:sqlite를 import하는 유일한 파일이다
 * (node:sqlite는 아직 안정 API가 아니므로 바뀌면 이 파일만 고친다).
 *
 * - 쓰기 모드: journal_mode=WAL(결과 확인), foreign_keys=ON, synchronous=FULL, busy timeout.
 * - 파라미터는 이름 있는 값($id 등)만 받는다. SQL 문자열은 호출부의 상수만 쓴다(입력으로 조립 금지).
 * - node:sqlite 예외는 clsSqliteError(STORE_ERROR)로 감싸고 SQLite 오류 번호를 남긴다.
 * - 닫은 뒤 부르면 STORE_ERROR. close는 여러 번 불러도 된다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { existsSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";

export type typSqlValue = string | number | bigint | null | Uint8Array;
/** 이름 있는 파라미터. SQL의 $id 는 { id } 로 넘긴다 */
export type typSqlParams = Readonly<Record<string, typSqlValue>>;

export interface itfSqliteOpenOptions {
    file: string;
    /** 잠금 대기(ms). 기본 5000 */
    busyTimeoutMs?: number;
    /** 읽기 전용(백업 검사 등). PRAGMA를 바꾸지 않는다 */
    readOnly?: boolean;
}

/** SQLite 오류 번호 (https://sqlite.org/rescode.html) */
export const SQLITE_CORRUPT = 11;
export const SQLITE_NOTADB = 26;

/** node:sqlite 오류를 감싼 저장 오류. sqliteCode는 SQLite 확장 오류 번호 */
export class clsSqliteError extends clsAppError {
    readonly sqliteCode: number | undefined;

    constructor(message: string | undefined, detail: string, sqliteCode?: number) {
        super("STORE_ERROR", message, detail);
        this.name = "clsSqliteError";
        this.sqliteCode = sqliteCode;
    }
}

/** 파일이 손상됐거나 SQLite 파일이 아니라서 난 오류인지 */
export function isSqliteCorruption(e: unknown): boolean {
    if (!(e instanceof clsSqliteError) || e.sqliteCode === undefined) return false;
    const primary = e.sqliteCode & 0xff;
    return primary === SQLITE_CORRUPT || primary === SQLITE_NOTADB;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const WRAP_MESSAGE = "데이터를 저장하거나 읽지 못했습니다.";

function f_Wrap(e: unknown): Error {
    if (e instanceof clsAppError) return e;
    const message = e instanceof Error ? e.message : String(e);
    const code =
        typeof e === "object" && e !== null && "errcode" in e
            ? Number((e as { errcode: unknown }).errcode)
            : undefined;
    return new clsSqliteError(
        WRAP_MESSAGE,
        message,
        code !== undefined && Number.isFinite(code) ? code : undefined,
    );
}

function f_IsThenable(v: unknown): boolean {
    return (
        typeof v === "object" &&
        v !== null &&
        "then" in v &&
        typeof (v as { then: unknown }).then === "function"
    );
}

export class clsSqliteDb {
    readonly file: string;
    private db: DatabaseSync | null;
    private readonly statements = new Map<string, StatementSync>();
    private inTransaction = false;

    private constructor(file: string, db: DatabaseSync) {
        this.file = file;
        this.db = db;
    }

    /** DB를 연다. 쓰기 모드면 WAL·외래 키·synchronous=FULL을 켠다. 실패하면 핸들을 닫고 throw */
    static open(o: itfSqliteOpenOptions): clsSqliteDb {
        let raw: DatabaseSync | null = null;
        try {
            raw = new DatabaseSync(o.file, {
                readOnly: o.readOnly === true,
                timeout: o.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
                enableForeignKeyConstraints: true,
            });
            if (!o.readOnly) {
                const row = raw.prepare("PRAGMA journal_mode = WAL").get() as
                    | Record<string, unknown>
                    | undefined;
                const mode = String(row?.journal_mode ?? "").toLowerCase();
                if (mode !== "wal") {
                    throw new clsSqliteError(undefined, `journal_mode=${mode} (wal 아님)`);
                }
                raw.exec("PRAGMA synchronous = FULL");
                raw.exec("PRAGMA foreign_keys = ON");
            } else {
                // 읽기 전용도 파일 형식을 바로 확인한다(손상 파일이면 여기서 실패)
                raw.prepare("PRAGMA schema_version").get();
            }
            return new clsSqliteDb(o.file, raw);
        } catch (e) {
            try {
                raw?.close();
            } catch {
                // 열다 실패한 핸들 정리. 원래 오류를 넘긴다
            }
            throw f_Wrap(e);
        }
    }

    get isOpen(): boolean {
        return this.db !== null;
    }

    /** 상수 DDL·PRAGMA 전용 */
    exec(sql: string): void {
        const db = this.handle();
        try {
            db.exec(sql);
        } catch (e) {
            throw f_Wrap(e);
        }
    }

    run(sql: string, p: typSqlParams = {}): { changes: number } {
        try {
            const r = this.statement(sql).run(p);
            return { changes: Number(r.changes) };
        } catch (e) {
            throw f_Wrap(e);
        }
    }

    /** 한 행. 호출부에서 zod row 스키마로 파싱한다 */
    get(sql: string, p: typSqlParams = {}): Record<string, unknown> | undefined {
        try {
            const row = this.statement(sql).get(p);
            return row === undefined ? undefined : { ...row };
        } catch (e) {
            throw f_Wrap(e);
        }
    }

    all(sql: string, p: typSqlParams = {}): Record<string, unknown>[] {
        try {
            return this.statement(sql)
                .all(p)
                .map((row) => ({ ...row }));
        } catch (e) {
            throw f_Wrap(e);
        }
    }

    /**
     * BEGIN IMMEDIATE → fn → COMMIT. 예외면 ROLLBACK 후 다시 던진다.
     * 중첩 호출이나 Promise를 돌려주는 fn은 거부한다(동기 본문만).
     */
    transaction<T>(fn: () => T): T {
        const db = this.handle();
        if (this.inTransaction || db.isTransaction) {
            throw new clsAppError("INTERNAL", undefined, "중첩 트랜잭션");
        }
        this.exec("BEGIN IMMEDIATE");
        this.inTransaction = true;
        try {
            const result = fn();
            if (f_IsThenable(result)) {
                throw new clsAppError("INTERNAL", undefined, "트랜잭션 본문이 Promise를 돌려줌");
            }
            this.exec("COMMIT");
            return result;
        } catch (e) {
            try {
                if (db.isTransaction) db.exec("ROLLBACK");
            } catch {
                // ROLLBACK 실패는 원래 오류보다 덜 중요하다
            }
            // 본문 예외(clsAppError·ZodError 등)는 그대로 넘긴다. SQL 오류는 run/exec에서 이미 감쌌다
            throw e;
        } finally {
            this.inTransaction = false;
        }
    }

    getUserVersion(): number {
        const row = this.get("PRAGMA user_version");
        return Number(row?.user_version ?? 0);
    }

    setUserVersion(v: number): void {
        if (!Number.isInteger(v) || v < 0) {
            throw new clsAppError("INTERNAL", undefined, `잘못된 user_version: ${String(v)}`);
        }
        // PRAGMA는 파라미터를 받지 않는다. 정수 검사를 거친 값만 넣는다
        this.exec(`PRAGMA user_version = ${v}`);
    }

    /** PRAGMA integrity_check 결과. 정상이면 ["ok"] */
    integrityCheck(): string[] {
        return this.all("PRAGMA integrity_check").map((r) => String(r.integrity_check));
    }

    /** 일관된 사본을 target에 만든다(WAL 내용 포함). 대상이 있으면 오류. 트랜잭션 밖에서만 */
    vacuumInto(target: string): void {
        const db = this.handle();
        if (this.inTransaction || db.isTransaction) {
            throw new clsAppError("INTERNAL", undefined, "트랜잭션 안에서 백업할 수 없음");
        }
        if (existsSync(target)) {
            throw new clsSqliteError(undefined, `백업 대상이 이미 있음: ${target}`);
        }
        this.run("VACUUM INTO $target", { target });
    }

    close(): void {
        const db = this.db;
        if (!db) return;
        this.db = null;
        this.statements.clear();
        try {
            db.close();
        } catch (e) {
            throw f_Wrap(e);
        }
    }

    private handle(): DatabaseSync {
        if (!this.db) throw new clsSqliteError("저장소가 이미 닫혔습니다.", this.file);
        return this.db;
    }

    private statement(sql: string): StatementSync {
        const db = this.handle();
        let st = this.statements.get(sql);
        if (!st) {
            st = db.prepare(sql);
            this.statements.set(sql, st);
        }
        return st;
    }
}
