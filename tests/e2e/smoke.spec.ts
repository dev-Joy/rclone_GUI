/**
 * Electron 스모크 E2E. 임시 userData로 앱을 띄워 창·preload API·온보딩 셸을 확인하고,
 * 새 작업을 저장한 뒤 앱을 다시 띄워 작업과 설정 화면이 유지되는지 본다.
 * 실제 사용자 데이터·remote는 쓰지 않는다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// ========== Internal imports ==========
import { createJob, expectNoConsoleErrors, launchApp, openJob, waitForApp } from "./app-harness";

interface itfAppInfoEnvelope {
    ok: boolean;
    data?: {
        appVersion: string;
        electron: string;
        userDataPath: string;
    };
}

const JOB_NAME = "E2E 스모크";
let root = "";
let source = "";
let destination = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-smoke-"));
    source = join(root, "source");
    destination = join(root, "destination");
    mkdirSync(source, { recursive: true });
    mkdirSync(destination, { recursive: true });
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

test("창과 preload API가 뜨고 새 작업을 저장한다", async () => {
    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);

        const hasApi = await page.evaluate(
            () =>
                typeof (globalThis as { rclonegui?: { app?: { getInfo?: unknown } } }).rclonegui
                    ?.app?.getInfo === "function",
        );
        expect(hasApi).toBe(true);

        const info = (await page.evaluate(async () => {
            const api = (
                globalThis as {
                    rclonegui?: { app: { getInfo: () => Promise<unknown> } };
                }
            ).rclonegui;
            return api?.app.getInfo();
        })) as itfAppInfoEnvelope | undefined;
        expect(info?.ok).toBe(true);
        expect(info?.data?.appVersion).toBe("0.1.0");
        expect(info?.data?.electron).toBe("45.0.0");
        expect(info?.data?.userDataPath).toBe(harness.paths.userData);

        await createJob(page, { name: JOB_NAME, source, destination });
        await expect(
            page
                .locator('nav[aria-labelledby="jobs-title"]')
                .getByRole("button", { name: new RegExp(JOB_NAME) }),
        ).toBeVisible();

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        // 다음 테스트에서 같은 userData로 다시 띄운다
        await harness.close({ keepFiles: true });
    }
});

test("앱을 다시 띄워도 저장한 작업과 설정 화면이 열린다", async () => {
    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);
        await openJob(page, JOB_NAME);
        await expect(page.locator("#job-source")).toHaveValue(source);
        await expect(page.locator("#job-destination")).toHaveValue(destination);

        const nav = page.getByRole("navigation", { name: "화면 전환" });
        await nav.getByRole("button", { name: "설정" }).click();
        await expect(
            page.getByRole("heading", { name: "설정", level: 2, exact: true }),
        ).toBeVisible();
        await expect(page.getByText("로그 보관 일수")).toBeVisible();
        await nav.getByRole("button", { name: "작업" }).click();
        await expect(page.locator("#job-name")).toHaveValue(JOB_NAME);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
