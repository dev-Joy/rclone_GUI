/**
 * rclone 인자 배열 생성기와 위험 옵션 차단 목록 (MVP_SPEC §8.1, AGENTS.md 안전 규칙 3).
 * 문자열 조립 없이 구조화된 값에서만 인자 배열을 만들고, 반환 직전에 차단 목록을 통과시킨다.
 * 순서: [명령, ...플래그, "--", 원본, 대상] — "--" 뒤의 경로는 플래그로 해석되지 않는다.
 *
 * 차단 목록을 줄이는 변경은 docs/adr/ 에 ADR이 필요하다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
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

export interface itfLsjsonArgsInput {
    path: string;
    configPath: string | null;
    excludes: readonly string[];
    withHash: boolean;
    skipLinks: boolean;
}

/** 비교용 전체 목록: lsjson --recursive --files-only --no-mimetype */
export function buildLsjsonArgs(input: itfLsjsonArgsInput): string[] {
    const args = ["lsjson", "--recursive", "--files-only", "--no-mimetype"];
    if (input.withHash) args.push("--hash");
    if (input.skipLinks) args.push("--skip-links");
    f_PushCommon(args, input.configPath, input.excludes);
    args.push("--", input.path);
    assertNoBlockedFlags(args);
    return args;
}

export interface itfTransferArgsInput {
    mode: typRunMode;
    source: string;
    destination: string;
    configPath: string | null;
    excludes: readonly string[];
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
    const args: string[] = [input.mode];
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
    assertNoBlockedFlags(args);
    return args;
}

function f_PushCommon(
    args: string[],
    configPath: string | null,
    excludes: readonly string[],
): void {
    if (configPath) args.push("--config", configPath);
    for (const pattern of excludes) args.push("--exclude", pattern);
}
