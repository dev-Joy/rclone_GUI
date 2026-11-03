/**
 * OAuth remote 추가·재인증 세션 (INT-006 T-04, FR-9~FR-13).
 *
 * - 앱 전체에서 한 번에 하나만 진행한다(서비스가 관리). 10분이 지나거나 취소하면 프로세스 트리를 끝낸다.
 * - rcd `config/create`가 질문(State·Option)을 돌려주면 범용 질문 폼으로 답을 받아 `opt.continue`로 보낸다.
 *   `config_is_local`만 앱이 자동으로 true로 답한다(notes #45).
 * - 새로 추가하다 실패·취소하면 이번 시도에서 만든 remote만 지운다(FR-12).
 * - 재인증은 rc에 reconnect가 없어 `config reconnect <name>: --non-interactive`를 쓴다.
 * - 비밀 값·토큰은 이벤트·오류 문구에 담지 않는다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import type { ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { redactedStderrTail } from "@/main/lib/secret-redact";
import { parseQuestionOption } from "@/main/parsers/rclone-providers-parser";
import {
    parseRcConfigResponse,
    type itfRcConfigResponse,
} from "@/main/parsers/rclone-config-parser";
import { buildConfigReconnectArgs } from "@/main/rclone/command-builder";
import { RCLONE_TIMEOUTS } from "@/main/rclone/config";
import { killProcessTree, spawnRcloneChecked } from "@/main/rclone/process";
import { clsRcSession } from "@/main/rclone/rc-session";
import type { typErrorCode } from "@/shared/errors";
import type {
    itfRemoteAuthAnswerResult,
    itfRemoteAuthProgress,
    itfRemoteQuestion,
    typRemoteAuthPhase,
} from "@/shared/types/remote-config";

/** 한 흐름에서 허용하는 질문 수(FR-15a) */
export const MAX_AUTH_QUESTIONS = 20;
const AUTH_URL_RE = /https?:\/\/127\.0\.0\.1:\d+\/auth[^\s"'<>]*/;
const AUTH_PORT_RE = /53682/;
const BIND_ERROR_RE = /bind|address already in use|Only one usage of each socket address/i;
const KILL_WAIT_MS = 5_000;

export interface itfRemoteAuthSessionOptions {
    name: string;
    type: string;
    mode: "create" | "reconnect";
    binaryPath: string;
    configPath: string | null;
    /** 비밀 아닌 값 + 비밀 평문. rcd HTTP 본문으로만 넘어간다 */
    parameters: Record<string, string>;
    /** 진행 상태(질문·주소·완료)를 화면에 알린다 */
    emit: (e: itfRemoteAuthProgress) => void;
    /** 이번 시도에서 만든 remote 정리(create 모드에서 실패·취소 시) */
    cleanup: () => Promise<void>;
    /** 성공 뒤 rclone 환경을 다시 감지한다 */
    refresh: () => Promise<void>;
    logger: { info(message: string): void; warn(message: string, e?: unknown): void };
    timeoutMs?: number;
    /** 테스트용 */
    sessionFactory?: (opts: {
        binaryPath: string;
        configPath: string | null;
        onAuthUrl: (url: string) => void;
        onAuthPortInUse: () => void;
    }) => Promise<clsRcSession>;
    spawnReconnect?: (binaryPath: string, args: readonly string[]) => ChildProcess;
}

export interface itfAuthSessionHandle {
    readonly name: string;
    readonly mode: "create" | "reconnect";
    /** 흐름이 끝날 때(완료·실패·취소·시간 초과) 결과 */
    readonly done: Promise<itfRemoteAuthAnswerResult>;
    /** 진행 중인 질문에 답하고 다음 질문·완료를 기다린다 */
    answer(state: string, result: string): Promise<itfRemoteAuthAnswerResult>;
    /** 취소(사용자) 또는 시간 초과. 정리까지 마친다 */
    cancel(phase: "canceled" | "timeout", message?: string): Promise<void>;
    /** 앱 종료: 정리를 기다리되 오래 걸리면 넘긴다 */
    dispose(): Promise<void>;
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

export class clsRemoteAuthSession implements itfAuthSessionHandle {
    readonly name: string;
    readonly mode: "create" | "reconnect";
    private readonly opts: itfRemoteAuthSessionOptions;
    private phase: typRemoteAuthPhase = "starting";
    private rc: clsRcSession | null = null;
    private reconnect: ChildProcess | null = null;
    private pending: {
        state: string;
        resolve: (result: string) => void;
        reject: (e: unknown) => void;
    } | null = null;
    private currentQuestion: itfRemoteQuestion | null = null;
    private nextWaiters: Array<(r: itfRemoteAuthAnswerResult) => void> = [];
    private finished = false;
    private timer: NodeJS.Timeout | null = null;
    private authUrl: string | null = null;
    private created = false;
    readonly done: Promise<itfRemoteAuthAnswerResult>;
    private resolveDone: (r: itfRemoteAuthAnswerResult) => void = () => undefined;

    constructor(opts: itfRemoteAuthSessionOptions) {
        this.opts = opts;
        this.name = opts.name;
        this.mode = opts.mode;
        this.done = new Promise((resolve) => {
            this.resolveDone = resolve;
        });
    }

    /** 흐름을 시작한다(기다리지 않는다) */
    start(): void {
        const timeoutMs = this.opts.timeoutMs ?? RCLONE_TIMEOUTS.oauth;
        this.timer = setTimeout(() => {
            void this.cancel("timeout", "인증 대기 시간(10분)이 지났습니다.");
        }, timeoutMs);
        if (this.mode === "create") void this.f_RunCreate();
        else void this.f_RunReconnect();
    }

    async answer(state: string, result: string): Promise<itfRemoteAuthAnswerResult> {
        const pending = this.pending;
        if (!pending || pending.state !== state) {
            throw new clsAppError(
                "VALIDATION",
                "진행 중인 질문이 바뀌었습니다. 화면을 새로 고치세요.",
            );
        }
        this.pending = null;
        this.currentQuestion = null;
        pending.resolve(result);
        return this.f_WaitNext();
    }

    async cancel(phase: "canceled" | "timeout", message?: string): Promise<void> {
        if (this.finished) return;
        this.finished = true;
        this.f_ClearTimer();
        this.pending?.reject(new clsAppError("CANCELED"));
        this.pending = null;
        this.currentQuestion = null;
        this.rc?.abort();
        if (this.reconnect?.pid !== undefined && this.reconnect.exitCode === null) {
            await killProcessTree(this.reconnect.pid);
        }
        if (this.mode === "create" && this.created) {
            await this.opts.cleanup().catch((e: unknown) => {
                this.opts.logger.warn("OAuth 취소 뒤 remote 정리 실패", e);
            });
        }
        this.f_Emit({ phase, message });
    }

    async dispose(): Promise<void> {
        await Promise.race([
            this.cancel("canceled", "앱을 종료해 인증을 취소했습니다."),
            new Promise<void>((resolve) => setTimeout(resolve, KILL_WAIT_MS)),
        ]);
    }

    private f_ClearTimer(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    private f_Emit(e: Omit<itfRemoteAuthProgress, "name">): void {
        this.phase = e.phase;
        try {
            this.opts.emit({ ...e, name: this.name });
        } catch (err) {
            this.opts.logger.warn("OAuth 진행 알림 실패", err);
        }
        if (
            e.phase === "question" ||
            e.phase === "done" ||
            e.phase === "failed" ||
            e.phase === "canceled" ||
            e.phase === "timeout"
        ) {
            const waiters = this.nextWaiters.splice(0);
            const result: itfRemoteAuthAnswerResult = {
                phase: e.phase,
                ...(e.question ? { question: e.question } : {}),
                ...(e.message ? { message: e.message } : {}),
            };
            for (const w of waiters) w(result);
            if (
                e.phase === "done" ||
                e.phase === "failed" ||
                e.phase === "canceled" ||
                e.phase === "timeout"
            ) {
                this.resolveDone(result);
            }
        }
    }

    private f_WaitNext(): Promise<itfRemoteAuthAnswerResult> {
        if (this.currentQuestion && this.pending) {
            return Promise.resolve({ phase: "question", question: this.currentQuestion });
        }
        if (
            this.phase === "done" ||
            this.phase === "failed" ||
            this.phase === "canceled" ||
            this.phase === "timeout"
        ) {
            return Promise.resolve({ phase: this.phase });
        }
        return new Promise((resolve) => {
            this.nextWaiters.push(resolve);
            setTimeout(() => {
                const i = this.nextWaiters.indexOf(resolve);
                if (i >= 0) {
                    this.nextWaiters.splice(i, 1);
                    resolve({ phase: this.phase });
                }
            }, 5_000);
        });
    }

    private f_Fail(code: typErrorCode, message: string): void {
        this.opts.logger.warn(`remote 인증 실패(${code}): ${message}`);
        this.f_Emit({ phase: "failed", message });
    }

    private async f_RunCreate(): Promise<void> {
        this.f_Emit({ phase: "starting" });
        try {
            const session = await (this.opts.sessionFactory ?? this.f_DefaultSession)({
                binaryPath: this.opts.binaryPath,
                configPath: this.opts.configPath,
                onAuthUrl: (url) => this.f_OnAuthUrl(url),
                onAuthPortInUse: () => {
                    void this.cancel("canceled", "다른 프로그램이 53682 포트를 쓰고 있습니다.");
                },
            });
            this.rc = session;
            let resp = await this.f_PostCreate({
                name: this.name,
                type: this.opts.type,
                parameters: this.opts.parameters,
                opt: { nonInteractive: true, obscure: true },
            });
            this.created = true;
            let questions = 0;
            while (resp.error === "" && (resp.state !== "" || resp.option !== null)) {
                questions += 1;
                if (questions > MAX_AUTH_QUESTIONS) {
                    throw new clsAppError(
                        "RCLONE_FAILED",
                        "인증 질문이 너무 많습니다. rclone config 명령으로 설정하세요.",
                    );
                }
                const option = parseQuestionOption(resp.option);
                if (!option) {
                    throw new clsAppError(
                        "RCLONE_FAILED",
                        "알 수 없는 인증 질문이 나왔습니다. rclone config 명령으로 설정하세요.",
                    );
                }
                if (option.name === "config_is_local") {
                    resp = await this.f_PostCreate({
                        name: this.name,
                        type: this.opts.type,
                        parameters: {},
                        opt: {
                            nonInteractive: true,
                            continue: true,
                            state: resp.state,
                            result: "true",
                        },
                    });
                    continue;
                }
                const question: itfRemoteQuestion = { state: resp.state, option };
                const answer = await new Promise<string>((resolve, reject) => {
                    this.currentQuestion = question;
                    this.pending = { state: resp.state, resolve, reject };
                    this.f_Emit({ phase: "question", question });
                });
                resp = await this.f_PostCreate({
                    name: this.name,
                    type: this.opts.type,
                    parameters: {},
                    opt: {
                        nonInteractive: true,
                        continue: true,
                        state: resp.state,
                        result: answer,
                    },
                });
            }
            if (resp.error !== "") {
                throw new clsAppError("RCLONE_FAILED", resp.error);
            }
            await session.quit();
            this.f_ClearTimer();
            this.finished = true;
            await this.opts.refresh().catch(() => undefined);
            this.f_Emit({ phase: "done" });
        } catch (e) {
            if (this.finished) return;
            await this.f_HandleError(e);
        }
    }

    private async f_PostCreate(body: unknown): Promise<itfRcConfigResponse> {
        if (!this.rc) throw new clsAppError("RC_START_FAILED");
        const raw = await this.rc.post("/config/create", body, {
            timeoutMs: this.opts.timeoutMs ?? RCLONE_TIMEOUTS.oauth,
            timeoutCode: "AUTH_TIMEOUT",
        });
        return parseRcConfigResponse(raw);
    }

    private async f_RunReconnect(): Promise<void> {
        this.f_Emit({ phase: "starting" });
        const args = buildConfigReconnectArgs(this.name, this.opts.configPath);
        const spawn = this.opts.spawnReconnect ?? ((b, a) => spawnRcloneChecked(b, a));
        let stderr = "";
        try {
            const child = spawn(this.opts.binaryPath, args);
            this.reconnect = child;
            const closed = new Promise<number | null>((resolve) =>
                child.once("close", (code) => resolve(code)),
            );
            const lines = f_LineReader((line) => {
                stderr = `${stderr}${line}\n`;
                const auth = AUTH_URL_RE.exec(line);
                if (auth) this.f_OnAuthUrl(auth[0]);
                if (AUTH_PORT_RE.test(line) && BIND_ERROR_RE.test(line)) {
                    void this.cancel("canceled", "다른 프로그램이 53682 포트를 쓰고 있습니다.");
                }
            });
            child.stderr?.on("data", (chunk: Buffer) => lines.push(chunk));
            child.stdout?.on("data", (chunk: Buffer) => lines.push(chunk));
            const code = await closed;
            lines.flush();
            if (this.finished) return;
            if (code !== 0) {
                throw new clsAppError(
                    "RCLONE_FAILED",
                    `재인증이 실패했습니다(exit ${code ?? "-"}). 기존 설정은 바뀌지 않았습니다.`,
                    redactedStderrTail(stderr, []),
                );
            }
            this.f_ClearTimer();
            this.finished = true;
            await this.opts.refresh().catch(() => undefined);
            this.f_Emit({ phase: "done" });
        } catch (e) {
            if (this.finished) return;
            await this.f_HandleError(e);
        }
    }

    private async f_HandleError(e: unknown): Promise<void> {
        this.f_ClearTimer();
        this.finished = true;
        this.rc?.abort();
        if (this.mode === "create" && this.created) {
            await this.opts.cleanup().catch((err: unknown) => {
                this.opts.logger.warn("OAuth 실패 뒤 remote 정리 실패", err);
            });
        }
        const code = e instanceof clsAppError ? e.code : "INTERNAL";
        const message =
            e instanceof clsAppError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "remote 설정 중 오류가 발생했습니다.";
        this.f_Fail(code, message);
    }

    private f_OnAuthUrl(url: string): void {
        if (!/^https?:\/\/127\.0\.0\.1:\d+\//.test(url)) return;
        if (this.authUrl === url) return;
        this.authUrl = url;
        const timeoutMs = this.opts.timeoutMs ?? RCLONE_TIMEOUTS.oauth;
        this.f_Emit({
            phase: "waiting",
            authUrl: url,
            expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
        });
    }

    private async f_DefaultSession(opts: {
        binaryPath: string;
        configPath: string | null;
        onAuthUrl: (url: string) => void;
        onAuthPortInUse: () => void;
    }): Promise<clsRcSession> {
        return clsRcSession.start(opts);
    }
}
