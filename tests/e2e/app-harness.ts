/**
 * Playwright E2E 공용 도구. 실제 사용자 데이터를 건드리지 않도록 임시 userData·임시 rclone.conf로
 * Electron 앱(out/main/index.js)을 띄우고, 새 작업 저장·재시작에 쓰는 도우미를 제공한다.
 * rclone이 없으면 비교·복사 테스트는 건너뛴다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    _electron as electron,
    expect,
    type ElectronApplication,
    type Locator,
    type Page,
} from "@playwright/test";

// ========== 내부 상수 ==========
const RCLONE = process.env.RCLONEGUI_TEST_RCLONE ?? "rclone";
const PROBE = spawnSync(RCLONE, ["version"], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
});
/** 실제 rclone이 없으면 비교·복사 E2E를 건너뛴다 */
export const HAS_RCLONE = PROBE.status === 0;
if (!HAS_RCLONE) {
    console.warn(
        `[test:e2e] rclone을 실행할 수 없어 비교·복사 테스트를 건너뜁니다 (${RCLONE}): ${
            PROBE.error?.message ?? PROBE.stderr
        }`,
    );
}

export interface itfE2EPaths {
    root: string;
    userData: string;
    conf: string;
}

export interface itfLaunchOptions {
    /** 재시작 확인처럼 같은 임시 폴더를 다시 쓸 때 */
    root?: string;
    /** 앱에 더할 환경 변수(기본값을 덮어쓴다) */
    env?: Record<string, string>;
}

export interface itfE2EApp {
    app: ElectronApplication;
    page: Page;
    paths: itfE2EPaths;
    /** renderer 콘솔 오류·페이지 예외 */
    consoleErrors: string[];
    /** 앱을 끝내고(keepFiles가 아니면) 임시 폴더를 지운다 */
    close: (opts?: { keepFiles?: boolean }) => Promise<void>;
}

export interface itfJobInput {
    name: string;
    source: string;
    destination: string;
    /** 없으면 기본값(복사) */
    mode?: "copy" | "sync";
    /** 없으면 기본값(파일만) */
    scope?: "all" | "files";
}

/** 임시 userData·rclone.conf 경로. 이미 있는 root를 주면 그대로 쓴다(재시작) */
export function preparePaths(root?: string): itfE2EPaths {
    const base = root ?? mkdtempSync(join(tmpdir(), "rclonegui-e2e-"));
    const userData = join(base, "userdata");
    const conf = join(base, "rclone.conf");
    mkdirSync(join(userData, "logs"), { recursive: true });
    if (!existsSync(conf)) writeFileSync(conf, "");
    return { root: base, userData, conf };
}

/** process.env에서 값이 있는 항목만 복사한다(Playwright env는 string만 받는다) */
function f_Env(extra: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === "string") out[key] = value;
    }
    return { ...out, ...extra };
}

/**
 * Electron 앱을 띄운다. RCLONEGUI_E2E=1로 트레이를 만들지 않고, 창을 닫으면 앱이 끝난다.
 * 비교·복사 테스트는 RCLONE_CONFIG를 빈 임시 파일로 두어 실제 remote 설정을 읽지 않는다.
 */
export async function launchApp(opts: itfLaunchOptions = {}): Promise<itfE2EApp> {
    const paths = preparePaths(opts.root);
    const app = await electron.launch({
        args: [process.cwd()],
        cwd: process.cwd(),
        env: f_Env({
            RCLONEGUI_USER_DATA: paths.userData,
            RCLONEGUI_E2E: "1",
            RCLONE_CONFIG: paths.conf,
            RCLONEGUI_DEV_QUIT_CHOICE: "quit",
            ...opts.env,
        }),
    });
    const page = await app.firstWindow({ timeout: 90_000 });
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    const close = async (closeOpts: { keepFiles?: boolean } = {}): Promise<void> => {
        const proc = app.process();
        await Promise.race([
            app.close().catch(() => undefined),
            new Promise<void>((resolve) => {
                setTimeout(resolve, 15_000);
            }),
        ]);
        if (proc.exitCode === null && !proc.killed) proc.kill();
        if (!closeOpts.keepFiles) rmSync(paths.root, { recursive: true, force: true });
    };

    return { app, page, paths, consoleErrors, close };
}

/** 첫 화면(앱 셸)이 그려질 때까지 기다린다 */
export async function waitForApp(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: "rcloneGUI", level: 1 })).toBeVisible();
}

/** 왼쪽 작업 목록 */
export function jobSidebar(page: Page): Locator {
    return page.locator('nav[aria-labelledby="jobs-title"]');
}

/** 작업 편집 모달(상단 제목이 대화상자 이름이다) */
export function jobEditor(page: Page): Locator {
    return page.getByRole("dialog", { name: "작업 편집" });
}

/** 설정 모달(상단 제목이 대화상자 이름이다) */
export function settingsDialog(page: Page): Locator {
    return page.getByRole("dialog", { name: "설정" });
}

/** 상단 막대의 설정 단추로 설정 모달을 연다 */
export async function openSettings(page: Page): Promise<Locator> {
    await page.getByRole("button", { name: "설정", exact: true }).click();
    const dialog = settingsDialog(page);
    await expect(dialog).toBeVisible();
    return dialog;
}

/** 설정 모달을 닫는다(변경이 없을 때만. 변경이 있으면 확인 모달이 뜬다) */
export async function closeSettings(page: Page): Promise<void> {
    const dialog = settingsDialog(page);
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(dialog).toBeHidden();
}

/**
 * 떠 있는 알림을 모두 닫는다(위쪽 알림이 아래쪽 단추를 가리지 않게).
 * 모달(<dialog>)이 열려 있으면 문서가 inert가 되어 닫기 단추를 누를 수 없으므로 건너뛴다.
 * 알림은 모달을 닫은 뒤에 정리한다.
 */
export async function dismissToasts(page: Page): Promise<void> {
    if ((await page.locator("dialog[open]").count()) > 0) return;
    const close = page.getByRole("button", { name: "알림 닫기" });
    while ((await close.count()) > 0) await close.first().click();
}

/** 작업 목록(왼쪽)에서 새 작업을 열고 이름·원본·대상(주면 모드·범위도)을 채워 저장한다 */
export async function createJob(page: Page, job: itfJobInput): Promise<void> {
    await jobSidebar(page).getByRole("button", { name: "+ 새 작업", exact: true }).click();
    const dialog = jobEditor(page);
    await expect(dialog).toBeVisible();
    await dialog.locator("#job-name").fill(job.name);
    await dialog.locator("#job-source").fill(job.source);
    await dialog.locator("#job-destination").fill(job.destination);
    if (job.mode) await dialog.locator(`input[name="mode"][value="${job.mode}"]`).check();
    if (job.scope) await dialog.locator(`input[name="scope"][value="${job.scope}"]`).check();
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText("작업을 저장했습니다.").last()).toBeVisible();
    // 저장하면 편집 모달이 스스로 닫히고 작업 화면에 남는다
    await expect(dialog).toBeHidden();
}

/** 작업 목록에서 이름으로 작업을 고른다(편집 모달은 열지 않는다) */
export async function selectJob(page: Page, name: string): Promise<void> {
    await jobSidebar(page)
        .getByRole("button", { name: new RegExp(name) })
        .click();
    await expect(page.locator("#job-title")).toHaveText(name);
}

/**
 * 작업 목록에서 이름으로 작업을 고르고 편집 모달을 연다.
 * 선택지는 이름으로만 고르고(정규식), 편집 모달은 작업 화면의 `편집` 단추로 연다.
 */
export async function openJob(page: Page, name: string): Promise<void> {
    await selectJob(page, name);
    await page.locator("#job-open-edit").click();
    const dialog = jobEditor(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#job-name")).toHaveValue(name);
}

/** renderer 콘솔 오류가 없어야 한다(MVP 수용 기준) */
export function expectNoConsoleErrors(consoleErrors: readonly string[]): void {
    expect(consoleErrors).toEqual([]);
}
