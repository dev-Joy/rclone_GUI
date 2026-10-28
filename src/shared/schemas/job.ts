/**
 * Job(동기화 작업) 스키마와 타입. jobs.json 저장 형식과 IPC 입력 검증에 같이 쓴다.
 * 경로의 형식·안전 검사(S1~S4a)는 path-utils의 checkJobPaths가 담당한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { zIsoDate, zRunMode, zRunStatus } from "@/shared/schemas/common";

const zNoControlChars = (max: number) =>
    z
        .string()
        .max(max)
        // oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
        .refine((v) => !/[\u0000-\u001f]/.test(v), "제어문자(줄바꿈 포함)는 쓸 수 없습니다.");

export const zExcludes = z.array(zNoControlChars(512).min(1)).max(100);

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
const zPathInput = z.string().trim().min(1, "경로를 입력하세요.").max(4096);

export const zJobDraft = z.object({
    name: zJobName,
    notes: z.string().max(4000),
    source: zPathInput,
    destination: zPathInput,
    mode: zRunMode,
    excludes: zExcludes,
    options: zJobRunOptions,
    configPathOverride: z.string().trim().min(1).max(4096).nullable(),
    autoSync: zAutoSyncInput,
});
export type typJobDraft = z.infer<typeof zJobDraft>;

/** 사용자가 바꿀 수 있는 필드만 받는다. 알 수 없는 키는 거부한다. */
export const zJobPatch = zJobDraft.partial().strict();
export type typJobPatch = z.infer<typeof zJobPatch>;

export const zJobLastRun = z.object({
    runId: z.string().nullable(),
    at: zIsoDate,
    status: zRunStatus,
});

export const zJob = zJobDraft.extend({
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
export const zJobCreateInput = zJobDraft.strict();
export const zJobId = z.object({ id: z.uuid() });
export const zJobUpdateInput = z.object({ id: z.uuid(), patch: zJobPatch });
