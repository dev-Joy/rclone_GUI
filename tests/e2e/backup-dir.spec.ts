/**
 * 백업 폴더 E2E (INT-003 T-03). 임시 원본·대상·백업 폴더와 임시 userData만 쓴다.
 * 편집기: 동기화에서만 백업 폴더 입력란이 보이고, 대상 안을 고르면 저장되지 않고 필드에 이유가 보인다.
 * 형제 폴더로 고치면 저장된다. 복사로 바꾸면 입력란이 숨겨진다(rclone 없이 확인).
 * 실행(rclone이 없으면 건너뜀): 오류 무시 + 백업 폴더 → 비교 → 삭제 확인 창에 "옮깁니다" 안내 → 실행 →
 * 결과에 백업 위치가 보이고 지운 파일이 백업 하위 폴더에 있다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// ========== Internal imports ==========
import { createJob, expectNoConsoleErrors, HAS_RCLONE, launchApp, waitForApp } from "./app-harness";

const OLD = new Date("2026-01-01T00:00:00Z");

function f_File(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    utimesSync(path, OLD, OLD);
}

function f_Row(page: Page, name: string) {
    return page
        .locator('nav[aria-labelledby="jobs-title"]')
        .getByRole("listitem")
        .filter({ hasText: name });
}

async function f_DismissToasts(page: Page): Promise<void> {
    const close = page.getByRole("button", { name: "알림 닫기" });
    while ((await close.count()) > 0) await close.first().click();
}

let root = "";

test.beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-backup-"));
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

test("편집기: 동기화에서만 백업 폴더가 보이고, 대상 안이면 저장되지 않는다", async () => {
    const source = join(root, "e1", "source");
    const destination = join(root, "e1", "destination");
    mkdirSync(source, { recursive: true });
    mkdirSync(destination, { recursive: true });

    const harness = await launchApp({ root: join(root, "e1") });
    try {
        const { page } = harness;
        await waitForApp(page);
        const sidebar = page.locator('nav[aria-labelledby="jobs-title"]');
        await sidebar.getByRole("button", { name: "새 작업", exact: true }).click();
        await page.locator("#job-name").fill("E2E 백업 편집");
        await page.locator("#job-source").fill(source);
        await page.locator("#job-destination").fill(destination);
        // 복사 모드(기본)에는 백업 폴더 입력란이 없다
        await expect(page.locator("#job-backup-dir")).toHaveCount(0);
        await page.locator('input[name="mode"][value="sync"]').check();
        const backup = page.locator("#job-backup-dir");
        await expect(backup).toBeVisible();

        // 대상 안 → 저장 안 됨, 필드에 이유
        await backup.fill(join(destination, "bk"));
        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByText("대상 폴더와 겹칩니다", { exact: false })).toBeVisible();
        await expect(page.getByText("작업을 저장했습니다.")).toHaveCount(0);

        // 형제 폴더 → 저장됨
        await backup.fill(join(root, "e1", "backup"));
        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByText("작업을 저장했습니다.")).toBeVisible();

        // 복사로 바꾸면 입력란을 숨기고, 값이 있으면 쓰지 않는다고 알린다
        await page.locator('input[name="mode"][value="copy"]').check();
        await expect(page.locator("#job-backup-dir")).toHaveCount(0);
        await expect(page.locator("#job-backup-dir-note")).toContainText("복사 모드는");

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});

test("실행: 오류 무시 + 백업 폴더 → 삭제 확인 창 안내 → 지운 파일이 백업 하위 폴더에 있다", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 백업 폴더 실행 E2E를 건너뜁니다.");

    const name = "E2E 백업 동기화";
    const source = join(root, "r1", "source");
    const destination = join(root, "r1", "destination");
    const backup = join(root, "r1", "backup");
    f_File(join(source, "keep.txt"), "keep");
    f_File(join(destination, "keep.txt"), "keep");
    f_File(join(destination, "extra.txt"), "move me");

    const harness = await launchApp({ root: join(root, "r1") });
    try {
        const { page } = harness;
        await waitForApp(page);
        await createJob(page, { name, source, destination, mode: "sync" });
        // 백업 폴더와 ‘오류가 나도 계속’을 켜고 저장
        await page.locator("#job-backup-dir").fill(backup);
        await page.getByText("위험 옵션", { exact: false }).click();
        await page.locator("#job-ignoreErrors").check();
        await expect(page.getByText("백업 폴더가 있어 실행할 수 있습니다.")).toBeVisible();
        await f_DismissToasts(page);
        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByText("작업을 저장했습니다.")).toBeVisible();

        await f_Row(page, name).getByRole("button", { name: "지금 실행" }).click();
        const dialog = page.getByRole("dialog", { name: "동기화 실행 (삭제 포함)" });
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await expect(dialog.locator("#delete-confirm-backup")).toContainText("옮깁니다");
        await dialog.locator("#delete-confirm-ack").check();
        // 대상 2개 중 1개(50%)라 대량 삭제 확인도 필요하다
        await dialog.locator("#delete-confirm-large").check();
        await dialog.getByRole("button", { name: "1개 삭제 포함 실행" }).click();

        const runPanel = page.locator("#job-tabs-panel-run");
        await expect(runPanel.getByText("동기화 완료", { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect(runPanel.locator("#run-backup-dir")).toContainText("로 옮김");
        expect(existsSync(join(destination, "extra.txt"))).toBe(false);
        const subs = readdirSync(backup);
        expect(subs).toHaveLength(1);
        expect(subs[0]).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}_[0-9a-f]{8}$/);
        expect(readFileSync(join(backup, subs[0]!, "extra.txt"), "utf8")).toBe("move me");

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
