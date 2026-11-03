/**
 * 앱에서 remote 추가·수정·삭제 E2E (INT-006 T-06, AC-14).
 * 임시 userData·임시 rclone.conf만 쓰고 실제 remote 설정은 건드리지 않는다.
 * rclone이 없으면 이유와 함께 건너뛴다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { mkdirSync } from "node:fs";
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

async function f_DismissToasts(page: Page): Promise<void> {
    const close = page.getByRole("button", { name: "알림 닫기" });
    while ((await close.count()) > 0) await close.first().click();
}

test("설정에서 remote를 추가하고 수정한 뒤 삭제한다", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 remote 설정 E2E를 건너뜁니다.");
    const paths = preparePaths();
    mkdirSync(join(paths.root, "data"), { recursive: true });
    const harness = await launchApp({ root: paths.root });
    try {
        const { page } = harness;
        await waitForApp(page);
        const nav = page.getByRole("navigation", { name: "화면 전환" });
        await nav.getByRole("button", { name: "설정" }).click();
        await expect(
            page.getByRole("heading", { name: "설정", level: 2, exact: true }),
        ).toBeVisible();

        // 추가: alias 종류 고르기 → 이름·remote 값
        await expect(page.locator("#remote-config-add")).toBeEnabled({ timeout: 30_000 });
        await page.locator("#remote-config-add").click();
        let dialog = page.getByRole("dialog");
        await dialog.locator("#remote-config-search").fill("alias");
        await dialog
            .getByRole("button", { name: /^alias/ })
            .first()
            .click();
        await dialog.locator("#remote-config-name").fill("it-e2e-alias");
        await dialog.locator("#remote-option-remote").fill(join(paths.root, "data"));
        await dialog.locator("#remote-config-save").click();
        await expect(page.getByText("remote ‘it-e2e-alias’을 추가했습니다.")).toBeVisible();
        const panel = page.locator('section[aria-labelledby="remote-config-title"]');
        await expect(panel.getByText("it-e2e-alias:", { exact: true })).toBeVisible();
        await f_DismissToasts(page);

        // 수정: 이름은 읽기 전용, remote 값은 채워져 있다
        await page.getByRole("button", { name: "it-e2e-alias 수정" }).click();
        dialog = page.getByRole("dialog");
        await expect(dialog.locator("#remote-option-remote")).toHaveValue(join(paths.root, "data"));
        await dialog.locator("#remote-option-remote").fill(join(paths.root, "data", "sub"));
        await dialog.locator("#remote-config-save").click();
        await expect(page.getByText("리모트 설정을 저장했습니다.")).toBeVisible();
        await f_DismissToasts(page);

        // 삭제: 참조 수를 보여 주고 확인하면 목록에서 사라진다
        await page.getByRole("button", { name: "it-e2e-alias 삭제" }).click();
        dialog = page.getByRole("dialog");
        await expect(dialog.getByText("작업 0개")).toBeVisible();
        await dialog.getByRole("button", { name: "리모트 삭제" }).click();
        await expect(page.getByText("remote ‘it-e2e-alias’을 삭제했습니다.")).toBeVisible();
        await expect(panel.getByText("it-e2e-alias:", { exact: true })).toHaveCount(0);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
