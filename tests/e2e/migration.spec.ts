/**
 * 저장소 이전 E2E (INT-002 T-01). 예전 형식(v1 JSON) fixture로 임시 userData를 채운 뒤 앱을 띄워
 * SQLite(rclonegui-store.sqlite)로 옮겨졌는지, 원본이 *.json.migrated로 남는지,
 * 다시 띄워도 중복으로 가져오지 않는지 확인한다.
 * 스키마 v2 저장소(작업 1건)로 시작해 v3으로 올라가며 pre-v3 백업을 남기는지도 본다(INT-008 AC-12).
 * 실제 사용자 데이터는 쓰지 않는다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";

// ========== Internal imports ==========
import { expectNoConsoleErrors, launchApp, preparePaths, waitForApp } from "./app-harness";

// 테스트는 저장소 루트에서 실행한다(app-harness도 process.cwd()를 앱 경로로 쓴다)
const FIXTURES = join(process.cwd(), "tests", "fixtures", "store-v1");
const LEGACY = ["settings.json", "jobs.json", "jobs.json.bak", "history.json"] as const;
const JOB_NAMES = ["이전 작업 가", "이전 작업 나", "이전 작업 다"] as const;
const RUN_COUNT = 4;

interface itfCounts {
    jobs: number;
    runs: number;
    theme: string | null;
}

/** v2 저장소에 넣는 작업 하나. 저장소 열에서 읽는 값만 꺼내 쓴다 */
interface itfSeedJob {
    id: string;
    name: string;
    rev: number;
    createdAt: string;
    updatedAt: string;
}

let root = "";

/** 예전 JSON fixture의 첫 작업(스키마 zJob을 통과하는 값). data 열에 그대로 넣는다 */
function f_SeedJob(): itfSeedJob {
    const parsed = JSON.parse(readFileSync(join(FIXTURES, "jobs.json"), "utf8")) as {
        jobs?: itfSeedJob[];
    };
    const seed = parsed.jobs?.[0];
    if (!seed) throw new Error("store-v1 fixture에 작업이 없습니다.");
    return seed;
}

/**
 * 앱이 만든 v3 저장소를 v2로 되돌린다. v3은 groups 표·jobs.group_id 열·색인만 더하므로
 * 그 셋을 지우고 user_version을 2로 낮추면 v2와 같은 구조가 된다. 작업 1건을 넣고 닫는다.
 * 임시 userData 안 파일만 건드린다.
 */
function f_DowngradeToV2(file: string, seed: itfSeedJob): void {
    const db = new DatabaseSync(file);
    try {
        db.exec("DROP INDEX jobs_group");
        db.exec("ALTER TABLE jobs DROP COLUMN group_id");
        db.exec("DROP TABLE groups");
        db.prepare(
            "INSERT INTO jobs (id, name, rev, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(seed.id, seed.name, seed.rev, seed.createdAt, seed.updatedAt, JSON.stringify(seed));
        db.exec("PRAGMA user_version = 2");
        // WAL을 본 파일로 합쳐 둔다(앱이 열 때 다시 WAL로 바꾼다)
        db.exec("PRAGMA journal_mode = DELETE");
    } finally {
        db.close();
    }
}

/** 저장소 스키마 버전(PRAGMA user_version). 앱을 닫은 뒤에 읽는다 */
function f_UserVersion(file: string): number {
    const db = new DatabaseSync(file);
    try {
        const row = db.prepare("PRAGMA user_version").get();
        return Number(row?.user_version ?? 0);
    } finally {
        db.close();
    }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-migration-"));
    const { userData } = preparePaths(root);
    for (const name of LEGACY) copyFileSync(join(FIXTURES, name), join(userData, name));
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

/** preload API로 작업·이력 개수와 설정 테마를 읽는다 */
async function f_Counts(page: Page): Promise<itfCounts> {
    return page.evaluate(async () => {
        interface itfEnvelope {
            ok: boolean;
            data?: unknown;
        }
        const api = (
            globalThis as unknown as {
                rclonegui: {
                    jobs: { list: () => Promise<itfEnvelope> };
                    history: { list: () => Promise<itfEnvelope> };
                    settings: { get: () => Promise<itfEnvelope> };
                };
            }
        ).rclonegui;
        const jobs = await api.jobs.list();
        const runs = await api.history.list();
        const settings = await api.settings.get();
        const ui = (settings.data as { ui?: { theme?: string } } | undefined)?.ui;
        return {
            jobs: Array.isArray(jobs.data) ? jobs.data.length : -1,
            runs: Array.isArray(runs.data) ? runs.data.length : -1,
            theme: ui?.theme ?? null,
        };
    });
}

test("예전 JSON을 SQLite로 옮기고 원본을 .migrated로 남긴다", async () => {
    const harness = await launchApp({ root });
    try {
        const { page, paths } = harness;
        await waitForApp(page);
        const sidebar = page.locator('nav[aria-labelledby="jobs-title"]');
        for (const name of JOB_NAMES) {
            await expect(sidebar.getByRole("button", { name: new RegExp(name) })).toBeVisible();
        }
        expect(await f_Counts(page)).toEqual({ jobs: 3, runs: RUN_COUNT, theme: "dark" });

        const names = readdirSync(paths.userData);
        expect(names).toContain("rclonegui-store.sqlite");
        for (const name of LEGACY) {
            expect(names).toContain(`${name}.migrated`);
            expect(existsSync(join(paths.userData, name))).toBe(false);
        }
        expect(readdirSync(join(paths.userData, "db-backups")).length).toBeGreaterThan(0);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close({ keepFiles: true });
    }
});

test("다시 띄워도 중복으로 가져오지 않는다", async () => {
    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);
        expect(await f_Counts(page)).toEqual({ jobs: 3, runs: RUN_COUNT, theme: "dark" });
        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});

test("v2 저장소를 v3으로 올리고 변경 전 backup(pre-v3)을 남긴다", async () => {
    // 앞 테스트의 root와 섞이지 않게 이 테스트만 임시 폴더를 새로 쓴다
    const seedRoot = mkdtempSync(join(tmpdir(), "rclonegui-e2e-migrate-v2-"));
    const { userData } = preparePaths(seedRoot);
    const dbFile = join(userData, "rclonegui-store.sqlite");
    const seed = f_SeedJob();
    try {
        // 1) 앱으로 v3 저장소를 만든 뒤 v2로 되돌려 둔다
        const created = await launchApp({ root: seedRoot });
        await waitForApp(created.page);
        await created.close({ keepFiles: true });
        f_DowngradeToV2(dbFile, seed);

        // 2) 다시 띄우면 v2 → v3으로 올리고, 변경 전 백업을 남기며, 작업을 그대로 읽는다
        const harness = await launchApp({ root: seedRoot });
        try {
            const { page, paths } = harness;
            await waitForApp(page);
            const sidebar = page.locator('nav[aria-labelledby="jobs-title"]');
            await expect(
                sidebar.getByRole("button", { name: new RegExp(seed.name) }),
            ).toBeVisible();
            const backups = readdirSync(join(paths.userData, "db-backups"));
            expect(backups.some((name) => name.startsWith("rclonegui-store-pre-v3-"))).toBe(true);
            expectNoConsoleErrors(harness.consoleErrors);
        } finally {
            // 버전을 읽어야 하므로 파일은 남긴다(아래 finally가 임시 폴더를 지운다)
            await harness.close({ keepFiles: true });
        }

        expect(f_UserVersion(dbFile)).toBe(3);
    } finally {
        rmSync(seedRoot, { recursive: true, force: true });
    }
});
