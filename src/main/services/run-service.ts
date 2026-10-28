/**
 * 실행 서비스 (MVP_SPEC §8, intent T-07): 미리보기(dry-run)와 copy 실제 실행, 로그·stats, 취소, 이력.
 *
 * - 흐름: 작업 → 실행 문맥(경로·rclone·설정 파일) → [실제 실행이면 게이트] → 전역 활동 락 → 이력 시작
 *   → rclone 실행(stderr 줄 단위: 로그 파일·화면 이벤트·dry-run 집계) → 결과 판정 → 마무리.
 * - 실제 실행 게이트(f_CheckRealGate): sync 실제 실행은 아직 막는다(SAFETY_BLOCKED, Phase 7).
 *   비교의 planToken(없으면 PLAN_REQUIRED)과 계획에서 다시 계산한 삭제 수 == 확인한 삭제 수가 필요하다.
 *   형식 충돌·대소문자만 다른 항목이 있으면 막는다. 실패하면 이력도 프로세스도 만들지 않는다.
 * - buildTransferArgs는 이 파일의 spawnTransfer에서만 부른다(실제 전송의 단일 시작점, AGENTS.md 안전 규칙 2).
 * - 실제 실행은 결과와 관계없이(취소·실패 포함) 비교 결과를 무효화하고 job.lastRun을 갱신한다.
 *   dry-run은 이력에만 남긴다.
 * - app.log에는 id·수·코드만 남긴다(경로·파일 이름은 실행 로그 파일에만).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { randomUUID } from "node:crypto";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { redactSecrets, type clsLogger } from "@/main/lib/logger";
import { parseLogLine } from "@/main/parsers/log-parser";
import { hintForRcloneError } from "@/main/parsers/rclone-env-parser";
import {
    createDryRunCollector,
    decideRunOutcome,
    type itfDryRunCollector,
    type itfRunOutcome,
} from "@/main/parsers/run-output";
import { buildTransferArgs, clsCommandBlockedError } from "@/main/rclone/command-builder";
import type { clsRcloneEnv } from "@/main/rclone/detect";
import {
    clsProcessSpawnError,
    runRclone,
    type itfProcessResult,
    type typRunRclone,
} from "@/main/rclone/process";
import { busyMessageFor, type clsActivityLock } from "@/main/services/activity-lock";
import type { clsCompareService } from "@/main/services/compare-service";
import { remoteNameOf, resolveJobContext, type itfJobContext } from "@/main/services/job-context";
import { clsRunEventBatcher, type itfBatcherTimers } from "@/main/services/run-events";
import { clsRunLogFile, maskArgsForLog, runLogFileName } from "@/main/services/run-log-file";
import type { clsActiveRunStore } from "@/main/services/run-recovery";
import type { clsHistoryStore } from "@/main/store/history-store";
import type { clsJobStore } from "@/main/store/job-store";
import { expectedDeletes, planFromCompare } from "@/shared/run-plan";
import type { typAppErrorPayload } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import type { typRunPlan, typRunRecord, typStartRunInput } from "@/shared/schemas/run";
import type { typSettings } from "@/shared/schemas/settings";
import {
    RUN_TAIL_LINES,
    type itfRunLogLine,
    type itfRunSnapshot,
    type typRunEvent,
} from "@/shared/types/run";

export interface itfRunServiceDeps {
    jobs: Pick<clsJobStore, "get" | "setBookkeeping">;
    settings: { get(): typSettings };
    rcloneEnv: Pick<clsRcloneEnv, "require" | "resolveConfigFor">;
    compare: Pick<clsCompareService, "requirePlan" | "invalidate" | "get">;
    history: Pick<clsHistoryStore, "begin" | "patch">;
    activity: clsActivityLock;
    activeRun: Pick<clsActiveRunStore, "write" | "clear">;
    /** 실행 로그 폴더(logs/) */
    logsDir: string;
    logger: Pick<clsLogger, "info" | "warn">;
    /** 기본 runRclone */
    run?: typRunRclone;
    now?: () => Date;
    newId?: () => string;
    emit?: (e: typRunEvent) => void;
    /** 이벤트 묶음 타이머(테스트) */
    timers?: itfBatcherTimers;
}

declare const REAL_GATE: unique symbol;

/** 실제 실행 허가. f_CheckRealGate만 만든다 */
type typRealGate = {
    readonly [REAL_GATE]: true;
    readonly plan: typRunPlan;
    /** 실제 sync의 --max-delete (copy는 null) */
    readonly maxDelete: number | null;
};

/** 오류 detail로 남길 마지막 오류 줄 수 */
const ERROR_LINES_KEPT = 5;

interface itfActiveRun {
    snapshot: itfRunSnapshot;
    record: typRunRecord;
    controller: AbortController;
    pid: number | null;
    errorLines: string[];
    collector: itfDryRunCollector | null;
    logFile: clsRunLogFile;
    done: Promise<void>;
}

/**
 * 실제 실행 게이트(D1). 통과하면 typRealGate를 돌려주고, 아니면 clsAppError를 던진다.
 * 순서: sync 실제 실행 차단 → planToken → 비교 결과 유효성 → 확인한 삭제 수 → 충돌 항목.
 */
function f_CheckRealGate(
    job: typJob,
    input: typStartRunInput,
    compare: Pick<clsCompareService, "requirePlan">,
): typRealGate {
    if (job.mode === "sync") {
        throw new clsAppError(
            "SAFETY_BLOCKED",
            "동기화(삭제 포함) 실제 실행은 아직 지원하지 않습니다. 미리보기로 일어날 일을 확인할 수 있습니다.",
        );
    }
    if (!input.planToken) {
        throw new clsAppError("PLAN_REQUIRED", "먼저 비교한 뒤 실행하세요.");
    }
    const result = compare.requirePlan(job.id, input.planToken);
    const expected = expectedDeletes(result.summary, job.mode);
    if (input.confirmedDeletes === undefined || input.confirmedDeletes !== expected) {
        throw new clsAppError(
            "SAFETY_BLOCKED",
            `확인한 삭제 수(${input.confirmedDeletes ?? "없음"})가 계획(${expected}개)과 다릅니다. 다시 비교하세요.`,
        );
    }
    const { conflictFiles, caseOnlyFiles } = result.summary;
    if (conflictFiles > 0 || caseOnlyFiles > 0) {
        throw new clsAppError(
            "SAFETY_BLOCKED",
            `파일·폴더 이름이 겹치거나(${conflictFiles}개) 대소문자만 다른(${caseOnlyFiles}개) 항목이 있어 실행할 수 없습니다. 직접 정리한 뒤 다시 비교하세요.`,
        );
    }
    return {
        plan: planFromCompare(result.summary, job.mode),
        maxDelete: f_MaxDelete(job, expected),
    } as typRealGate;
}

/** 실제 sync만 --max-delete를 쓴다(Phase 7). copy는 null */
function f_MaxDelete(job: Pick<typJob, "mode">, expected: number): number | null {
    return job.mode === "sync" ? expected : null;
}

/** rclone을 시작하지 못했거나 인자가 막힘 → 이력 오류 */
function f_StartFailure(e: unknown): typAppErrorPayload {
    if (e instanceof clsProcessSpawnError) {
        return e.errno === "ENOENT"
            ? { code: "RCLONE_NOT_FOUND", message: "rclone을 찾지 못했습니다." }
            : { code: "RCLONE_NOT_EXECUTABLE", message: "rclone을 실행할 수 없습니다." };
    }
    if (e instanceof clsCommandBlockedError) return { code: "COMMAND_BLOCKED", message: e.message };
    if (e instanceof clsAppError) return { code: e.code, message: e.message };
    return { code: "INTERNAL", message: "실행 중 내부 오류가 발생했습니다." };
}

function f_ImageName(binaryPath: string): string {
    return binaryPath.split(/[\\/]/).at(-1) || "rclone.exe";
}

export class clsRunService {
    private readonly deps: Required<Omit<itfRunServiceDeps, "timers">> &
        Pick<itfRunServiceDeps, "timers">;
    private active: itfActiveRun | null = null;

    constructor(deps: itfRunServiceDeps) {
        this.deps = {
            run: runRclone,
            now: () => new Date(),
            newId: () => randomUUID(),
            emit: () => undefined,
            ...deps,
        };
    }

    /**
     * 실행을 시작하고 runId를 돌려준다(끝날 때까지 기다리지 않음). 진행은 run:event로 알린다.
     * 시작 전 검사(경로·rclone·게이트·BUSY)에 걸리면 이력 없이 오류를 던진다.
     */
    async start(input: typStartRunInput): Promise<{ runId: string }> {
        const job = this.deps.jobs.get(input.jobId);
        const ctx = await resolveJobContext(job, this.deps);
        const gate = input.dryRun ? null : f_CheckRealGate(job, input, this.deps.compare);

        const runId = this.deps.newId();
        const startedAtDate = this.deps.now();
        const startedAt = startedAtDate.toISOString();
        const release = this.deps.activity.acquire(
            { kind: "run", jobId: job.id, runId, startedAt },
            (cur) => busyMessageFor(cur, this.deps.jobs),
        );
        const logFile = new clsRunLogFile(
            this.deps.logsDir,
            runLogFileName(startedAtDate, job.id, runId),
        );
        const record: typRunRecord = {
            id: runId,
            jobId: job.id,
            jobName: job.name,
            mode: job.mode,
            dryRun: gate === null,
            trigger: "manual",
            status: "running",
            phase: "validating",
            startedAt,
            finishedAt: null,
            durationMs: null,
            plan: gate ? gate.plan : this.dryRunPlan(job),
            preflight: null,
            stats: null,
            exitCode: null,
            pid: null,
            error: null,
            logFile: logFile.fileName,
        };
        const active: itfActiveRun = {
            snapshot: {
                runId,
                jobId: job.id,
                jobName: job.name,
                mode: job.mode,
                dryRun: gate === null,
                trigger: "manual",
                status: "running",
                phase: "validating",
                startedAt,
                stats: null,
                logFile: logFile.fileName,
                tail: [],
                dryRunSummary: null,
                cancelRequested: false,
            },
            record,
            controller: new AbortController(),
            pid: null,
            errorLines: [],
            collector: gate === null ? createDryRunCollector() : null,
            logFile,
            done: Promise.resolve(),
        };
        this.active = active;
        try {
            await this.deps.history.begin(record);
        } catch (e) {
            if (this.active === active) this.active = null;
            release();
            throw e;
        }
        this.deps.logger.info(
            `실행 시작: run=${runId} job=${job.id} mode=${job.mode} dryRun=${record.dryRun}`,
        );
        this.safeEmit({ type: "started", snapshot: this.snapshotOf(active) });
        active.done = this.execute(ctx, gate, active, release);
        return { runId };
    }

    /** 진행 중인 실행을 취소한다. 없거나 다른 실행이거나 이미 요청했으면 아무것도 하지 않는다 */
    cancel(runId: string): void {
        const a = this.active;
        if (!a || a.snapshot.runId !== runId || a.snapshot.cancelRequested) return;
        a.snapshot.cancelRequested = true;
        a.logFile.write(`# 취소 요청: ${this.deps.now().toISOString()}`);
        this.deps.logger.info(`실행 취소 요청: run=${runId}`);
        a.controller.abort();
    }

    getActive(): itfRunSnapshot | null {
        return this.active ? this.snapshotOf(this.active) : null;
    }

    isRunningJob(jobId: string): boolean {
        return this.active?.snapshot.jobId === jobId;
    }

    /** 실행이 끝날 때까지 최대 ms 기다린다. 끝났으면(또는 없으면) true */
    async whenIdle(ms: number): Promise<boolean> {
        const a = this.active;
        if (!a) return true;
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), ms);
        });
        try {
            return await Promise.race([a.done.then(() => true as const), timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** dry-run 이력의 계획: 유효한 비교 결과가 있으면 그것, 없으면 null */
    private dryRunPlan(job: typJob): typRunPlan | null {
        const r = this.deps.compare.get(job.id);
        return r && r.mode === job.mode ? planFromCompare(r.summary, job.mode) : null;
    }

    private snapshotOf(a: itfActiveRun): itfRunSnapshot {
        return {
            ...a.snapshot,
            tail: [...a.snapshot.tail],
            dryRunSummary: a.collector ? a.collector.summary() : null,
        };
    }

    /** 실행부터 마무리까지. 예외를 밖으로 던지지 않는다 */
    private async execute(
        ctx: itfJobContext,
        gate: typRealGate | null,
        active: itfActiveRun,
        release: () => void,
    ): Promise<void> {
        const batcher = new clsRunEventBatcher({
            runId: active.snapshot.runId,
            emit: (e) => this.safeEmit(e),
            ...(this.deps.timers ? { timers: this.deps.timers } : {}),
        });
        let result: itfProcessResult | null = null;
        let outcome: itfRunOutcome;
        try {
            result = await this.spawnTransfer(ctx, gate, active, batcher);
            outcome = decideRunOutcome({
                canceled: active.snapshot.cancelRequested || result.canceled,
                exitCode: result.exitCode,
                stats: active.snapshot.stats,
                errorLines: active.errorLines,
                hint: hintForRcloneError(
                    result.stderrTail,
                    remoteNameOf(ctx.src) ?? remoteNameOf(ctx.dst),
                ),
            });
        } catch (e) {
            outcome = { status: "failed", error: f_StartFailure(e) };
        }
        await this.finalize(active, outcome, result, batcher, release);
    }

    /** 실제 전송의 단일 시작점. buildTransferArgs는 여기서만 부른다 */
    private spawnTransfer(
        ctx: itfJobContext,
        gate: typRealGate | null,
        active: itfActiveRun,
        batcher: clsRunEventBatcher,
    ): Promise<itfProcessResult> {
        const { job } = ctx;
        const source = ctx.src.normalized;
        const destination = ctx.dst.normalized;
        const args = buildTransferArgs({
            mode: job.mode,
            source,
            destination,
            configPath: ctx.configPath,
            excludes: job.excludes,
            options: job.options,
            dryRun: gate === null,
            maxDelete: gate === null ? null : gate.maxDelete,
        });
        active.logFile.open({
            runId: active.snapshot.runId,
            jobId: job.id,
            mode: job.mode,
            dryRun: gate === null,
            args: maskArgsForLog(args, { source, destination, configPath: ctx.configPath }),
        });
        const imageName = f_ImageName(ctx.binaryPath);
        return this.deps.run(ctx.binaryPath, args, {
            timeoutMs: null,
            signal: active.controller.signal,
            collectStdout: false,
            onSpawn: (pid) => this.onSpawn(active, pid, imageName),
            onStderrLine: (line) => this.onLine(active, line, batcher),
        });
    }

    private onSpawn(active: itfActiveRun, pid: number, imageName: string): void {
        const { runId, jobId, startedAt } = active.snapshot;
        active.pid = pid;
        active.snapshot.phase = "transferring";
        this.safeEmit({
            type: "phase",
            runId,
            phase: "transferring",
            at: this.deps.now().toISOString(),
        });
        this.deps.activeRun
            .write({ version: 1, runId, jobId, pid, startedAt, imageName })
            .catch((e: unknown) => this.warn(`active-run 기록 실패: run=${runId}`, e));
        this.deps.history
            .patch(runId, { pid, phase: "transferring" })
            .catch((e: unknown) => this.warn(`이력 갱신 실패: run=${runId}`, e));
    }

    private onLine(active: itfActiveRun, line: string, batcher: clsRunEventBatcher): void {
        active.logFile.write(line);
        const p = parseLogLine(line);
        if (p.stats) {
            active.snapshot.stats = p.stats;
            batcher.pushStats(p.stats);
            return;
        }
        active.collector?.push(p);
        if (p.message === "") return;
        const message = redactSecrets(p.message);
        if (p.level === "error") {
            active.errorLines.push(message);
            if (active.errorLines.length > ERROR_LINES_KEPT) active.errorLines.shift();
        }
        const entry: itfRunLogLine = {
            at: p.at ?? this.deps.now().toISOString(),
            level: p.level,
            message,
            ...(p.object === null ? {} : { object: p.object }),
        };
        const tail = active.snapshot.tail;
        tail.push(entry);
        if (tail.length > RUN_TAIL_LINES) tail.shift();
        batcher.pushLog(entry);
    }

    /** 이벤트 정리 → 로그 닫기 → 이력 → (실제 실행) lastRun·비교 무효화 → active-run → 락 해제 → finished */
    private async finalize(
        active: itfActiveRun,
        outcome: itfRunOutcome,
        result: itfProcessResult | null,
        batcher: clsRunEventBatcher,
        release: () => void,
    ): Promise<void> {
        const { runId, jobId, dryRun } = active.snapshot;
        let record: typRunRecord = active.record;
        try {
            batcher.flush();
            active.snapshot.phase = "finalizing";
            this.safeEmit({
                type: "phase",
                runId,
                phase: "finalizing",
                at: this.deps.now().toISOString(),
            });
            const finished = this.deps.now();
            const finishedAt = finished.toISOString();
            const exitCode = result?.exitCode ?? null;
            active.logFile.write(
                `# 종료: ${finishedAt} status=${outcome.status} exit=${exitCode ?? "-"}`,
            );
            await active.logFile.close();
            const patch = {
                status: outcome.status,
                phase: "finalizing" as const,
                finishedAt,
                durationMs: Math.max(0, finished.getTime() - Date.parse(active.record.startedAt)),
                stats: active.snapshot.stats,
                exitCode,
                pid: active.pid,
                error: outcome.error,
            };
            record = { ...active.record, ...patch };
            try {
                record = await this.deps.history.patch(runId, patch);
            } catch (e) {
                this.warn(`이력 저장 실패: run=${runId}`, e);
            }
            active.snapshot.status = outcome.status;
            if (!dryRun) {
                // 대상이 바뀌었을 수 있으므로 결과와 관계없이 비교 결과를 버린다
                this.deps.compare.invalidate(jobId);
                await this.deps.jobs
                    .setBookkeeping(jobId, {
                        lastRun: { runId, at: finishedAt, status: outcome.status },
                    })
                    .catch((e: unknown) => this.warn(`작업 기록 실패: run=${runId}`, e));
            }
            // 프로세스 종료를 확인하지 못했으면 남겨 두고 다음 시작 때 정리한다
            if (result === null || result.closed) {
                await this.deps.activeRun
                    .clear()
                    .catch((e: unknown) => this.warn(`active-run 삭제 실패: run=${runId}`, e));
            } else {
                this.deps.logger.warn(`프로세스 종료를 확인하지 못함: run=${runId}`);
            }
            const s = active.snapshot.stats;
            this.deps.logger.info(
                `실행 종료: run=${runId} job=${jobId} status=${outcome.status} code=${outcome.error?.code ?? "-"} exit=${exitCode ?? "-"} transfers=${s?.transfers ?? 0} errors=${s?.errors ?? 0}`,
            );
        } catch (e) {
            this.warn(`실행 마무리 실패: run=${runId}`, e);
        } finally {
            if (this.active === active) this.active = null;
            release();
            this.safeEmit({
                type: "finished",
                runId,
                record,
                dryRunSummary: active.collector ? active.collector.summary() : null,
            });
        }
    }

    private warn(message: string, e: unknown): void {
        const code = e instanceof clsAppError ? e.code : "INTERNAL";
        this.deps.logger.warn(`${message} code=${code}`);
    }

    private safeEmit(e: typRunEvent): void {
        try {
            this.deps.emit(e);
        } catch {
            // 창이 닫히는 중 등: 이벤트 실패로 실행을 멈추지 않는다
        }
    }
}
