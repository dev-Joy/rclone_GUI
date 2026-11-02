/**
 * 빈 폴더를 만들 수 없는 대상 E2E (INT-003 T-05). 임시 원본 폴더·임시 userData와 임시 rclone.conf의
 * memory remote(CanHaveEmptyDirectories false)만 쓴다. 실제 rclone이 없으면 건너뛴다.
 * 편집기: '전체' 범위 + memory 대상이면 범위 아래에 경고가 보이고 저장은 된다. '파일만'으로 바꾸면 경고가 사라진다.
 * 비교: 빈 폴더 차이는 ‘이 저장소는 빈 폴더를 만들 수 없음(N개)’으로 따로 보이고, 실행 버튼은 이 차이만으로는 켜지지 않는다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// ========== Internal imports ==========
import {
    createJob,
    expectNoConsoleErrors,
    HAS_RCLONE,
    launchApp,
    preparePaths,
    waitForApp,
} from "./app-harness";

const JOB_NAME = "E2E 빈 폴더 불가 대상";
const MEM_REMOTE = "e2e-mem";

let root = "";

test.beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rclonegui-e2e-emptydirs-"));
});

test.afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

test("빈 폴더를 만들 수 없는 대상: 편집기 경고, 비교 안내, 실행 버튼 꺼짐", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 빈 폴더 불가 대상 E2E를 건너뜁니다.");

    const caseRoot = join(root, "mem");
    const paths = preparePaths(caseRoot);
    // 테스트 준비용 설정 파일(앱 코드는 읽지 않고 경로만 넘긴다)
    writeFileSync(paths.conf, `[${MEM_REMOTE}]\ntype = memory\n`);
    const source = join(caseRoot, "source");
    mkdirSync(join(source, "empty"), { recursive: true });

    const harness = await launchApp({ root: caseRoot });
    try {
        const { page } = harness;
        await waitForApp(page);
        await createJob(page, {
            name: JOB_NAME,
            source,
            destination: `${MEM_REMOTE}:dst`,
            scope: "all",
        });
        const warning = page.locator("#job-scope-empty-dir-warning");
        await expect(warning).toBeVisible({ timeout: 15_000 });
        await expect(warning).toContainText("빈 폴더를 만들 수 없습니다");

        await page.locator('input[name="scope"][value="files"]').check();
        await expect(warning).toHaveCount(0);
        await page.locator('input[name="scope"][value="all"]').check();
        // 저장값('전체')으로 돌아왔으므로 다시 저장할 것은 없다
        await expect(warning).toBeVisible({ timeout: 15_000 });

        const workspace = page.locator("section[aria-labelledby='job-title']");
        const compareButton = workspace.getByRole("button", { name: "비교", exact: true });
        await expect(compareButton).toBeEnabled();
        await compareButton.click();

        const notice = page.locator("#compare-empty-dirs-unsupported");
        await expect(notice).toBeVisible({ timeout: 60_000 });
        await expect(notice).toContainText("이 저장소는 빈 폴더를 만들 수 없음(1개)");
        // 폴더 줄에는 생성 문구가 없다(다른 폴더 변화도 없으므로 줄 자체가 없음)
        await expect(page.locator('[data-kind="dirs"]')).toHaveCount(0);
        await expect(
            workspace.getByRole("button", { name: "복사 실행", exact: true }),
        ).toBeDisabled();
        await expect(
            workspace.getByText(
                "이 저장소는 빈 폴더를 만들 수 없어 빈 폴더 1개는 생기지 않습니다",
                {
                    exact: false,
                },
            ),
        ).toBeVisible();

        expectNoConsoleErrors(harness.consoleErrors);
    } finally {
        await harness.close();
    }
});
