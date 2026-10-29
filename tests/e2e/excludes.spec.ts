/**
 * 공용 제외 패턴 E2E (INT-002 T-03). 임시 userData로 앱을 띄워 두 작업이 같은 공용 패턴을 고르고
 * (중복 추가는 기존 패턴 선택), #로 시작하는 패턴은 공용으로 막히며 작업 전용으로는 안내만 보이는지,
 * 쓰는 작업을 보여 주는 확인 창을 거쳐 지우면 두 작업에서 빠지는지 확인한다. rclone은 쓰지 않는다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// ========== Internal imports ==========
import { createJob, expectNoConsoleErrors, launchApp, openJob, waitForApp } from "./app-harness";

let root = "";

test.beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-excl-"));
    for (const n of ["a-src", "a-dst", "b-src", "b-dst"]) {
        mkdirSync(join(root, n), { recursive: true });
    }
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

/** 떠 있는 알림을 모두 닫는다(같은 문구 알림이 겹치지 않게) */
async function f_DismissToasts(page: Page): Promise<void> {
    const close = page.getByRole("button", { name: "알림 닫기" });
    while ((await close.count()) > 0) await close.first().click();
}

async function f_Save(page: Page): Promise<void> {
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText("작업을 저장했습니다.")).toBeVisible();
    await f_DismissToasts(page);
}

test("공용 제외 패턴: 두 작업이 함께 쓰고, 확인 창을 거쳐 지운다", async () => {
    const harness = await launchApp();
    try {
        const { page } = harness;
        await waitForApp(page);
        const library = page.locator("#job-exclude-library");

        // 작업 A: 새 공용 패턴 추가 → 바로 선택 → 저장
        await createJob(page, {
            name: "공용 A",
            source: join(root, "a-src"),
            destination: join(root, "a-dst"),
        });
        await f_DismissToasts(page);
        await library.locator("#job-exclude-library-new").fill("  *.bak  ");
        await library.getByRole("button", { name: "공용 패턴 추가" }).click();
        await expect(library.locator("legend")).toHaveText("공용 제외 패턴 (1개 선택)");
        await expect(library.getByRole("checkbox", { name: "*.bak" })).toBeChecked();
        await f_Save(page);

        // #로 시작하는 패턴은 공용으로 막는다
        await library.locator("#job-exclude-library-new").fill("#주석");
        await library.getByRole("button", { name: "공용 패턴 추가" }).click();
        await expect(library.getByRole("alert")).toContainText("#·;로 시작하는 패턴은");

        // 작업 전용에는 쓸 수 있고 안내만 보인다
        await page.locator("#job-excludes").fill("#keep\nlogs/**");
        await expect(
            page.getByText(/#·;로 시작하는 줄 1개는 다른 작업과 공유할 수 없어/),
        ).toBeVisible();
        await page.getByRole("button", { name: "되돌리기" }).click();

        // 작업 B: 같은 패턴을 다시 추가하면 기존 패턴을 고른다
        await createJob(page, {
            name: "공용 B",
            source: join(root, "b-src"),
            destination: join(root, "b-dst"),
        });
        await f_DismissToasts(page);
        await library.locator("#job-exclude-library-new").fill("*.bak");
        await library.getByRole("button", { name: "공용 패턴 추가" }).click();
        await expect(page.getByText("이미 있는 패턴을 골랐습니다.")).toBeVisible();
        await expect(library.getByRole("checkbox", { name: "*.bak" })).toBeChecked();
        await f_DismissToasts(page);
        await f_Save(page);
        await expect(library.getByText("작업 2개에서 사용")).toBeVisible();

        // 지우기: 쓰는 작업 2개를 보여 주는 확인 창
        await library.getByRole("button", { name: "*.bak 패턴 삭제" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("list", { name: "이 패턴을 쓰는 작업" })).toContainText(
            "공용 A",
        );
        await expect(dialog.getByRole("list", { name: "이 패턴을 쓰는 작업" })).toContainText(
            "공용 B",
        );
        await dialog
            .getByRole("button", { name: "패턴 지우고 작업 2개의 비교 결과 버리기" })
            .click();
        await expect(page.getByText("공용 제외 패턴을 지웠습니다.")).toBeVisible();
        await expect(library.locator("legend")).toHaveText("공용 제외 패턴 (0개 선택)");
        await expect(page.getByText("저장됨")).toBeVisible();

        await openJob(page, "공용 A");
        await expect(library.locator("legend")).toHaveText("공용 제외 패턴 (0개 선택)");
        await expect(page.getByText("저장됨")).toBeVisible();

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
