/**
 * 여러 도메인이 함께 쓰는 열거형·결과 envelope 스키마.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { ERROR_CODES } from "@/shared/errors";

/** UTC ISO-8601 문자열 */
export const zIsoDate = z.iso.datetime({ offset: true });
export type typIsoDateString = string;

export const zRunMode = z.enum(["copy", "sync"]);
export type typRunMode = z.infer<typeof zRunMode>;

export const zRunStatus = z.enum([
    "running",
    "success",
    "partial",
    "failed",
    "canceled",
    "blocked",
    "noop",
    "interrupted",
]);
export type typRunStatus = z.infer<typeof zRunStatus>;

export const zRunTrigger = z.enum(["manual", "scheduler"]);
export type typRunTrigger = z.infer<typeof zRunTrigger>;

export const zRunPhase = z.enum([
    "validating",
    "comparing",
    "preflight",
    "transferring",
    "finalizing",
]);
export type typRunPhase = z.infer<typeof zRunPhase>;

export const zAppErrorPayload = z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    detail: z.string().optional(),
});
export type typAppErrorPayload = z.infer<typeof zAppErrorPayload>;

export type typApiResult<T> = { ok: true; data: T } | { ok: false; error: typAppErrorPayload };

/** 하위 객체까지 선택 입력으로 만든다. 배열은 통째로 교체한다. */
export type typDeepPartial<T> = {
    [K in keyof T]?: T[K] extends readonly unknown[]
        ? T[K]
        : T[K] extends object
          ? typDeepPartial<T[K]>
          : T[K];
};
