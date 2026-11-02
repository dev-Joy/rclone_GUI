/**
 * 자동 실행 예약 편집 E2E (INT-002 T-06·T-08). 임시 폴더와 임시 userData만 쓰고 rclone이 없어도 돈다
 * (저장·표시만 확인하고 실행하지 않는다).
 * 새 작업에서 요일 지정(월·수 09:00)으로 저장하면 목록에 "매주 월·수 09:00"이 보이고,
 * 로그인 시 시작이 꺼져 있으면 안내가 한 번 뜬다. 작업 화면의 탭은 단계 순서이고, 대기 중에는 중지 버튼이 없다.
 * 예약 실행 방식의 Windows 작업 스케줄러 선택지는 비패키징(out/) 실행이라 비활성이고 이유가 보인다(INT-003 T-01 AC-8).
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// ========== Internal imports ==========
import { expectNoConsoleErrors, launchApp, waitForApp } from "./app-harness";

const NAME = "E2E 요일 예약";

let root = "";

test.beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-schedule-"));
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

test("요일 지정 예약 저장 → 목록 표시·로그인 안내, 단계 탭 순서와 중지 버튼", async () => {
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source, { recursive: true });
    mkdirSync(destination, { recursive: true });

    const harness = await launchApp({ root: join(root, "app") });
    try {
        const { page } = harness;
        await waitForApp(page);
        const sidebar = page.locator('nav[aria-labelledby="jobs-title"]');
        await sidebar.getByRole("button", { name: "새 작업", exact: true }).click();
        await page.locator("#job-name").fill(NAME);
        await page.locator("#job-source").fill(source);
        await page.locator("#job-destination").fill(destination);

        // 자동 실행 켬 → 요일과 시각 지정 → 09:00 → 월·수만(기본 평일에서 화·목·금 끔)
        await page.locator("#job-auto-enabled").check();
        await expect(
            page.getByText("‘로그인 시 시작’이 꺼져 있습니다.", { exact: false }),
        ).toBeVisible();
        await page.locator('input[name="autoKind"][value="weekly"]').check();
        await expect(page.locator("#job-auto-interval")).toHaveCount(0);
        await page.locator("#job-auto-time").fill("09:00");
        for (const bit of [2, 4, 5]) await page.locator(`#job-auto-weekday-${bit}`).uncheck();
        await expect(page.locator("#job-auto-weekday-1")).toBeChecked();
        await expect(page.locator("#job-auto-weekday-3")).toBeChecked();
        await expect(page.locator("#job-auto-preview")).toContainText("저장하면 다음 실행");

        // 요일을 모두 끄면 저장할 수 없다는 오류
        await page.locator("#job-auto-weekday-1").uncheck();
        await page.locator("#job-auto-weekday-3").uncheck();
        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByText("요일을 하나 이상 고르세요.")).toBeVisible();
        await page.locator("#job-auto-weekday-1").check();
        await page.locator("#job-auto-weekday-3").check();

        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByText("작업을 저장했습니다.")).toBeVisible();
        await expect(
            page.getByText("설정에서 ‘로그인 시 시작’을 켜세요.", { exact: false }),
        ).toBeVisible();

        const row = sidebar.getByRole("listitem").filter({ hasText: NAME });
        await expect(row).toContainText("매주 월·수 09:00");
        await expect(page.getByText("자동 · 매주 월·수 09:00")).toBeVisible();

        // 단계 탭 순서, 대기 중에는 중지 버튼 없음, 워크스페이스에 "…취소" 버튼 없음
        const section = page.locator("section[aria-labelledby='job-title']");
        await expect(section.getByRole("tab")).toHaveText([
            "비교·미리보기",
            "실행",
            "결과·이력",
            "작업 설정",
        ]);
        await expect(page.locator("#job-stop")).toHaveCount(0);
        await expect(
            section.getByRole("button", { name: /^(비교|미리보기|실행) 취소$/ }),
        ).toHaveCount(0);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close({ keepFiles: true });
    }
});

test("예약 실행 방식: Windows 작업 스케줄러 선택지는 비활성이고 이유가 보인다", async () => {
    const harness = await launchApp({ root: join(root, "app-os") });
    try {
        const { page } = harness;
        await waitForApp(page);
        const sidebar = page.locator('nav[aria-labelledby="jobs-title"]');
        await sidebar.getByRole("button", { name: "새 작업", exact: true }).click();
        const backend = page.locator("#job-auto-backend");
        await expect(backend).toHaveValue("app");
        await expect(backend.locator('option[value="os"]')).toBeDisabled();
        await expect(backend.locator('option[value="app"]')).toBeEnabled();
        await expect(page.locator("#job-auto-backend-reason")).toContainText(
            "설치한 앱에서만 쓸 수 있습니다",
        );
        // 앱 예약에서는 암호화 conf 안내·미등록 경고가 없다
        await expect(page.locator("#job-auto-encrypted-hint")).toHaveCount(0);
        await expect(page.locator("#job-auto-os-warning")).toHaveCount(0);

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
