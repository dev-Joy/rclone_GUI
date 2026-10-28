// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    BLOCKED_FLAGS,
    assertNoBlockedFlags,
    buildLsjsonArgs,
    buildTransferArgs,
    clsCommandBlockedError,
    type itfTransferArgsInput,
} from "@/main/rclone/command-builder";
import { createDefaultSettings } from "@/shared/defaults";

const { excludes: _ex, ...DEFAULT_OPTIONS } = createDefaultSettings().defaults;

function f_Input(over: Partial<itfTransferArgsInput> = {}): itfTransferArgsInput {
    return {
        mode: "copy",
        source: "C:\\tmp\\src",
        destination: "test-remote:dst",
        configPath: "C:\\tmp\\rclone.conf",
        excludes: ["node_modules/**", "*.tmp"],
        options: { ...DEFAULT_OPTIONS },
        dryRun: false,
        maxDelete: null,
        ...over,
    };
}

function f_IsBlocked(i: itfTransferArgsInput): boolean {
    return i.mode === "sync" && i.options.ignoreErrors;
}

describe("buildTransferArgs", () => {
    it("copy 기본 인자 배열이 정확한 순서로 나온다", () => {
        expect(buildTransferArgs(f_Input())).toEqual([
            "copy",
            "--config",
            "C:\\tmp\\rclone.conf",
            "--exclude",
            "node_modules/**",
            "--exclude",
            "*.tmp",
            "--checkers",
            "8",
            "--transfers",
            "4",
            "--fast-list",
            "--skip-links",
            "--modify-window",
            "2000ms",
            "-v",
            "--use-json-log",
            "--stats",
            "1s",
            "--",
            "C:\\tmp\\src",
            "test-remote:dst",
        ]);
    });

    it("끈 옵션은 플래그를 생략하고, 켠 옵션만 추가한다", () => {
        const args = buildTransferArgs(
            f_Input({
                configPath: null,
                excludes: [],
                options: {
                    ...DEFAULT_OPTIONS,
                    fastList: false,
                    skipLinks: false,
                    checkHashes: true,
                },
            }),
        );
        expect(args).not.toContain("--config");
        expect(args).not.toContain("--exclude");
        expect(args).not.toContain("--fast-list");
        expect(args).not.toContain("--skip-links");
        expect(args).toContain("--checksum");
    });

    it("경로는 항상 -- 뒤 마지막 두 칸에 온다 (플래그처럼 보이는 경로 포함)", () => {
        const args = buildTransferArgs(f_Input({ source: "--dump-headers", destination: "-v" }));
        expect(args.slice(-3)).toEqual(["--", "--dump-headers", "-v"]);
    });

    it("copy에는 --max-delete를 넣지 않는다", () => {
        expect(buildTransferArgs(f_Input({ maxDelete: 5 }))).not.toContain("--max-delete");
    });

    it("실제 sync는 --max-delete 계획 수를 넣고, 0도 유효하다", () => {
        const args = buildTransferArgs(f_Input({ mode: "sync", maxDelete: 0 }));
        const i = args.indexOf("--max-delete");
        expect(args.slice(i, i + 2)).toEqual(["--max-delete", "0"]);
        expect(args).not.toContain("--dry-run");
    });

    it.each([null, -1, 1.5])("실제 sync에 maxDelete=%s 이면 거부", (maxDelete) => {
        expect(() => buildTransferArgs(f_Input({ mode: "sync", maxDelete }))).toThrow(
            clsCommandBlockedError,
        );
    });

    it("dry-run sync는 --max-delete 없이 --dry-run을 넣는다 (preflight)", () => {
        const args = buildTransferArgs(f_Input({ mode: "sync", dryRun: true, maxDelete: null }));
        expect(args).toContain("--dry-run");
        expect(args).not.toContain("--max-delete");
    });

    it("sync + ignoreErrors(백업 없음)는 차단, copy는 허용", () => {
        const options = { ...DEFAULT_OPTIONS, ignoreErrors: true };
        expect(() => buildTransferArgs(f_Input({ mode: "sync", maxDelete: 1, options }))).toThrow(
            clsCommandBlockedError,
        );
        expect(buildTransferArgs(f_Input({ options }))).toContain("--ignore-errors");
    });
});

describe("buildLsjsonArgs", () => {
    it("비교용 lsjson 인자", () => {
        expect(
            buildLsjsonArgs({
                path: "r:a",
                configPath: "C:\\c.conf",
                excludes: ["x/**"],
                withHash: true,
                skipLinks: true,
            }),
        ).toEqual([
            "lsjson",
            "--recursive",
            "--files-only",
            "--no-mimetype",
            "--hash",
            "--skip-links",
            "--config",
            "C:\\c.conf",
            "--exclude",
            "x/**",
            "--",
            "r:a",
        ]);
    });
});

describe("차단 목록", () => {
    it.each([
        [["sync", "--delete-excluded", "--", "a", "b"]],
        [["sync", "--delete-excluded=true", "--", "a", "b"]],
        [["copy", "--no-check-dest", "--", "a", "b"]],
        [["sync", "--max-delete", "-1", "--", "a", "b"]],
        [["sync", "--max-delete=-1", "--", "a", "b"]],
        [["copy", "--dump", "headers", "--", "a", "b"]],
        [["copy", "--dump-bodies", "--", "a", "b"]],
        [["sync", "--ignore-errors", "--", "a", "b"]],
    ])("%j 는 차단", (args) => {
        expect(() => assertNoBlockedFlags(args)).toThrow(clsCommandBlockedError);
    });

    it("-- 뒤 경로 영역은 검사하지 않는다", () => {
        expect(() =>
            assertNoBlockedFlags(["copy", "--", "--delete-excluded", "--dump"]),
        ).not.toThrow();
    });

    it("sync --ignore-errors 는 --backup-dir 이 있으면 허용", () => {
        expect(() =>
            assertNoBlockedFlags([
                "sync",
                "--ignore-errors",
                "--backup-dir",
                "r:bak",
                "--",
                "a",
                "b",
            ]),
        ).not.toThrow();
    });

    const bools = [false, true];
    const combos = (["copy", "sync"] as const).flatMap((mode) =>
        bools.flatMap((dryRun) =>
            bools.flatMap((fastList) =>
                bools.flatMap((checkHashes) =>
                    bools.map((ignoreErrors) =>
                        f_Input({
                            mode,
                            dryRun,
                            maxDelete: 3,
                            options: { ...DEFAULT_OPTIONS, fastList, checkHashes, ignoreErrors },
                        }),
                    ),
                ),
            ),
        ),
    );
    it.each(combos.filter((i) => !f_IsBlocked(i)))(
        "허용 조합 %# 의 생성 결과에 차단 옵션이 나오지 않는다",
        (input) => {
            const args = buildTransferArgs(input);
            const flags = args.slice(0, args.indexOf("--"));
            for (const rule of BLOCKED_FLAGS) {
                flags.forEach((_f, i) => expect(rule.test(flags, i)).toBe(false));
            }
            expect(flags).not.toContain("--progress");
        },
    );

    it.each(combos.filter(f_IsBlocked))(
        "sync + ignoreErrors 조합 %# 은 생성 단계에서 거부",
        (input) => {
            expect(() => buildTransferArgs(input)).toThrow(clsCommandBlockedError);
        },
    );
});
