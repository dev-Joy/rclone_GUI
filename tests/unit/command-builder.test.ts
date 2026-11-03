// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    ALLOWED_COMMANDS,
    BLOCKED_FLAGS,
    assertAllowedCommand,
    assertCommandLength,
    assertNoBlockedFlags,
    buildBackendFeaturesArgs,
    buildConfigFileArgs,
    buildListDirsArgs,
    buildListRemotesArgs,
    buildListRemotesLongArgs,
    buildLsjsonArgs,
    buildProbeListArgs,
    buildTransferArgs,
    buildVersionArgs,
    clsCommandBlockedError,
    COMPARE_HASH_TYPES,
    type itfLsjsonArgsInput,
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
        excludes: { patterns: ["node_modules/**", "*.tmp"], fromFile: null },
        options: { ...DEFAULT_OPTIONS },
        scope: "files",
        dryRun: false,
        maxDelete: null,
        backupDir: null,
        ...over,
    };
}

const BK = "D:\\bk\\2026-11-02_103000_1a2b3c4d";

function f_IsBlocked(i: itfTransferArgsInput): boolean {
    return i.mode === "sync" && i.options.ignoreErrors && i.backupDir === null;
}

describe("buildTransferArgs", () => {
    it("copy 기본 인자 배열이 정확한 순서로 나온다", () => {
        expect(buildTransferArgs(f_Input())).toEqual([
            "copy",
            "--ask-password=false",
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
                excludes: { patterns: [], fromFile: null },
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

describe("백업 폴더 --backup-dir (INT-003 T-03)", () => {
    it("sync + 오류 무시 + 백업 폴더 실제 실행: 정확한 순서", () => {
        const args = buildTransferArgs(
            f_Input({
                mode: "sync",
                configPath: null,
                excludes: { patterns: [], fromFile: null },
                options: { ...DEFAULT_OPTIONS, ignoreErrors: true },
                maxDelete: 2,
                backupDir: BK,
            }),
        );
        expect(args).toEqual([
            "sync",
            "--ask-password=false",
            "--checkers",
            "8",
            "--transfers",
            "4",
            "--fast-list",
            "--skip-links",
            "--ignore-errors",
            "--modify-window",
            "2000ms",
            "--backup-dir",
            BK,
            "--max-delete",
            "2",
            "-v",
            "--use-json-log",
            "--stats",
            "1s",
            "--",
            "C:\\tmp\\src",
            "test-remote:dst",
        ]);
    });

    it("dry-run(미리보기·사전 확인)에도 같은 --backup-dir를 넣는다", () => {
        const args = buildTransferArgs(f_Input({ mode: "sync", dryRun: true, backupDir: BK }));
        const i = args.indexOf("--backup-dir");
        expect(args.slice(i, i + 3)).toEqual(["--backup-dir", BK, "--dry-run"]);
    });

    it("copy에는 백업 폴더 값이 있어도 넣지 않는다", () => {
        expect(buildTransferArgs(f_Input({ backupDir: BK }))).not.toContain("--backup-dir");
    });

    it("위치 인자(-- 뒤)의 --backup-dir는 백업으로 보지 않는다 (D-9)", () => {
        expect(() =>
            assertNoBlockedFlags(["sync", "--ignore-errors", "--", "--backup-dir", "b"]),
        ).toThrow(clsCommandBlockedError);
        expect(() =>
            assertNoBlockedFlags(["sync", "--ignore-errors", "--backup-dir=r:bak", "--", "a", "b"]),
        ).not.toThrow();
    });

    it("값이 빈 --backup-dir는 백업으로 보지 않는다", () => {
        for (const args of [
            ["sync", "--ignore-errors", "--backup-dir=", "--", "a", "b"],
            ["sync", "--ignore-errors", "--backup-dir", "", "--", "a", "b"],
            ["sync", "--ignore-errors", "--backup-dir", "--", "a", "b"],
            ["sync", "--backup-dir", "--ignore-errors", "--", "a", "b"],
        ]) {
            expect(() => assertNoBlockedFlags(args)).toThrow(clsCommandBlockedError);
        }
    });
});

describe("동기화 범위 (INT-002 T-05)", () => {
    it("파일만 범위는 --create-empty-src-dirs를 넣지 않는다", () => {
        expect(buildTransferArgs(f_Input())).not.toContain("--create-empty-src-dirs");
        expect(
            buildTransferArgs(f_Input({ mode: "sync", dryRun: false, maxDelete: 0 })),
        ).not.toContain("--create-empty-src-dirs");
    });

    it("전체 범위는 copy·sync, dry-run·실제 모두 --modify-window 뒤에 --create-empty-src-dirs", () => {
        for (const input of [
            f_Input({ scope: "all" }),
            f_Input({ scope: "all", dryRun: true }),
            f_Input({ scope: "all", mode: "sync", dryRun: true }),
            f_Input({ scope: "all", mode: "sync", maxDelete: 2 }),
        ]) {
            const args = buildTransferArgs(input);
            const i = args.indexOf("--create-empty-src-dirs");
            expect(i).toBeGreaterThan(args.indexOf("--modify-window"));
            expect(i).toBeLessThan(args.indexOf("--"));
            expect(() => assertAllowedCommand(args)).not.toThrow();
        }
    });

    it("전체 범위 실제 sync의 --max-delete는 그대로 붙는다", () => {
        const args = buildTransferArgs(f_Input({ scope: "all", mode: "sync", maxDelete: 3 }));
        const i = args.indexOf("--max-delete");
        expect(args.slice(i, i + 2)).toEqual(["--max-delete", "3"]);
    });
});

describe("buildLsjsonArgs", () => {
    const base: itfLsjsonArgsInput = {
        path: "r:a",
        configPath: "C:\\c.conf",
        excludes: { patterns: ["x/**"], fromFile: null },
        withHash: true,
        hashTypes: [],
        skipLinks: true,
        fastList: false,
        scope: "files",
    };

    it("비교용 lsjson 인자", () => {
        expect(buildLsjsonArgs(base)).toEqual([
            "lsjson",
            "--recursive",
            "--files-only",
            "--no-mimetype",
            "--ask-password=false",
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

    it("전체 범위는 --files-only 없이 폴더도 나열한다 (INT-002 T-05)", () => {
        const args = buildLsjsonArgs({ ...base, scope: "all" });
        expect(args).not.toContain("--files-only");
        expect(args.slice(0, 4)).toEqual([
            "lsjson",
            "--recursive",
            "--no-mimetype",
            "--ask-password=false",
        ]);
    });

    it("hashTypes는 --hash 뒤에 --hash-type으로 하나씩 넣는다", () => {
        const args = buildLsjsonArgs({ ...base, hashTypes: COMPARE_HASH_TYPES });
        const i = args.indexOf("--hash");
        expect(args.slice(i, i + 5)).toEqual([
            "--hash",
            "--hash-type",
            "md5",
            "--hash-type",
            "sha1",
        ]);
    });

    it("withHash가 꺼져 있으면 hashTypes를 무시한다", () => {
        const args = buildLsjsonArgs({ ...base, withHash: false, hashTypes: ["md5"] });
        expect(args).not.toContain("--hash");
        expect(args).not.toContain("--hash-type");
    });

    it("fastList를 켜면 --fast-list를 넣는다", () => {
        expect(buildLsjsonArgs({ ...base, fastList: true })).toContain("--fast-list");
        expect(buildLsjsonArgs(base)).not.toContain("--fast-list");
    });

    it("허용 명령 검사를 통과하고, 플래그처럼 보이는 경로는 -- 뒤에 둔다", () => {
        const args = buildLsjsonArgs({ ...base, path: "--delete-excluded" });
        expect(() => assertAllowedCommand(args)).not.toThrow();
        expect(args.slice(-2)).toEqual(["--", "--delete-excluded"]);
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
                    bools.flatMap((ignoreErrors) =>
                        [null, BK].map((backupDir) =>
                            f_Input({
                                mode,
                                dryRun,
                                maxDelete: 3,
                                backupDir,
                                options: {
                                    ...DEFAULT_OPTIONS,
                                    fastList,
                                    checkHashes,
                                    ignoreErrors,
                                },
                            }),
                        ),
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
        "sync + ignoreErrors + 백업 없음 조합 %# 은 생성 단계에서 거부",
        (input) => {
            expect(() => buildTransferArgs(input)).toThrow(clsCommandBlockedError);
        },
    );
});

describe("환경 감지·경로 확인 빌더", () => {
    it("version / config file / listremotes 인자 배열", () => {
        expect(buildVersionArgs()).toEqual(["version"]);
        expect(buildConfigFileArgs()).toEqual(["config", "file", "--ask-password=false"]);
        expect(buildListRemotesArgs(null)).toEqual(["listremotes", "--ask-password=false"]);
        expect(buildListRemotesArgs("C:\\tmp\\rclone.conf")).toEqual([
            "listremotes",
            "--ask-password=false",
            "--config",
            "C:\\tmp\\rclone.conf",
        ]);
    });

    it("listremotes --long: 이름과 종류, --config는 뒤", () => {
        expect(buildListRemotesLongArgs(null)).toEqual([
            "listremotes",
            "--long",
            "--ask-password=false",
        ]);
        expect(buildListRemotesLongArgs("C:\\tmp\\rclone.conf")).toEqual([
            "listremotes",
            "--long",
            "--ask-password=false",
            "--config",
            "C:\\tmp\\rclone.conf",
        ]);
    });

    it("폴더 탐색: --max-depth 1 --dirs-only, 경로는 -- 뒤", () => {
        const args = buildListDirsArgs({
            path: "test-remote:base/a",
            configPath: "C:\\tmp\\rclone.conf",
        });
        expect(args).toEqual([
            "lsjson",
            "--max-depth",
            "1",
            "--dirs-only",
            "--no-mimetype",
            "--no-modtime",
            "--ask-password=false",
            "--config",
            "C:\\tmp\\rclone.conf",
            "--",
            "test-remote:base/a",
        ]);
        expect(args).not.toContain("--files-only");
        expect(buildListDirsArgs({ path: "test-remote:", configPath: null })).toEqual([
            "lsjson",
            "--max-depth",
            "1",
            "--dirs-only",
            "--no-mimetype",
            "--no-modtime",
            "--ask-password=false",
            "--",
            "test-remote:",
        ]);
    });

    it("probe 목록: --max-depth 1, --files-only 없음, 경로는 -- 뒤", () => {
        const args = buildProbeListArgs({
            parent: "--delete-excluded",
            configPath: "C:\\tmp\\rclone.conf",
        });
        expect(args).toEqual([
            "lsjson",
            "--max-depth",
            "1",
            "--no-mimetype",
            "--no-modtime",
            "--ask-password=false",
            "--config",
            "C:\\tmp\\rclone.conf",
            "--",
            "--delete-excluded",
        ]);
        expect(args).not.toContain("--files-only");
        expect(buildProbeListArgs({ parent: "test-remote:", configPath: null })).toEqual([
            "lsjson",
            "--max-depth",
            "1",
            "--no-mimetype",
            "--no-modtime",
            "--ask-password=false",
            "--",
            "test-remote:",
        ]);
    });

    it("새 빌더 결과는 모두 허용 명령이다", () => {
        for (const args of [
            buildVersionArgs(),
            buildConfigFileArgs(),
            buildListRemotesArgs(null),
            buildListRemotesLongArgs(null),
            buildListDirsArgs({ path: "a:", configPath: null }),
            buildProbeListArgs({ parent: "a:", configPath: null }),
        ]) {
            expect(() => assertAllowedCommand(args)).not.toThrow();
        }
    });
});

describe("제외 패턴 전달 (INT-002 T-09)", () => {
    const lsBase: itfLsjsonArgsInput = {
        path: "r:a",
        configPath: "C:\\c.conf",
        excludes: { patterns: ["#a", " b"], fromFile: "C:\\ud\\exclude-files\\excl-cmp-x.txt" },
        withHash: false,
        hashTypes: [],
        skipLinks: false,
        fastList: false,
        scope: "files",
    };

    it("--config → --exclude(인자 패턴) → --exclude-from 순서, '--' 앞에만", () => {
        const args = buildLsjsonArgs(lsBase);
        const i = args.indexOf("--config");
        expect(args.slice(i, i + 7)).toEqual([
            "--config",
            "C:\\c.conf",
            "--exclude",
            "#a",
            "--exclude",
            " b",
            "--exclude-from",
        ]);
        expect(args.indexOf("--exclude-from")).toBeLessThan(args.indexOf("--"));
        const t = buildTransferArgs(
            f_Input({ excludes: { patterns: ["#a"], fromFile: "C:\\f.txt" } }),
        );
        expect(t.slice(t.indexOf("--exclude"), t.indexOf("--exclude") + 4)).toEqual([
            "--exclude",
            "#a",
            "--exclude-from",
            "C:\\f.txt",
        ]);
    });

    it("--filter·--filter-from·--include*는 만들지 않는다(파일 방식 포함)", () => {
        const all = [
            buildLsjsonArgs(lsBase),
            buildTransferArgs(f_Input({ excludes: { patterns: ["a"], fromFile: "C:\\f.txt" } })),
            buildTransferArgs(
                f_Input({
                    mode: "sync",
                    dryRun: true,
                    excludes: { patterns: [], fromFile: "C:\\f.txt" },
                }),
            ),
        ];
        for (const args of all) {
            const flags = args.slice(0, args.indexOf("--"));
            expect(flags.some((a) => /^--(filter|include)/.test(a))).toBe(false);
            expect(() => assertNoBlockedFlags(args)).not.toThrow();
        }
    });

    it("차단 목록은 그대로다", () => {
        expect(BLOCKED_FLAGS.map((b) => b.flag)).toEqual([
            "--delete-excluded",
            "--no-check-dest",
            "--max-delete -1",
            "--dump*",
            "--ignore-errors (백업 없음)",
        ]);
    });

    it("assertCommandLength: 한도 안은 통과, 넘으면 VALIDATION(따옴표·역슬래시 포함 추정)", () => {
        const bin = "C:\\Program Files\\rclone\\rclone.exe";
        expect(() => assertCommandLength(bin, ["lsjson", "x".repeat(30_000)])).not.toThrow();
        expect(() => assertCommandLength(bin, ["lsjson", "x".repeat(32_300)])).toThrow(
            expect.objectContaining({
                code: "VALIDATION",
                message: expect.stringContaining("너무 깁니다"),
            }),
        );
        // 역슬래시는 이스케이프로 길이가 늘어난다고 본다
        expect(() => assertCommandLength(bin, ["lsjson", "\\".repeat(16_200)])).toThrow(
            expect.objectContaining({ code: "VALIDATION" }),
        );
    });
});

describe("허용 명령 목록", () => {
    it.each([
        [["config", "show"]],
        [["config", "dump"]],
        [["config"]],
        [["delete", "--", "a:"]],
        [["purge", "--", "a:"]],
        [["move", "--", "a:", "b:"]],
        [[]],
    ])("%j 는 거부", (args) => {
        expect(() => assertAllowedCommand(args)).toThrow(clsCommandBlockedError);
    });

    it("기존 copy/sync/lsjson 빌더 결과도 허용 목록 안에 있다", () => {
        expect(() => assertAllowedCommand(buildTransferArgs(f_Input()))).not.toThrow();
        expect(ALLOWED_COMMANDS.map((c) => c.join(" "))).toEqual([
            "version",
            "config file",
            "config providers",
            "config redacted",
            "config delete",
            "config reconnect",
            "rcd",
            "listremotes",
            "lsjson",
            "copy",
            "sync",
            "backend features",
        ]);
    });

    it("backend의 다른 하위 명령은 거부한다", () => {
        expect(() => assertAllowedCommand(["backend", "drop", "--", "a:"])).toThrow(
            clsCommandBlockedError,
        );
        expect(() => assertAllowedCommand(["backend"])).toThrow(clsCommandBlockedError);
    });

    it("buildBackendFeaturesArgs: 대상은 -- 뒤 위치 인자", () => {
        expect(buildBackendFeaturesArgs("gd:", "C:\\tmp\\rclone.conf")).toEqual([
            "backend",
            "features",
            "--ask-password=false",
            "--config",
            "C:\\tmp\\rclone.conf",
            "--",
            "gd:",
        ]);
        expect(buildBackendFeaturesArgs("gd:", null)).toEqual([
            "backend",
            "features",
            "--ask-password=false",
            "--",
            "gd:",
        ]);
    });
});
