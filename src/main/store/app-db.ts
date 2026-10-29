/**
 * 앱 저장소 DB(userData/rclonegui-store.sqlite)를 연다. 창을 띄우기 전에 한 번 부른다 (INT-002 T-01).
 *
 * 순서: 열기 → (있던 파일이면) 무결성 검사 → 손상이면 격리·백업으로 복구 → 스키마 마이그레이션
 *       (기존 데이터면 변경 전 pre-v<N> 백업) → 예전 JSON 1회 이전 → 하루 한 번 daily 백업.
 * - 손상: db·-wal·-shm을 .corrupt-<시각>으로 옮기고, db-backups/에서 최신순으로 무결성이 맞는 첫 백업을
 *   복사해 연다. 없으면 새 DB. 예전 JSON은 이미 .migrated라 다시 가져오지 않는다.
 * - 백업은 VACUUM INTO로 만든다(WAL DB 파일을 그대로 복사하지 않는다). daily는 최신 5개만 남기고 pre-v는 지우지 않는다.
 * - 손상이 아닌 열기 오류(권한 등)와 더 새 버전 데이터는 파일을 건드리지 않고 throw한다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, join } from "node:path";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsLogger } from "@/main/lib/logger";
import { fileStamp } from "@/main/lib/time";
import { migrateSchema } from "@/main/store/db-schema";
import { importLegacyJson, type itfJsonImportReport } from "@/main/store/json-import";
import { renameWithRetry } from "@/main/store/json-store";
import { clsSqliteDb, isSqliteCorruption } from "@/main/store/sqlite-db";
import type { itfAppNotice } from "@/shared/ipc-contract";

export const DB_FILE_NAME = "rclonegui-store.sqlite";
export const DB_BACKUP_DIR = "db-backups";
/** daily 백업 보관 수 */
export const DB_BACKUP_KEEP = 5;

const DAILY_MS = 24 * 60 * 60 * 1000;
const BACKUP_PREFIX = "rclonegui-store-";
const DAILY_RE = /^rclonegui-store-daily-(\d{8}-\d{6})\.sqlite$/;
const REASON_RE = /^[a-z0-9-]{1,32}$/;
const SIDE_FILES = ["", "-wal", "-shm"] as const;

export interface itfOpenAppDbOptions {
    userDataDir: string;
    logger?: Pick<clsLogger, "info" | "warn" | "error">;
    onNotice?: (n: itfAppNotice) => void;
    /** 시각 주입(테스트) */
    now?: () => Date;
}

export interface itfOpenAppDbResult {
    db: clsSqliteDb;
    /** 손상으로 복구에 쓴 백업 파일 경로. 복구하지 않았으면 null(새 DB로 시작한 경우도 null) */
    restoredFrom: string | null;
    imported: itfJsonImportReport | null;
}

/** fileStamp(YYYYMMDD-HHMMSS, 로컬) → Date. 형식이 아니면 null */
function f_ParseStamp(stamp: string): Date | null {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m.map(Number);
    const date = new Date(y!, mo! - 1, d!, h!, mi!, s!);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** db-backups/ 안 백업을 최신순(수정 시각)으로 */
function f_ListBackups(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith(".sqlite"))
        .map((n) => join(dir, n))
        .map((p) => ({ p, t: statSync(p).mtimeMs }))
        .toSorted((a, b) => b.t - a.t)
        .map((x) => x.p);
}

/** 백업이 열리고 무결성 검사를 통과하는지 */
function f_BackupUsable(file: string): boolean {
    let db: clsSqliteDb | null = null;
    try {
        db = clsSqliteDb.open({ file, readOnly: true });
        const r = db.integrityCheck();
        return r.length === 1 && r[0] === "ok";
    } catch {
        return false;
    } finally {
        db?.close();
    }
}

/** 열고(있던 파일이면) 무결성 검사. 손상이면 null, 그 밖의 오류는 throw */
function f_OpenChecked(file: string, existed: boolean): clsSqliteDb | null {
    let db: clsSqliteDb | null = null;
    try {
        db = clsSqliteDb.open({ file });
        if (existed) {
            const r = db.integrityCheck();
            if (r.length !== 1 || r[0] !== "ok") {
                db.close();
                return null;
            }
        }
        return db;
    } catch (e) {
        db?.close();
        if (isSqliteCorruption(e)) return null;
        throw e;
    }
}

/** 손상된 DB를 격리하고 백업으로 복구한다(없으면 새 DB) */
async function f_Recover(
    file: string,
    o: itfOpenAppDbOptions,
    now: Date,
): Promise<{ db: clsSqliteDb; restoredFrom: string | null }> {
    const stamp = fileStamp(now);
    const moved: string[] = [];
    for (const suffix of SIDE_FILES) {
        const from = `${file}${suffix}`;
        if (!existsSync(from)) continue;
        const to = `${from}.corrupt-${stamp}`;
        await renameWithRetry(from, to);
        moved.push(to);
    }
    let restoredFrom: string | null = null;
    for (const backup of f_ListBackups(join(o.userDataDir, DB_BACKUP_DIR))) {
        if (!f_BackupUsable(backup)) {
            o.logger?.warn(`손상 복구: 쓸 수 없는 백업 건너뜀 ${basename(backup)}`);
            continue;
        }
        await copyFile(backup, file);
        restoredFrom = backup;
        break;
    }
    const db = clsSqliteDb.open({ file });
    const where = moved.length > 0 ? moved[0] : file;
    const how = restoredFrom
        ? `${new Date(statSync(restoredFrom).mtimeMs).toLocaleString("ko-KR")}에 만든 백업(${basename(restoredFrom)})으로 복구했습니다. 그 뒤의 변경은 없습니다.`
        : "쓸 수 있는 백업이 없어 빈 저장소로 시작합니다.";
    o.logger?.error(`저장소 손상: ${where} → 복구=${restoredFrom ?? "없음"}`);
    o.onNotice?.({
        level: "error",
        message: `저장소 파일이 손상되어 ${where} 로 옮겼습니다. ${how}`,
    });
    return { db, restoredFrom };
}

/** 하루 한 번 daily 백업, daily는 최신 DB_BACKUP_KEEP개만 남긴다. 실패해도 시작은 계속한다 */
function f_DailyBackup(db: clsSqliteDb, o: itfOpenAppDbOptions, now: Date): void {
    try {
        const dir = join(o.userDataDir, DB_BACKUP_DIR);
        const dailies = (existsSync(dir) ? readdirSync(dir) : [])
            .map((n) => ({ n, m: DAILY_RE.exec(n) }))
            .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
            .map((x) => ({ n: x.n, at: f_ParseStamp(x.m[1]!) }))
            .filter((x): x is { n: string; at: Date } => x.at !== null)
            .toSorted((a, b) => b.at.getTime() - a.at.getTime());
        const latest = dailies[0];
        if (!latest || now.getTime() - latest.at.getTime() >= DAILY_MS) {
            const made = backupAppDb(db, o.userDataDir, "daily", now);
            dailies.unshift({ n: basename(made), at: now });
            o.logger?.info(`저장소 일일 백업: ${basename(made)}`);
        }
        for (const old of dailies.slice(DB_BACKUP_KEEP)) {
            rmSync(join(dir, old.n), { force: true });
        }
    } catch (e) {
        o.logger?.warn("저장소 일일 백업 실패", e);
    }
}

/** db-backups/rclonegui-store-<reason>-<시각>.sqlite 로 백업한다. 만든 경로 */
export function backupAppDb(
    db: clsSqliteDb,
    userDataDir: string,
    reason: string,
    now: Date = new Date(),
): string {
    if (!REASON_RE.test(reason)) {
        throw new clsAppError("INTERNAL", undefined, `잘못된 백업 이름: ${reason}`);
    }
    const dir = join(userDataDir, DB_BACKUP_DIR);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${BACKUP_PREFIX}${reason}-${fileStamp(now)}.sqlite`);
    db.vacuumInto(target);
    return target;
}

export async function openAppDb(o: itfOpenAppDbOptions): Promise<itfOpenAppDbResult> {
    const now = (o.now ?? (() => new Date()))();
    mkdirSync(o.userDataDir, { recursive: true });
    const file = join(o.userDataDir, DB_FILE_NAME);
    const existed = existsSync(file);

    let restoredFrom: string | null = null;
    let db = f_OpenChecked(file, existed);
    if (!db) ({ db, restoredFrom } = await f_Recover(file, o, now));

    try {
        const opened = db;
        const r = migrateSchema(opened, (from) => {
            const made = backupAppDb(opened, o.userDataDir, `pre-v${from + 1}`, now);
            o.logger?.info(`스키마 변경 전 백업: ${basename(made)}`);
        });
        if (r.from !== r.to) o.logger?.info(`저장소 스키마 v${r.from} → v${r.to}`);
        const imported = await importLegacyJson(opened, o.userDataDir, o.onNotice);
        if (imported) {
            o.logger?.info(
                `예전 JSON 이전: source=${imported.source} jobs=${imported.jobs} runs=${imported.runs} settings=${imported.settings} dup=${imported.skippedDuplicates} renamed=${imported.renamed.length} renameFailed=${imported.renameFailed.length}`,
            );
        }
        f_DailyBackup(opened, o, now);
        return { db: opened, restoredFrom, imported };
    } catch (e) {
        db.close();
        throw e;
    }
}
