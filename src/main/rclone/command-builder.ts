/**
 * rclone 인자 배열 생성기와 위험 옵션 차단 목록 (MVP_SPEC §8.1, AGENTS.md 안전 규칙 3).
 * 문자열 조립 없이 구조화된 값에서만 인자 배열을 만들고, 반환 직전에 차단 목록을 통과시킨다.
 * 순서: [명령, ...플래그, "--", 원본, 대상] — "--" 뒤의 경로는 플래그로 해석되지 않는다.
 *
 * 차단 목록을 줄이는 변경은 docs/adr/ 에 ADR이 필요하다.
 * 제외 패턴은 --exclude 인자와 --exclude-from 파일만 쓴다(--filter·--filter-from·--include*는 만들지 않음).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { CMDLINE_SAFETY_MARGIN, WIN_CMDLINE_MAX } from "@/shared/option-limits";
import type { typJobRunOptions } from "@/shared/schemas/job";
import type { typRunMode } from "@/shared/schemas/common";

export class clsCommandBlockedError extends Error {
    readonly flag: string;

    constructor(flag: string, reason: string) {
        super(`차단된 rclone 옵션: ${flag} (${reason})`);
        this.name = "clsCommandBlockedError";
        this.flag = flag;
    }
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
            !a.some((x) => x === "--backup-dir" || x.startsWith("--backup-dir=")),
        reason: "IO 오류가 나도 대상 파일을 삭제함",
    },
];

/** 인자 배열에 차단 옵션이 있으면 clsCommandBlockedError를 던진다 */
export function assertNoBlockedFlags(args: readonly string[]): void {
    const end = args.indexOf("--");
    const flagEnd = end === -1 ? args.length : end;
    for (let i = 0; i < flagEnd; i += 1) {
        for (const rule of BLOCKED_FLAGS) {
            if (rule.test(args, i)) throw new clsCommandBlockedError(rule.flag, rule.reason);
        }
    }
}

/**
 * 앱이 실행하는 rclone 하위 명령 허용 목록.
 * config는 "file"만 허용한다(설정 내용을 출력하는 config show/dump 차단 — 안전 규칙 6).
 */
export const ALLOWED_COMMANDS: ReadonlyArray<readonly string[]> = [
    ["version"],
    ["config", "file"],
    ["listremotes"],
    ["lsjson"],
    ["copy"],
    ["sync"],
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

/** rclone listremotes */
export function buildListRemotesArgs(configPath: string | null): string[] {
    const args = ["listremotes", NO_ASK_PASSWORD];
    if (configPath) args.push("--config", configPath);
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

/** 제외 패턴 전달: 인자 패턴과 (있으면) --exclude-from 파일 경로 */
export interface itfExcludeArgs {
    patterns: readonly string[];
    fromFile: string | null;
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
}

/**
 * 비교에 쓰는 해시 종류. --hash만 주면 local은 지원 해시를 모두(13종) 계산·출력한다.
 * md5·sha1은 local·Drive·S3(md5)·B2(sha1)에 공통이다.
 */
export const COMPARE_HASH_TYPES: readonly string[] = ["md5", "sha1"];

/**
 * 비교용 전체 목록:
 * lsjson --recursive --files-only --no-mimetype --ask-password=false
 *        [--hash [--hash-type X]...] [--skip-links] [--fast-list] [--config C] [--exclude P]...
 *        [--exclude-from F] -- <path>
 */
export function buildLsjsonArgs(input: itfLsjsonArgsInput): string[] {
    const args = ["lsjson", "--recursive", "--files-only", "--no-mimetype", NO_ASK_PASSWORD];
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
    dryRun: boolean;
    /**
     * 실제 sync에는 필수(비교 계획의 삭제 수). 0도 유효하며 모든 파일 삭제를 막는다.
     * copy와 dry-run에서는 무시한다.
     */
    maxDelete: number | null;
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

/** --config → --exclude P… → (파일이 있으면) --exclude-from F */
function f_PushCommon(args: string[], configPath: string | null, excludes: itfExcludeArgs): void {
    if (configPath) args.push("--config", configPath);
    for (const pattern of excludes.patterns) args.push("--exclude", pattern);
    if (excludes.fromFile !== null) args.push("--exclude-from", excludes.fromFile);
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
