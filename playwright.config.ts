/**
 * Playwright E2E 설정. Electron 앱(out/)을 임시 userData로 띄워 화면을 조작한다.
 * 브라우저 프로젝트를 쓰지 않고 tests/e2e의 Electron 테스트만 실행한다.
 * 실행 전 `pnpm run build`가 필요하다(`pnpm run test:e2e`가 먼저 빌드한다).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e",
    // Electron 앱 하나를 띄워 조작하므로 파일·테스트를 순서대로 실행한다
    fullyParallel: false,
    workers: 1,
    timeout: 120_000,
    expect: { timeout: 15_000 },
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: [["list"]],
    outputDir: "test-results",
    use: {
        trace: "retain-on-failure",
    },
});
