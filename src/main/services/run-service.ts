/**
 * 실행 서비스 (MVP_SPEC §8·§9, intent T-07·T-08): 미리보기(dry-run)와 copy·sync 실제 실행, 로그·stats, 취소, 이력.
 *
 * - 흐름: 작업 → 실행 문맥(경로·rclone·설정 파일) → [실제 실행이면 게이트] → 전역 활동 락 → 이력 시작
 *   → [삭제가 있는 sync면 사전 확인 dry-run] → rclone 실행(stderr 줄 단위: 로그 파일·화면 이벤트·dry-run 집계)
 *   → 결과 판정 → 마무리.
 * - 실제 실행 게이트(f_CheckRealGate, 락 전): 비교의 planToken(없으면 PLAN_REQUIRED) → 계획 안전 검사
 *   (checkPlanSafety: 형식 충돌·대소문자·빈 원본 sync·오류 무시 sync) → 계획에서 다시 계산한 삭제 수 ==
 *   확인한 삭제 수 → 대량 삭제면 confirmLargeDeletes. 실패하면 이력도 프로세스도 만들지 않는다.
 * - 사전 확인(preflight): sync + 삭제 > 0 + 작업 옵션 켜짐이면 같은 runId 안에서 --dry-run(--max-delete 없음)을
 *   먼저 돌려 계획과 맞춰 본다(checkPreflight). 다르면 blocked + PLAN_DRIFT, 취소면 canceled, rclone 오류면
 *   failed로 끝내고 실제 실행은 하지 않는다. 옵션을 끄면 --max-delete만 백스톱이다.
 * - 실제 sync에는 항상 --max-delete <계획 삭제 수>(0 포함)를 준다.
 * - 자동 실행(startAuto, 스케줄러): 락을 await 전에 동기로 잡고 같은 runId 안에서 비교(compareForAuto,
 *   수동 비교 결과는 건드리지 않음) → 작업 rev 재확인 → 자동 게이트(f_CheckAutoGate: checkPlanSafety → 삭제가
 *   있으면 allowDeletes·autoMaxDeletes·대량 아님·사전 확인 켜짐 모두 필요 → 바꿀 것 없으면 noop) → 수동과 같은
 *   execute/finalize. 게이트에 걸리면 아무것도 실행하지 않고 blocked 이력, noop은 이력 없이 lastRun만 남긴다.
 * - typRealGate는 f_CheckRealGate(수동)와 f_CheckAutoGate(자동)만 만든다.
 * - buildTransferArgs는 이 파일의 spawnTransfer에서만 부른다(실제 전송의 단일 시작점, AGENTS.md 안전 규칙 2).
 * - 실제 실행은 결과와 관계없이(취소·실패·차단 포함) 비교 결과를 무효화하고 job.lastRun을 갱신한다.
 *   dry-run은 이력에만 남긴다.
 * - app.log에는 id·수·코드만 남긴다(경로·파일 이름은 실행 로그 파일에만).
 * - 제외 패턴은 실행 문맥(ctx.excludes)만 쓴다. 게이트는 비교 결과의 excludeHash와 지금 snapshotHash를
 *   맞춰 보고(다르면 PLAN_STALE), 자동 실행은 같은 실행 안 비교 결과와 맞춰 본다. 파일 방식이면 첫 rclone
 *   실행 전에 --exclude-from 파일 1개를 만들어 dry-run·사전 확인·실제 실행이 함께 쓰고 끝나면 지운다.
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
import { writeExcludeFile, type itfExcludeFileHandle } from "@/main/services/exclude-file";
import { remoteNameOf, resolveJobContext, type itfJobContext } from "@/main/services/job-context";
import { clsRunEventBatcher, type itfBatcherTimers } from "@/main/services/run-events";
import { clsRunLogFile, maskArgsForLog, runLogFileName } from "@/main/services/run-log-file";
import type { clsActiveRunStore } from "@/main/services/run-recovery";
import type { clsExcludeStore } from "@/main/store/exclude-store";
import type { clsHistoryStore } from "@/main/store/history-store";
import type { clsJobStore } from "@/main/store/job-store";
import { checkPlanSafety, isLargeDelete, needsPreflight } from "@/shared/run-gates";
import { checkPreflight, planFromCompare } from "@/shared/run-plan";
import type {
    typAppErrorPayload,
    typRunPhase,
    typRunStatus,
    typRunTrigger,
} from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import type { typRunPlan, typRunRecord, typRunStats, typStartRunInput } from "@/shared/schemas/run";
import type { typSettings } from "@/shared/schemas/settings";
import type { itfCompareResult } from "@/shared/types/compare";
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
    compare: Pick<clsCompareService, "requirePlan" | "invalidate" | "get" | "compareForAuto">;
    history: Pick<clsHistoryStore, "begin" | "patch">;
    activity: clsActivityLock;
    activeRun: Pick<clsActiveRunStore, "write" | "clear">;
    /** 실행 로그 폴더(logs/) */
    logsDir: string;
    /** 공용 제외 패턴 조회 */
    excludes: Pick<clsExcludeStore, "patternsFor">;
    /** --exclude-from 임시 파일 폴더(userData/exclude-files) */
    excludeFileDir: string;
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

/** 실제 실행 허가. f_CheckRealGate(수동)·f_CheckAutoGate(자동)만 만든다 */
type typRealGate = {
    readonly [REAL_GATE]: true;
    readonly plan: typRunPlan;
    /** 실제 sync의 --max-delete (copy는 null) */
    readonly maxDelete: number | null;
    /** 실제 실행 전에 같은 실행 안에서 사전 확인 dry-run을 한다 */
    readonly preflight: boolean;
};

/** spawnTransfer 한 번의 종류. 사전 확인·실제 실행은 게이트가 있어야 만들 수 있다 */
type typTransferStep = { kind: "dryRun" } | { kind: "preflight" | "real"; gate: typRealGate };

const STAGE_TEXT = {
    dryRun: "미리보기(dry-run)",
    preflight: "사전 확인(dry-run, 파일을 바꾸지 않음)",
    real: "실제 실행",
} as const;

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
    /** 로그 파일 머리말을 썼는지(둘째 단계부터는 구획 머리말만) */
    logStarted: boolean;
    done: Promise<void>;
    /** 마무리한 최종 이력 레코드 */
    final: typRunRecord | null;
    /** 이 실행의 --exclude-from 파일 경로(파일 방식이 아니면 null) */
    excludeFile: string | null;
}

/** 자동 실행 결과(스케줄러가 예약·알림에 쓴다). recorded가 false면 이력에 없다(noop 등) */
export interface itfAutoOutcome {
    runId: string;
    jobId: string;
    jobName: string;
    status: typRunStatus;
    error: typAppErrorPayload | null;
    plan: typRunPlan | null;
    stats: typRunStats | null;
    finishedAt: string;
    recorded: boolean;
    /** 실제 전송 rclone을 시작했는지(멈췄으면 대상에 .partial이 남을 수 있음) */
    transferStarted: boolean;
}

/** 자동 실행을 실제 전송 없이 끝내는 이유 */
interface itfAutoStop {
    status: "blocked" | "noop" | "failed" | "canceled";
    error: typAppErrorPayload | null;
    plan: typRunPlan | null;
}

const AUTO_CANCELED: typAppErrorPayload = {
    code: "CANCELED",
    message: "자동 실행을 비교 중에 취소했습니다. 대상은 바뀌지 않았습니다.",
};

/**
 * 실제 실행 게이트(Phase 7 D1). 통과하면 typRealGate를 돌려주고, 아니면 clsAppError를 던진다(락 전, 이력 없음).
 * 순서: planToken → 비교 결과 유효성 → 계획 안전 검사 → 확인한 삭제 수 → 대량 삭제 확인.
 */
function f_CheckRealGate(
    job: typJob,
    input: typStartRunInput,
    compare: Pick<clsCompareService, "requirePlan">,
    safety: typSettings["safety"],
    excludeHash: string,
): typRealGate {
    if (!input.planToken) {
        throw new clsAppError("PLAN_REQUIRED", "먼저 비교한 뒤 실행하세요.");
    }
    const result = compare.requirePlan(job.id, input.planToken, excludeHash);
    const plan = planFromCompare(result.summary, job.mode);
    const block = checkPlanSafety(plan, job);
    if (block) throw new clsAppError(block.code, block.message);
    const expected = plan.deleteFiles;
    if (input.confirmedDeletes === undefined || input.confirmedDeletes !== expected) {
        throw new clsAppError(
            "SAFETY_BLOCKED",
            `확인한 삭제 수(${input.confirmedDeletes ?? "없음"})가 계획(${expected}개)과 다릅니다. 다시 비교하세요.`,
        );
    }
    if (isLargeDelete(plan, safety) && input.confirmLargeDeletes !== true) {
        throw new clsAppError(
            "SAFETY_BLOCKED",
            `대상 파일 ${plan.destFiles}개 중 ${expected}개를 지우는 대량 삭제입니다. 대량 삭제 경고를 확인한 뒤 실행하세요.`,
        );
    }
    return {
        plan,
        maxDelete: f_MaxDelete(job, expected),
        preflight: needsPreflight(plan, job),
    } as typRealGate;
}

/**
 * 자동 실행 게이트(Phase 8 D3/D4, MVP_SPEC §9.3). 통과하면 typRealGate, 아니면 멈출 이유.
 * 순서: checkPlanSafety(S5·S6·S7·S15) → 삭제가 있으면 allowDeletes 켜짐·autoMaxDeletes(0=금지) 이하·
 * 대량 아님·사전 확인 켜짐을 모두 만족해야 한다(일부만 실행하지 않음) → 바꿀 것이 없으면 noop.
 * 문구에는 수만 쓴다(경로 없음: 알림에도 쓴다).
 */
function f_CheckAutoGate(
    job: typJob,
    result: itfCompareResult,
    safety: typSettings["safety"],
): typRealGate | itfAutoStop {
    const plan = planFromCompare(result.summary, job.mode);
    const f_Block = (code: typAppErrorPayload["code"], message: string): itfAutoStop => ({
        status: "blocked",
        error: { code, message },
        plan,
    });
    const block = checkPlanSafety(plan, job);
    if (block) return f_Block(block.code, block.message);
    const d = plan.deleteFiles;
    if (d > 0) {
        if (!job.autoSync.allowDeletes) {
            return f_Block(
                "SAFETY_BLOCKED",
                `대상에서 ${d}개를 지워야 하지만 이 작업은 자동 실행 때 삭제를 허용하지 않아 실행하지 않았습니다.`,
            );
        }
        if (safety.autoMaxDeletes === 0) {
            return f_Block(
                "SAFETY_BLOCKED",
                `설정의 ‘자동 실행 최대 삭제 수’가 0이라 삭제(${d}개)가 필요한 자동 실행은 하지 않았습니다.`,
            );
        }
        if (d > safety.autoMaxDeletes) {
            return f_Block(
                "SAFETY_BLOCKED",
                `삭제 ${d}개가 설정의 ‘자동 실행 최대 삭제 수’(${safety.autoMaxDeletes}개)를 넘어 실행하지 않았습니다.`,
            );
        }
        if (isLargeDelete(plan, safety)) {
            return f_Block(
                "SAFETY_BLOCKED",
                `대상 파일 ${plan.destFiles}개 중 ${d}개를 지우는 대량 삭제라 자동으로 실행하지 않았습니다. 직접 비교한 뒤 실행하세요.`,
            );
        }
        if (!needsPreflight(plan, job)) {
            return f_Block(
                "SAFETY_BLOCKED",
                `실행 직전 사전 확인이 꺼져 있어 삭제(${d}개)가 필요한 자동 실행은 하지 않았습니다.`,
            );
        }
    }
    if (plan.createFiles + plan.updateFiles + d === 0) return { status: "noop", error: null, plan };
    return {
        plan,
        maxDelete: f_MaxDelete(job, d),
        preflight: needsPreflight(plan, job),
    } as typRealGate;
}

/** 자동 실행이 전송 전에 끝난 이유(문맥 해석·비교 실패, 취소) */
function f_AutoFailure(e: unknown, canceled: boolean): itfAutoStop {
    if (canceled || (e instanceof clsAppError && e.code === "CANCELED")) {
        return { status: "canceled", error: AUTO_CANCELED, plan: null };
    }
    if (e instanceof clsAppError && e.code === "PLAN_STALE") {
        return { status: "blocked", error: { code: e.code, message: e.message }, plan: null };
    }
    return { status: "failed", error: f_StartFailure(e), plan: null };
}

/** 실제 sync만 --max-delete(계획 삭제 수, 0 포함)를 쓴다. copy는 null */
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
        const gate = input.dryRun
            ? null
            : f_CheckRealGate(
                  job,
                  input,
                  this.deps.compare,
                  this.deps.settings.get().safety,
                  ctx.excludes.snapshotHash,
              );

        const runId = this.deps.newId();
        const startedAtDate = this.deps.now();
        const release = this.deps.activity.acquire(
            { kind: "run", jobId: job.id, runId, startedAt: startedAtDate.toISOString() },
            (cur) => busyMessageFor(cur, this.deps.jobs),
        );
        const active = this.createActive(job, runId, startedAtDate, {
            dryRun: gate === null,
            trigger: "manual",
            phase: "validating",
            plan: gate ? gate.plan : this.dryRunPlan(job),
        });
        this.active = active;
        await this.beginRecord(active, release, true);
        active.done = this.execute(ctx, gate, active, release);
        return { runId };
    }

    /**
     * 자동 실행(스케줄러, trigger "scheduler"). 전역 락은 첫 await 전에 동기로 잡는다
     * (차 있으면 BUSY를 던지고 이력·예약은 바꾸지 않는다). 같은 runId 안에서 비교 → 자동 게이트 → 실행.
     * done은 예외 없이 결과를 돌려준다(blocked·failed·canceled·success는 이력, noop은 lastRun만).
     */
    async startAuto(jobId: string): Promise<{ runId: string; done: Promise<itfAutoOutcome> }> {
        const job = this.deps.jobs.get(jobId);
        const runId = this.deps.newId();
        const startedAtDate = this.deps.now();
        const release = this.deps.activity.acquire(
            { kind: "run", jobId: job.id, runId, startedAt: startedAtDate.toISOString() },
            (cur) => busyMessageFor(cur, this.deps.jobs),
        );
        const active = this.createActive(job, runId, startedAtDate, {
            dryRun: false,
            trigger: "scheduler",
            phase: "comparing",
            plan: null,
        });
        this.active = active;
        this.deps.logger.info(`자동 실행 시작: run=${runId} job=${job.id} mode=${job.mode}`);
        this.safeEmit({ type: "started", snapshot: this.snapshotOf(active) });
        const done = this.runAuto(job, active, release).catch((e: unknown) =>
            this.finishEarly(active, f_AutoFailure(e, false), release, false),
        );
        active.done = done.then(() => undefined);
        return { runId, done };
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

    /** 실행 상태(스냅샷·이력 레코드)를 만든다. 로그 파일은 첫 rclone 실행 때 연다 */
    private createActive(
        job: typJob,
        runId: string,
        startedAtDate: Date,
        o: { dryRun: boolean; trigger: typRunTrigger; phase: typRunPhase; plan: typRunPlan | null },
    ): itfActiveRun {
        const startedAt = startedAtDate.toISOString();
        const logFile = new clsRunLogFile(
            this.deps.logsDir,
            runLogFileName(startedAtDate, job.id, runId),
        );
        const record: typRunRecord = {
            id: runId,
            jobId: job.id,
            jobName: job.name,
            mode: job.mode,
            dryRun: o.dryRun,
            trigger: o.trigger,
            status: "running",
            phase: o.phase,
            startedAt,
            finishedAt: null,
            durationMs: null,
            plan: o.plan,
            preflight: null,
            stats: null,
            exitCode: null,
            pid: null,
            error: null,
            logFile: logFile.fileName,
            transferStarted: false,
        };
        return {
            snapshot: {
                runId,
                jobId: job.id,
                jobName: job.name,
                mode: job.mode,
                dryRun: o.dryRun,
                trigger: o.trigger,
                status: "running",
                phase: o.phase,
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
            collector: o.dryRun ? createDryRunCollector() : null,
            logFile,
            logStarted: false,
            done: Promise.resolve(),
            final: null,
            excludeFile: null,
        };
    }

    /** running 이력을 남기고 알린다. 기록에 실패하면 락을 풀고 던진다(수동·자동 공통) */
    private async beginRecord(
        active: itfActiveRun,
        release: () => void,
        emitStarted: boolean,
    ): Promise<void> {
        try {
            await this.deps.history.begin(active.record);
        } catch (e) {
            if (this.active === active) this.active = null;
            release();
            throw e;
        }
        const { runId, jobId, mode } = active.snapshot;
        this.deps.logger.info(
            `실행 시작: run=${runId} job=${jobId} mode=${mode} dryRun=${active.record.dryRun} trigger=${active.record.trigger}`,
        );
        if (emitStarted) this.safeEmit({ type: "started", snapshot: this.snapshotOf(active) });
    }

    /** 자동 실행 본문: 문맥 → 비교 → rev 재확인 → 자동 게이트 → (통과) 실행 */
    private async runAuto(
        job: typJob,
        active: itfActiveRun,
        release: () => void,
    ): Promise<itfAutoOutcome> {
        let ctx: itfJobContext;
        let result: itfCompareResult;
        try {
            ctx = await resolveJobContext(job, this.deps);
            if (active.snapshot.cancelRequested) throw new clsAppError("CANCELED");
            result = await this.deps.compare.compareForAuto(job.id, active.controller.signal);
        } catch (e) {
            return this.finishEarly(
                active,
                f_AutoFailure(e, active.snapshot.cancelRequested),
                release,
                true,
            );
        }
        // 비교하는 동안 작업이 바뀌었거나 지워졌으면 실행하지 않는다
        let cur: typJob | null = null;
        try {
            cur = this.deps.jobs.get(job.id);
        } catch {
            cur = null;
        }
        if (!cur || cur.rev !== result.jobRev) {
            return this.finishEarly(
                active,
                {
                    status: "blocked",
                    error: {
                        code: "PLAN_STALE",
                        message: "비교하는 동안 작업 설정이 바뀌어 실행하지 않았습니다.",
                    },
                    plan: null,
                },
                release,
                true,
            );
        }
        // 실행 문맥과 비교의 제외 패턴이 다르면(그 사이 공용 패턴 변경) 실행하지 않는다
        if (result.excludeHash !== ctx.excludes.snapshotHash) {
            return this.finishEarly(
                active,
                {
                    status: "blocked",
                    error: {
                        code: "PLAN_STALE",
                        message: "비교하는 동안 제외 패턴이 바뀌어 실행하지 않았습니다.",
                    },
                    plan: null,
                },
                release,
                true,
            );
        }
        const gate = f_CheckAutoGate(cur, result, this.deps.settings.get().safety);
        if ("status" in gate)
            return this.finishEarly(active, gate, release, gate.status !== "noop");
        if (active.snapshot.cancelRequested) {
            return this.finishEarly(
                active,
                { status: "canceled", error: AUTO_CANCELED, plan: gate.plan },
                release,
                true,
            );
        }
        active.record.plan = gate.plan;
        try {
            await this.beginRecord(active, release, false);
        } catch (e) {
            return this.finishEarly(
                active,
                { status: "failed", error: f_StartFailure(e), plan: gate.plan },
                release,
                false,
            );
        }
        await this.execute(ctx, gate, active, release);
        const rec = active.final ?? active.record;
        return {
            runId: rec.id,
            jobId: rec.jobId,
            jobName: rec.jobName,
            status: rec.status,
            error: rec.error,
            plan: rec.plan,
            stats: rec.stats,
            finishedAt: rec.finishedAt ?? this.deps.now().toISOString(),
            recorded: true,
            transferStarted: rec.transferStarted === true,
        };
    }

    /**
     * rclone 전송 없이 끝난 자동 실행 마무리. recorded면 이력 1건(최종 상태)을 남긴다.
     * lastRun은 항상 갱신한다(이력이 없으면 runId null). 비교 결과·active-run은 건드리지 않는다.
     */
    private async finishEarly(
        active: itfActiveRun,
        stop: itfAutoStop,
        release: () => void,
        recorded: boolean,
    ): Promise<itfAutoOutcome> {
        const { runId, jobId, jobName } = active.snapshot;
        const finished = this.deps.now();
        const finishedAt = finished.toISOString();
        const record: typRunRecord = {
            ...active.record,
            status: stop.status,
            phase: "finalizing",
            finishedAt,
            durationMs: Math.max(0, finished.getTime() - Date.parse(active.record.startedAt)),
            plan: stop.plan,
            error: stop.error,
            logFile: null,
        };
        let saved = recorded;
        try {
            if (recorded) {
                await this.deps.history.begin(record).catch((e: unknown) => {
                    saved = false;
                    this.warn(`이력 저장 실패: run=${runId}`, e);
                });
            }
            await this.deps.jobs
                .setBookkeeping(jobId, {
                    lastRun: { runId: saved ? runId : null, at: finishedAt, status: stop.status },
                })
                .catch((e: unknown) => this.warn(`작업 기록 실패: run=${runId}`, e));
            this.deps.logger.info(
                `자동 실행 종료: run=${runId} job=${jobId} status=${stop.status} code=${stop.error?.code ?? "-"} recorded=${saved}`,
            );
        } finally {
            if (this.active === active) this.active = null;
            release();
            active.snapshot.status = stop.status;
            active.final = record;
            this.safeEmit({ type: "finished", runId, record, dryRunSummary: null });
        }
        return {
            runId,
            jobId,
            jobName,
            status: stop.status,
            error: stop.error,
            plan: stop.plan,
            stats: null,
            finishedAt,
            recorded: saved,
            transferStarted: false,
        };
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
        let file: itfExcludeFileHandle | null = null;
        try {
            // 파일 방식이면 첫 rclone 실행 전에 만들어 dry-run·사전 확인·실제 실행이 함께 쓴다
            if (ctx.excludes.fileContent !== null) {
                file = await writeExcludeFile(
                    this.deps.excludeFileDir,
                    ctx.excludes.fileContent,
                    "run",
                );
                active.excludeFile = file.path;
            }
            const stopped = gate?.preflight
                ? await this.runPreflight(ctx, gate, active, batcher)
                : null;
            if (stopped) {
                ({ result, outcome } = stopped);
            } else {
                result = await this.spawnTransfer(
                    ctx,
                    gate ? { kind: "real", gate } : { kind: "dryRun" },
                    active,
                    batcher,
                );
                outcome = this.decide(ctx, active, result);
            }
        } catch (e) {
            outcome = { status: "failed", error: f_StartFailure(e) };
        } finally {
            active.excludeFile = null;
            await file?.dispose();
        }
        await this.finalize(active, outcome, result, batcher, release);
    }

    private decide(
        ctx: itfJobContext,
        active: itfActiveRun,
        result: itfProcessResult,
    ): itfRunOutcome {
        return decideRunOutcome({
            canceled: active.snapshot.cancelRequested || result.canceled,
            exitCode: result.exitCode,
            stats: active.snapshot.stats,
            errorLines: active.errorLines,
            hint: hintForRcloneError(
                result.stderrTail,
                remoteNameOf(ctx.src) ?? remoteNameOf(ctx.dst),
            ),
        });
    }

    /**
     * 사전 확인 dry-run(§8.4, S14). 계획과 같으면 null(실제 실행으로 진행), 아니면 끝낼 결과를 돌려준다.
     * 결과와 관계없이 사전 확인 stats는 record.preflight에 남기고, 실제 실행용 stats·집계·오류 줄은 비운다.
     */
    private async runPreflight(
        ctx: itfJobContext,
        gate: typRealGate,
        active: itfActiveRun,
        batcher: clsRunEventBatcher,
    ): Promise<{ result: itfProcessResult; outcome: itfRunOutcome } | null> {
        const { runId } = active.snapshot;
        const collector = createDryRunCollector();
        active.collector = collector;
        let result: itfProcessResult;
        try {
            result = await this.spawnTransfer(ctx, { kind: "preflight", gate }, active, batcher);
        } finally {
            active.collector = null;
        }
        const stats = active.snapshot.stats;
        active.record.preflight = stats;
        const canceledOutcome: itfRunOutcome = {
            status: "canceled",
            error: {
                code: "CANCELED",
                message: "사전 확인 중 취소했습니다. 대상은 바뀌지 않았습니다.",
            },
        };
        let outcome: itfRunOutcome | null = null;
        if (active.snapshot.cancelRequested || result.canceled) {
            outcome = canceledOutcome;
        } else if (result.exitCode !== 0) {
            const o = this.decide(ctx, active, result);
            outcome = {
                status: "failed",
                error: {
                    ...(o.error ?? { code: "RCLONE_FAILED", message: "" }),
                    message:
                        `사전 확인에 실패해 실행하지 않았습니다(대상은 바뀌지 않음). ${o.error?.message ?? ""}`.trim(),
                },
            };
        } else {
            const match = checkPreflight(gate.plan, collector.summary(), stats);
            if (!match.ok) {
                outcome = {
                    status: "blocked",
                    error: {
                        code: "PLAN_DRIFT",
                        message:
                            "비교한 뒤 원본 또는 대상이 바뀌어 실행하지 않았습니다(대상은 바뀌지 않음). 다시 비교하세요.",
                        detail: match.mismatches.join("\n"),
                    },
                };
            }
        }
        this.deps.logger.info(
            `사전 확인: run=${runId} exit=${result.exitCode ?? "-"} result=${outcome ? outcome.status : "ok"}`,
        );
        active.snapshot.stats = null;
        if (outcome) return { result, outcome };
        // 사전 확인과 실제 실행 사이에 취소했으면 시작하지 않는다
        if (active.snapshot.cancelRequested) return { result, outcome: canceledOutcome };
        active.errorLines = [];
        active.pid = null;
        return null;
    }

    /** 실제 전송의 단일 시작점. buildTransferArgs는 여기서만 부른다 */
    private spawnTransfer(
        ctx: itfJobContext,
        step: typTransferStep,
        active: itfActiveRun,
        batcher: clsRunEventBatcher,
    ): Promise<itfProcessResult> {
        const { job } = ctx;
        const source = ctx.src.normalized;
        const destination = ctx.dst.normalized;
        const real = step.kind === "real";
        const args = buildTransferArgs({
            mode: job.mode,
            source,
            destination,
            configPath: ctx.configPath,
            excludes: { patterns: ctx.excludes.argPatterns, fromFile: active.excludeFile },
            options: job.options,
            dryRun: !real,
            maxDelete: step.kind === "real" ? step.gate.maxDelete : null,
        });
        const masked = maskArgsForLog(args, { source, destination, configPath: ctx.configPath });
        if (active.logStarted) {
            active.logFile.section(STAGE_TEXT[step.kind], masked);
        } else {
            active.logStarted = true;
            active.logFile.open({
                runId: active.snapshot.runId,
                jobId: job.id,
                mode: job.mode,
                dryRun: active.snapshot.dryRun,
                ...(step.kind === "preflight" ? { stage: STAGE_TEXT.preflight } : {}),
                args: masked,
            });
        }
        const imageName = f_ImageName(ctx.binaryPath);
        const phase: typRunPhase = step.kind === "preflight" ? "preflight" : "transferring";
        return this.deps.run(ctx.binaryPath, args, {
            timeoutMs: null,
            signal: active.controller.signal,
            collectStdout: false,
            onSpawn: (pid) => this.onSpawn(active, pid, imageName, phase, real),
            onStderrLine: (line) => this.onLine(active, line, batcher),
        });
    }

    private onSpawn(
        active: itfActiveRun,
        pid: number,
        imageName: string,
        phase: typRunPhase,
        real: boolean,
    ): void {
        const { runId, jobId, startedAt } = active.snapshot;
        active.pid = pid;
        active.snapshot.phase = phase;
        // 실제 전송이 시작됐다: 멈추면 대상에 .partial이 남을 수 있다(rclone-notes #17)
        if (real) active.record.transferStarted = true;
        this.safeEmit({
            type: "phase",
            runId,
            phase,
            at: this.deps.now().toISOString(),
        });
        this.deps.activeRun
            .write({ version: 1, runId, jobId, pid, startedAt, imageName })
            .catch((e: unknown) => this.warn(`active-run 기록 실패: run=${runId}`, e));
        this.deps.history
            .patch(runId, real ? { pid, phase, transferStarted: true } : { pid, phase })
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
                preflight: active.record.preflight,
                stats: active.snapshot.stats,
                exitCode,
                pid: active.pid,
                error: outcome.error,
                transferStarted: active.record.transferStarted === true,
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
            active.final = record;
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
