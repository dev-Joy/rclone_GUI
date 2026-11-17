/**
 * 작업 그룹 E2E (INT-008 FR-17, AC-11). 임시 userData만 쓰고 실제 사용자 데이터·remote는 건드리지 않는다.
 * 그룹 만들기 → 작업을 그룹에 넣기 → 접기/펼치기 → 이름 바꾸기 → 지우기(작업은 그룹 없음으로) →
 * 앱을 다시 띄워 그룹·순서가 유지되는지 확인한다. 렌더러 콘솔 오류는 0건이어야 한다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

// ========== Internal imports ==========
import {
    createJob,
    expectNoConsoleErrors,
    jobSidebar,
    openJob,
    launchApp,
    waitForApp,
} from "./app-harness";

const JOB_NAME = "그룹 작업";
const G1 = "백업";
const G1_RENAMED = "백업2";
const G2 = "임시";
const G3 = "마지막";
/** 앱은 Windows 경로 형식만 받는다. 이 테스트는 폴더를 만들지 않고 경로 형식만 저장한다 */
const SOURCE = "C:\\rclonegui-e2e\\source";
const DESTINATION = "D:\\rclonegui-e2e\\destination";

let root = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-groups-"));
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

/** 그룹 이름 대화상자(새 그룹·이름 바꾸기)로 이름을 저장한다 */
async function f_SaveGroupName(page: Page, dialogName: string, name: string): Promise<void> {
    const dialog = page.getByRole("dialog", { name: dialogName });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="groupName"]').fill(name);
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog).toBeHidden();
}

/** 중복 이름은 저장을 끄고 사유를 보여 준다 */
async function f_AssertDuplicateBlocked(page: Page): Promise<void> {
    const dialog = page.getByRole("dialog", { name: "새 그룹" });
    await dialog.locator('input[name="groupName"]').fill(G1.toLowerCase());
    await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await expect(dialog).toContainText("같은 이름의 그룹이 이미 있습니다.");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(dialog).toBeHidden();
}

/** 그룹 머리글(접기 버튼) 순서 */
function f_GroupHeaders(sidebar: Locator): Locator {
    return sidebar.locator("button[aria-expanded]");
}

test("그룹 만들기 → 작업 넣기 → 이름 바꾸기 → 지우기(작업은 그룹 없음)", async () => {
    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);
        const sidebar = jobSidebar(page);

        await sidebar.getByRole("button", { name: "+ 새 그룹", exact: true }).click();
        await f_SaveGroupName(page, "새 그룹", G1);
        await expect(f_GroupHeaders(sidebar).first()).toContainText(G1);

        await sidebar.getByRole("button", { name: "+ 새 그룹", exact: true }).click();
        await f_AssertDuplicateBlocked(page);

        await createJob(page, {
            name: JOB_NAME,
            source: SOURCE,
            destination: DESTINATION,
        });

        // 그룹이 하나라도 있으면 그룹 없는 작업은 `그룹 없음` 머리글 아래에 보인다
        await expect(f_GroupHeaders(sidebar).last()).toContainText("그룹 없음");

        // 작업을 그룹에 넣는다(편집 모달의 그룹 select)
        await openJob(page, JOB_NAME);
        const editor = page.getByRole("dialog", { name: "작업 편집" });
        await editor.locator("#job-group").selectOption({ label: G1 });
        await editor.getByRole("button", { name: "저장", exact: true }).click();
        await expect(editor).toBeHidden();
        await expect(f_GroupHeaders(sidebar).first()).toContainText(`${G1}1`);
        await expect(sidebar.getByRole("button", { name: new RegExp(JOB_NAME) })).toBeVisible();

        // 접기/펼치기(세션 안에서만)
        await f_GroupHeaders(sidebar).first().click();
        await expect(sidebar.getByRole("button", { name: new RegExp(JOB_NAME) })).toBeHidden();
        await f_GroupHeaders(sidebar).first().click();
        await expect(sidebar.getByRole("button", { name: new RegExp(JOB_NAME) })).toBeVisible();

        // 순서 확인용 그룹 두 개를 더 만든다(임시, 마지막)
        for (const name of [G2, G3]) {
            await sidebar.getByRole("button", { name: "+ 새 그룹", exact: true }).click();
            await f_SaveGroupName(page, "새 그룹", name);
        }
        await expect(f_GroupHeaders(sidebar)).toHaveCount(3); // 세 그룹(작업이 모두 그룹에 있다)

        // 이름 바꾸기
        await sidebar.getByRole("button", { name: `${G1} 그룹 이름 바꾸기` }).click();
        await f_SaveGroupName(page, "그룹 이름 바꾸기", G1_RENAMED);
        await expect(f_GroupHeaders(sidebar).first()).toContainText(G1_RENAMED);

        // 지우기: 속한 작업은 `그룹 없음`으로 옮긴다
        await sidebar.getByRole("button", { name: `${G1_RENAMED} 그룹 지우기` }).click();
        const confirm = page.getByRole("dialog", { name: "그룹 지우기" });
        await expect(confirm).toContainText("그룹 없음으로 옮깁니다");
        await confirm.getByRole("button", { name: "지우기", exact: true }).click();
        await expect(confirm).toBeHidden();
        await expect(f_GroupHeaders(sidebar)).toHaveCount(3);
        await expect(f_GroupHeaders(sidebar).first()).toContainText(G2);
        await expect(f_GroupHeaders(sidebar).nth(1)).toContainText(G3);
        await expect(f_GroupHeaders(sidebar).last()).toContainText("그룹 없음");
        await expect(sidebar.getByRole("button", { name: new RegExp(JOB_NAME) })).toBeVisible();

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close({ keepFiles: true });
    }
});

test("앱을 다시 띄워도 그룹과 순서가 유지된다", async () => {
    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);
        const sidebar = jobSidebar(page);
        const headers = f_GroupHeaders(sidebar);
        await expect(headers).toHaveCount(3);
        await expect(headers.first()).toContainText(G2);
        await expect(headers.nth(1)).toContainText(G3);
        await expect(headers.last()).toContainText("그룹 없음");
        await expect(sidebar.getByRole("button", { name: new RegExp(JOB_NAME) })).toBeVisible();
        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
