/**
 * electron-vite 빌드 설정. main/preload는 CJS, renderer는 Vite ESM 번들.
 * 운영 빌드의 index.html에만 엄격한 CSP meta를 넣는다(개발 CSP는 main에서 헤더로 설정).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

const alias = { "@": resolve(import.meta.dirname, "src") };

const PROD_CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join("; ");

function f_ProdCspPlugin(): Plugin {
    return {
        name: "rclonegui-prod-csp",
        apply: "build",
        transformIndexHtml() {
            return [
                {
                    tag: "meta",
                    attrs: { "http-equiv": "Content-Security-Policy", content: PROD_CSP },
                    injectTo: "head-prepend",
                },
            ];
        },
    };
}

export default defineConfig({
    main: {
        resolve: { alias },
    },
    preload: {
        resolve: { alias },
    },
    renderer: {
        resolve: { alias },
        plugins: [react(), f_ProdCspPlugin()],
    },
});
