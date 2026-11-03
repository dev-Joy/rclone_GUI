/**
 * remote 설정 쓰기용 임시 rclone rc 서버(rcd) 세션 (INT-006 T-02, 안전 규칙 1).
 *
 * - `rcd --rc-addr 127.0.0.1:0`만 띄운다(loopback·임의 포트). 인증은 실행마다 새로 만든
 *   RCLONE_RC_USER·RCLONE_RC_PASS 환경 변수로만 넘긴다(명령줄에 값이 나오지 않는다).
 * - 호출은 config/create·config/update·core/quit만 허용한다. config/get·dump는 비밀 값을 돌려주므로 부르지 않는다.
 * - stderr 시작 줄에서 포트를 읽고, OAuth 주소(127.0.0.1)와 53682 포트 충돌을 알린다.
 * - 흐름이 끝나면 core/quit, 응답이 없으면 프로세스 트리를 끝낸다. 요청·응답 본문은 로그에 남기지 않는다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { randomBytes } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { buildRcdArgs } from "@/main/rclone/command-builder";
import { RCLONE_TIMEOUTS } from "@/main/rclone/config";
import { killProcessTree, spawnRcloneChecked } from "@/main/rclone/process";
import type { typErrorCode } from "@/shared/errors";

/** 이 세션이 부를 수 있는 rc 경로 */
const ALLOWED_RC_PATHS = new Set(["/config/create", "/config/update", "/core/quit"]);
/** rclone이 알리는 rc 서버 주소 */
const START_LINE_RE = /Serving remote control on (http:\/\/127\.0\.0\.1:\d+\/)/;
/** OAuth 대기 주소(127.0.0.1만 통과) */
const AUTH_URL_RE = /https?:\/\/127\.0\.0\.1:\d+\/auth[^\s"'<>]*/;
/** OAuth 리디렉트 포트(53682)를 다른 프로그램이 쓰는 경우 */
const AUTH_PORT_RE = /53682/;
const BIND_ERROR_RE = /bind|address already in use|Only one usage of each socket address/i;
const KILL_WAIT_MS = 5_000;

export interface itfRcSessionOptions {
    binaryPath: string;
    configPath: string | null;
    /** rclone이 OAuth 주소를 출력했을 때(같은 주소는 한 번만) */
    onAuthUrl?: (url: string) => void;
    /** 53682 포트를 못 열었다는 출력을 봤을 때 */
    onAuthPortInUse?: () => void;
    /** 테스트에서 갈아끼운다 */
    spawn?: typeof spawnRcloneChecked;
    fetchImpl?: typeof fetch;
}

export interface itfRcPostOptions {
    timeoutMs?: number;
    /** 시간 초과일 때 던질 코드(기본 RCLONE_FAILED) */
    timeoutCode?: typErrorCode;
}

function f_LineReader(onLine: (line: string) => void) {
    const decoder = new StringDecoder("utf8");
    let rest = "";
    const emit = (part: string) => onLine(part.endsWith("\r") ? part.slice(0, -1) : part);
    return {
        push: (chunk: Buffer) => {
            const parts = (rest + decoder.write(chunk)).split("\n");
            rest = parts.pop() ?? "";
            for (const part of parts) emit(part);
        },
        flush: () => {
            const last = rest + decoder.end();
            rest = "";
            if (last !== "") emit(last);
        },
    };
}

function f_SanitizeTail(text: string): string {
    return text.length > 600 ? text.slice(text.length - 600) : text;
}

export class clsRcSession {
    private readonly opts: Required<Pick<itfRcSessionOptions, "spawn" | "fetchImpl">> &
        itfRcSessionOptions;
    private readonly child: ChildProcess;
    private readonly base: string;
    private readonly user: string;
    private readonly pass: string;
    private readonly exitPromise: Promise<void>;
    private aborted = false;
    private quitSent = false;
    private stderrTail = "";
    private readonly abortController = new AbortController();

    private constructor(
        opts: itfRcSessionOptions & {
            spawn: NonNullable<itfRcSessionOptions["spawn"]>;
            fetchImpl: NonNullable<itfRcSessionOptions["fetchImpl"]>;
            child: ChildProcess;
            base: string;
            user: string;
            pass: string;
            exitPromise: Promise<void>;
        },
    ) {
        this.opts = opts;
        this.child = opts.child;
        this.base = opts.base;
        this.user = opts.user;
        this.pass = opts.pass;
        this.exitPromise = opts.exitPromise;
    }

    /** rcd를 띄우고 시작 줄(포트)을 기다린다 */
    static async start(options: itfRcSessionOptions): Promise<clsRcSession> {
        const spawn = options.spawn ?? spawnRcloneChecked;
        const fetchImpl = options.fetchImpl ?? fetch;
        const user = `rclonegui-${randomBytes(8).toString("hex")}`;
        const pass = randomBytes(16).toString("hex");
        const child = spawn(options.binaryPath, buildRcdArgs(options.configPath), {
            RCLONE_RC_USER: user,
            RCLONE_RC_PASS: pass,
        });

        let settled = false;
        let resolveStart: ((base: string) => void) | null = null;
        let rejectStart: ((e: unknown) => void) | null = null;
        const started = new Promise<string>((resolve, reject) => {
            resolveStart = resolve;
            rejectStart = reject;
        });
        const exitPromise = new Promise<void>((resolve) => child.once("close", () => resolve()));
        let stderrTail = "";
        let lastAuthUrl: string | null = null;

        const lines = f_LineReader((line) => {
            stderrTail = f_SanitizeTail(`${stderrTail}${line}\n`);
            const m = START_LINE_RE.exec(line);
            if (m && !settled) {
                settled = true;
                resolveStart?.(m[1]!);
            }
            const auth = AUTH_URL_RE.exec(line);
            if (auth && auth[0] !== lastAuthUrl) {
                lastAuthUrl = auth[0];
                options.onAuthUrl?.(auth[0]);
            }
            if (AUTH_PORT_RE.test(line) && BIND_ERROR_RE.test(line)) {
                options.onAuthPortInUse?.();
            }
        });
        child.stderr?.on("data", (chunk: Buffer) => lines.push(chunk));
        child.stdout?.on("data", (chunk: Buffer) => lines.push(chunk));

        const fail = (code: typErrorCode, message: string) => {
            if (settled) return;
            settled = true;
            rejectStart?.(new clsAppError(code, message, stderrTail || undefined));
        };
        child.once("error", () => {
            fail("RC_START_FAILED", "rclone 설정 도우미를 시작하지 못했습니다.");
        });
        child.once("close", (code) => {
            lines.flush();
            if (!settled) {
                fail(
                    "RC_START_FAILED",
                    `rclone 설정 도우미가 시작하지 못하고 끝났습니다(exit ${code ?? "-"}).`,
                );
            }
        });
        const timer = setTimeout(() => {
            fail("RC_START_FAILED", "rclone 설정 도우미가 시간 안에 시작하지 않았습니다.");
        }, RCLONE_TIMEOUTS.rcStart);

        try {
            const base = await started;
            clearTimeout(timer);
            return new clsRcSession({
                ...options,
                spawn,
                fetchImpl,
                child,
                base,
                user,
                pass,
                exitPromise,
            });
        } catch (e) {
            clearTimeout(timer);
            if (child.pid !== undefined) await killProcessTree(child.pid);
            throw e;
        }
    }

    /** 테스트용: 실제 프로세스 없이 시작한 것으로 만든다 */
    static forTest(options: {
        base: string;
        fetchImpl: typeof fetch;
        child?: ChildProcess;
        exitPromise?: Promise<void>;
    }): clsRcSession {
        return new clsRcSession({
            binaryPath: "rclone",
            configPath: null,
            spawn: spawnRcloneChecked,
            fetchImpl: options.fetchImpl,
            child: options.child ?? ({} as ChildProcess),
            base: options.base,
            user: "u",
            pass: "p",
            exitPromise: options.exitPromise ?? Promise.resolve(),
        });
    }

    get url(): string {
        return this.base;
    }

    /** 프로세스가 아직 살아 있는지(통합 테스트·종료 확인용) */
    get running(): boolean {
        return this.child.exitCode === null && !this.aborted;
    }

    /** 허용 경로에만 POST한다. 본문·응답은 돌려주기만 하고 기록하지 않는다 */
    async post(path: string, body: unknown, opts: itfRcPostOptions = {}): Promise<unknown> {
        if (!ALLOWED_RC_PATHS.has(path)) {
            throw new clsAppError("INTERNAL", "허용하지 않은 rclone 설정 요청입니다.");
        }
        if (this.aborted) throw new clsAppError("CANCELED");
        const timeoutMs = opts.timeoutMs ?? RCLONE_TIMEOUTS.remoteConfig;
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        this.abortController.signal.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await this.opts.fetchImpl(new URL(path, this.base), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Basic ${Buffer.from(`${this.user}:${this.pass}`).toString("base64")}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const text = await res.text();
            if (res.status === 401) {
                throw new clsAppError(
                    "RC_START_FAILED",
                    "rclone 설정 도우미 인증이 거부되었습니다.",
                );
            }
            if (!res.ok) {
                throw new clsAppError(
                    "RCLONE_FAILED",
                    `rclone 설정 요청이 실패했습니다(HTTP ${res.status}).`,
                );
            }
            if (text.trim() === "") return {};
            try {
                return JSON.parse(text) as unknown;
            } catch {
                throw new clsAppError(
                    "RCLONE_PARSE_ERROR",
                    "rclone 설정 응답을 해석하지 못했습니다.",
                );
            }
        } catch (e) {
            if (this.aborted) throw new clsAppError("CANCELED");
            if (controller.signal.aborted && e instanceof Error && e.name === "AbortError") {
                throw new clsAppError(
                    opts.timeoutCode ?? "RCLONE_FAILED",
                    "rclone 설정 요청이 시간 안에 끝나지 않았습니다.",
                );
            }
            throw e;
        } finally {
            clearTimeout(timer);
            this.abortController.signal.removeEventListener("abort", onAbort);
        }
    }

    /** 흐름을 중단한다(진행 중 요청 취소 + 프로세스 트리 종료) */
    abort(): void {
        if (this.aborted) return;
        this.aborted = true;
        this.abortController.abort();
        if (this.child.pid !== undefined && this.child.exitCode === null) {
            void killProcessTree(this.child.pid);
        }
    }

    /** core/quit으로 끝내고, 응답이 없으면 프로세스 트리를 끝낸다 */
    async quit(): Promise<void> {
        if (this.quitSent) return;
        this.quitSent = true;
        if (this.child.exitCode === null) {
            try {
                await this.post("/core/quit", {}, { timeoutMs: 5_000 });
            } catch {
                // 이미 끝났거나 응답이 없으면 아래에서 정리한다
            }
        }
        const closed = await Promise.race([
            this.exitPromise.then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), KILL_WAIT_MS)),
        ]);
        if (!closed && this.child.pid !== undefined) await killProcessTree(this.child.pid);
    }

    /** 앱 종료·취소: 진행 중 요청을 끊고 프로세스가 남지 않게 한다 */
    async dispose(): Promise<void> {
        this.abort();
        await Promise.race([
            this.exitPromise,
            new Promise<void>((resolve) => setTimeout(resolve, KILL_WAIT_MS)),
        ]);
    }
}
