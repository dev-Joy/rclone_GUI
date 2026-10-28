/**
 * oxlint에 없는 규칙 두 가지만 검사한다.
 * 1) child_process 옵션 `shell: true` 금지 (AGENTS.md 안전 규칙 1)
 * 2) type/interface/class 이름 접두사 typ/itf/cls (AGENTS.md §4.2 이름 접두사)
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "node_modules/**",
            "out/**",
            "dist/**",
            "release/**",
            "coverage/**",
            "docs/**",
            "tests/fixtures/**",
            "resources/**",
            "build/**",
        ],
    },
    {
        files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.mjs"],
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: "latest",
            sourceType: "module",
        },
        plugins: { "@typescript-eslint": tseslint.plugin },
        linterOptions: { reportUnusedDisableDirectives: "error" },
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    selector: "Property[key.name='shell'][value.type='Literal'][value.value=true]",
                    message:
                        "shell: true 금지. spawn/execFile(exe, args[], { shell: false })만 사용하세요.",
                },
                {
                    selector: "Property[key.value='shell'][value.type='Literal'][value.value=true]",
                    message:
                        "shell: true 금지. spawn/execFile(exe, args[], { shell: false })만 사용하세요.",
                },
            ],
            "@typescript-eslint/naming-convention": [
                "error",
                { selector: "typeAlias", format: ["PascalCase"], prefix: ["typ"] },
                {
                    selector: "interface",
                    format: ["PascalCase"],
                    prefix: ["itf"],
                    // 전역 타입 확장(declare global { interface Window })은 이름을 바꿀 수 없다
                    filter: { regex: "^Window$", match: false },
                },
                { selector: "class", format: ["PascalCase"], prefix: ["cls"] },
            ],
        },
    },
);
