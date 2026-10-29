/**
 * 비교 → 복사 → 이력 E2E. 임시 원본·대상 폴더와 임시 userData만 쓰고, 실제 rclone이 없으면 건너뛴다.
 * 화면에서 비교 요약(복사 2·동일 1·대상에만 있음 1)을 확인한 뒤 복사 실행 확인 창을 거쳐
 * 대상 파일이 생기고 이력에 '복사 완료'가 남는지 본다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";

// ========== Internal imports ==========
import { createJob, expectNoConsoleErrors, HAS_RCLONE, launchApp, waitForApp } from "./app-harness";

const JOB_NAME = "E2E 비교·복사";
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
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-copy-"));
    source = join(root, "source");
    destination = join(root, "destination");
    f_File(join(source, "new.txt"), "new file");
    f_File(join(source, "sub", "nested.txt"), "nested");
    f_File(join(source, "same.txt"), "same");
    f_File(join(destination, "same.txt"), "same");
    f_File(join(destination, "extra.txt"), "keep me");
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

test("비교 요약을 확인하고 복사한 뒤 이력이 남는다", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 비교·복사 E2E를 건너뜁니다.");

    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);
        await createJob(page, { name: JOB_NAME, source, destination });

        const workspace = page.locator("section[aria-labelledby='job-title']");
        await workspace.getByRole("button", { name: "비교", exact: true }).click();

        await expect(page.getByRole("list", { name: "비교 요약" })).toBeVisible();
        await expect(page.getByRole("button", { name: "대상에 2개 복사" })).toBeVisible();
        await expect(page.getByRole("button", { name: "동일 1개" })).toBeVisible();
        await expect(page.getByRole("button", { name: "1개 대상에만 있음(유지)" })).toBeVisible();
        await expect(page.getByRole("region", { name: "비교 결과 목록" })).toBeVisible();

        // 비교 결과가 있어야 실행 버튼이 켜진다
        await workspace.getByRole("button", { name: "복사 실행", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "복사 실행" });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "복사 실행", exact: true }).click();

        const runPanel = page.locator("#job-tabs-panel-run");
        await expect(runPanel.getByText("복사 완료", { exact: true })).toBeVisible({
            timeout: 60_000,
        });

        expect(existsSync(join(destination, "new.txt"))).toBe(true);
        expect(existsSync(join(destination, "sub", "nested.txt"))).toBe(true);
        expect(readFileSync(join(destination, "new.txt"), "utf8")).toBe("new file");
        // 복사 모드는 대상에만 있는 파일을 지우지 않는다
        expect(readFileSync(join(destination, "extra.txt"), "utf8")).toBe("keep me");

        await page.getByRole("tab", { name: "이력" }).click();
        const history = page.getByRole("table", { name: "실행 이력" });
        await expect(history).toBeVisible();
        const first = history.locator("tbody tr").first();
        await expect(first).toContainText("복사 완료");
        await expect(first).toContainText("복사 2");

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
