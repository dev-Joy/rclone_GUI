/**
 * 경로 접근 확인(probe) (MVP_SPEC §6.4).
 * - 로컬·UNC: fs.stat(시간 제한) → 폴더면 opendir로 읽기 권한 확인
 * - remote: 부모 폴더를 `lsjson --max-depth 1`로 나열해 이름이 정확히 같은 항목을 찾는다
 *   (`lsjson -- <파일>`은 그 파일 1건을 돌려주므로 대상 자체를 나열하면 폴더·파일을 구분할 수 없다)
 * 읽기 전용이며 파일을 만들거나 바꾸지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { opendir, stat } from "node:fs/promises";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { clsLsjsonParseError, parseLsjsonEntries } from "@/main/parsers/lsjson-parser";
import { hintForRcloneError, summarizeStderr } from "@/main/parsers/rclone-env-parser";
import { buildProbeListArgs } from "@/main/rclone/command-builder";
import { RCLONE_TIMEOUTS } from "@/main/rclone/config";
import type { clsRcloneEnv } from "@/main/rclone/detect";
import { clsProcessSpawnError, runRclone, type typRunRclone } from "@/main/rclone/process";
import type { itfPathProbe } from "@/shared/ipc-contract";
import {
    canonicalLocation,
    isRemoteAbsolute,
    LONG_PATH_WARN_LENGTH,
    parsePath,
    type itfParsedPath,
} from "@/shared/path-utils";
import type { typTestPathInput } from "@/shared/schemas/rclone";

export interface itfPathServiceDeps {
    rcloneEnv: Pick<clsRcloneEnv, "require" | "resolveConfigFor">;
    run: typRunRclone;
    stat: (p: string) => Promise<{ isDirectory(): boolean }>;
    /** 읽기 가능 확인용 */
    openDir: (p: string) => Promise<{ close(): Promise<void> }>;
    /** 로컬·UNC 응답 대기 상한. 기본 15초(중지된 WSL 배포판·끊긴 공유 대비) */
    localTimeoutMs?: number;
    /** 응답 없는 fs 호출 수 제한. 기본 새 인스턴스 */
    fsGate?: clsFsGate;
}

export type typPathServiceInit = Pick<itfPathServiceDeps, "rcloneEnv"> &
    Partial<Omit<itfPathServiceDeps, "rcloneEnv">>;

const DEFAULT_LOCAL_TIMEOUT_MS = 15_000;
/** fs 호출이 시간 안에 끝나지 않음 */
export const FS_TIMEOUT = Symbol("timeout");
const NETWORK_ERRORS = new Set(["ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EBADNETPATH"]);

/** probe가 "없음"을 알릴 때의 문구 앞부분(네트워크·시간 초과와 구분용) */
export const PROBE_MISSING_MESSAGE = "경로가 없습니다.";

const MSG = {
    dir: "폴더가 있습니다.",
    file: "파일입니다. 폴더를 지정하세요.",
    missing: PROBE_MISSING_MESSAGE,
    gateBusy:
        "이전 확인이 아직 끝나지 않았습니다(응답 없는 경로). 네트워크·WSL 상태를 확인한 뒤 잠시 후 다시 시도하세요.",
} as const;

function f_Code(e: unknown): string {
    if (e && typeof e === "object" && "code" in e && typeof e.code === "string") return e.code;
    return "UNKNOWN";
}

export interface itfFsGateOptions {
    /** 동시에 끝나지 않은 fs 호출 상한. 기본 2(libuv 스레드 4개 중 2개는 저장·로그용으로 남긴다) */
    maxPending: number;
}

/**
 * 응답 없는 fs 호출 제한.
 * 시간 제한은 기다림만 끊고 fs.stat/opendir은 libuv 스레드풀(기본 4)에 남는다. 응답 없는 UNC·WSL 경로를
 * 반복 확인하면 스레드가 모두 묶여 설정 저장·로그 쓰기까지 멈추므로, 실제 호출이 끝날 때까지 수를 센다.
 * - 같은 root(예: `\\wsl.localhost\distro`, `e:`)에서 시간 초과 후 아직 안 끝난 호출이 있으면 거부
 * - 끝나지 않은 호출이 maxPending 이상이면 거부
 */
export class clsFsGate {
    private readonly maxPending: number;
    private pending = 0;
    private readonly hungRoots = new Map<string, number>();

    constructor(opts: Partial<itfFsGateOptions> = {}) {
        this.maxPending = opts.maxPending ?? 2;
    }

    /** 실제로 끝나지 않은 fs 호출 수(시간 초과 포함) */
    get pendingCount(): number {
        return this.pending;
    }

    /** 막혔으면 null. 통과하면 task 결과(시간 초과면 FS_TIMEOUT)를 돌려준다. 늦게 끝난 쪽의 오류는 버린다 */
    run<T>(
        root: string,
        task: () => Promise<T>,
        timeoutMs: number,
    ): Promise<T | typeof FS_TIMEOUT> | null {
        if ((this.hungRoots.get(root) ?? 0) > 0 || this.pending >= this.maxPending) return null;
        this.pending += 1;
        let hung = false;
        let p: Promise<T>;
        try {
            p = task();
        } catch (e) {
            p = Promise.reject(e);
        }
        const settled = p.finally(() => {
            this.pending -= 1;
            if (!hung) return;
            const n = (this.hungRoots.get(root) ?? 1) - 1;
            if (n > 0) this.hungRoots.set(root, n);
            else this.hungRoots.delete(root);
        });
        settled.catch(() => undefined);
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<typeof FS_TIMEOUT>((r) => {
            timer = setTimeout(() => {
                hung = true;
                this.hungRoots.set(root, (this.hungRoots.get(root) ?? 0) + 1);
                r(FS_TIMEOUT);
            }, timeoutMs);
        });
        return Promise.race([p, timeout]).finally(() => {
            if (timer) clearTimeout(timer);
        });
    }
}

/** 경로 종류와 상관없는 경고 */
function f_CommonWarnings(p: itfParsedPath): string[] {
    const warnings: string[] = [];
    if (p.segments.length === 0) {
        warnings.push("루트 전체는 작업 경로로 쓸 수 없습니다. 하위 폴더를 고르세요.");
    }
    if (p.normalized.length > LONG_PATH_WARN_LENGTH) {
        warnings.push(
            `경로가 ${LONG_PATH_WARN_LENGTH}자를 넘습니다. 일부 파일이 실패할 수 있습니다.`,
        );
    }
    const c = canonicalLocation(p, true);
    if (c.wslMntAlias) {
        warnings.push(
            `WSL /mnt 경로입니다. 같은 폴더를 Windows 경로(${c.root.toUpperCase()}\\...)로 쓰면 더 빠릅니다.`,
        );
    }
    return warnings;
}

/**
 * remote 경로의 부모와 이름. 맨 앞 / 는 보존한다.
 * "rr:a/b" → { parent: "rr:a", name: "b" }, "rr:/a" → { parent: "rr:/", name: "a" }, "rr:" → null
 */
export function remoteParentOf(p: itfParsedPath): { parent: string; name: string } | null {
    if (p.kind !== "remote" || p.segments.length === 0) return null;
    return {
        parent: p.root + (isRemoteAbsolute(p) ? "/" : "") + p.segments.slice(0, -1).join("/"),
        name: p.segments.at(-1)!,
    };
}

export class clsPathService {
    private readonly deps: Required<itfPathServiceDeps>;

    constructor(init: typPathServiceInit) {
        this.deps = {
            run: runRclone,
            stat: (p) => stat(p),
            openDir: (p) => opendir(p),
            localTimeoutMs: DEFAULT_LOCAL_TIMEOUT_MS,
            fsGate: new clsFsGate(),
            ...init,
        };
    }

    async probe(input: typTestPathInput): Promise<itfPathProbe> {
        const parsed = parsePath(input.path);
        if (!parsed.ok) throw new clsAppError(parsed.issue.code, parsed.issue.message);
        const p = parsed.path;
        const base: itfPathProbe = {
            kind: p.kind,
            displayPath: p.display,
            normalizedPath: p.normalized,
            exists: false,
            isDirectory: false,
            readable: null,
            isRoot: p.segments.length === 0,
            message: MSG.missing,
            warnings: f_CommonWarnings(p),
        };
        return p.kind === "remote"
            ? this.probeRemote(p, input.configPath, base)
            : this.probeLocal(p, base);
    }

    private async probeLocal(p: itfParsedPath, base: itfPathProbe): Promise<itfPathProbe> {
        const ms = this.deps.localTimeoutMs;
        const timeoutMsg = `응답이 없습니다(${Math.round(ms / 1000)}초). 네트워크·WSL 상태를 확인하세요.`;
        // UNC 공유 루트는 끝에 \ 가 있어야 stat이 된다
        const target =
            p.kind === "unc" && p.segments.length === 0 ? `${p.normalized}\\` : p.normalized;
        const isWsl = /^\\\\wsl(\.localhost|\$)\\/i.test(p.root);
        const gate = this.deps.fsGate;
        const gateRoot = canonicalLocation(p, true).root;
        const gateBusy: itfPathProbe = { ...base, message: MSG.gateBusy };
        let st: { isDirectory(): boolean } | typeof FS_TIMEOUT;
        try {
            const pending = gate.run(gateRoot, () => this.deps.stat(target), ms);
            if (pending === null) return gateBusy;
            st = await pending;
        } catch (e) {
            const code = f_Code(e);
            if (code === "EACCES" || code === "EPERM") {
                return { ...base, exists: true, readable: false, message: "접근 권한이 없습니다." };
            }
            if (p.kind === "unc" && (NETWORK_ERRORS.has(code) || p.segments.length === 0)) {
                return {
                    ...base,
                    message: isWsl
                        ? "네트워크 경로에 연결할 수 없습니다. WSL 배포판이 실행 중인지 확인하세요."
                        : "네트워크 경로에 연결할 수 없습니다.",
                };
            }
            if (code === "ENOENT" || code === "ENOTDIR") return { ...base, message: MSG.missing };
            return { ...base, message: `경로를 확인하지 못했습니다(${code}).` };
        }
        if (st === FS_TIMEOUT) return { ...base, message: timeoutMsg };
        if (!st.isDirectory()) return { ...base, exists: true, message: MSG.file };

        try {
            const pending = gate.run(gateRoot, () => this.deps.openDir(target), ms);
            if (pending === null) {
                return { ...gateBusy, exists: true, isDirectory: true };
            }
            const dir = await pending;
            if (dir === FS_TIMEOUT) {
                return { ...base, exists: true, isDirectory: true, message: timeoutMsg };
            }
            await dir.close();
            return { ...base, exists: true, isDirectory: true, readable: true, message: MSG.dir };
        } catch {
            return {
                ...base,
                exists: true,
                isDirectory: true,
                readable: false,
                message: "폴더가 있지만 읽을 권한이 없습니다.",
            };
        }
    }

    private async probeRemote(
        p: itfParsedPath,
        configOverride: string | null | undefined,
        base: itfPathProbe,
    ): Promise<itfPathProbe> {
        const rt = await this.deps.rcloneEnv.require();
        const configPath = await this.deps.rcloneEnv.resolveConfigFor(configOverride);
        const split = remoteParentOf(p);
        const remoteName = p.root.slice(0, -1);
        const parent = split ? split.parent : p.root;

        let r;
        try {
            r = await this.deps.run(rt.binaryPath, buildProbeListArgs({ parent, configPath }), {
                timeoutMs: RCLONE_TIMEOUTS.probe,
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
            throw new clsAppError(
                "RCLONE_FAILED",
                `remote가 ${RCLONE_TIMEOUTS.probe / 1000}초 안에 응답하지 않았습니다.`,
            );
        }
        // exit 3: 폴더 없음(부모 또는 루트가 가리키는 폴더)
        if (r.exitCode === 3) return { ...base, message: MSG.missing };
        if (r.exitCode !== 0) {
            const hint = hintForRcloneError(r.stderrTail, remoteName);
            throw new clsAppError(
                "RCLONE_FAILED",
                `remote 경로를 확인하지 못했습니다(exit ${r.exitCode}).${hint ? ` ${hint}` : ""}`,
                summarizeStderr(r.stderrTail),
            );
        }
        if (!split) return { ...base, exists: true, isDirectory: true, message: MSG.dir };
        if (r.stdoutTruncated) {
            throw new clsAppError(
                "RCLONE_FAILED",
                "상위 폴더의 목록이 너무 커서 확인하지 못했습니다. 하위 폴더 경로를 직접 지정하세요.",
            );
        }

        let entries;
        try {
            entries = parseLsjsonEntries(r.stdout);
        } catch (e) {
            if (e instanceof clsLsjsonParseError)
                throw new clsAppError("RCLONE_PARSE_ERROR", e.message);
            throw e;
        }
        const hit = entries.find((x) => x.name === split.name);
        if (hit) {
            return hit.isDir
                ? { ...base, exists: true, isDirectory: true, message: MSG.dir }
                : { ...base, exists: true, message: MSG.file };
        }
        const lower = split.name.toLowerCase();
        const near = entries.find((x) => x.name.toLowerCase() === lower);
        return {
            ...base,
            message: near
                ? `${MSG.missing} 대소문자가 다른 '${near.name}'가 있습니다.`
                : MSG.missing,
        };
    }
}
