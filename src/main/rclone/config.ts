/**
 * rclone.conf 경로 결정과 remote 목록 조회 (MVP_SPEC §4.1, AGENTS.md 안전 규칙 6).
 * 앱은 설정 파일을 열어 읽지 않는다. 존재 여부(stat)만 보고 경로를 --config로 넘긴다.
 *
 * 순서: 수동 지정(settings.configPath) → RCLONE_CONFIG → `rclone config file` → %APPDATA%\rclone\rclone.conf → 없음
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import {
    hintForRcloneError,
    parseConfigFileOutput,
    parseListRemotes,
    summarizeStderr,
} from "@/main/parsers/rclone-env-parser";
import { buildConfigFileArgs, buildListRemotesArgs } from "@/main/rclone/command-builder";
import { clsProcessSpawnError, type typRunRclone } from "@/main/rclone/process";
import type { typConfigSource } from "@/shared/ipc-contract";
import { parsePath } from "@/shared/path-utils";
import type { typAppErrorPayload } from "@/shared/schemas/common";

/** rclone 호출별 시간 제한(ms) */
export const RCLONE_TIMEOUTS = {
    version: 10_000,
    configFile: 10_000,
    listRemotes: 20_000,
    probe: 60_000,
    /** 비교용 전체 목록(lsjson --recursive) 한 쪽 */
    compare: 30 * 60_000,
} as const;

export const NO_CONFIG_WARNING = "rclone 설정 파일이 없습니다. 로컬·UNC 경로만 쓸 수 있습니다.";

export interface itfConfigDeps {
    run: typRunRclone;
    /** 파일이 있는지(stat)만 확인한다. 내용은 읽지 않는다 */
    isFile: (p: string) => Promise<boolean>;
    env: Readonly<Record<string, string | undefined>>;
}

export interface itfResolvedConfig {
    path: string | null;
    exists: boolean;
    source: typConfigSource;
    warnings: string[];
    problem: typAppErrorPayload | null;
}

/** 드라이브·UNC 전체 경로인지 */
export function isAbsoluteWindowsPath(p: string): boolean {
    const r = parsePath(p);
    return r.ok && r.path.kind !== "remote";
}

function f_NotFound(message: string): typAppErrorPayload {
    return { code: "CONFIG_NOT_FOUND", message };
}

/** 사용자가 지정한 설정 파일 경로 확인. 문제가 없으면 null */
export async function checkConfigFile(
    p: string,
    isFile: itfConfigDeps["isFile"],
): Promise<typAppErrorPayload | null> {
    if (!isAbsoluteWindowsPath(p)) {
        return f_NotFound("rclone.conf는 전체 경로(예: C:\\...\\rclone.conf)로 지정하세요.");
    }
    if (!(await isFile(p))) return f_NotFound("지정한 rclone.conf가 없습니다.");
    return null;
}

/** 사용할 rclone.conf 경로를 정한다 */
export async function resolveConfig(
    binary: string,
    manual: string | null,
    deps: itfConfigDeps,
): Promise<itfResolvedConfig> {
    const warnings: string[] = [];

    if (manual !== null) {
        const problem = await checkConfigFile(manual, deps.isFile);
        return { path: manual, exists: problem === null, source: "manual", warnings, problem };
    }

    const fromEnv = deps.env.RCLONE_CONFIG?.trim();
    if (fromEnv) {
        if (isAbsoluteWindowsPath(fromEnv) && (await deps.isFile(fromEnv))) {
            return { path: fromEnv, exists: true, source: "env", warnings, problem: null };
        }
        warnings.push("환경 변수 RCLONE_CONFIG가 가리키는 파일이 없어 기본 위치를 찾습니다.");
    }

    try {
        const r = await deps.run(binary, buildConfigFileArgs(), {
            timeoutMs: RCLONE_TIMEOUTS.configFile,
        });
        const info = r.exitCode === 0 ? parseConfigFileOutput(r.stdout) : null;
        if (info?.exists && (await deps.isFile(info.path))) {
            return { path: info.path, exists: true, source: "auto", warnings, problem: null };
        }
        if (info && !info.exists) {
            warnings.push(NO_CONFIG_WARNING);
            return { path: info.path, exists: false, source: "none", warnings, problem: null };
        }
    } catch {
        // config file 실패 → 다음 위치
    }

    const appData = deps.env.APPDATA;
    if (appData) {
        const fallback = `${appData}\\rclone\\rclone.conf`;
        if (await deps.isFile(fallback)) {
            return { path: fallback, exists: true, source: "auto", warnings, problem: null };
        }
    }
    warnings.push(NO_CONFIG_WARNING);
    return { path: null, exists: false, source: "none", warnings, problem: null };
}

/** `rclone listremotes` 결과 이름 목록 */
export async function listRemotes(
    binary: string,
    configPath: string | null,
    deps: Pick<itfConfigDeps, "run">,
): Promise<string[]> {
    let r;
    try {
        r = await deps.run(binary, buildListRemotesArgs(configPath), {
            timeoutMs: RCLONE_TIMEOUTS.listRemotes,
        });
    } catch (e) {
        if (e instanceof clsProcessSpawnError) {
            throw new clsAppError(
                e.errno === "ENOENT" ? "RCLONE_NOT_FOUND" : "RCLONE_NOT_EXECUTABLE",
            );
        }
        throw e;
    }
    if (r.timedOut) {
        throw new clsAppError("RCLONE_FAILED", "remote 목록 조회가 시간 안에 끝나지 않았습니다.");
    }
    if (r.exitCode !== 0) {
        const hint = hintForRcloneError(r.stderrTail, null);
        throw new clsAppError(
            "RCLONE_FAILED",
            `remote 목록을 읽지 못했습니다(exit ${r.exitCode}).${hint ? ` ${hint}` : ""}`,
            summarizeStderr(r.stderrTail),
        );
    }
    if (r.stdoutTruncated) {
        throw new clsAppError("RCLONE_FAILED", "remote 목록이 너무 커서 읽지 못했습니다.");
    }
    return parseListRemotes(r.stdout);
}
