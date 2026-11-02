/**
 * Job(동기화 작업) 스키마와 타입. 저장 형식과 IPC 입력 검증에 같이 쓴다.
 * 경로의 형식·안전 검사(S1~S4a)는 path-utils의 checkJobPaths가 담당한다.
 * 저장된 값 읽기(zJob)와 새로 저장하는 입력(zJobDraft·zJobPatch) 모두 경로 4096자 한도를
 * 쓰고, 제외 패턴 합계 한도는 저장 입력에만 적용한다 (INT-002 T-09).
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

/**
 * 동기화 범위(INT-002 T-05). files: 파일만(빈 폴더는 만들지 않음), all: 원본의 빈 폴더도 만든다.
 * 저장 입력에는 기본값을 두지 않는다 — partial patch에서 default가 범위를 되돌리지 않도록.
 */
export const zSyncScope = z.enum(["all", "files"]);
export type typSyncScope = z.infer<typeof zSyncScope>;

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

/** 자동 실행 예약 종류(INT-002 T-06). interval: 일정 간격, daily: 매일 HH:MM, weekly: 고른 요일의 HH:MM */
export const zScheduleKind = z.enum(["interval", "daily", "weekly"]);
export type typScheduleKind = z.infer<typeof zScheduleKind>;

export const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_TIME_OF_DAY = "09:00";
/** 요일 bit 마스크. bit0 = 일요일 (Date.getDay()와 같다) */
export const WEEKDAYS_ALL = 0b1111111;
/** 월~금 */
export const WEEKDAYS_WEEKDAYS = 0b0111110;

export const zTimeOfDay = z.string().regex(TIME_OF_DAY_RE, "시각은 00:00~23:59로 입력하세요.");
export const zWeekdays = z.number().int().min(0).max(WEEKDAYS_ALL);

/**
 * 저장 입력. 새 필드도 필수이고 기본값이 없다 — job-store가 patch를 기존 값과 합치므로
 * 기본값이 있으면 daily·weekly 작업이 interval로 되돌아간다.
 */
export const zAutoSyncInput = z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number().int().min(1).max(10_080),
    allowDeletes: z.boolean(),
    kind: zScheduleKind,
    timeOfDay: zTimeOfDay,
    weekdays: zWeekdays,
});

/** 저장된 값 읽기. 예전 데이터(종류·시각·요일 없음)는 interval·09:00·평일로 읽는다 */
export const zAutoSync = zAutoSyncInput.extend({
    kind: zScheduleKind.default("interval"),
    timeOfDay: zTimeOfDay.default(DEFAULT_TIME_OF_DAY),
    weekdays: zWeekdays.default(WEEKDAYS_WEEKDAYS),
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
    scope: zSyncScope,
    excludes: zExcludes,
    excludePatternIds: zExcludePatternIds,
    options: zJobRunOptions,
    configPathOverride: zPathInput.nullable(),
    autoSync: zAutoSyncInput,
};

/** 저장된 작업 읽기용 초안(예전 한도). excludePatternIds가 없으면 [], scope가 없으면 "files" */
export const zJobStoredDraft = z.object({
    ...zJobDraftShape,
    source: zPathStored,
    destination: zPathStored,
    configPathOverride: zPathStored.nullable(),
    excludePatternIds: zExcludePatternIds.default([]),
    scope: zSyncScope.default("files"),
});

/** 공용 + 작업 전용 제외 패턴 합계·인자 길이 */
function f_ExcludesTotal(
    v: { excludes: readonly string[]; excludePatternIds: readonly string[] },
    ctx: z.RefinementCtx,
): void {
    const issue = excludesSaveIssue(v.excludes, v.excludePatternIds.length);
    if (issue) ctx.addIssue({ code: "custom", path: ["excludes"], message: issue });
}

/** 요일 지정 예약은 요일을 하나 이상 골라야 한다 */
function f_ScheduleCheck(
    v: { autoSync: { kind: typScheduleKind; weekdays: number } },
    ctx: z.RefinementCtx,
): void {
    if (v.autoSync.kind === "weekly" && v.autoSync.weekdays === 0) {
        ctx.addIssue({
            code: "custom",
            path: ["autoSync", "weekdays"],
            message: "요일을 하나 이상 고르세요.",
        });
    }
}

const zJobDraftBase = z.object(zJobDraftShape);

/** 저장 입력(새 한도). 알 수 없는 키는 거부한다 */
export const zJobDraft = zJobDraftBase
    .strict()
    .superRefine(f_ExcludesTotal)
    .superRefine(f_ScheduleCheck);
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
