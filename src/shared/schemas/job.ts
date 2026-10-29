/**
 * Job(동기화 작업) 스키마와 타입. 저장 형식과 IPC 입력 검증에 같이 쓴다.
 * 경로의 형식·안전 검사(S1~S4a)는 path-utils의 checkJobPaths가 담당한다.
 * 저장된 값 읽기(zJob)는 예전 한도(경로 4096)를, 새로 저장하는 입력(zJobDraft·zJobPatch)은
 * 좁은 한도(경로 1024, 제외 패턴 합계)를 쓴다 (INT-002 T-09).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { excludesSaveIssue } from "@/shared/exclude-patterns";
import {
    EXCLUDE_PATTERN_MAX_LEN,
    EXCLUDES_TOTAL_MAX,
    JOB_EXCLUDES_MAX,
    PATH_MAX_INPUT,
    PATH_MAX_STORED,
} from "@/shared/option-limits";
import { zIsoDate, zRunMode, zRunStatus } from "@/shared/schemas/common";

const zNoControlChars = (max: number) =>
    z
        .string()
        .max(max)
        // oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
        .refine((v) => !/[\u0000-\u001f]/.test(v), "제어문자(줄바꿈 포함)는 쓸 수 없습니다.");

export const zExcludes = z
    .array(zNoControlChars(EXCLUDE_PATTERN_MAX_LEN).min(1))
    .max(JOB_EXCLUDES_MAX);

/** 작업에 연결한 공용 제외 패턴 id (저장소에서는 연결 테이블이 원본) */
export const zExcludePatternIds = z.array(z.uuid()).max(EXCLUDES_TOTAL_MAX);

export const zJobRunOptions = z.object({
    checkers: z.number().int().min(1).max(64),
    transfers: z.number().int().min(1).max(32),
    fastList: z.boolean(),
    skipLinks: z.boolean(),
    ignoreErrors: z.boolean(),
    checkHashes: z.boolean(),
    modtimeToleranceMs: z.number().int().min(0).max(600_000),
    preflightBeforeDestructive: z.boolean(),
});
export type typJobRunOptions = z.infer<typeof zJobRunOptions>;

export const zAutoSyncInput = z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number().int().min(1).max(10_080),
    allowDeletes: z.boolean(),
});

export const zAutoSync = zAutoSyncInput.extend({
    nextRunAt: zIsoDate.nullable(),
    lastAutoRunAt: zIsoDate.nullable(),
});
export type typAutoSyncOptions = z.infer<typeof zAutoSync>;

const zJobName = z.string().trim().min(1, "이름을 입력하세요.").max(80);
const zPathStored = z.string().trim().min(1, "경로를 입력하세요.").max(PATH_MAX_STORED);
const zPathInput = z
    .string()
    .trim()
    .min(1, "경로를 입력하세요.")
    .max(PATH_MAX_INPUT, `경로는 ${PATH_MAX_INPUT}자 이내로 입력하세요.`);

const zJobDraftShape = {
    name: zJobName,
    notes: z.string().max(4000),
    source: zPathInput,
    destination: zPathInput,
    mode: zRunMode,
    excludes: zExcludes,
    excludePatternIds: zExcludePatternIds,
    options: zJobRunOptions,
    configPathOverride: zPathInput.nullable(),
    autoSync: zAutoSyncInput,
};

/** 저장된 작업 읽기용 초안(예전 한도). excludePatternIds가 없으면 [] */
export const zJobStoredDraft = z.object({
    ...zJobDraftShape,
    source: zPathStored,
    destination: zPathStored,
    configPathOverride: zPathStored.nullable(),
    excludePatternIds: zExcludePatternIds.default([]),
});

/** 공용 + 작업 전용 제외 패턴 합계·인자 길이 */
function f_ExcludesTotal(
    v: { excludes: readonly string[]; excludePatternIds: readonly string[] },
    ctx: z.RefinementCtx,
): void {
    const issue = excludesSaveIssue(v.excludes, v.excludePatternIds.length);
    if (issue) ctx.addIssue({ code: "custom", path: ["excludes"], message: issue });
}

const zJobDraftBase = z.object(zJobDraftShape);

/** 저장 입력(새 한도). 알 수 없는 키는 거부한다 */
export const zJobDraft = zJobDraftBase.strict().superRefine(f_ExcludesTotal);
export type typJobDraft = z.infer<typeof zJobDraft>;

/** 사용자가 바꿀 수 있는 필드만 받는다. 알 수 없는 키는 거부한다. 합계는 병합 뒤 zJobDraft로 다시 검사한다 */
export const zJobPatch = zJobDraftBase.partial().strict();
export type typJobPatch = z.infer<typeof zJobPatch>;

export const zJobLastRun = z.object({
    runId: z.string().nullable(),
    at: zIsoDate,
    status: zRunStatus,
});

export const zJob = zJobStoredDraft.extend({
    id: z.uuid(),
    autoSync: zAutoSync,
    rev: z.number().int().min(0),
    createdAt: zIsoDate,
    updatedAt: zIsoDate,
    lastRun: zJobLastRun.nullable(),
});
export type typJob = z.infer<typeof zJob>;

export const zJobsFile = z.object({
    version: z.literal(1),
    jobs: z.array(zJob),
});
export type typJobsFile = z.infer<typeof zJobsFile>;

/** IPC 입력: 알 수 없는 최상위 키(id·rev 등)는 버리지 않고 거부한다 */
export const zJobCreateInput = zJobDraft;
export const zJobId = z.object({ id: z.uuid() });
export const zJobUpdateInput = z.object({ id: z.uuid(), patch: zJobPatch });
