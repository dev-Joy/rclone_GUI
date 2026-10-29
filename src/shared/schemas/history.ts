/**
 * 이력 IPC 입력 스키마 (history:list / get / readLog / clear). 알 수 없는 키는 거부한다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { LOG_TAIL_MAX_BYTES } from "@/shared/types/history";

export const zHistoryListInput = z
    .object({
        jobId: z.uuid().optional(),
        limit: z.number().int().min(1).max(5000).optional(),
    })
    .strict();
export type typHistoryListInput = z.infer<typeof zHistoryListInput>;

export const zHistoryGetInput = z.object({ runId: z.uuid() }).strict();
export type typHistoryGetInput = z.infer<typeof zHistoryGetInput>;

export const zHistoryReadLogInput = z
    .object({
        runId: z.uuid(),
        tailBytes: z.number().int().min(1).max(LOG_TAIL_MAX_BYTES).optional(),
    })
    .strict();
export type typHistoryReadLogInput = z.infer<typeof zHistoryReadLogInput>;

export const zHistoryClearInput = z.object({ deleteLogs: z.boolean() }).strict();
export type typHistoryClearInput = z.infer<typeof zHistoryClearInput>;
