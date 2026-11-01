/**
 * remote 북마크·폴더 탐색 E2E (INT-002 T-02). 임시 userData·임시 rclone.conf(alias remote)로 앱을 띄워
 * 설정에서 북마크를 추가하고 연결 테스트를 거친 뒤, 작업 편집기에서 북마크를 골라 폴더를 두 단계
 * 내려가 원본 경로에 넣는지 확인한다. rclone이 없으면 이유와 함께 건너뛴다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== External imports ==========
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// ========== Internal imports ==========
import {
    expectNoConsoleErrors,
    HAS_RCLONE,
    launchApp,
    preparePaths,
    waitForApp,
} from "./app-harness";

/** 떠 있는 알림을 모두 닫는다(아래쪽 버튼을 가리지 않게) */
async function f_DismissToasts(page: Page): Promise<void> {
    const close = page.getByRole("button", { name: "알림 닫기" });
    while ((await close.count()) > 0) await close.first().click();
}

test("설정에서 북마크를 추가하고 작업 편집기에서 폴더를 찾아 고른다", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 remote 북마크 E2E를 건너뜁니다.");
    const paths = preparePaths();
    mkdirSync(join(paths.root, "data", "base", "a", "b"), { recursive: true });
    // 테스트 준비용 설정 파일. 앱 코드는 이 파일을 읽지 않고 경로만 --config로 넘긴다
    writeFileSync(
        paths.conf,
        `[test-remote]\ntype = alias\nremote = ${join(paths.root, "data")}\n`,
    );
    const harness = await launchApp({ root: paths.root });
    try {
        const { page } = harness;
        await waitForApp(page);
        const nav = page.getByRole("navigation", { name: "화면 전환" });
        await nav.getByRole("button", { name: "설정" }).click();
        await expect(
            page.getByRole("heading", { name: "설정", level: 2, exact: true }),
        ).toBeVisible();

        // 북마크 추가: alias·remote·기준 경로
        await expect(page.locator("#remote-bookmark-add")).toBeEnabled();
        await page.locator("#remote-bookmark-add").click();
        const editor = page.getByRole("dialog");
        await editor.locator("#remote-bookmark-alias").fill("테스트");
        await editor.locator("#remote-bookmark-remote").selectOption("test-remote");
        await editor.locator("#remote-bookmark-base").fill("base");
        await editor.locator("#remote-bookmark-save").click();
        await expect(page.getByText("test-remote:base", { exact: true })).toBeVisible();
        await f_DismissToasts(page);

        // 연결 테스트: lsjson --max-depth 1로 존재·폴더 확인
        await page.getByRole("button", { name: "테스트 연결 테스트" }).click();
        await expect(page.getByText("폴더가 있습니다.")).toBeVisible();

        // 작업 편집기: 북마크를 고르고 폴더를 두 단계 내려간다
        await nav.getByRole("button", { name: "작업" }).click();
        const sidebar = page.locator('nav[aria-labelledby="jobs-title"]');
        await sidebar.getByRole("button", { name: "새 작업", exact: true }).click();
        await page.locator("#job-name").fill("remote 북마크 E2E");
        await page.locator("#job-destination").fill(join(paths.root, "dst"));
        await page
            .locator("#job-source-remote-bookmark")
            .selectOption({ label: "테스트 — test-remote:base" });
        await expect(page.locator("#job-source")).toHaveValue("test-remote:base");

        await page.locator("#job-source-remote-browse").click();
        const browser = page.getByRole("dialog");
        await expect(browser.locator("#remote-browser-current")).toHaveText("test-remote:base");
        await browser.getByRole("button", { name: "a", exact: true }).click();
        await expect(browser.locator("#remote-browser-current")).toHaveText("test-remote:base/a");
        await browser.getByRole("button", { name: "b", exact: true }).click();
        await expect(browser.locator("#remote-browser-current")).toHaveText("test-remote:base/a/b");
        await browser.getByRole("button", { name: "이 폴더 선택" }).click();
        await expect(page.locator("#job-source")).toHaveValue("test-remote:base/a/b");

        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByText("작업을 저장했습니다.")).toBeVisible();

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
