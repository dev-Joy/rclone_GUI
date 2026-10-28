/**
 * 외부 프로세스 실행 공통 래퍼 (MVP_SPEC §4.1, §14.2, AGENTS.md 안전 규칙 1).
 * - spawn(file, args[], { shell: false }) 로만 실행한다. 명령 문자열을 조립하지 않는다.
 * - stdout/stderr를 줄 단위로 넘긴다(청크 경계·UTF-8 멀티바이트 안전).
 * - 시간 초과·취소 시 자식 프로세스 트리까지 종료한다(Windows: taskkill /T /F).
 * - 종료 코드가 0이 아니어도 reject 하지 않는다. 판단은 호출자가 한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { execFile, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

// ========== Internal imports ==========
import { assertAllowedCommand, assertNoBlockedFlags } from "@/main/rclone/command-builder";

export interface itfRunProcessOptions {
    /** 시간 제한(ms). null이면 제한 없음(실행은 사용자가 취소할 때까지 기다린다) */
    timeoutMs: number | null;
    signal?: AbortSignal;
    /** 기본 process.env */
    env?: NodeJS.ProcessEnv;
    /** 기본 16 MiB. 넘으면 그 뒤는 모으지 않고 stdoutTruncated = true */
    maxStdoutBytes?: number;
    /**
     * 기본 true. false면 stdout을 모으지 않고 onStdoutLine만 부른다
     * (stdout "", stdoutBytes 빈 버퍼, stdoutTruncated false). 큰 목록을 줄 단위로 읽을 때 쓴다.
     */
    collectStdout?: boolean;
    /** 기본 20 KiB. stderr는 뒤쪽만 남긴다 */
    stderrTailBytes?: number;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
    /** 프로세스가 시작되면 pid와 함께 한 번 부른다 */
    onSpawn?: (pid: number) => void;
}

export interface itfProcessResult {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    /** utf8로 읽은 stdout */
    stdout: string;
    /** 원본 바이트(wsl.exe의 UTF-16LE 등) */
    stdoutBytes: Buffer;
    stdoutTruncated: boolean;
    stderrTail: string;
    timedOut: boolean;
    canceled: boolean;
    durationMs: number;
    /**
     * 프로세스가 끝난 것을 확인했는지(close 이벤트 수신, 또는 시작 전에 취소됨).
     * false면 종료 요청 뒤 대기 상한(5초)이 지나 결과만 먼저 돌려준 것이다(프로세스가 남아 있을 수 있음).
     */
    closed: boolean;
}

export type typRunProcess = (
    file: string,
    args: readonly string[],
    opts: itfRunProcessOptions,
) => Promise<itfProcessResult>;

/** rclone 실행 함수 모양. env는 runRclone이 정한다 */
export type typRunRclone = (
    binary: string,
    args: readonly string[],
    opts: Omit<itfRunProcessOptions, "env">,
) => Promise<itfProcessResult>;

/** 프로세스를 시작하지 못함(ENOENT: 파일 없음, EACCES/EPERM: 권한 등) */
export class clsProcessSpawnError extends Error {
    readonly errno: string;

    constructor(errno: string, message: string) {
        super(message);
        this.name = "clsProcessSpawnError";
        this.errno = errno;
    }
}

export const DEFAULT_MAX_STDOUT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_STDERR_TAIL_BYTES = 20 * 1024;
/** 종료 요청 뒤 close 이벤트를 기다리는 최대 시간 */
const KILL_WAIT_MS = 5_000;

/** 암호화된 rclone.conf 해독에 필요한 것만 남긴다 */
const KEEP_RCLONE_ENV = new Set(["RCLONE_CONFIG_PASS", "RCLONE_PASSWORD_COMMAND"]);

/** 청크를 줄로 나눈다. 마지막 줄은 flush()에서 넘긴다 */
function f_LineReader(onLine: ((line: string) => void) | undefined) {
    const decoder = new StringDecoder("utf8");
    let rest = "";
    const emit = (part: string) => onLine?.(part.endsWith("\r") ? part.slice(0, -1) : part);
    return {
        push: (chunk: Buffer) => {
            if (!onLine) return;
            const parts = (rest + decoder.write(chunk)).split("\n");
            rest = parts.pop()!;
            for (const part of parts) emit(part);
        },
        flush: () => {
            if (!onLine) return;
            const last = rest + decoder.end();
            rest = "";
            if (last !== "") emit(last);
        },
    };
}

function f_Errno(e: unknown): string {
    if (e && typeof e === "object" && "code" in e && typeof e.code === "string") return e.code;
    return "UNKNOWN";
}

/** 프로세스 트리를 강제 종료한다. 이미 끝난 프로세스는 무시한다 */
export function killProcessTree(pid: number): Promise<void> {
    const fallback = () => {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            // ESRCH: 이미 종료됨
        }
    };
    if (process.platform !== "win32") {
        fallback();
        return Promise.resolve();
    }
    const root = process.env.SystemRoot ?? "C:\\Windows";
    return new Promise((resolve) => {
        execFile(
            `${root}\\System32\\taskkill.exe`,
            ["/PID", String(pid), "/T", "/F"],
            { shell: false, windowsHide: true },
            (err) => {
                if (err) fallback();
                resolve();
            },
        );
    });
}

/** spawn 공통 래퍼 */
export const runProcess: typRunProcess = (file, args, opts) => {
    const started = Date.now();
    const maxStdout = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
    const tailBytes = opts.stderrTailBytes ?? DEFAULT_STDERR_TAIL_BYTES;
    const collect = opts.collectStdout ?? true;

    return new Promise<itfProcessResult>((resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        let stdoutSize = 0;
        let stdoutTruncated = false;
        let stderrTail: Buffer = Buffer.alloc(0);
        let timedOut = false;
        let canceled = false;
        let spawned = false;
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        let killTimer: NodeJS.Timeout | undefined;
        const outLines = f_LineReader(opts.onStdoutLine);
        const errLines = f_LineReader(opts.onStderrLine);

        const f_Result = (
            code: number | null,
            sig: NodeJS.Signals | null,
            closed: boolean,
        ): itfProcessResult => {
            const bytes = Buffer.concat(stdoutChunks);
            return {
                exitCode: code,
                signal: sig,
                stdout: bytes.toString("utf8"),
                stdoutBytes: bytes,
                stdoutTruncated,
                // 앞쪽이 잘린 멀티바이트 문자는 버린다
                stderrTail: stderrTail.toString("utf8").replace(/^\uFFFD+/, ""),
                timedOut,
                canceled,
                durationMs: Date.now() - started,
                closed,
            };
        };

        const f_Cleanup = () => {
            if (timer) clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            opts.signal?.removeEventListener("abort", f_OnAbort);
        };

        const f_Settle = (code: number | null, sig: NodeJS.Signals | null, closed: boolean) => {
            if (settled) return;
            settled = true;
            f_Cleanup();
            outLines.flush();
            errLines.flush();
            resolve(f_Result(code, sig, closed));
        };

        if (opts.signal?.aborted) {
            canceled = true;
            settled = true;
            resolve(f_Result(null, null, true));
            return;
        }

        const child = spawn(file, [...args], {
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            env: opts.env ?? process.env,
        });

        const f_Stop = () => {
            if (settled || killTimer) return;
            // close가 오지 않아도(손자 프로세스가 파이프를 잡는 등) 상한 뒤에는 끝낸다
            killTimer = setTimeout(() => f_Settle(null, null, false), KILL_WAIT_MS);
            if (child.pid !== undefined) void killProcessTree(child.pid);
        };

        function f_OnAbort() {
            canceled = true;
            f_Stop();
        }

        // setTimeout(fn, Infinity)는 즉시 실행되므로 유한한 값일 때만 건다
        if (opts.timeoutMs !== null && Number.isFinite(opts.timeoutMs)) {
            timer = setTimeout(() => {
                timedOut = true;
                f_Stop();
            }, opts.timeoutMs);
        }
        opts.signal?.addEventListener("abort", f_OnAbort, { once: true });

        child.once("spawn", () => {
            spawned = true;
            if (child.pid !== undefined) opts.onSpawn?.(child.pid);
        });
        child.once("error", (e) => {
            if (spawned || settled) return;
            settled = true;
            f_Cleanup();
            reject(new clsProcessSpawnError(f_Errno(e), `프로세스를 시작하지 못했습니다: ${file}`));
        });
        child.stdout.on("data", (chunk: Buffer) => {
            outLines.push(chunk);
            if (!collect || stdoutTruncated) return;
            if (stdoutSize + chunk.length > maxStdout) {
                stdoutChunks.push(chunk.subarray(0, maxStdout - stdoutSize));
                stdoutSize = maxStdout;
                stdoutTruncated = true;
                return;
            }
            stdoutChunks.push(chunk);
            stdoutSize += chunk.length;
        });
        child.stderr.on("data", (chunk: Buffer) => {
            errLines.push(chunk);
            const joined = Buffer.concat([stderrTail, chunk]);
            stderrTail =
                joined.length > tailBytes ? joined.subarray(joined.length - tailBytes) : joined;
        });
        child.once("close", (code, sig) => f_Settle(code, sig, true));
    });
};

/**
 * rclone에 넘길 환경 변수. RCLONE_* 는 지운다(예: RCLONE_DELETE_EXCLUDED로 차단 목록 우회 방지).
 * RCLONE_CONFIG_PASS, RCLONE_PASSWORD_COMMAND만 남긴다. 지운 이름 목록을 돌려준다(값은 돌려주지 않음).
 */
export function buildRcloneEnv(base: NodeJS.ProcessEnv): {
    env: NodeJS.ProcessEnv;
    removed: string[];
} {
    const env: NodeJS.ProcessEnv = {};
    const removed: string[] = [];
    for (const [key, value] of Object.entries(base)) {
        const upper = key.toUpperCase();
        if (upper.startsWith("RCLONE_") && !KEEP_RCLONE_ENV.has(upper)) {
            removed.push(key);
            continue;
        }
        env[key] = value;
    }
    return { env, removed: removed.toSorted() };
}

/** rclone 실행. 허용 명령·차단 목록을 다시 확인하고 정리한 환경 변수로 실행한다 */
export const runRclone: typRunRclone = async (binary, args, opts) => {
    assertAllowedCommand(args);
    assertNoBlockedFlags(args);
    return runProcess(binary, args, { ...opts, env: buildRcloneEnv(process.env).env });
};
