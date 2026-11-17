/**
 * 앱에서 remote 추가·수정·삭제 E2E (INT-006 T-06, AC-14).
 * 임시 userData·임시 rclone.conf만 쓰고 실제 remote 설정은 건드리지 않는다.
 * 설정·remote 편집 창은 모두 모달이므로 각 대화상자를 이름으로 좁혀 고른다.
 * rclone이 없으면 이유와 함께 건너뛴다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// ========== Internal imports ==========
import {
    expectNoConsoleErrors,
    HAS_RCLONE,
    launchApp,
    openSettings,
    preparePaths,
    waitForApp,
} from "./app-harness";

test("설정에서 remote를 추가하고 수정한 뒤 삭제한다", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 remote 설정 E2E를 건너뜁니다.");
    const paths = preparePaths();
    mkdirSync(join(paths.root, "data"), { recursive: true });
    const harness = await launchApp({ root: paths.root });
    try {
        const { page } = harness;
        await waitForApp(page);
        const settings = await openSettings(page);
        await expect(settings.getByText("로그 보관 일수")).toBeVisible();

        // 추가: alias 종류 고르기 → 이름·remote 값
        await expect(page.locator("#remote-config-add")).toBeEnabled({ timeout: 30_000 });
        await page.locator("#remote-config-add").click();
        let dialog = page.getByRole("dialog", { name: "리모트 추가" });
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
        // 설정 모달이 열려 있는 동안에는 알림을 닫을 수 없다(문서가 inert) — 모달 안 조작은 알림의 영향을 받지 않는다

        // 수정: 이름은 읽기 전용, remote 값은 채워져 있다
        await page.getByRole("button", { name: "it-e2e-alias 수정" }).click();
        dialog = page.getByRole("dialog", { name: "리모트 수정" });
        await expect(dialog.locator("#remote-option-remote")).toHaveValue(join(paths.root, "data"));
        await dialog.locator("#remote-option-remote").fill(join(paths.root, "data", "sub"));
        await dialog.locator("#remote-config-save").click();
        await expect(page.getByText("리모트 설정을 저장했습니다.")).toBeVisible();

        // 삭제: 참조 수를 보여 주고 확인하면 목록에서 사라진다
        await page.getByRole("button", { name: "it-e2e-alias 삭제" }).click();
        dialog = page.getByRole("dialog", { name: "리모트 삭제" });
        await expect(dialog.getByText("작업 0개")).toBeVisible();
        await dialog.getByRole("button", { name: "리모트 삭제" }).click();
        await expect(page.getByText("remote ‘it-e2e-alias’을 삭제했습니다.")).toBeVisible();
        await expect(panel.getByText("it-e2e-alias:", { exact: true })).toHaveCount(0);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
