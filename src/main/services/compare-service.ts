/**
 * 비교 서비스 (MVP_SPEC §7.2~7.4, intent T-05). 원본·대상 목록을 읽어 차이를 계산한다. 읽기 전용.
 *
 * - 시작 전: 전역 활동 락 → 경로 형식·안전 검사(드라이브 상대 경로 포함) → rclone·설정 파일 → probe
 *   (lsjson은 파일 경로에 그 파일 1건을 돌려주므로 폴더인지 먼저 확인한다. 대상이 없으면 빈 목록)
 * - 목록: 원본·대상 lsjson을 병렬로 줄 단위로 읽는다(stdout을 모으지 않음). 한쪽이 실패하면 다른 쪽도 끝낸다.
 * - 결과는 작업별로 메모리에만 둔다. 실패·취소하면 그 작업의 이전 결과도 지운다(§7.4).
 * - 자동 실행용 compareForAuto는 실행 서비스가 잡은 락 안에서 부른다: 락·캐시·진행 이벤트가 없고
 *   수동 비교 결과(planToken)를 건드리지 않는다. 취소는 넘겨받은 signal로 한다.
 * - 로그에는 작업 id·수·코드만 남기고 경로·파일 이름은 쓰지 않는다.
 * - 제외 패턴은 실행 문맥(ctx.excludes)만 쓴다. 파일 방식이면 --exclude-from 파일 1개를 만들어 두 lsjson이
 *   함께 쓰고 끝나면 지운다. 결과의 excludeHash가 지금 패턴과 다르면 get은 null, requirePlan은 PLAN_STALE
 *   (공용 패턴을 바꿔도 작업 rev는 그대로라 rev만으로는 막지 못한다).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsLogger } from "@/main/lib/logger";
import {
    clsLsjsonParseError,
    createLsjsonLineParser,
    type itfLsjsonLineParser,
} from "@/main/parsers/lsjson-parser";
import { hintForRcloneError, summarizeStderr } from "@/main/parsers/rclone-env-parser";
import {
    buildLsjsonArgs,
    COMPARE_HASH_TYPES,
    type itfExcludeArgs,
} from "@/main/rclone/command-builder";
import { RCLONE_TIMEOUTS } from "@/main/rclone/config";
import type { clsRcloneEnv } from "@/main/rclone/detect";
import { clsProcessSpawnError, runRclone, type typRunRclone } from "@/main/rclone/process";
import { busyMessageFor, type clsActivityLock } from "@/main/services/activity-lock";
import { resolveEffectiveExcludes } from "@/main/services/effective-excludes";
import { writeExcludeFile, type itfExcludeFileHandle } from "@/main/services/exclude-file";
import { remoteNameOf, resolveJobContext, type itfJobContext } from "@/main/services/job-context";
import { PROBE_MISSING_MESSAGE, type clsPathService } from "@/main/services/path-service";
import { computePlanToken } from "@/main/services/plan-token";
import type { clsExcludeStore } from "@/main/store/exclude-store";
import type { clsJobStore } from "@/main/store/job-store";
import { diffFileLists } from "@/shared/diff-engine";
import type { itfPathProbe } from "@/shared/ipc-contract";
import type { itfParsedPath } from "@/shared/path-utils";
import type { typJob } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";
import type {
    itfCompareActive,
    itfCompareProgress,
    itfCompareResult,
    itfFileMeta,
    typCompareEventPhase,
    typComparePhase,
} from "@/shared/types/compare";

export interface itfCompareServiceDeps {
    jobs: Pick<clsJobStore, "get">;
    settings: { get(): typSettings };
    rcloneEnv: Pick<clsRcloneEnv, "require" | "resolveConfigFor">;
    pathService: Pick<clsPathService, "probe">;
    activity: clsActivityLock;
    /** 공용 제외 패턴 조회 */
    excludes: Pick<clsExcludeStore, "patternsFor">;
    /** --exclude-from 임시 파일 폴더(userData/exclude-files) */
    excludeFileDir: string;
    logger: Pick<clsLogger, "info" | "warn">;
    /** 기본 runRclone */
    run?: typRunRclone;
    now?: () => Date;
    emit?: (e: itfCompareProgress) => void;
    /** 한 쪽 목록 조회 상한. 기본 RCLONE_TIMEOUTS.compare(30분) */
    timeoutMs?: number;
    /** 목록 진행 이벤트 간격. 기본 250ms */
    progressIntervalMs?: number;
    /** 작업별 결과 보관 수. 기본 3 (오래된 것부터 버림) */
    maxCached?: number;
}

/** 이 행 수를 넘으면 화면이 느려질 수 있다고 알린다 */
export const LARGE_COMPARE_ROWS = 50_000;

interface itfActiveCompare {
    jobId: string;
    phase: typComparePhase;
    startedAt: string;
    sourceFiles: number;
    destFiles: number;
    controller: AbortController;
    canceled: boolean;
    /** 진행 이벤트를 보내지 않는다(자동 실행) */
    silent: boolean;
}

interface itfCacheEntry {
    result: itfCompareResult;
    settingsKey: string;
}

interface itfListSide {
    label: "원본" | "대상";
    path: itfParsedPath;
    parser: itfLsjsonLineParser;
}

function f_SettingsKey(s: typSettings): string {
    return JSON.stringify([s.rclonePath, s.configPath, s.compare.caseInsensitivePaths]);
}

export class clsCompareService {
    private readonly deps: Required<itfCompareServiceDeps>;
    private readonly cache = new Map<string, itfCacheEntry>();
    private active: itfActiveCompare | null = null;

    constructor(deps: itfCompareServiceDeps) {
        this.deps = {
            run: runRclone,
            now: () => new Date(),
            emit: () => undefined,
            timeoutMs: RCLONE_TIMEOUTS.compare,
            progressIntervalMs: 250,
            maxCached: 3,
            ...deps,
        };
    }

    /** 비교 실행. 끝나면 캐시에 넣고 결과를 돌려준다. 실패·취소 시 그 작업의 이전 결과도 지운다 */
    async run(jobId: string): Promise<itfCompareResult> {
        const job = this.deps.jobs.get(jobId);
        const startedAt = this.deps.now().toISOString();
        const release = this.deps.activity.acquire({ kind: "compare", jobId, startedAt }, (cur) =>
            busyMessageFor(cur, this.deps.jobs),
        );
        const active = f_NewActive(jobId, startedAt, false);
        this.active = active;
        this.emitProgress(active, "check");
        const t0 = Date.now();
        let end: typCompareEventPhase = "failed";
        try {
            const { result, settingsKey } = await this.execute(job, active, t0);
            end = "done";
            this.cachePut(jobId, result, settingsKey);
            this.deps.logger.info(
                `비교 완료: job=${jobId} files=${result.summary.sourceFiles}/${result.summary.destFiles} ms=${result.durationMs}`,
            );
            return result;
        } catch (e) {
            this.cache.delete(jobId);
            const err = active.canceled ? new clsAppError("CANCELED", "비교를 취소했습니다.") : e;
            if (err instanceof clsAppError && err.code === "CANCELED") end = "canceled";
            const code = err instanceof clsAppError ? err.code : "INTERNAL";
            this.deps.logger.warn(
                `비교 ${end === "canceled" ? "취소" : "실패"}: job=${jobId} code=${code}`,
            );
            throw err;
        } finally {
            if (this.active === active) this.active = null;
            release();
            this.emitProgress(active, end);
        }
    }

    /**
     * 자동 실행용 비교. 락(호출하는 실행 서비스가 잡음)·캐시·진행 이벤트 없이 결과만 돌려준다.
     * 수동 비교 결과는 그대로 둔다. signal이 abort되면 lsjson을 끝내고 CANCELED를 던진다.
     */
    async compareForAuto(jobId: string, signal: AbortSignal): Promise<itfCompareResult> {
        const job = this.deps.jobs.get(jobId);
        const active = f_NewActive(jobId, this.deps.now().toISOString(), true);
        const f_Abort = () => {
            active.canceled = true;
            active.controller.abort();
        };
        if (signal.aborted) f_Abort();
        else signal.addEventListener("abort", f_Abort, { once: true });
        try {
            const { result } = await this.execute(job, active, Date.now());
            this.deps.logger.info(
                `자동 비교 완료: job=${jobId} files=${result.summary.sourceFiles}/${result.summary.destFiles} ms=${result.durationMs}`,
            );
            return result;
        } catch (e) {
            const err = active.canceled ? new clsAppError("CANCELED", "비교를 취소했습니다.") : e;
            const code = err instanceof clsAppError ? err.code : "INTERNAL";
            this.deps.logger.warn(`자동 비교 실패: job=${jobId} code=${code}`);
            throw err;
        } finally {
            signal.removeEventListener("abort", f_Abort);
        }
    }

    /** 진행 중이면 두 lsjson을 모두 종료한다. 없거나 다른 작업이면 아무것도 하지 않는다(idempotent) */
    cancel(jobId: string): void {
        const a = this.active;
        if (!a || a.jobId !== jobId || a.canceled) return;
        a.canceled = true;
        a.controller.abort();
    }

    /** 유효한 결과만. 작업 rev·설정 지문·제외 패턴이 바뀌었거나 작업이 없으면 지우고 null */
    get(jobId: string): itfCompareResult | null {
        const entry = this.cache.get(jobId);
        if (!entry) return null;
        let job: typJob;
        try {
            job = this.deps.jobs.get(jobId);
        } catch {
            this.cache.delete(jobId);
            return null;
        }
        if (
            job.rev !== entry.result.jobRev ||
            f_SettingsKey(this.deps.settings.get()) !== entry.settingsKey ||
            this.currentExcludeHash(job) !== entry.result.excludeHash
        ) {
            this.cache.delete(jobId);
            return null;
        }
        return entry.result;
    }

    getActive(): itfCompareActive | null {
        const a = this.active;
        if (!a) return null;
        return {
            jobId: a.jobId,
            phase: a.phase,
            startedAt: a.startedAt,
            sourceFiles: a.sourceFiles,
            destFiles: a.destFiles,
        };
    }

    /**
     * Phase 6/7 실행 게이트용. 없음·토큰 불일치 → PLAN_REQUIRED,
     * rev/설정 변경·제외 패턴 변경(excludeHash: 실행 문맥의 snapshotHash)·compareMaxAgeMinutes 초과
     * → PLAN_STALE. 통과하면 결과를 돌려준다.
     */
    requirePlan(jobId: string, planToken: string, excludeHash: string): itfCompareResult {
        const entry = this.cache.get(jobId);
        if (!entry) throw new clsAppError("PLAN_REQUIRED");
        const job = this.deps.jobs.get(jobId);
        const settings = this.deps.settings.get();
        if (job.rev !== entry.result.jobRev || f_SettingsKey(settings) !== entry.settingsKey) {
            this.cache.delete(jobId);
            throw new clsAppError("PLAN_STALE", "작업 설정이 바뀌었습니다. 다시 비교하세요.");
        }
        if (excludeHash !== entry.result.excludeHash) {
            this.cache.delete(jobId);
            throw new clsAppError("PLAN_STALE", "제외 패턴이 바뀌었습니다. 다시 비교하세요.");
        }
        if (entry.result.planToken !== planToken) throw new clsAppError("PLAN_REQUIRED");
        const ageMs = this.deps.now().getTime() - Date.parse(entry.result.createdAt);
        if (ageMs > settings.safety.compareMaxAgeMinutes * 60_000) {
            throw new clsAppError(
                "PLAN_STALE",
                `비교한 지 ${Math.floor(ageMs / 60_000)}분 지났습니다. 다시 비교하세요.`,
            );
        }
        return entry.result;
    }

    invalidate(jobId: string): void {
        this.cache.delete(jobId);
    }

    /** 지금 패턴의 해시. 해석할 수 없으면(지워진 공용 패턴 등) null */
    private currentExcludeHash(job: typJob): string | null {
        try {
            return resolveEffectiveExcludes(job, this.deps.excludes).snapshotHash;
        } catch {
            return null;
        }
    }

    private async execute(
        job: typJob,
        active: itfActiveCompare,
        t0: number,
    ): Promise<{ result: itfCompareResult; settingsKey: string }> {
        // 1~2) 경로 형식·안전 검사(프로세스 실행 전) → rclone·설정 파일
        const ctx = await resolveJobContext(job, this.deps);
        const settingsKey = f_SettingsKey(ctx.settings);
        this.throwIfCanceled(active);
        // 파일 방식이면 두 lsjson이 함께 쓸 제외 파일 1개를 만들고, 비교가 끝나면 지운다
        let file: itfExcludeFileHandle | null = null;
        try {
            if (ctx.excludes.fileContent !== null) {
                file = await writeExcludeFile(
                    this.deps.excludeFileDir,
                    ctx.excludes.fileContent,
                    "cmp",
                );
            }
            const excludeArgs: itfExcludeArgs = {
                patterns: ctx.excludes.argPatterns,
                fromFile: file?.path ?? null,
            };
            return await this.executeWith(job, active, t0, ctx, settingsKey, excludeArgs);
        } finally {
            await file?.dispose();
        }
    }

    private async executeWith(
        job: typJob,
        active: itfActiveCompare,
        t0: number,
        ctx: itfJobContext,
        settingsKey: string,
        excludeArgs: itfExcludeArgs,
    ): Promise<{ result: itfCompareResult; settingsKey: string }> {
        const { src, dst, configPath, caseInsensitive } = ctx;
        this.throwIfCanceled(active);

        // 3) 폴더 확인
        const [sp, dp] = await Promise.all([
            this.probeSide("원본", job.source, job.configPathOverride),
            this.probeSide("대상", job.destination, job.configPathOverride),
        ]);
        this.throwIfCanceled(active);
        this.checkSource(src, sp);
        const destMissing = this.checkDest(dst, dp);

        // 4) 목록
        this.setPhase(active, "list");
        const sides: itfListSide[] = [
            { label: "원본", path: src, parser: createLsjsonLineParser() },
        ];
        if (!destMissing)
            sides.push({ label: "대상", path: dst, parser: createLsjsonLineParser() });
        const lists = await this.listAll(
            job,
            sides,
            configPath,
            ctx.binaryPath,
            active,
            excludeArgs,
        );
        const sourceList = lists[0]!;
        const destList = lists[1] ?? [];
        this.throwIfCanceled(active);

        // 5) 차이
        this.setPhase(active, "diff");
        const diff = diffFileLists(sourceList, destList, {
            caseInsensitive,
            checkHashes: job.options.checkHashes,
            modtimeToleranceMs: job.options.modtimeToleranceMs,
        });
        if (!diff.ok) {
            const [a, b] = diff.paths;
            throw new clsAppError(
                "CASE_COLLISION",
                `${diff.side === "source" ? "원본" : "대상"}: ‘${a}’와 ‘${b}’가 대소문자만 달라 비교할 수 없습니다.`,
            );
        }
        const warnings = [...diff.warnings];
        if (destMissing) warnings.push("대상 폴더가 없습니다. 실행하면 새로 만듭니다.");
        if (diff.summary.sourceFiles === 0) {
            warnings.push(
                job.mode === "sync"
                    ? "원본에 파일이 없습니다. 동기화하면 대상 파일이 모두 삭제 대상이 됩니다."
                    : "원본에 파일이 없습니다.",
            );
        }
        if (diff.entries.length > LARGE_COMPARE_ROWS) {
            warnings.push(
                `비교 항목이 ${diff.entries.length.toLocaleString("ko-KR")}개로 많아 화면이 느려질 수 있습니다.`,
            );
        }

        // 6) 비교하는 동안 작업이 바뀌었으면 버린다
        let cur: typJob | null = null;
        try {
            cur = this.deps.jobs.get(job.id);
        } catch {
            cur = null;
        }
        if (!cur || cur.rev !== job.rev) {
            throw new clsAppError(
                "PLAN_STALE",
                "비교하는 동안 작업 설정이 바뀌어 결과를 버렸습니다. 다시 비교하세요.",
            );
        }

        const createdAt = this.deps.now().toISOString();
        const method = {
            checkHashes: job.options.checkHashes,
            modtimeToleranceMs: job.options.modtimeToleranceMs,
            caseInsensitive,
        };
        const planToken = computePlanToken({
            jobId: job.id,
            jobRev: job.rev,
            createdAt,
            source: src.normalized,
            destination: dst.normalized,
            mode: job.mode,
            excludeSnapshotHash: ctx.excludes.snapshotHash,
            options: {
                checkHashes: job.options.checkHashes,
                modtimeToleranceMs: job.options.modtimeToleranceMs,
                skipLinks: job.options.skipLinks,
                fastList: job.options.fastList,
            },
            caseInsensitive,
            binaryPath: ctx.binaryPath,
            configPath,
            summary: diff.summary,
        });
        const result: itfCompareResult = {
            jobId: job.id,
            jobRev: job.rev,
            createdAt,
            durationMs: Date.now() - t0,
            mode: job.mode,
            method,
            destMissing,
            summary: diff.summary,
            entries: diff.entries,
            warnings,
            planToken,
            excludeHash: ctx.excludes.snapshotHash,
        };
        return { result, settingsKey };
    }

    private async probeSide(
        label: "원본" | "대상",
        path: string,
        configOverride: string | null,
    ): Promise<itfPathProbe> {
        try {
            return await this.deps.pathService.probe({ path, configPath: configOverride });
        } catch (e) {
            if (e instanceof clsAppError) {
                throw new clsAppError(e.code, `${label}: ${e.message}`, e.detail);
            }
            throw e;
        }
    }

    private checkSource(p: itfParsedPath, probe: itfPathProbe): void {
        if (probe.readable === false) {
            throw new clsAppError("PATH_NOT_FOUND", "원본: 읽을 권한이 없습니다.");
        }
        if (!probe.exists) throw new clsAppError("PATH_NOT_FOUND", `원본: ${probe.message}`);
        if (!probe.isDirectory) {
            throw new clsAppError("PATH_NOT_DIRECTORY", `원본: ${probe.message}`);
        }
        // 로컬·UNC는 폴더를 열어 본 경우만 통과(시간 초과·확인 대기 중이면 막는다)
        if (p.kind !== "remote" && probe.readable !== true) {
            throw new clsAppError("PATH_NOT_FOUND", `원본: ${probe.message}`);
        }
    }

    /** 대상이 없으면 true(빈 목록으로 비교). 접근할 수 없거나 파일이면 막는다 */
    private checkDest(p: itfParsedPath, probe: itfPathProbe): boolean {
        if (probe.readable === false) {
            throw new clsAppError("PATH_NOT_FOUND", "대상: 읽을 권한이 없습니다.");
        }
        if (!probe.exists) {
            // "경로가 없습니다."만 새 폴더로 본다(네트워크·시간 초과는 막는다)
            if (probe.message.startsWith(PROBE_MISSING_MESSAGE)) return true;
            throw new clsAppError("PATH_NOT_FOUND", `대상: ${probe.message}`);
        }
        if (!probe.isDirectory) {
            throw new clsAppError("PATH_NOT_DIRECTORY", `대상: ${probe.message}`);
        }
        if (p.kind !== "remote" && probe.readable !== true) {
            throw new clsAppError("PATH_NOT_FOUND", `대상: ${probe.message}`);
        }
        return false;
    }

    /** 모든 쪽을 병렬로 나열한다. 한쪽이 실패하면 다른 쪽도 끝내고 먼저 난 오류를 던진다 */
    private async listAll(
        job: typJob,
        sides: readonly itfListSide[],
        configPath: string | null,
        binary: string,
        active: itfActiveCompare,
        excludeArgs: itfExcludeArgs,
    ): Promise<itfFileMeta[][]> {
        let firstError: unknown = null;
        const f_Fail = (e: unknown) => {
            if (firstError === null) firstError = e;
            active.controller.abort();
        };
        let lastEmit = 0;
        const f_Tick = () => {
            active.sourceFiles = sides[0]?.parser.count ?? 0;
            active.destFiles = sides[1]?.parser.count ?? 0;
            const now = Date.now();
            if (now - lastEmit < this.deps.progressIntervalMs) return;
            lastEmit = now;
            this.emitProgress(active, "list");
        };
        const lists = await Promise.all(
            sides.map((side) =>
                this.listSide(
                    job,
                    side,
                    configPath,
                    binary,
                    active,
                    excludeArgs,
                    f_Fail,
                    f_Tick,
                ).catch((e: unknown) => {
                    f_Fail(e);
                    return null;
                }),
            ),
        );
        if (active.canceled) throw new clsAppError("CANCELED", "비교를 취소했습니다.");
        if (firstError !== null) throw firstError;
        active.sourceFiles = sides[0]?.parser.count ?? 0;
        active.destFiles = sides[1]?.parser.count ?? 0;
        return lists.map((l) => l ?? []);
    }

    private async listSide(
        job: typJob,
        side: itfListSide,
        configPath: string | null,
        binary: string,
        active: itfActiveCompare,
        excludeArgs: itfExcludeArgs,
        f_Fail: (e: unknown) => void,
        f_Tick: () => void,
    ): Promise<itfFileMeta[]> {
        const { label, parser } = side;
        let lineError = false;
        const args = buildLsjsonArgs({
            path: side.path.normalized,
            configPath,
            excludes: excludeArgs,
            withHash: job.options.checkHashes,
            hashTypes: COMPARE_HASH_TYPES,
            skipLinks: job.options.skipLinks,
            fastList: job.options.fastList,
        });
        let r;
        try {
            r = await this.deps.run(binary, args, {
                timeoutMs: this.deps.timeoutMs,
                signal: active.controller.signal,
                collectStdout: false,
                onStdoutLine: (line) => {
                    if (lineError) return;
                    try {
                        parser.push(line);
                    } catch (e) {
                        // 이벤트 처리기 밖으로 던지지 않는다. 먼저 오류를 남기고 두 쪽을 끝낸다
                        lineError = true;
                        f_Fail(f_ParseFailure(label, e));
                        return;
                    }
                    f_Tick();
                },
            });
        } catch (e) {
            if (e instanceof clsProcessSpawnError) {
                throw new clsAppError(
                    e.errno === "ENOENT" ? "RCLONE_NOT_FOUND" : "RCLONE_NOT_EXECUTABLE",
                );
            }
            throw e;
        }
        if (lineError) throw new clsAppError("RCLONE_PARSE_ERROR");
        if (r.canceled) throw new clsAppError("CANCELED", "비교를 취소했습니다.");
        if (r.timedOut) {
            throw new clsAppError(
                "RCLONE_FAILED",
                `${label}: 목록 조회가 ${Math.round(this.deps.timeoutMs / 60_000)}분 안에 끝나지 않았습니다.`,
            );
        }
        // exit 3: 폴더 없음. stdout("[")은 쓰지 않는다
        if (r.exitCode === 3) {
            throw new clsAppError(
                "PATH_NOT_FOUND",
                `${label}: 폴더를 찾지 못했습니다. 비교하는 동안 지워졌거나 이름이 바뀌었는지 확인하세요.`,
                summarizeStderr(r.stderrTail),
            );
        }
        if (r.exitCode !== 0) {
            const hint = hintForRcloneError(r.stderrTail, remoteNameOf(side.path));
            throw new clsAppError(
                "RCLONE_FAILED",
                `${label} 목록을 읽지 못했습니다(exit ${r.exitCode}).${hint ? ` ${hint}` : ""}`,
                summarizeStderr(r.stderrTail),
            );
        }
        try {
            return parser.finish();
        } catch (e) {
            throw f_ParseFailure(label, e);
        }
    }

    private throwIfCanceled(active: itfActiveCompare): void {
        if (active.canceled) throw new clsAppError("CANCELED", "비교를 취소했습니다.");
    }

    private setPhase(active: itfActiveCompare, phase: typComparePhase): void {
        active.phase = phase;
        this.emitProgress(active, phase);
    }

    private emitProgress(active: itfActiveCompare, phase: typCompareEventPhase): void {
        if (active.silent) return;
        try {
            this.deps.emit({
                jobId: active.jobId,
                phase,
                sourceFiles: active.sourceFiles,
                destFiles: active.destFiles,
                at: this.deps.now().toISOString(),
            });
        } catch {
            // 창이 닫히는 중 등: 이벤트 실패로 비교를 멈추지 않는다
        }
    }

    private cachePut(jobId: string, result: itfCompareResult, settingsKey: string): void {
        this.cache.delete(jobId);
        this.cache.set(jobId, { result, settingsKey });
        while (this.cache.size > this.deps.maxCached) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
        }
    }
}

function f_NewActive(jobId: string, startedAt: string, silent: boolean): itfActiveCompare {
    return {
        jobId,
        phase: "check",
        startedAt,
        sourceFiles: 0,
        destFiles: 0,
        controller: new AbortController(),
        canceled: false,
        silent,
    };
}

function f_ParseFailure(label: string, e: unknown): unknown {
    if (e instanceof clsLsjsonParseError) {
        return new clsAppError("RCLONE_PARSE_ERROR", `${label} 목록: ${e.message}`);
    }
    return e;
}
