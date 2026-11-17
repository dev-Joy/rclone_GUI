/**
 * Electron 스모크 E2E. 임시 userData로 앱을 띄워 창·preload API·온보딩 셸을 확인하고,
 * 새 작업을 저장한 뒤 앱을 다시 띄워 작업과 설정 모달이 유지되는지 본다.
 * 작업이 없을 때 빈 화면의 ‘새 작업 만들기’로 저장하면 작업 화면에 머무는지 본다.
 * 복제는 값을 채운 편집 모달을 열고, 저장하면 새 작업이 목록에 생겨 선택되는지 본다.
 * 작업 선택은 목록에서 하나만 강조되고(aria-current), 설정은 상단 막대의 단추로 여는 모달이다.
 * 실제 사용자 데이터·remote는 쓰지 않는다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// ========== Internal imports ==========
import {
    closeSettings,
    createJob,
    dismissToasts,
    expectNoConsoleErrors,
    jobEditor,
    jobSidebar,
    launchApp,
    openJob,
    openSettings,
    selectJob,
    waitForApp,
} from "./app-harness";

interface itfAppInfoEnvelope {
    ok: boolean;
    data?: {
        appVersion: string;
        electron: string;
        userDataPath: string;
    };
}

const JOB_NAME = "E2E 스모크";
const SECOND_NAME = "E2E 둘째 작업";
/** 앱 버전은 package.json이 기준이다(빌드마다 바뀌므로 기대값을 박아 두지 않는다) */
const APP_VERSION = (
    JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string }
).version;
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
        expect(info?.data?.appVersion).toBe(APP_VERSION);
        expect(info?.data?.electron).toBe("45.0.0");
        expect(info?.data?.userDataPath).toBe(harness.paths.userData);

        await createJob(page, { name: JOB_NAME, source, destination });
        const sidebar = jobSidebar(page);
        await expect(sidebar.getByRole("button", { name: new RegExp(JOB_NAME) })).toBeVisible();

        // 작업을 하나 더 만들어, 선택은 목록에서 하나만 강조되는지 본다
        await createJob(page, { name: SECOND_NAME, source, destination });
        await selectJob(page, JOB_NAME);
        const current = sidebar.locator('[aria-current="true"]');
        await expect(current).toHaveCount(1);
        await expect(current).toContainText(JOB_NAME);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        // 다음 테스트에서 같은 userData로 다시 띄운다
        await harness.close({ keepFiles: true });
    }
});

test("앱을 다시 띄워도 저장한 작업과 설정 모달이 열린다", async () => {
    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);
        await openJob(page, JOB_NAME);
        const editor = jobEditor(page);
        await expect(editor.locator("#job-source")).toHaveValue(source);
        await expect(editor.locator("#job-destination")).toHaveValue(destination);

        // 편집 모달을 닫고 상단 막대의 ‘설정’ 단추로 설정 모달을 연다
        await editor.getByRole("button", { name: "취소", exact: true }).click();
        await expect(editor).toBeHidden();
        const settings = await openSettings(page);
        await expect(settings.getByText("로그 보관 일수")).toBeVisible();
        await closeSettings(page);

        await openJob(page, JOB_NAME);
        await expect(jobEditor(page).locator("#job-name")).toHaveValue(JOB_NAME);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});

test("작업이 없을 때 빈 화면의 새 작업 만들기로 저장하면 작업 화면에 머문다", async () => {
    // 앞 테스트가 root를 지우므로 이 테스트의 원본·대상은 앱 임시 폴더 안에 만든다
    const harness = await launchApp();
    try {
        const { page } = harness;
        const firstSource = join(harness.paths.root, "source");
        const firstDestination = join(harness.paths.root, "destination");
        mkdirSync(firstSource, { recursive: true });
        mkdirSync(firstDestination, { recursive: true });
        await waitForApp(page);
        await page.getByRole("button", { name: "새 작업 만들기", exact: true }).click();
        const editor = jobEditor(page);
        await expect(editor).toBeVisible();
        await editor.locator("#job-name").fill("E2E 첫 작업");
        await editor.locator("#job-source").fill(firstSource);
        await editor.locator("#job-destination").fill(firstDestination);
        await editor.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByText("작업을 저장했습니다.").last()).toBeVisible();
        // 저장하면 편집 모달이 스스로 닫히고 그 작업의 화면으로 옮겨 간다
        await expect(editor).toBeHidden();
        await expect(page.locator("#job-title")).toHaveText("E2E 첫 작업");
        await expect(page.locator("#job-open-edit")).toBeVisible();

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});

test("복제는 값을 채운 편집 모달을 열고, 저장하면 새 작업이 선택된다", async () => {
    const harness = await launchApp();
    try {
        const { page } = harness;
        const dupSource = join(harness.paths.root, "source");
        const dupDestination = join(harness.paths.root, "destination");
        mkdirSync(dupSource, { recursive: true });
        mkdirSync(dupDestination, { recursive: true });
        await waitForApp(page);
        const name = "E2E 복제 원본";
        await createJob(page, { name, source: dupSource, destination: dupDestination });
        // 상단 알림이 header 단추를 가리지 않게 정리한다
        await dismissToasts(page);
        const sidebar = jobSidebar(page);
        const editor = jobEditor(page);

        // 1) 복제를 취소하면 작업이 늘지 않는다
        await page.getByRole("button", { name: "복제", exact: true }).click();
        await expect(editor).toBeVisible();
        await editor.getByRole("button", { name: "취소", exact: true }).click();
        await expect(editor).toBeHidden();
        await expect(sidebar.getByRole("listitem")).toHaveCount(1);

        // 2) 복제 → 저장: 값을 그대로 이어받고, 저장하면 새 작업이 목록에 생겨 선택된다
        await page.getByRole("button", { name: "복제", exact: true }).click();
        await expect(editor).toBeVisible();
        await expect(editor.locator("#job-name")).toHaveValue(`${name} (복제)`);
        await expect(editor.locator("#job-source")).toHaveValue(dupSource);
        await expect(editor.locator("#job-destination")).toHaveValue(dupDestination);
        await editor.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByText("작업을 저장했습니다.").last()).toBeVisible();
        await expect(editor).toBeHidden();
        await expect(sidebar.getByRole("listitem")).toHaveCount(2);
        await expect(page.locator("#job-title")).toHaveText(`${name} (복제)`);
        await expect(sidebar.locator('[aria-current="true"]')).toContainText(`${name} (복제)`);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
