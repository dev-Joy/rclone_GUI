/**
 * 저장소 이전 E2E (INT-002 T-01). 예전 형식(v1 JSON) fixture로 임시 userData를 채운 뒤 앱을 띄워
 * SQLite(rclonegui-store.sqlite)로 옮겨졌는지, 원본이 *.json.migrated로 남는지,
 * 다시 띄워도 중복으로 가져오지 않는지 확인한다. 실제 사용자 데이터는 쓰지 않는다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

let root = "";

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
