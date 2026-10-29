/**
 * 실행 계획·통계·이력 레코드 스키마와 타입. history.json 저장 형식에 쓴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import {
    zAppErrorPayload,
    zIsoDate,
    zRunMode,
    zRunPhase,
    zRunStatus,
    zRunTrigger,
} from "@/shared/schemas/common";

const zCount = z.number().int().min(0);

export const zRunPlan = z.object({
    sourceFiles: zCount,
    destFiles: zCount,
    createFiles: zCount,
    updateFiles: zCount,
    deleteFiles: zCount,
    transferBytes: zCount,
    deleteBytes: zCount,
    conflictFiles: zCount,
    caseOnlyFiles: zCount,
});
export type typRunPlan = z.infer<typeof zRunPlan>;

export const zRunStats = z.object({
    bytes: zCount,
    totalBytes: zCount,
    transfers: zCount,
    totalTransfers: zCount,
    deletes: zCount,
    deletedDirs: zCount,
    checks: zCount,
    totalChecks: zCount,
    listed: zCount,
    errors: zCount,
    speedBps: z.number().min(0).nullable(),
    etaSeconds: z.number().min(0).nullable(),
    elapsedMs: z.number().min(0),
    fatalError: z.boolean(),
    lastError: z.string().nullable(),
});
export type typRunStats = z.infer<typeof zRunStats>;

export const zRunRecord = z.object({
    id: z.uuid(),
    jobId: z.uuid(),
    jobName: z.string(),
    mode: zRunMode,
    dryRun: z.boolean(),
    trigger: zRunTrigger,
    status: zRunStatus,
    phase: zRunPhase,
    startedAt: zIsoDate,
    finishedAt: zIsoDate.nullable(),
    durationMs: z.number().min(0).nullable(),
    plan: zRunPlan.nullable(),
    preflight: zRunStats.nullable(),
    stats: zRunStats.nullable(),
    exitCode: z.number().int().nullable(),
    pid: z.number().int().nullable(),
    error: zAppErrorPayload.nullable(),
    logFile: z.string().nullable(),
});
export type typRunRecord = z.infer<typeof zRunRecord>;

export const zHistoryFile = z.object({
    version: z.literal(1),
    records: z.array(zRunRecord),
});
export type typHistoryFile = z.infer<typeof zHistoryFile>;

/**
 * run:start 입력. 실제 실행(dryRun:false)은 비교의 planToken과 확인한 삭제 수가 필요하다
 * (main이 계획에서 삭제 수를 다시 계산해 맞춰 본다). 대량 삭제(isLargeDelete)는 confirmLargeDeletes도
 * 필요하다. 알 수 없는 키는 거부한다.
 */
export const zStartRunInput = z
    .object({
        jobId: z.uuid(),
        dryRun: z.boolean(),
        planToken: z.string().min(1).max(200).optional(),
        confirmedDeletes: zCount.optional(),
        confirmLargeDeletes: z.boolean().optional(),
    })
    .strict();
export type typStartRunInput = z.infer<typeof zStartRunInput>;

export const zRunIdInput = z.object({ runId: z.uuid() }).strict();
export type typRunIdInput = z.infer<typeof zRunIdInput>;

/** userData/active-run.json: 실행 중 앱이 비정상 종료됐을 때 남은 rclone을 찾는 기록 */
export const zActiveRunFile = z.object({
    version: z.literal(1),
    runId: z.uuid(),
    jobId: z.uuid(),
    pid: z.number().int().positive(),
    startedAt: zIsoDate,
    /** 실행 파일 이름(예: rclone.exe). PID 재사용 확인용 */
    imageName: z.string().min(1).max(260),
});
export type typActiveRunFile = z.infer<typeof zActiveRunFile>;
