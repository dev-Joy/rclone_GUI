/**
 * rclone remote 설정 서비스 (INT-006 T-03~T-05).
 *
 * - 종류 정의(providers)는 rclone 경로별로 앱 실행 동안 캐시한다(FR-2, NFR-5).
 * - 추가·수정·삭제·재인증은 remoteOps 전역 큐로 직렬화하고, 같은 remote를 쓰는 비교·실행 중이면 BUSY다(FR-20).
 * - 값(비밀 포함)은 짧게 띄운 rcd의 HTTP 본문으로만 넘긴다(FR-14). 명령줄·로그·IPC 응답에 비밀 값을 남기지 않는다.
 * - 수정 화면은 `config redacted`에서 비밀 아닌 값만 채우고, 비밀 값은 "설정됨"만 알린다(FR-17).
 * - 삭제 전에 참조 작업·북마크를 세고, 예약 켜진 작업은 자동 실행을 끈 뒤 OS 예약이 사라진 것을 확인한다(FR-22).
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import type { ChildProcess } from "node:child_process";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { collectSecretValues, redactedStderrTail } from "@/main/lib/secret-redact";
import {
    isRedactedValue,
    parseRcConfigResponse,
    parseRedactedConfig,
    type itfRedactedConfig,
} from "@/main/parsers/rclone-config-parser";
import { parseProvidersJson } from "@/main/parsers/rclone-providers-parser";
import {
    buildConfigDeleteArgs,
    buildConfigProvidersArgs,
    buildConfigRedactedArgs,
} from "@/main/rclone/command-builder";
import { RCLONE_TIMEOUTS } from "@/main/rclone/config";
import type { clsRcloneEnv } from "@/main/rclone/detect";
import { clsProcessSpawnError, runRclone, type typRunRclone } from "@/main/rclone/process";
import { clsRcSession } from "@/main/rclone/rc-session";
import { remoteNamesOfJob } from "@/main/services/job-context";
import { clsRemoteAuthSession } from "@/main/services/remote-auth-session";
import type { clsRemoteOps } from "@/main/services/remote-ops";
import type { clsOsScheduler } from "@/main/services/os-scheduler";
import type { clsJobStore } from "@/main/store/job-store";
import type { clsRemoteStore } from "@/main/store/remote-store";
import { validateNewRemoteName } from "@/shared/remote-name";
import type {
    typRemoteConfigCreateInput,
    typRemoteConfigDeleteInput,
    typRemoteConfigUpdateInput,
} from "@/shared/schemas/remote-config";
import type { typJob } from "@/shared/schemas/job";
import type {
    itfRemoteAuthAnswerResult,
    itfRemoteAuthProgress,
    itfRemoteConfigView,
    itfRemoteDeleteResult,
    itfRemoteProvider,
    itfRemoteUsage,
    itfRemoteUsageJob,
} from "@/shared/types/remote-config";

export interface itfRemoteConfigServiceDeps {
    rcloneEnv: Pick<clsRcloneEnv, "require" | "listRemotes" | "detect" | "resolveConfigFor">;
    remoteOps: Pick<clsRemoteOps, "run">;
    jobs: Pick<clsJobStore, "list" | "get" | "update">;
    bookmarks: Pick<clsRemoteStore, "list">;
    osScheduler: Pick<clsOsScheduler, "idle" | "status">;
    logger: { info(message: string): void; warn(message: string, e?: unknown): void };
    emit: (e: itfRemoteAuthProgress) => void;
    /** 테스트에서 갈아끼운다 */
    run?: typRunRclone;
    /** 테스트에서 갈아끼운다(비OAuth create·update의 rcd 세션) */
    startRcSession?: (opts: {
        binaryPath: string;
        configPath: string | null;
    }) => Promise<Pick<clsRcSession, "post" | "quit">>;
    sessionFactory?: ConstructorParameters<typeof clsRemoteAuthSession>[0]["sessionFactory"];
    spawnReconnect?: (binaryPath: string, args: readonly string[]) => ChildProcess;
    now?: () => Date;
}

type typDeps = Omit<itfRemoteConfigServiceDeps, "run"> & { run: typRunRclone };

/** 삭제 확인 창의 버튼 문구에 쓰는 수 */
export function autoSyncCount(usage: itfRemoteUsage): number {
    return usage.jobs.filter((j) => j.autoSync !== "off").length;
}

/** providers 정의에 맞춰 값·비밀을 합치고 모양을 검사한다. 문제가 있으면 VALIDATION */
export function mergeRemoteParameters(
    provider: itfRemoteProvider,
    values: Record<string, string>,
    secrets: Record<string, string>,
    requireAll: boolean,
): Record<string, string> {
    const defs = new Map(provider.options.map((o) => [o.name, o]));
    const out: Record<string, string> = {};
    const f_Check = (name: string, value: string, secret: boolean) => {
        const def = defs.get(name);
        if (!def) {
            throw new clsAppError("VALIDATION", `‘${name}’은 이 종류의 옵션이 아닙니다.`);
        }
        if (def.secret !== secret) {
            throw new clsAppError(
                "VALIDATION",
                secret
                    ? `‘${name}’은 비밀 옵션이 아닙니다.`
                    : `‘${name}’은 비밀 옵션입니다. 비밀 칸으로 입력하세요.`,
            );
        }
        if (value === "") return;
        if (def.kind === "bool" && value !== "true" && value !== "false") {
            throw new clsAppError("VALIDATION", `‘${name}’은 true 또는 false여야 합니다.`);
        }
        if (def.kind === "int" && !/^-?\d+$/.test(value)) {
            throw new clsAppError("VALIDATION", `‘${name}’은 숫자여야 합니다.`);
        }
        if (def.exclusive && !def.choices.some((c) => c.value === value)) {
            throw new clsAppError("VALIDATION", `‘${name}’은 목록에서 고르세요.`);
        }
        out[name] = value;
    };
    for (const [name, value] of Object.entries(values)) f_Check(name, value, false);
    for (const [name, value] of Object.entries(secrets)) f_Check(name, value, true);
    if (requireAll) {
        for (const def of provider.options) {
            if (!def.required || def.defaultText !== "" || def.name in out) continue;
            throw new clsAppError("VALIDATION", `‘${def.name}’ 값을 입력하세요.`);
        }
    }
    return out;
}

export class clsRemoteConfigService {
    private readonly deps: typDeps;
    /** rclone 경로 → 종류 정의 */
    private readonly providersCache = new Map<string, itfRemoteProvider[]>();
    private auth: clsRemoteAuthSession | null = null;

    constructor(deps: itfRemoteConfigServiceDeps) {
        this.deps = { ...deps, run: deps.run ?? runRclone };
    }

    /** 진행 중인 OAuth가 있으면 BUSY */
    private f_AssertNoAuth(): void {
        if (this.auth) {
            throw new clsAppError(
                "BUSY",
                "다른 리모트 인증이 진행 중입니다. 끝나거나 취소한 뒤 다시 시도하세요.",
            );
        }
    }

    /** rclone config providers 정의(캐시) */
    async providers(): Promise<itfRemoteProvider[]> {
        const rt = await this.deps.rcloneEnv.require();
        return this.f_Providers(rt);
    }

    /** 수정 화면용 값. 비밀 값은 빠지고 "설정됨" 이름만 온다 */
    async get(name: string): Promise<itfRemoteConfigView> {
        return this.deps.remoteOps.run([name], async () => {
            const rt = await this.deps.rcloneEnv.require();
            await this.f_AssertExists(name);
            const providers = await this.f_Providers(rt);
            const red = await this.f_ReadRedacted(name, rt);
            const type = red?.type ?? (await this.deps.rcloneEnv.detect()).remoteTypes[name] ?? "";
            const provider = providers.find((p) => p.type === type);
            const values: Record<string, string> = {};
            const secretsSet = new Set<string>();
            if (red) {
                for (const [key, value] of Object.entries(red.entries)) {
                    const def = provider?.options.find((o) => o.name === key);
                    if (def?.secret === true || isRedactedValue(value)) {
                        secretsSet.add(key);
                        continue;
                    }
                    values[key] = value;
                }
            }
            return {
                name,
                type,
                values,
                secretsSet: [...secretsSet].toSorted(),
                redactedUnavailable: red === null,
            };
        });
    }

    /** 작업·북마크 참조 수(FR-19) */
    async usage(name: string): Promise<itfRemoteUsage> {
        return this.deps.remoteOps.run([name], () => this.f_Usage(name));
    }

    /**
     * remote 추가. OAuth 종류는 진행 이벤트로 질문·주소·결과를 알리고, 이 호출은 흐름이 끝날 때까지 기다린다.
     * (인증 중에도 remoteOps 큐를 잡고 있어 같은 remote 실행·탐색이 끼어들지 않는다)
     */
    async create(input: typRemoteConfigCreateInput): Promise<{ name: string; oauth: boolean }> {
        return this.deps.remoteOps.run([input.name], async () => {
            this.f_AssertNoAuth();
            const rt = await this.deps.rcloneEnv.require();
            const providers = await this.f_Providers(rt);
            const provider = providers.find((p) => p.type === input.type);
            if (!provider) {
                throw new clsAppError("VALIDATION", "지원하지 않는 리모트 종류입니다.");
            }
            const existing = await this.deps.rcloneEnv.listRemotes(null);
            const issue = validateNewRemoteName(input.name, existing);
            if (issue) throw new clsAppError("REMOTE_NAME_INVALID", issue);
            const parameters = mergeRemoteParameters(provider, input.values, input.secrets, true);
            const configPath = await this.deps.rcloneEnv.resolveConfigFor(null);
            if (provider.oauth) {
                const session = this.f_NewSession({
                    name: input.name,
                    type: input.type,
                    mode: "create",
                    binaryPath: rt.binaryPath,
                    configPath,
                    parameters,
                });
                this.auth = session;
                session.start();
                const result = await session.done;
                this.auth = null;
                if (result.phase !== "done") {
                    throw new clsAppError(
                        result.phase === "timeout" ? "AUTH_TIMEOUT" : "RCLONE_FAILED",
                        result.message ?? "리모트 인증을 마치지 못했습니다.",
                    );
                }
                return { name: input.name, oauth: true };
            }

            const secrets = collectSecretValues(input.values, input.secrets);
            const session = await this.f_StartRcSession({
                binaryPath: rt.binaryPath,
                configPath,
            });
            try {
                const raw = await session.post(
                    "/config/create",
                    {
                        name: input.name,
                        type: input.type,
                        parameters,
                        opt: { nonInteractive: true, obscure: true },
                    },
                    { timeoutMs: RCLONE_TIMEOUTS.remoteConfig },
                );
                const resp = parseRcConfigResponse(raw);
                if (resp.error !== "") {
                    throw new clsAppError("RCLONE_FAILED", redactedStderrTail(resp.error, secrets));
                }
                if (resp.state !== "" || resp.option !== null) {
                    throw new clsAppError(
                        "RCLONE_FAILED",
                        "이 종류는 추가할 때 질문이 필요합니다. rclone config 명령으로 설정하세요.",
                    );
                }
            } catch (e) {
                await this.f_DeleteQuietly(input.name, rt.binaryPath, configPath);
                throw e;
            } finally {
                await session.quit();
            }
            await this.deps.rcloneEnv.detect(true).catch(() => undefined);
            return { name: input.name, oauth: false };
        });
    }

    /** 바뀐 칸만 config/update로 보낸다(FR-18). 비밀 칸을 비워 두면 기존 값을 유지한다 */
    async update(
        input: typRemoteConfigUpdateInput,
    ): Promise<{ name: string; reauthSuggested: boolean }> {
        return this.deps.remoteOps.run([input.name], async () => {
            this.f_AssertNoAuth();
            const rt = await this.deps.rcloneEnv.require();
            await this.f_AssertExists(input.name);
            const providers = await this.f_Providers(rt);
            const red = await this.f_ReadRedacted(input.name, rt);
            const type =
                red?.type ?? (await this.deps.rcloneEnv.detect()).remoteTypes[input.name] ?? "";
            const provider = providers.find((p) => p.type === type);
            if (!provider) {
                throw new clsAppError(
                    "VALIDATION",
                    "이 리모트의 종류를 확인하지 못해 수정할 수 없습니다.",
                );
            }
            const parameters = mergeRemoteParameters(provider, input.values, input.secrets, false);
            if (Object.keys(parameters).length === 0) {
                throw new clsAppError("VALIDATION", "바꿀 값이 없습니다.");
            }
            const secrets = collectSecretValues(input.values, input.secrets);
            const configPath = await this.deps.rcloneEnv.resolveConfigFor(null);
            const session = await this.f_StartRcSession({
                binaryPath: rt.binaryPath,
                configPath,
            });
            try {
                const raw = await session.post(
                    "/config/update",
                    {
                        name: input.name,
                        parameters,
                        opt: { nonInteractive: true, obscure: true },
                    },
                    { timeoutMs: RCLONE_TIMEOUTS.remoteConfig },
                );
                const resp = parseRcConfigResponse(raw);
                if (resp.error !== "") {
                    throw new clsAppError("RCLONE_FAILED", redactedStderrTail(resp.error, secrets));
                }
                if (resp.state !== "" || resp.option !== null) {
                    throw new clsAppError(
                        "RCLONE_FAILED",
                        "수정에 질문이 필요합니다. rclone config 명령으로 설정하세요.",
                    );
                }
            } finally {
                await session.quit();
            }
            await this.deps.rcloneEnv.detect(true).catch(() => undefined);
            const reauthSuggested =
                provider.oauth &&
                (["client_id", "client_secret"].some((k) => k in parameters) ||
                    "token" in parameters);
            return { name: input.name, reauthSuggested };
        });
    }

    /**
     * remote 삭제. 예약 켜진 참조 작업은 자동 실행을 끄고 OS 예약이 사라진 것을 확인한 뒤 지운다(FR-22).
     * 예약 켜진 작업이 있는데 disableSchedules가 없으면 CONFIRM_REQUIRED.
     */
    async remove(input: typRemoteConfigDeleteInput): Promise<itfRemoteDeleteResult> {
        return this.deps.remoteOps.run([input.name], async () => {
            this.f_AssertNoAuth();
            const rt = await this.deps.rcloneEnv.require();
            await this.f_AssertExists(input.name);
            const usage = this.f_Usage(input.name);
            const autoJobs = usage.jobs.filter((j) => j.autoSync !== "off");
            if (autoJobs.length > 0 && input.disableSchedules !== true) {
                throw new clsAppError(
                    "CONFIRM_REQUIRED",
                    `자동 실행이 켜진 작업 ${autoJobs.length}개가 이 리모트를 씁니다. 자동 실행을 끄고 삭제할지 확인하세요.`,
                );
            }
            const disabledJobIds: string[] = [];
            for (const row of autoJobs) {
                const job = this.deps.jobs.get(row.id);
                await this.deps.jobs.update(row.id, {
                    autoSync: { ...job.autoSync, enabled: false },
                });
                disabledJobIds.push(job.id);
            }
            if (disabledJobIds.length > 0) {
                await this.deps.osScheduler.idle();
                const status = this.deps.osScheduler.status();
                if (status.available) {
                    for (const id of disabledJobIds) {
                        const task = status.tasks.find(
                            (t) => t.jobId === id.toLowerCase() && t.registered,
                        );
                        if (task) {
                            throw new clsAppError(
                                "RCLONE_FAILED",
                                "작업 스케줄러에서 예약을 지우지 못해 remote를 지우지 않았습니다. 자동 실행은 꺼진 상태입니다.",
                            );
                        }
                    }
                }
            }
            const configPath = await this.deps.rcloneEnv.resolveConfigFor(null);
            let r;
            try {
                r = await this.deps.run(
                    rt.binaryPath,
                    buildConfigDeleteArgs(input.name, configPath),
                    { timeoutMs: RCLONE_TIMEOUTS.remoteConfig },
                );
            } catch (e) {
                if (e instanceof clsProcessSpawnError) {
                    throw new clsAppError(
                        e.errno === "ENOENT" ? "RCLONE_NOT_FOUND" : "RCLONE_NOT_EXECUTABLE",
                    );
                }
                throw e;
            }
            if (r.timedOut || r.exitCode !== 0) {
                throw new clsAppError(
                    "RCLONE_FAILED",
                    "리모트를 지우지 못했습니다. rclone 설정을 확인하세요.",
                    redactedStderrTail(r.stderrTail, []),
                );
            }
            await this.deps.rcloneEnv.detect(true).catch(() => undefined);
            return { name: input.name, disabledJobIds };
        });
    }

    /** OAuth 재인증. 진행 이벤트로 결과를 알리고 흐름이 끝날 때까지 기다린다 */
    async reconnect(name: string): Promise<{ name: string }> {
        return this.deps.remoteOps.run([name], async () => {
            this.f_AssertNoAuth();
            const rt = await this.deps.rcloneEnv.require();
            await this.f_AssertExists(name);
            const configPath = await this.deps.rcloneEnv.resolveConfigFor(null);
            const session = this.f_NewSession({
                name,
                type: "",
                mode: "reconnect",
                binaryPath: rt.binaryPath,
                configPath,
                parameters: {},
            });
            this.auth = session;
            session.start();
            const result = await session.done;
            this.auth = null;
            if (result.phase !== "done") {
                throw new clsAppError(
                    result.phase === "timeout" ? "AUTH_TIMEOUT" : "RCLONE_FAILED",
                    result.message ?? "재인증을 마치지 못했습니다.",
                );
            }
            return { name };
        });
    }

    /** 진행 중인 OAuth 질문에 답한다 */
    async answer(state: string, result: string): Promise<itfRemoteAuthAnswerResult> {
        if (!this.auth) {
            throw new clsAppError("NOT_FOUND", "진행 중인 인증이 없습니다.");
        }
        return this.auth.answer(state, result);
    }

    /** 진행 중인 OAuth를 취소한다(없으면 아무것도 하지 않는다) */
    async cancelAuth(): Promise<void> {
        const session = this.auth;
        if (!session) return;
        await session.cancel("canceled", "인증을 취소했습니다.");
    }

    /** 앱 종료: 인증 세션을 정리한다(최대 5초) */
    async disposeForQuit(): Promise<void> {
        const session = this.auth;
        if (!session) return;
        await session.dispose();
        this.auth = null;
    }

    private f_NewSession(opts: {
        name: string;
        type: string;
        mode: "create" | "reconnect";
        binaryPath: string;
        configPath: string | null;
        parameters: Record<string, string>;
    }): clsRemoteAuthSession {
        return new clsRemoteAuthSession({
            ...opts,
            emit: this.deps.emit,
            logger: this.deps.logger,
            cleanup: () => this.f_DeleteQuietly(opts.name, opts.binaryPath, opts.configPath),
            refresh: async () => {
                await this.deps.rcloneEnv.detect(true);
            },
            ...(this.deps.sessionFactory ? { sessionFactory: this.deps.sessionFactory } : {}),
            ...(this.deps.spawnReconnect ? { spawnReconnect: this.deps.spawnReconnect } : {}),
        });
    }

    /** 비OAuth create·update용 rcd 세션. 테스트에서는 가짜 세션을 쓴다 */
    private f_StartRcSession(opts: {
        binaryPath: string;
        configPath: string | null;
    }): Promise<Pick<clsRcSession, "post" | "quit">> {
        return (this.deps.startRcSession ?? clsRcSession.start)(opts);
    }

    private async f_Providers(rt: { binaryPath: string }): Promise<itfRemoteProvider[]> {
        const hit = this.providersCache.get(rt.binaryPath);
        if (hit) return hit;
        let r;
        try {
            r = await this.deps.run(rt.binaryPath, buildConfigProvidersArgs(), {
                timeoutMs: RCLONE_TIMEOUTS.providers,
            });
        } catch (e) {
            if (e instanceof clsProcessSpawnError) {
                throw new clsAppError(
                    e.errno === "ENOENT" ? "RCLONE_NOT_FOUND" : "RCLONE_NOT_EXECUTABLE",
                );
            }
            throw e;
        }
        if (r.timedOut || r.exitCode !== 0 || r.stdoutTruncated) {
            throw new clsAppError(
                "RCLONE_FAILED",
                "rclone 종류 목록을 읽지 못했습니다. 이 rclone 버전에서는 앱에서 리모트를 추가할 수 없습니다. rclone config 명령을 쓰세요.",
            );
        }
        const providers = parseProvidersJson(r.stdout);
        this.providersCache.set(rt.binaryPath, providers);
        return providers;
    }

    private async f_ReadRedacted(
        name: string,
        rt: { binaryPath: string; configPath: string | null },
    ): Promise<itfRedactedConfig | null> {
        try {
            const r = await this.deps.run(
                rt.binaryPath,
                buildConfigRedactedArgs(name, rt.configPath),
                { timeoutMs: RCLONE_TIMEOUTS.remoteConfig },
            );
            if (r.timedOut || r.exitCode !== 0 || r.stdoutTruncated) return null;
            return parseRedactedConfig(r.stdout);
        } catch {
            return null;
        }
    }

    private async f_AssertExists(name: string): Promise<void> {
        const names = await this.deps.rcloneEnv.listRemotes(null);
        if (!names.includes(name)) {
            throw new clsAppError(
                "REMOTE_NOT_FOUND",
                `remote ‘${name}’가 rclone 설정에 없습니다. 설정 화면에서 추가하거나 이름을 확인하세요.`,
            );
        }
    }

    /** 참조 수(FR-19). remote 이름은 대소문자를 무시하고 센다 */
    private f_Usage(name: string): itfRemoteUsage {
        const key = name.toLowerCase();
        const jobs = this.deps.jobs.list();
        const rows: itfRemoteUsageJob[] = [];
        let otherConfigJobs = 0;
        for (const job of jobs) {
            if (!f_UsesRemote(job, key)) continue;
            if (job.configPathOverride !== null) {
                otherConfigJobs += 1;
                continue;
            }
            rows.push({
                id: job.id,
                name: job.name,
                autoSync: !job.autoSync.enabled
                    ? "off"
                    : job.autoSync.backend === "os"
                      ? "os"
                      : "app",
            });
        }
        const bookmarks = this.deps.bookmarks
            .list()
            .filter((b) => b.remoteName.toLowerCase() === key)
            .map((b) => ({ id: b.id, alias: b.alias }));
        return {
            jobs: rows.toSorted((a, b) => a.name.localeCompare(b.name)),
            bookmarks,
            otherConfigJobs,
        };
    }

    /** 실패·취소한 create의 반쪽 remote 정리. 오류는 삼킨다 */
    private async f_DeleteQuietly(
        name: string,
        binaryPath: string,
        configPath: string | null,
    ): Promise<void> {
        try {
            await this.deps.run(binaryPath, buildConfigDeleteArgs(name, configPath), {
                timeoutMs: RCLONE_TIMEOUTS.remoteConfig,
            });
        } catch (e) {
            this.deps.logger.warn("반쪽 remote 정리 실패", e);
        }
    }
}

function f_UsesRemote(job: Pick<typJob, "source" | "destination">, key: string): boolean {
    return remoteNamesOfJob(job).some((n) => n.toLowerCase() === key);
}
