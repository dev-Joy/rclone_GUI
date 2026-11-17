/**
 * 비교 → 복사 → 이력 E2E. 임시 원본·대상 폴더와 임시 userData만 쓰고, 실제 rclone이 없으면 건너뛴다.
 * 화면에서 상태 칩(추가 2·대상만 1·같음 1)과 동기화 단추 문구를 확인한 뒤 복사 확인 창을 거쳐
 * 대상 파일이 생기고 기록 탭에 '복사 완료'가 남는지 본다.
 * 동기화 단추는 비교 전 비활성이고 ‘먼저 [비교]’를 안내하며, 비교 뒤 일어날 일을 문구로 보여 준다.
 * 로컬 대상은 '전체' 범위여도 빈 폴더 경고·안내가 없다(INT-003 T-05).
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

test("비교 칩과 동기화 단추를 확인하고 복사한 뒤 기록이 남는다", async () => {
    test.skip(!HAS_RCLONE, "실제 rclone이 없어 비교·복사 E2E를 건너뜁니다.");

    const harness = await launchApp({ root });
    try {
        const { page } = harness;
        await waitForApp(page);
        await createJob(page, { name: JOB_NAME, source, destination, scope: "all" });
        await expect(page.locator("#job-scope-empty-dir-warning")).toHaveCount(0);

        const workspace = page.locator("section[aria-labelledby='job-title']");
        const sync = workspace.locator("#job-sync");
        // 비교 전: 동기화 단추는 꺼져 있고 먼저 비교하라고 안내한다
        await expect(sync).toBeDisabled();
        await expect(sync).toHaveText("동기화 — 먼저 [비교]를 누르세요");

        await workspace.locator("#job-compare").click();

        // 비교 요약은 상태 칩 5개(추가 2·변경 0·대상만 1·오류 0·같음 1)로 보인다
        await expect(workspace.locator("button[aria-pressed][data-tone]")).toHaveCount(5);
        await expect(workspace.getByRole("button", { name: /^추가\s*2/ })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await expect(workspace.getByRole("button", { name: /^변경\s*0/ })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await expect(workspace.getByRole("button", { name: /^대상만\s*1/ })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await expect(workspace.getByRole("button", { name: /^오류\s*0/ })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        // 같음 칩은 기본으로 꺼져 있다(예전 ‘동일 숨기기’를 대신한다)
        await expect(workspace.getByRole("button", { name: /^같음\s*1/ })).toHaveAttribute(
            "aria-pressed",
            "false",
        );
        await expect(page.getByRole("region", { name: "비교 결과 목록" })).toBeVisible();
        await expect(workspace.locator("#compare-empty-dirs-unsupported")).toHaveCount(0);

        // 비교 뒤: 동기화 단추가 일어날 일을 보여 주고 켜진다
        await expect(sync).toBeEnabled();
        await expect(sync).toHaveText(/^동기화: 대상에 2개 복사/);

        await sync.click();
        const dialog = page.getByRole("dialog", { name: "복사 실행" });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "복사 실행", exact: true }).click();

        const runPanel = page.locator("#job-run-panel");
        await expect(runPanel.getByText("복사 완료", { exact: true })).toBeVisible({
            timeout: 60_000,
        });

        expect(existsSync(join(destination, "new.txt"))).toBe(true);
        expect(existsSync(join(destination, "sub", "nested.txt"))).toBe(true);
        expect(readFileSync(join(destination, "new.txt"), "utf8")).toBe("new file");
        // 복사 모드는 대상에만 있는 파일을 지우지 않는다
        expect(readFileSync(join(destination, "extra.txt"), "utf8")).toBe("keep me");

        await workspace.locator("#job-open-history").click();
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
