/**
 * 비교 결과 트리 보기·파일 줄 메뉴 E2E (INT-008 AC-8·AC-9).
 * 임시 원본·대상 폴더와 임시 userData만 쓰고, 실제 rclone이 없으면 건너뛴다.
 * 트리로 바꾸면 폴더 행이 보이고, 모두 펼치기·모두 접기가 동작하며, 평면으로 바꾸면 같은 파일 수가 보인다.
 * 파일 행 우클릭 → `경로 복사` → 클립보드에 원본 기준 상대 경로가 들어가고, Escape로 메뉴가 닫힌다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";

// ========== Internal imports ==========
import {
    createJob,
    dismissToasts,
    expectNoConsoleErrors,
    HAS_RCLONE,
    launchApp,
    waitForApp,
} from "./app-harness";

const JOB_NAME = "E2E 트리·경로 복사";
const OLD = new Date("2026-01-01T00:00:00Z");

function f_File(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    utimesSync(path, OLD, OLD);
}

let root = "";
let source = "";
let destination = "";

test.beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-tree-"));
    source = join(root, "source");
    destination = join(root, "destination");
    f_File(join(source, "new.txt"), "new");
    f_File(join(source, "same.txt"), "same");
    f_File(join(source, "sub", "nested.txt"), "nested");
    f_File(join(source, "other", "deep", "x.txt"), "deep");
    f_File(join(destination, "same.txt"), "same");
    f_File(join(destination, "extra.txt"), "extra");
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

test("트리를 접고 펴고, 파일 행에서 경로를 복사한다", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 트리 E2E를 건너뜁니다.");

    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);
        await createJob(page, { name: JOB_NAME, source, destination });

        const workspace = page.locator("section[aria-labelledby='job-title']");
        const files = page.locator("tbody tr[data-status]");
        await workspace.locator("#job-compare").click();
        await expect(page.getByRole("region", { name: "비교 결과 목록" })).toBeVisible();

        // 평면(기본): 같음 칩이 꺼져 있어 파일 4개만 보인다
        await expect(files).toHaveCount(4);

        // 트리: 접힌 폴더 행만 생기고 하위 파일은 감춰진다(루트 파일 2개만)
        const modes = page.getByRole("group", { name: "보기 방식" });
        await modes.getByRole("button", { name: "트리" }).click();
        await expect(files).toHaveCount(2);
        const sub = page.getByRole("button", { name: /sub/ });
        await expect(sub).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByRole("row").filter({ hasText: "sub/nested.txt" })).toHaveCount(0);

        // 모두 펼치기/모두 접기
        await workspace.getByRole("button", { name: "모두 펼치기" }).click();
        await expect(sub).toHaveAttribute("aria-expanded", "true");
        await expect(files).toHaveCount(4);
        await workspace.getByRole("button", { name: "모두 접기" }).click();
        await expect(files).toHaveCount(2);

        // 파일 행 우클릭 → 경로 복사(원본 기준 상대 경로)
        await workspace.getByRole("button", { name: "모두 펼치기" }).click();
        const nested = page.locator("tbody tr[data-status]").filter({ hasText: "sub/nested.txt" });
        await nested.click({ button: "right" });
        const menu = page.getByRole("menu", { name: "파일 메뉴" });
        await expect(menu).toBeVisible();
        await menu.getByRole("menuitem", { name: "경로 복사" }).click();
        const copied = await harness.app.evaluate(({ clipboard }) => clipboard.readText());
        expect(copied).toBe("sub/nested.txt");
        await dismissToasts(page);

        // Escape로 메뉴가 닫힌다
        const rootFile = page.locator("tbody tr[data-status]").filter({ hasText: "new.txt" });
        await rootFile.click({ button: "right" });
        await expect(page.getByRole("menu", { name: "파일 메뉴" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu", { name: "파일 메뉴" })).toBeHidden();

        // 평면으로 바꾸면 같은 파일 수가 보인다
        await modes.getByRole("button", { name: "평면" }).click();
        await expect(files).toHaveCount(4);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
