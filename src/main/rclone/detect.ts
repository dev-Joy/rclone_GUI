/**
 * rclone 실행 환경 감지 (MVP_SPEC §4.1, §13.2).
 * - 바이너리: 수동 지정(fallback 없음) → PATH → WinGet Links/Packages → Program Files → scoop
 * - 버전 확인(1.65.0 미만 거부, 1.75.1 초과 경고), rclone.conf 결정, remote 목록
 * - 결과는 설정(rclonePath·configPath)이 바뀌기 전까지 캐시한다. 동시 호출은 진행 중 감지를 공유한다.
 * - 로그에는 버전·출처만 남기고 stdout/stderr 원문과 설정 경로는 쓰지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { readdir, stat } from "node:fs/promises";
import { win32 } from "node:path";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsLogger } from "@/main/lib/logger";
import {
    compareVersions,
    hintForRcloneError,
    MIN_RCLONE_VERSION,
    parseRcloneVersion,
    VERIFIED_RCLONE_VERSION,
    type itfRcloneVersion,
} from "@/main/parsers/rclone-env-parser";
import { buildVersionArgs } from "@/main/rclone/command-builder";
import {
    checkConfigFile,
    isAbsoluteWindowsPath,
    listRemotes,
    RCLONE_TIMEOUTS,
    resolveConfig,
    type itfConfigDeps,
} from "@/main/rclone/config";
import { buildRcloneEnv, clsProcessSpawnError, runRclone } from "@/main/rclone/process";
import type { itfRcloneEnvironment, typBinarySource } from "@/shared/ipc-contract";
import type { typAppErrorPayload } from "@/shared/schemas/common";
import type { typSettings } from "@/shared/schemas/settings";

export { RCLONE_TIMEOUTS };

export interface itfRcloneEnvDeps extends itfConfigDeps {
    getSettings: () => Pick<typSettings, "rclonePath" | "configPath">;
    /** 폴더 안 이름 목록(WinGet Packages 탐색용) */
    readDir: (p: string) => Promise<string[]>;
    now: () => Date;
    logger: Pick<clsLogger, "info" | "warn">;
}

/** 생략하면 실제 파일 시스템·rclone·process.env를 쓴다 */
export type typRcloneEnvInit = Pick<itfRcloneEnvDeps, "getSettings" | "logger"> &
    Partial<Omit<itfRcloneEnvDeps, "getSettings" | "logger">>;

export interface itfRcloneRuntime {
    binaryPath: string;
    configPath: string | null;
}

export interface itfBinaryCandidate {
    path: string;
    source: typBinarySource;
}

type typTryResult =
    | { ok: true; version: itfRcloneVersion }
    | { ok: false; problem: typAppErrorPayload };

const PROBLEM_RANK: Partial<Record<typAppErrorPayload["code"], number>> = {
    RCLONE_NOT_FOUND: 1,
    RCLONE_NOT_EXECUTABLE: 2,
    RCLONE_VERSION_UNSUPPORTED: 3,
};

const NOT_FOUND_MESSAGE =
    "rclone을 찾지 못했습니다. PowerShell에서 winget install Rclone.Rclone 으로 설치하거나 rclone.exe를 직접 지정하세요.";

async function f_IsFile(p: string): Promise<boolean> {
    try {
        return (await stat(p)).isFile();
    } catch {
        return false;
    }
}

async function f_ReadDir(p: string): Promise<string[]> {
    try {
        return await readdir(p);
    } catch {
        return [];
    }
}

/** 자동 감지 후보. 순서대로 시도한다 */
export async function candidateBinaries(
    env: Readonly<Record<string, string | undefined>>,
    deps: Pick<itfRcloneEnvDeps, "readDir" | "isFile">,
): Promise<itfBinaryCandidate[]> {
    const out: itfBinaryCandidate[] = [];
    const seen = new Set<string>();
    const f_Add = async (p: string, source: typBinarySource) => {
        const key = p.toLowerCase();
        if (seen.has(key) || !isAbsoluteWindowsPath(p)) return;
        seen.add(key);
        if (await deps.isFile(p)) out.push({ path: p, source });
    };

    const pathVar = env.Path ?? env.PATH ?? "";
    for (const raw of pathVar.split(";")) {
        const dir = raw.trim().replace(/^"(.*)"$/, "$1");
        if (dir) await f_Add(win32.join(dir, "rclone.exe"), "path");
    }
    const local = env.LOCALAPPDATA;
    if (local) {
        const winget = win32.join(local, "Microsoft", "WinGet");
        await f_Add(win32.join(winget, "Links", "rclone.exe"), "common");
        const packages = win32.join(winget, "Packages");
        const pkgs = (await deps.readDir(packages))
            .filter((n) => n.startsWith("Rclone.Rclone_"))
            .toSorted()
            .toReversed();
        for (const pkg of pkgs) {
            const versions = (await deps.readDir(win32.join(packages, pkg)))
                .filter((n) => n.startsWith("rclone-"))
                .toSorted()
                .toReversed();
            for (const v of versions)
                await f_Add(win32.join(packages, pkg, v, "rclone.exe"), "common");
        }
    }
    if (env.ProgramFiles)
        await f_Add(win32.join(env.ProgramFiles, "rclone", "rclone.exe"), "common");
    if (env.USERPROFILE) {
        await f_Add(win32.join(env.USERPROFILE, "scoop", "shims", "rclone.exe"), "common");
    }
    return out;
}

export class clsRcloneEnv {
    private readonly deps: itfRcloneEnvDeps;
    private cache: { key: string; result: itfRcloneEnvironment } | null = null;
    private inflight: { key: string; promise: Promise<itfRcloneEnvironment> } | null = null;

    constructor(init: typRcloneEnvInit) {
        this.deps = {
            run: runRclone,
            isFile: f_IsFile,
            readDir: f_ReadDir,
            env: process.env,
            now: () => new Date(),
            ...init,
        };
    }

    /** 설정이 그대로면 캐시를 돌려준다. force면 다시 감지한다 */
    detect(force = false): Promise<itfRcloneEnvironment> {
        const s = this.deps.getSettings();
        const key = `${s.rclonePath ?? ""}|${s.configPath ?? ""}`;
        if (this.inflight?.key === key) return this.inflight.promise;
        if (!force && this.cache?.key === key) return Promise.resolve(this.cache.result);
        const promise = this.run(s).then((result) => {
            this.cache = { key, result };
            return result;
        });
        const entry = { key, promise };
        this.inflight = entry;
        promise
            .finally(() => {
                if (this.inflight === entry) this.inflight = null;
            })
            .catch(() => undefined);
        return promise;
    }

    /** 이후 단계(비교·실행·probe)용. 문제가 있으면 그 코드로 던진다 */
    async require(): Promise<itfRcloneRuntime> {
        const env = await this.detect();
        if (env.problem) {
            throw new clsAppError(env.problem.code, env.problem.message, env.problem.detail);
        }
        if (!env.binaryPath) throw new clsAppError("RCLONE_NOT_FOUND");
        return { binaryPath: env.binaryPath, configPath: env.configPath };
    }

    /** 요청·작업별 설정 파일이 있으면 그것을, 없으면 감지된 경로를 쓴다 */
    async resolveConfigFor(configOverride: string | null | undefined): Promise<string | null> {
        if (configOverride) {
            const problem = await checkConfigFile(configOverride, this.deps.isFile);
            if (problem) throw new clsAppError(problem.code, problem.message);
            return configOverride;
        }
        return (await this.detect()).configPath;
    }

    async listRemotes(configOverride?: string | null): Promise<string[]> {
        const rt = await this.require();
        const configPath = await this.resolveConfigFor(configOverride);
        if (configPath === null) return [];
        return listRemotes(rt.binaryPath, configPath, this.deps);
    }

    private async tryBinary(path: string): Promise<typTryResult> {
        try {
            const r = await this.deps.run(path, buildVersionArgs(), {
                timeoutMs: RCLONE_TIMEOUTS.version,
            });
            if (r.timedOut || r.exitCode !== 0) {
                return {
                    ok: false,
                    problem: {
                        code: "RCLONE_NOT_EXECUTABLE",
                        message: r.timedOut
                            ? "rclone version이 응답하지 않습니다."
                            : `rclone version이 실패했습니다(exit ${r.exitCode}).`,
                    },
                };
            }
            const version = parseRcloneVersion(r.stdout);
            if (!version) {
                return {
                    ok: false,
                    problem: {
                        code: "RCLONE_NOT_EXECUTABLE",
                        message:
                            "rclone 버전 출력을 해석하지 못했습니다. rclone.exe가 맞는지 확인하세요.",
                    },
                };
            }
            if (compareVersions(version, MIN_RCLONE_VERSION) < 0) {
                return {
                    ok: false,
                    problem: {
                        code: "RCLONE_VERSION_UNSUPPORTED",
                        message: `rclone ${version.text}는 지원하지 않습니다. ${MIN_RCLONE_VERSION} 이상으로 올리세요.`,
                    },
                };
            }
            return { ok: true, version };
        } catch (e) {
            if (e instanceof clsProcessSpawnError && e.errno === "ENOENT") {
                return {
                    ok: false,
                    problem: { code: "RCLONE_NOT_FOUND", message: NOT_FOUND_MESSAGE },
                };
            }
            return {
                ok: false,
                problem: {
                    code: "RCLONE_NOT_EXECUTABLE",
                    message:
                        "rclone을 실행할 수 없습니다. 파일 권한과 백신 차단 여부를 확인하세요.",
                },
            };
        }
    }

    private async findBinary(
        manual: string | null,
    ): Promise<
        | { ok: true; path: string; source: typBinarySource; version: itfRcloneVersion }
        | { ok: false; problem: typAppErrorPayload }
    > {
        if (manual !== null) {
            if (!isAbsoluteWindowsPath(manual) || !(await this.deps.isFile(manual))) {
                return {
                    ok: false,
                    problem: {
                        code: "RCLONE_NOT_FOUND",
                        message:
                            "지정한 rclone.exe가 없습니다. 다시 지정하거나 자동 감지로 되돌리세요.",
                    },
                };
            }
            const r = await this.tryBinary(manual);
            return r.ok ? { ok: true, path: manual, source: "manual", version: r.version } : r;
        }
        let best: typAppErrorPayload = { code: "RCLONE_NOT_FOUND", message: NOT_FOUND_MESSAGE };
        for (const c of await candidateBinaries(this.deps.env, this.deps)) {
            const r = await this.tryBinary(c.path);
            if (r.ok) return { ok: true, path: c.path, source: c.source, version: r.version };
            if ((PROBLEM_RANK[r.problem.code] ?? 0) > (PROBLEM_RANK[best.code] ?? 0)) {
                best = r.problem;
            }
        }
        return { ok: false, problem: best };
    }

    private async run(
        s: Pick<typSettings, "rclonePath" | "configPath">,
    ): Promise<itfRcloneEnvironment> {
        const warnings: string[] = [];
        const removed = buildRcloneEnv(this.deps.env).removed.filter(
            (n) => n.toUpperCase() !== "RCLONE_CONFIG",
        );
        if (removed.length > 0) {
            warnings.push(
                `rclone 실행 때 환경 변수 ${removed.join(", ")}를 넘기지 않습니다(위험 옵션 우회 방지).`,
            );
        }
        const base: itfRcloneEnvironment = {
            binaryPath: null,
            binarySource: null,
            version: null,
            versionText: null,
            os: null,
            arch: null,
            configPath: null,
            configExists: false,
            configSource: "none",
            remotes: [],
            problem: null,
            warnings,
            detectedAt: this.deps.now().toISOString(),
        };

        const bin = await this.findBinary(s.rclonePath);
        if (!bin.ok) {
            this.deps.logger.warn(`rclone 감지 실패: ${bin.problem.code}`);
            return { ...base, problem: bin.problem };
        }
        const v = bin.version;
        const env: itfRcloneEnvironment = {
            ...base,
            binaryPath: bin.path,
            binarySource: bin.source,
            version: `${v.major}.${v.minor}.${v.patch}`,
            versionText: v.text,
            os: v.os,
            arch: v.arch,
        };
        if (compareVersions(v, VERIFIED_RCLONE_VERSION) > 0) {
            warnings.push(
                `검증하지 않은 rclone 버전입니다(${VERIFIED_RCLONE_VERSION}에서 확인). 동작이 다르면 알려 주세요.`,
            );
        }

        const cfg = await resolveConfig(bin.path, s.configPath, this.deps);
        warnings.push(...cfg.warnings);
        env.configExists = cfg.exists;
        env.configSource = cfg.source;
        env.configPath = cfg.exists ? cfg.path : null;
        env.problem = cfg.problem;

        if (env.configPath !== null) {
            try {
                env.remotes = await listRemotes(bin.path, env.configPath, this.deps);
            } catch (e) {
                const detail = e instanceof clsAppError ? (e.detail ?? "") : "";
                const hint = hintForRcloneError(detail, null);
                const message =
                    e instanceof clsAppError ? e.message : "remote 목록을 읽지 못했습니다.";
                warnings.push(hint && !message.includes(hint) ? `${message} ${hint}` : message);
            }
        }
        this.deps.logger.info(
            `rclone 감지: ${v.text} (${bin.source}, 설정 ${cfg.source}, remote ${env.remotes.length}개)`,
        );
        return env;
    }
}
