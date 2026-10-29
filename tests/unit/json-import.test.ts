// ========== External imports ==========
import {
    copyFileSync,
    existsSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { migrateSchema } from "@/main/store/db-schema";
import { clsHistoryStore } from "@/main/store/history-store";
import { clsJobStore } from "@/main/store/job-store";
import { importLegacyJson } from "@/main/store/json-import";
import { clsSettingsStore } from "@/main/store/settings-store";
import { clsSqliteDb } from "@/main/store/sqlite-db";
import type { itfAppNotice } from "@/shared/ipc-contract";
import type { typJobsFile } from "@/shared/schemas/job";
import type { typHistoryFile } from "@/shared/schemas/run";

const FIXTURES = resolve(import.meta.dirname, "..", "fixtures", "store-v1");

let dir = "";
let notices: itfAppNotice[] = [];
const opened: clsSqliteDb[] = [];

function f_Db(): clsSqliteDb {
    const db = clsSqliteDb.open({ file: join(dir, "rclonegui-store.sqlite") });
    opened.push(db);
    migrateSchema(db, () => undefined);
    return db;
}

function f_CopyFixtures(names: readonly string[]): void {
    for (const n of names) copyFileSync(join(FIXTURES, n), join(dir, n));
}

function f_Fixture<T>(name: string): T {
    return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

function f_Import(db: clsSqliteDb) {
    return importLegacyJson(db, dir, (n) => notices.push(n));
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-import-"));
    notices = [];
});

afterEach(() => {
    for (const db of opened.splice(0)) db.close();
    rmSync(dir, { recursive: true, force: true });
});

describe("importLegacyJson", () => {
    it("개수·순서·내용이 같고, 원본은 .migrated·.bak.migrated로 바뀐다", async () => {
        f_CopyFixtures(["settings.json", "jobs.json", "jobs.json.bak", "history.json"]);
        const db = f_Db();
        const report = await f_Import(db);
        expect(report).toMatchObject({
            source: "json",
            jobs: 3,
            runs: 4,
            settings: true,
            skippedDuplicates: 0,
            renameFailed: [],
        });
        expect([...(report?.renamed ?? [])].toSorted()).toEqual([
            "history.json.migrated",
            "jobs.json.bak.migrated",
            "jobs.json.migrated",
            "settings.json.migrated",
        ]);
        for (const n of ["settings.json", "jobs.json", "jobs.json.bak", "history.json"]) {
            expect(existsSync(join(dir, n))).toBe(false);
        }

        const jobs = new clsJobStore({ db, caseInsensitive: () => true });
        // 예전 JSON에는 공용 제외 패턴 연결이 없으므로 [] (INT-002 T-03)
        expect(await jobs.load()).toEqual(
            f_Fixture<typJobsFile>("jobs.json").jobs.map((j) => ({ ...j, excludePatternIds: [] })),
        );
        const history = new clsHistoryStore(db, () => 500);
        expect(history.list()).toEqual(f_Fixture<typHistoryFile>("history.json").records);
        const settings = new clsSettingsStore(db);
        expect(await settings.load()).toMatchObject({
            configPath: "C:\\tmp\\rclone.conf",
            ui: { theme: "dark" },
            scheduler: { paused: true },
            logs: { historyLimit: 200 },
        });
        const meta = db.get("SELECT value FROM meta WHERE key = 'json_import'");
        expect(JSON.parse(String(meta?.value))).toMatchObject({
            source: "json",
            counts: { jobs: 3, runs: 4, settings: true },
            skippedDuplicates: 0,
        });
        expect(notices).toEqual([]);
    });

    it("두 번째부터는 가져오지 않고, marker가 있는데 JSON이 있으면 알리기만 한다", async () => {
        f_CopyFixtures(["jobs.json"]);
        const db = f_Db();
        expect(await f_Import(db)).toMatchObject({ jobs: 3 });
        expect(await f_Import(db)).toBeNull();
        expect(notices).toEqual([]);
        f_CopyFixtures(["jobs.json"]);
        expect(await f_Import(db)).toBeNull();
        expect(notices).toHaveLength(1);
        expect(notices[0]?.level).toBe("warning");
        expect(existsSync(join(dir, "jobs.json"))).toBe(true);
        expect(db.get("SELECT COUNT(*) AS n FROM jobs")).toEqual({ n: 3 });
    });

    it("새 설치(JSON 없음): 기본 설정 행과 marker(source none)", async () => {
        const db = f_Db();
        expect(await f_Import(db)).toMatchObject({
            source: "none",
            jobs: 0,
            runs: 0,
            settings: false,
            renamed: [],
        });
        expect(db.get("SELECT COUNT(*) AS n FROM settings")).toEqual({ n: 1 });
        const meta = db.get("SELECT value FROM meta WHERE key = 'json_import'");
        expect(JSON.parse(String(meta?.value))).toMatchObject({ source: "none" });
    });

    it("이미 .migrated가 있으면 .migrated-<시각>으로 바꾼다", async () => {
        f_CopyFixtures(["jobs.json"]);
        writeFileSync(join(dir, "jobs.json.migrated"), "예전 것");
        const report = await f_Import(f_Db());
        expect(report?.renamed[0]).toMatch(/^jobs\.json\.migrated-\d{8}-\d{6}$/);
        expect(readFileSync(join(dir, "jobs.json.migrated"), "utf8")).toBe("예전 것");
    });

    it("중복 id: 작업은 먼저 나온 것, 이력은 최신 것을 남기고 건너뛴 수를 센다", async () => {
        const jobsFile = f_Fixture<typJobsFile>("jobs.json");
        const [a] = jobsFile.jobs;
        writeFileSync(
            join(dir, "jobs.json"),
            JSON.stringify({ version: 1, jobs: [...jobsFile.jobs, { ...a!, name: "나중 것" }] }),
        );
        const hist = f_Fixture<typHistoryFile>("history.json");
        const [newest] = hist.records;
        writeFileSync(
            join(dir, "history.json"),
            JSON.stringify({
                version: 1,
                records: [...hist.records, { ...newest!, jobName: "오래된 중복" }],
            }),
        );
        const db = f_Db();
        expect(await f_Import(db)).toMatchObject({ jobs: 3, runs: 4, skippedDuplicates: 2 });
        const jobs = new clsJobStore({ db, caseInsensitive: () => true });
        expect((await jobs.load()).find((j) => j.id === a!.id)?.name).toBe(a!.name);
        expect(new clsHistoryStore(db, () => 500).get(newest!.id)?.jobName).toBe(newest!.jobName);
    });

    it("트랜잭션 실패 시 ROLLBACK: JSON 원래 이름 유지, 작업 0, marker 없음", async () => {
        f_CopyFixtures(["settings.json", "jobs.json", "history.json"]);
        const db = f_Db();
        db.exec(
            "CREATE TRIGGER fail_runs BEFORE INSERT ON run_records BEGIN SELECT RAISE(ABORT, 't'); END",
        );
        await expect(f_Import(db)).rejects.toMatchObject({ code: "STORE_ERROR" });
        for (const n of ["settings.json", "jobs.json", "history.json"]) {
            expect(existsSync(join(dir, n))).toBe(true);
        }
        expect(db.get("SELECT COUNT(*) AS n FROM jobs")).toEqual({ n: 0 });
        expect(db.get("SELECT COUNT(*) AS n FROM settings")).toEqual({ n: 0 });
        expect(db.get("SELECT value FROM meta WHERE key = 'json_import'")).toBeUndefined();
        db.exec("DROP TRIGGER fail_runs");
        expect(await f_Import(db)).toMatchObject({ jobs: 3, runs: 4 });
    });

    it("본 파일 손상 + .bak 정상이면 .bak으로 가져오고 손상본은 .corrupt로 남긴다", async () => {
        writeFileSync(join(dir, "jobs.json"), "{ 깨진 JSON");
        f_CopyFixtures(["jobs.json.bak"]);
        const report = await f_Import(f_Db());
        expect(report?.jobs).toBe(2);
        const names = readdirSync(dir);
        expect(names.some((n) => n.startsWith("jobs.json.corrupt-"))).toBe(true);
        expect(names).toContain("jobs.json.migrated");
        expect(names).toContain("jobs.json.bak.migrated");
        expect(notices.some((n) => n.message.includes(".bak"))).toBe(true);
    });

    it("본 파일·.bak 모두 손상이면 .corrupt로 옮기고 빈 목록으로 가져온다", async () => {
        writeFileSync(join(dir, "jobs.json"), "{ 깨진 JSON");
        writeFileSync(join(dir, "jobs.json.bak"), "또 깨짐");
        const report = await f_Import(f_Db());
        expect(report?.jobs).toBe(0);
        expect(readdirSync(dir).some((n) => n.startsWith("jobs.json.corrupt-"))).toBe(true);
        expect(notices.some((n) => n.level === "error")).toBe(true);
    });

    it("version 2 JSON은 .unsupported로 보관하고 기본값으로 가져온다", async () => {
        writeFileSync(join(dir, "history.json"), JSON.stringify({ version: 2, records: [] }));
        const report = await f_Import(f_Db());
        expect(report?.runs).toBe(0);
        expect(readdirSync(dir).some((n) => n.startsWith("history.json.unsupported-"))).toBe(true);
        expect(notices.some((n) => n.message.includes("(2)"))).toBe(true);
    });

    it("이 앱 파일이 아닌 rclonegui.db·active-run.json은 건드리지 않는다", async () => {
        f_CopyFixtures(["jobs.json"]);
        const fake = join(dir, "rclonegui.db");
        writeFileSync(fake, Buffer.from([0x53, 0x51, 0x4c, 0x00, 0x01, 0x02, 0x03]));
        writeFileSync(join(dir, "active-run.json"), '{"version":1}');
        const before = { bytes: readFileSync(fake), mtime: statSync(fake).mtimeMs };
        await f_Import(f_Db());
        expect(readFileSync(fake).equals(before.bytes)).toBe(true);
        expect(statSync(fake).mtimeMs).toBe(before.mtime);
        expect(readFileSync(join(dir, "active-run.json"), "utf8")).toBe('{"version":1}');
    });
});
