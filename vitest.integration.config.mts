/**
 * 통합 테스트 설정. 실제 rclone을 임시 폴더에서만 실행한다.
 * rclone이 없으면 각 테스트가 이유를 출력하고 건너뛴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: { "@": resolve(import.meta.dirname, "src") },
    },
    test: {
        environment: "node",
        include: ["tests/integration/**/*.test.ts"],
        testTimeout: 60_000,
        fileParallelism: false,
    },
});
