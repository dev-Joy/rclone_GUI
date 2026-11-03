/**
 * rclone 인자 배열 생성기와 위험 옵션 차단 목록 (MVP_SPEC §8.1, AGENTS.md 안전 규칙 3).
 * 문자열 조립 없이 구조화된 값에서만 인자 배열을 만들고, 반환 직전에 차단 목록을 통과시킨다.
 * 순서: [명령, ...플래그, "--", 원본, 대상] — "--" 뒤의 경로는 플래그로 해석되지 않는다.
 *
 * 차단 목록을 줄이는 변경은 docs/adr/ 에 ADR이 필요하다.
 * 제외 패턴은 실행마다 만든 --filter-from 파일로만 넘긴다(--exclude·--exclude-from·--include*·--filter 인자는 만들지 않음).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { CMDLINE_SAFETY_MARGIN, WIN_CMDLINE_MAX } from "@/shared/option-limits";
import type { typJobRunOptions, typSyncScope } from "@/shared/schemas/job";
import type { typRunMode } from "@/shared/schemas/common";

export class clsCommandBlockedError extends Error {
    readonly flag: string;

    constructor(flag: string, reason: string) {
        super(`차단된 rclone 옵션: ${flag} (${reason})`);
        this.name = "clsCommandBlockedError";
        this.flag = flag;
    }
}

/** 플래그 영역의 끝("--"의 위치, 없으면 길이). 그 뒤는 위치 인자(경로)다 */
function f_FlagEnd(args: readonly string[]): number {
    const end = args.indexOf("--");
    return end === -1 ? args.length : end;
}

/** 플래그 영역에 값이 비어 있지 않은 --backup-dir가 있는지(빈 값은 rclone이 백업 없음으로 본다) */
function f_HasBackupDir(args: readonly string[]): boolean {
    const flags = args.slice(0, f_FlagEnd(args));
    return flags.some((x, i) => {
        if (x.startsWith("--backup-dir=")) return x.length > "--backup-dir=".length;
        if (x !== "--backup-dir") return false;
        const v = flags[i + 1];
        return v !== undefined && v !== "" && !v.startsWith("--");
    });
}

interface itfBlockRule {
    test: (args: readonly string[], index: number) => boolean;
    reason: string;
}

/** 위험 옵션. 인자 배열의 플래그 영역("--" 앞)에만 적용한다 */
export const BLOCKED_FLAGS: ReadonlyArray<{ flag: string } & itfBlockRule> = [
    {
        flag: "--delete-excluded",
        test: (a, i) => a[i] === "--delete-excluded" || a[i]!.startsWith("--delete-excluded="),
        reason: "제외 패턴에 걸린 대상 파일까지 삭제함",
    },
    {
        flag: "--no-check-dest",
        test: (a, i) => a[i] === "--no-check-dest" || a[i]!.startsWith("--no-check-dest="),
        reason: "대상 확인 없이 덮어씀",
    },
    {
        flag: "--max-delete -1",
        test: (a, i) =>
            (a[i] === "--max-delete" && Number(a[i + 1]) < 0) ||
            (a[i]!.startsWith("--max-delete=") && Number(a[i]!.slice("--max-delete=".length)) < 0),
        reason: "삭제 한도를 없앰",
    },
    {
        flag: "--dump*",
        test: (a, i) => a[i]!.startsWith("--dump"),
        reason: "인증 헤더·본문이 로그에 남을 수 있음",
    },
    {
        flag: "--ignore-errors (백업 없음)",
        test: (a, i) =>
            a[i] === "--ignore-errors" &&
            a[0] === "sync" &&
            // 백업 폴더는 플래그 영역에 값과 함께 있을 때만 인정한다(위치 인자 "--backup-dir"는 경로일 뿐)
            !f_HasBackupDir(a),
        reason: "IO 오류가 나도 대상 파일을 삭제함",
    },
];

/** 인자 배열에 차단 옵션이 있으면 clsCommandBlockedError를 던진다 */
export function assertNoBlockedFlags(args: readonly string[]): void {
    const flagEnd = f_FlagEnd(args);
    for (let i = 0; i < flagEnd; i += 1) {
        for (const rule of BLOCKED_FLAGS) {
            if (rule.test(args, i)) throw new clsCommandBlockedError(rule.flag, rule.reason);
        }
    }
}

/**
 * 앱이 실행하는 rclone 하위 명령 허용 목록.
 * config는 "file"·"providers"·"redacted"·"delete"·"reconnect"만 허용한다
 * (설정 내용을 출력하는 config show/dump·값을 명령줄에 넣는 create/update는 차단 — 안전 규칙 1·6).
 * rcd는 remote 설정 쓰기 전용으로만 띄운다(rc-session.ts, 안전 규칙 1).
 */
export const ALLOWED_COMMANDS: ReadonlyArray<readonly string[]> = [
    ["version"],
    ["config", "file"],
    ["config", "providers"],
    ["config", "redacted"],
    ["config", "delete"],
    ["config", "reconnect"],
    ["rcd"],
    ["listremotes"],
    ["lsjson"],
    ["copy"],
    ["sync"],
    ["backend", "features"],
];

/** 허용 목록에 없는 하위 명령이면 clsCommandBlockedError를 던진다 */
export function assertAllowedCommand(args: readonly string[]): void {
    const allowed = ALLOWED_COMMANDS.some((cmd) => cmd.every((word, i) => args[i] === word));
    if (!allowed) {
        const name = args.slice(0, 2).join(" ") || "(없음)";
        throw new clsCommandBlockedError(name, "앱이 허용하지 않은 rclone 명령");
    }
}

function f_Finish(args: string[]): string[] {
    assertNoBlockedFlags(args);
    assertAllowedCommand(args);
    return args;
}

/** 비밀번호 입력 대기를 막는다(암호화된 rclone.conf) */
const NO_ASK_PASSWORD = "--ask-password=false";

/** rclone version */
export function buildVersionArgs(): string[] {
    return f_Finish(["version"]);
}

/** rclone config file — 설정 파일 경로만 출력한다(내용은 읽지 않음) */
export function buildConfigFileArgs(): string[] {
    return f_Finish(["config", "file", NO_ASK_PASSWORD]);
}

/** remote 이름을 위치 인자로 넘기기 전에 확인한다(`-` 시작은 rclone이 플래그로 해석한다, notes #44) */
function f_AssertRemoteNameArg(name: string): void {
    // oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
    if (name === "" || name.startsWith("-") || /[\u0000-\u001f]/.test(name)) {
        throw new clsAppError(
            "REMOTE_NAME_INVALID",
            "리모트 이름이 비어 있거나 -로 시작합니다. 다른 이름을 쓰세요.",
        );
    }
}

/** rclone config providers — 지원하는 모든 종류와 옵션 정의(JSON). 값이 아니라 정의만 읽는다 */
export function buildConfigProvidersArgs(): string[] {
    return f_Finish(["config", "providers", NO_ASK_PASSWORD]);
}

/** rclone config redacted <name> — 비밀 값을 rclone이 가린 설정(수정 화면용, 안전 규칙 6 예외) */
export function buildConfigRedactedArgs(name: string, configPath: string | null): string[] {
    f_AssertRemoteNameArg(name);
    const args = ["config", "redacted", name, NO_ASK_PASSWORD];
    if (configPath) args.push("--config", configPath);
    return f_Finish(args);
}

/** rclone config delete <name> — remote 하나를 지운다(없는 이름도 exit 0이므로 호출 전에 확인한다) */
export function buildConfigDeleteArgs(name: string, configPath: string | null): string[] {
    f_AssertRemoteNameArg(name);
    const args = ["config", "delete", name, NO_ASK_PASSWORD];
    if (configPath) args.push("--config", configPath);
    return f_Finish(args);
}

/** rclone config reconnect <name>: — OAuth 토큰을 다시 받는다(값은 명령줄에 없다) */
export function buildConfigReconnectArgs(name: string, configPath: string | null): string[] {
    f_AssertRemoteNameArg(name);
    const args = ["config", "reconnect", `${name}:`, NO_ASK_PASSWORD];
    if (configPath) args.push("--config", configPath);
    return f_Finish(args);
}

/**
 * rclone rcd — remote 설정 쓰기 전용 임시 서버(안전 규칙 1).
 * loopback·임의 포트만 쓰고 인증 토큰은 환경 변수(RCLONE_RC_USER·RCLONE_RC_PASS)로만 넘긴다.
 */
export function buildRcdArgs(configPath: string | null): string[] {
    const args = ["rcd", "--rc-addr", "127.0.0.1:0", NO_ASK_PASSWORD];
    if (configPath) args.push("--config", configPath);
    return f_Finish(args);
}

/** rclone listremotes */
export function buildListRemotesArgs(configPath: string | null): string[] {
    const args = ["listremotes", NO_ASK_PASSWORD];
    if (configPath) args.push("--config", configPath);
    return f_Finish(args);
}

/** rclone listremotes --long — remote 이름과 종류를 함께 읽는다(설정 내용은 출력하지 않음) */
export function buildListRemotesLongArgs(configPath: string | null): string[] {
    const args = ["listremotes", "--long", NO_ASK_PASSWORD];
    if (configPath) args.push("--config", configPath);
    return f_Finish(args);
}

/**
 * rclone backend features <대상> — 저장소 기능(Move·CanHaveEmptyDirectories, INT-003 FR-36·FR-30).
 * 대상은 "--" 뒤 위치 인자로 준다(rclone-notes #30).
 */
export function buildBackendFeaturesArgs(target: string, configPath: string | null): string[] {
    const args = ["backend", "features", NO_ASK_PASSWORD];
    if (configPath) args.push("--config", configPath);
    args.push("--", target);
    return f_Finish(args);
}

export interface itfListDirsArgsInput {
    /** remote 경로("name:base") */
    path: string;
    configPath: string | null;
}

/** 폴더 탐색: lsjson --max-depth 1 --dirs-only (한 단계, 폴더만) */
export function buildListDirsArgs(input: itfListDirsArgsInput): string[] {
    const args = [
        "lsjson",
        "--max-depth",
        "1",
        "--dirs-only",
        "--no-mimetype",
        "--no-modtime",
        NO_ASK_PASSWORD,
    ];
    if (input.configPath) args.push("--config", input.configPath);
    args.push("--", input.path);
    return f_Finish(args);
}

export interface itfProbeListArgsInput {
    /** 확인할 경로의 부모(remote 루트 포함) */
    parent: string;
    configPath: string | null;
}

/** 경로 확인용 부모 목록: lsjson --max-depth 1 (폴더 포함, --files-only 없음) */
export function buildProbeListArgs(input: itfProbeListArgsInput): string[] {
    const args = ["lsjson", "--max-depth", "1", "--no-mimetype", "--no-modtime", NO_ASK_PASSWORD];
    if (input.configPath) args.push("--config", input.configPath);
    args.push("--", input.parent);
    return f_Finish(args);
}

/** 제외 패턴 전달: --filter-from 파일 경로(없으면 null) */
export interface itfExcludeArgs {
    filterFile: string | null;
}

export interface itfLsjsonArgsInput {
    path: string;
    configPath: string | null;
    excludes: itfExcludeArgs;
    withHash: boolean;
    /** withHash일 때만. 예: ["md5", "sha1"] → --hash-type md5 --hash-type sha1 */
    hashTypes: readonly string[];
    skipLinks: boolean;
    /** 지원 remote(Drive 등)에서 목록 호출 수를 줄인다. local에서는 무시됨 */
    fastList: boolean;
    /** files: 파일만(--files-only), all: 폴더도 목록에 넣는다(INT-002 T-05) */
    scope: typSyncScope;
}

/**
 * 비교에 쓰는 해시 종류. --hash만 주면 local은 지원 해시를 모두(13종) 계산·출력한다.
 * md5·sha1은 local·Drive·S3(md5)·B2(sha1)에 공통이다.
 */
export const COMPARE_HASH_TYPES: readonly string[] = ["md5", "sha1"];

/**
 * 비교용 전체 목록:
 * lsjson --recursive [--files-only] --no-mimetype --ask-password=false
 *        [--hash [--hash-type X]...] [--skip-links] [--fast-list] [--config C] [--filter-from F] -- <path>
 */
export function buildLsjsonArgs(input: itfLsjsonArgsInput): string[] {
    const args = [
        "lsjson",
        "--recursive",
        ...(input.scope === "files" ? ["--files-only"] : []),
        "--no-mimetype",
        NO_ASK_PASSWORD,
    ];
    if (input.withHash) {
        args.push("--hash");
        for (const t of input.hashTypes) args.push("--hash-type", t);
    }
    if (input.skipLinks) args.push("--skip-links");
    if (input.fastList) args.push("--fast-list");
    f_PushCommon(args, input.configPath, input.excludes);
    args.push("--", input.path);
    return f_Finish(args);
}

export interface itfTransferArgsInput {
    mode: typRunMode;
    source: string;
    destination: string;
    configPath: string | null;
    excludes: itfExcludeArgs;
    options: typJobRunOptions;
    /** all이면 --create-empty-src-dirs (copy·sync, dry-run·실제 모두) */
    scope: typSyncScope;
    dryRun: boolean;
    /**
     * 실제 sync에는 필수(비교 계획의 삭제 수). 0도 유효하며 모든 파일 삭제를 막는다.
     * copy와 dry-run에서는 무시한다.
     */
    maxDelete: number | null;
    /**
     * sync에서 지우거나 덮어쓸 파일을 옮길 위치(실행별 하위 폴더까지 붙은 최종 값). 없으면 null.
     * copy에서는 무시한다. dry-run·사전 확인·실제 실행에 같은 값을 준다(INT-003 FR-25).
     */
    backupDir: string | null;
}

/** copy/sync 인자. 실제 sync는 maxDelete 없이 만들 수 없다 */
export function buildTransferArgs(input: itfTransferArgsInput): string[] {
    const { options: o } = input;
    const args: string[] = [input.mode, NO_ASK_PASSWORD];
    f_PushCommon(args, input.configPath, input.excludes);
    args.push("--checkers", String(o.checkers), "--transfers", String(o.transfers));
    if (o.fastList) args.push("--fast-list");
    if (o.skipLinks) args.push("--skip-links");
    if (o.ignoreErrors) args.push("--ignore-errors");
    if (o.checkHashes) args.push("--checksum");
    args.push("--modify-window", `${o.modtimeToleranceMs}ms`);
    if (input.scope === "all") args.push("--create-empty-src-dirs");
    if (input.mode === "sync" && input.backupDir !== null)
        args.push("--backup-dir", input.backupDir);
    if (input.dryRun) {
        args.push("--dry-run");
    } else if (input.mode === "sync") {
        if (input.maxDelete === null || !Number.isInteger(input.maxDelete) || input.maxDelete < 0) {
            throw new clsCommandBlockedError(
                "--max-delete",
                "실제 sync에는 0 이상의 삭제 한도가 필요함",
            );
        }
        args.push("--max-delete", String(input.maxDelete));
    }
    args.push("-v", "--use-json-log", "--stats", "1s");
    args.push("--", input.source, input.destination);
    return f_Finish(args);
}

/** --config → (파일이 있으면) --filter-from F */
function f_PushCommon(args: string[], configPath: string | null, excludes: itfExcludeArgs): void {
    if (configPath) args.push("--config", configPath);
    if (excludes.filterFile !== null) args.push("--filter-from", excludes.filterFile);
}

/** Windows 명령줄 한 인자의 추정 길이: 값 + 따옴표·공백 3 + 이스케이프될 " 와 \ */
function f_ArgLength(arg: string): number {
    let extra = 0;
    for (const ch of arg) if (ch === '"' || ch === "\\") extra += 1;
    return arg.length + 3 + extra;
}

/** 명령줄이 Windows 한도(여유 포함)를 넘으면 VALIDATION */
export function assertCommandLength(binaryPath: string, args: readonly string[]): void {
    const total = [binaryPath, ...args].reduce((sum, a) => sum + f_ArgLength(a), 0);
    const limit = WIN_CMDLINE_MAX - CMDLINE_SAFETY_MARGIN;
    if (total > limit) {
        throw new clsAppError(
            "VALIDATION",
            `rclone 명령이 너무 깁니다(${total}자, 한도 ${limit}자). 제외 패턴이나 경로를 줄이세요.`,
        );
    }
}
