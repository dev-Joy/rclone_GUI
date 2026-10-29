// ========== External imports ==========
import {
    copyFileSync,
    existsSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
    writeSync,
    closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    backupAppDb,
    DB_BACKUP_DIR,
    DB_BACKUP_KEEP,
    DB_FILE_NAME,
    DB_RECOVERY_MARKER,
    openAppDb,
    type itfOpenAppDbResult,
} from "@/main/store/app-db";
import { migrateSchema, MIGRATIONS, SCHEMA_VERSION } from "@/main/store/db-schema";
import { clsJobStore } from "@/main/store/job-store";
import { clsSqliteDb } from "@/main/store/sqlite-db";
import type { itfAppNotice } from "@/shared/ipc-contract";

const FIXTURES = resolve(import.meta.dirname, "..", "fixtures", "store-v1");

let dir = "";
let notices: itfAppNotice[] = [];
const opened: clsSqliteDb[] = [];

async function f_Open(now = new Date()): Promise<itfOpenAppDbResult> {
    const r = await openAppDb({
        userDataDir: dir,
        onNotice: (n) => notices.push(n),
        now: () => now,
    });
    opened.push(r.db);
    return r;
}

function f_CloseAll(): void {
    for (const db of opened.splice(0)) db.close();
}

function f_Backups(): string[] {
    const d = join(dir, DB_BACKUP_DIR);
    return existsSync(d) ? readdirSync(d).toSorted() : [];
}

function f_JobCount(db: clsSqliteDb): unknown {
    return db.get("SELECT COUNT(*) AS n FROM jobs");
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-appdb-"));
    notices = [];
});

afterEach(() => {
    f_CloseAll();
    rmSync(dir, { recursive: true, force: true });
});

describe("openAppDb", () => {
    it("새 설치: DB·v1 스키마·daily 백업을 만들고 알림이 없다", async () => {
        const r = await f_Open();
        expect(existsSync(join(dir, DB_FILE_NAME))).toBe(true);
        expect(r.db.getUserVersion()).toBe(SCHEMA_VERSION);
        expect(r.imported).toMatchObject({ source: "none" });
        expect(r.restoredFrom).toBeNull();
        expect(f_Backups()).toHaveLength(1);
        expect(f_Backups()[0]).toMatch(/^rclonegui-store-daily-\d{8}-\d{6}\.sqlite$/);
        expect(notices).toEqual([]);
    });

    it("예전 JSON을 한 번만 가져온다(재시작 중복 없음)", async () => {
        for (const n of ["settings.json", "jobs.json", "history.json"]) {
            copyFileSync(join(FIXTURES, n), join(dir, n));
        }
        const first = await f_Open();
        expect(first.imported).toMatchObject({ source: "json", jobs: 3, runs: 4 });
        f_CloseAll();
        const again = await f_Open();
        expect(again.imported).toBeNull();
        const jobs = new clsJobStore({ db: again.db, caseInsensitive: () => true });
        expect(await jobs.load()).toHaveLength(3);
        expect(readdirSync(dir)).toContain("jobs.json.migrated");
    });

    it("SQLite가 아닌 파일: .corrupt로 옮기고 백업이 없으면 새 DB, 오류 알림", async () => {
        writeFileSync(join(dir, DB_FILE_NAME), "SQLite 파일이 아님".repeat(300));
        const r = await f_Open();
        expect(r.restoredFrom).toBeNull();
        expect(r.db.integrityCheck()).toEqual(["ok"]);
        expect(readdirSync(dir).some((n) => n.startsWith(`${DB_FILE_NAME}.corrupt-`))).toBe(true);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ level: "error" });
        expect(notices[0]?.message).toContain("빈 저장소");
    });

    it("2번째 페이지 손상: 최신 정상 백업으로 복구하고 데이터를 되살린다", async () => {
        const day1 = new Date(2026, 9, 1, 9, 0, 0);
        const r1 = await f_Open(day1);
        const jobs = new clsJobStore({ db: r1.db, caseInsensitive: () => true });
        await jobs.load();
        // 백업에 들어갈 데이터: daily 백업은 열 때 만들어지므로 다음 날 다시 열어 백업한다
        r1.db.run(
            "INSERT INTO jobs (id, name, rev, created_at, updated_at, data) VALUES ('x', 'n', 0, 'a', 'a', $d)",
            { d: JSON.stringify({ filler: "가".repeat(20_000) }) },
        );
        f_CloseAll();
        await f_Open(new Date(day1.getTime() + 25 * 60 * 60 * 1000));
        f_CloseAll();
        expect(f_Backups()).toHaveLength(2);

        const fd = openSync(join(dir, DB_FILE_NAME), "r+");
        writeSync(fd, Buffer.alloc(4096, 0xab), 0, 4096, 4096);
        closeSync(fd);

        const r = await f_Open(new Date(day1.getTime() + 26 * 60 * 60 * 1000));
        expect(r.restoredFrom).toMatch(/rclonegui-store-daily-.*\.sqlite$/);
        expect(f_JobCount(r.db)).toEqual({ n: 1 });
        expect(r.db.integrityCheck()).toEqual(["ok"]);
        expect(readdirSync(dir).some((n) => n.startsWith(`${DB_FILE_NAME}.corrupt-`))).toBe(true);
        expect(notices.at(-1)?.message).toContain("백업");
    });

    it("복구 표시만 남은 상태(본 파일 없음, -wal 있음): 이어서 백업으로 복구하고 표시를 지운다", async () => {
        const day1 = new Date(2026, 9, 1, 9, 0, 0);
        const r1 = await f_Open(day1);
        r1.db.run(
            "INSERT INTO jobs (id, name, rev, created_at, updated_at, data) VALUES ('x', 'n', 0, 'a', 'a', '{}')",
        );
        f_CloseAll();
        await f_Open(new Date(day1.getTime() + 25 * 60 * 60 * 1000));
        f_CloseAll();
        // 본 파일은 이미 옮겨졌고 -wal만 남은 채 멈춘 상황
        rmSync(join(dir, DB_FILE_NAME), { force: true });
        rmSync(join(dir, `${DB_FILE_NAME}-shm`), { force: true });
        writeFileSync(join(dir, `${DB_FILE_NAME}-wal`), "남은 wal");
        writeFileSync(join(dir, DB_RECOVERY_MARKER), JSON.stringify({ stamp: "20261001-090000" }));

        const r = await f_Open(new Date(day1.getTime() + 26 * 60 * 60 * 1000));
        expect(r.restoredFrom).toMatch(/rclonegui-store-daily-.*\.sqlite$/);
        expect(f_JobCount(r.db)).toEqual({ n: 1 });
        expect(notices).toHaveLength(1);
        expect(existsSync(join(dir, DB_RECOVERY_MARKER))).toBe(false);
        expect(existsSync(join(dir, `${DB_FILE_NAME}-wal.corrupt-20261001-090000`))).toBe(true);
    });

    it("손상 복구는 시작 표시를 만들고 끝나면 지운다", async () => {
        writeFileSync(join(dir, DB_FILE_NAME), "SQLite 파일이 아님".repeat(300));
        await f_Open();
        expect(existsSync(join(dir, DB_RECOVERY_MARKER))).toBe(false);
        expect(notices).toHaveLength(1);
    });

    it("daily 백업: 24시간 안에는 다시 만들지 않고, 최신 5개만 남긴다(pre-v는 남김)", async () => {
        const t0 = new Date(2026, 9, 1, 9, 0, 0);
        await f_Open(t0);
        f_CloseAll();
        await f_Open(new Date(t0.getTime() + 60 * 60 * 1000));
        f_CloseAll();
        expect(f_Backups()).toHaveLength(1);
        const keepMe = join(dir, DB_BACKUP_DIR, "rclonegui-store-pre-v2-20260101-000000.sqlite");
        writeFileSync(keepMe, "");
        for (let i = 1; i <= 6; i += 1) {
            await f_Open(new Date(t0.getTime() + i * 25 * 60 * 60 * 1000));
            f_CloseAll();
        }
        const dailies = f_Backups().filter((n) => n.includes("-daily-"));
        expect(dailies).toHaveLength(DB_BACKUP_KEEP);
        expect(existsSync(keepMe)).toBe(true);
        // 가장 오래된 두 개(t0, t0+25h)가 지워졌다
        expect(dailies[0]).toContain("20261003-");
    });

    it("pre-v 백업: 스키마를 바꾸기 전 데이터가 든 사본이 열린다", async () => {
        const r = await f_Open();
        r.db.run(
            "INSERT INTO jobs (id, name, rev, created_at, updated_at, data) VALUES ('j', 'n', 0, 'a', 'a', '{}')",
        );
        let made = "";
        migrateSchema(
            r.db,
            (from) => {
                made = backupAppDb(r.db, dir, `pre-v${from + 1}`);
            },
            [...MIGRATIONS, { version: SCHEMA_VERSION + 1, statements: ["DELETE FROM jobs"] }],
        );
        expect(f_JobCount(r.db)).toEqual({ n: 0 });
        expect(made).toMatch(
            new RegExp(`rclonegui-store-pre-v${SCHEMA_VERSION + 1}-\\d{8}-\\d{6}\\.sqlite$`),
        );
        const copy = clsSqliteDb.open({ file: made, readOnly: true });
        opened.push(copy);
        expect(copy.getUserVersion()).toBe(SCHEMA_VERSION);
        expect(f_JobCount(copy)).toEqual({ n: 1 });
        expect(() => backupAppDb(r.db, dir, "../x")).toThrow(
            expect.objectContaining({ code: "INTERNAL" }),
        );
    });

    it("v1 DB를 열면 pre-v2 백업을 만들고 v2로 올린다", async () => {
        const v1 = clsSqliteDb.open({ file: join(dir, DB_FILE_NAME) });
        migrateSchema(v1, () => undefined, MIGRATIONS.slice(0, 1));
        v1.close();
        const r = await f_Open();
        expect(r.db.getUserVersion()).toBe(2);
        expect(
            f_Backups().some((n) => /^rclonegui-store-pre-v2-\d{8}-\d{6}\.sqlite$/.test(n)),
        ).toBe(true);
    });

    it("더 새 버전 데이터: 파일을 바꾸지 않고 거부한다(손상 처리 안 함)", async () => {
        const r = await f_Open();
        r.db.setUserVersion(99);
        f_CloseAll();
        const before = readFileSync(join(dir, DB_FILE_NAME));
        await expect(f_Open()).rejects.toThrow(/더 새 버전/);
        expect(readFileSync(join(dir, DB_FILE_NAME)).equals(before)).toBe(true);
        expect(readdirSync(dir).some((n) => n.includes(".corrupt-"))).toBe(false);
    });
});
