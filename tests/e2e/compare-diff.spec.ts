/**
 * 비교 결과 파일 내용 비교(diff) 모달 E2E (INT-009 AC-1~AC-3).
 * 임시 원본·대상 폴더와 임시 userData만 쓰고, 실제 rclone이 없으면 건너뛴다.
 * 파일 행 더블클릭·파일 줄 메뉴로 모달을 열어 좌우 2열·요약·한쪽 미리보기를 보고,
 * 같음 행 메뉴에서는 항목이 비활성인지 확인한다. renderer 콘솔 오류 0.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";

// ========== Internal imports ==========
import { createJob, expectNoConsoleErrors, HAS_RCLONE, launchApp, waitForApp } from "./app-harness";

const JOB_NAME = "E2E 파일 내용 비교";
const OLD = new Date("2026-01-01T00:00:00Z");
const DIFF_TITLE = /원본·대상 내용 비교/;
const MENU_ITEM = "원본·대상 내용 비교";

function f_File(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    utimesSync(path, OLD, OLD);
}

let root = "";
let source = "";
let destination = "";

test.beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-diff-"));
    source = join(root, "source");
    destination = join(root, "destination");
    f_File(join(source, "a.txt"), "one\ntwo\nthree\n");
    f_File(join(destination, "a.txt"), "one\nTWO\nthree\nfour\n");
    f_File(join(source, "only-src.txt"), "only in source\n");
    f_File(join(source, "same.txt"), "same\n");
    f_File(join(destination, "same.txt"), "same\n");
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

test("파일 행에서 내용 비교를 열고 한쪽 미리보기·비활성 항목을 확인한다", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 내용 비교 E2E를 건너뜁니다.");

    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);
        await createJob(page, { name: JOB_NAME, source, destination });

        const workspace = page.locator("section[aria-labelledby='job-title']");
        const rows = page.locator("tbody tr[data-status]");
        const aRow = rows.filter({ hasText: "a.txt" });
        const sameRow = rows.filter({ hasText: "same.txt" });
        const onlyRow = rows.filter({ hasText: "only-src.txt" });

        await workspace.locator("#job-compare").click();
        await expect(page.getByRole("region", { name: "비교 결과 목록" })).toBeVisible();
        await expect(aRow).toHaveCount(1);

        // AC-1: 더블클릭 → 좌우 2열·요약 줄·바뀐 줄 텍스트
        await aRow.dblclick();
        const dialog = page.getByRole("dialog", { name: DIFF_TITLE });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("원본", { exact: true })).toBeVisible();
        await expect(dialog.getByText("대상", { exact: true })).toBeVisible();
        await expect(dialog.getByText(/\d+줄 추가, \d+줄 삭제, \d+줄 변경/)).toBeVisible();
        await expect(dialog.getByText("two", { exact: true })).toBeVisible();
        await expect(dialog.getByText("TWO", { exact: true })).toBeVisible();
        await expect(dialog.getByText("four", { exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "닫기" }).click();
        await expect(dialog).toBeHidden();

        // AC-2: 줄 메뉴 → 같은 모달
        await aRow.click({ button: "right" });
        const menu = page.getByRole("menu", { name: "파일 메뉴" });
        await expect(menu).toBeVisible();
        const diffItem = menu.getByRole("menuitem", { name: MENU_ITEM });
        await expect(diffItem).toBeEnabled();
        await diffItem.click();
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "닫기" }).click();
        await expect(dialog).toBeHidden();

        // AC-2: 같음 행은 칩을 켜야 보이고, 메뉴 항목이 비활성이며 이유를 title로 보인다
        await workspace.getByRole("button", { name: /^같음\s*1/ }).click();
        await expect(sameRow).toHaveCount(1);
        await sameRow.click({ button: "right" });
        await expect(menu).toBeVisible();
        const disabledItem = menu.getByRole("menuitem", { name: MENU_ITEM });
        await expect(disabledItem).toBeDisabled();
        await expect(disabledItem).toHaveAttribute("title", "같은 파일이라 비교할 내용이 없음");
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();

        // AC-3: 원본에만 있는 파일 → 왼쪽만 내용, 오른쪽에 대상에 없음 문구
        await onlyRow.dblclick();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("only in source", { exact: true })).toBeVisible();
        await expect(
            dialog.getByText("대상에 없음 — 동기화하면 새로 복사됨", { exact: true }),
        ).toBeVisible();
        await dialog.getByRole("button", { name: "닫기" }).click();
        await expect(dialog).toBeHidden();

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
