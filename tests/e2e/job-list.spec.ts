/**
 * 작업 목록 E2E (INT-002 T-04·T-05). 임시 원본·대상 폴더와 임시 userData만 쓰고, 실제 rclone이 없으면 건너뛴다.
 * 목록 한 줄에 원본 → 대상·최근 실행이 보이고, "지금 실행"은 비교 뒤 삭제 확인 모달을 거친다(취소하면 대상 불변,
 * 확인하면 삭제). 실행 뒤 상태 문구 "성공"이 보이고 설정에서 끄면 사라진다(AC-11).
 * 전체 범위 작업은 원본의 빈 폴더를 대상에 만든다(AC-9).
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// ========== Internal imports ==========
import { createJob, expectNoConsoleErrors, HAS_RCLONE, launchApp, waitForApp } from "./app-harness";

const SYNC_NAME = "E2E 목록 동기화";
const ALL_NAME = "E2E 빈 폴더 복사";
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
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-list-"));
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

test("목록에서 지금 실행: 비교 → 삭제 확인(취소·확인) → 상태 문구, 설정으로 숨김", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 작업 목록 실행 E2E를 건너뜁니다.");

    const source = join(root, "s1", "source");
    const destination = join(root, "s1", "destination");
    f_File(join(source, "keep.txt"), "keep");
    f_File(join(destination, "keep.txt"), "keep");
    f_File(join(destination, "extra.txt"), "delete me");

    const harness = await launchApp({ root: join(root, "s1") });
    try {
        const { page } = harness;
        await waitForApp(page);
        await createJob(page, { name: SYNC_NAME, source, destination, mode: "sync" });

        const row = f_Row(page, SYNC_NAME);
        await expect(row).toContainText("→");
        await expect(row).toContainText("실행 기록 없음");

        // 1) 지금 실행 → 비교 → 삭제 확인 모달 → 취소: 대상 불변
        await row.getByRole("button", { name: "지금 실행" }).click();
        const dialog = page.getByRole("dialog", { name: "동기화 실행 (삭제 포함)" });
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await expect(dialog).toContainText("extra.txt");
        await dialog.getByRole("button", { name: "취소", exact: true }).click();
        await expect(dialog).toBeHidden();
        expect(existsSync(join(destination, "extra.txt"))).toBe(true);

        // 2) 다시 지금 실행 → 체크 → 실행: 삭제됨
        await row.getByRole("button", { name: "지금 실행" }).click();
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await dialog.locator("#delete-confirm-ack").check();
        // 대상 2개 중 1개(50%)라 대량 삭제 확인도 필요하다
        await dialog.locator("#delete-confirm-large").check();
        await dialog.getByRole("button", { name: "1개 삭제 포함 실행" }).click();
        await expect(
            page.locator("#job-tabs-panel-run").getByText("동기화 완료", { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        expect(existsSync(join(destination, "extra.txt"))).toBe(false);
        expect(existsSync(join(destination, "keep.txt"))).toBe(true);

        // 3) 상태 문구: 보임 → 설정에서 끄면 숨김
        await expect(row).toContainText("최근 실행");
        await expect(row).toContainText("성공");
        const nav = page.getByRole("navigation", { name: "화면 전환" });
        await nav.getByRole("button", { name: "설정" }).click();
        await page.locator("#settings-show-job-status").uncheck();
        await f_DismissToasts(page);
        await page.getByRole("button", { name: "설정 저장", exact: true }).click();
        await expect(page.getByText(/설정을 저장했습니다/)).toBeVisible();
        await expect(row).toContainText("최근 실행");
        await expect(row).not.toContainText("성공");

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});

test("전체 범위 복사는 원본의 빈 폴더를 대상에 만든다 (AC-9)", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 빈 폴더 복사 E2E를 건너뜁니다.");

    const source = join(root, "s2", "source");
    const destination = join(root, "s2", "destination");
    f_File(join(source, "a.txt"), "a");
    mkdirSync(join(source, "empty", "inner"), { recursive: true });
    mkdirSync(destination, { recursive: true });

    const harness = await launchApp({ root: join(root, "s2") });
    try {
        const { page } = harness;
        await waitForApp(page);
        await createJob(page, { name: ALL_NAME, source, destination, scope: "all" });

        await f_Row(page, ALL_NAME).getByRole("button", { name: "지금 실행" }).click();
        const dialog = page.getByRole("dialog", { name: "복사 실행" });
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await expect(dialog).toContainText("빈 폴더 2개 생성");
        await dialog.getByRole("button", { name: "복사 실행", exact: true }).click();
        await expect(
            page.locator("#job-tabs-panel-run").getByText("복사 완료", { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        expect(existsSync(join(destination, "a.txt"))).toBe(true);
        expect(existsSync(join(destination, "empty", "inner"))).toBe(true);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
