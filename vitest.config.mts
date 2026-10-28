/**
 * 단위 테스트 설정. 실제 rclone을 쓰는 통합 테스트는 vitest.integration.config.ts.
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
        include: ["tests/unit/**/*.test.ts"],
    },
});
