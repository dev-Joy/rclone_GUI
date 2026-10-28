/**
 * main 프로세스의 표준 오류와 IPC 응답 envelope 변환.
 * IPC로는 예외를 그대로 넘기지 않고 { ok: false, error: { code, message } } 로 바꾼다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { ZodError } from "zod";

// ========== Internal imports ==========
import { ERROR_MESSAGES, type typErrorCode } from "@/shared/errors";
import type { typApiResult, typAppErrorPayload } from "@/shared/schemas/common";

export class clsAppError extends Error {
    readonly code: typErrorCode;
    readonly detail: string | undefined;

    constructor(code: typErrorCode, message?: string, detail?: string) {
        super(message ?? ERROR_MESSAGES[code]);
        this.name = "clsAppError";
        this.code = code;
        this.detail = detail;
    }
}

function f_ZodDetail(e: ZodError): string {
    return e.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(값)"}: ${i.message}`)
        .join("\n");
}

export function toErrorPayload(e: unknown): typAppErrorPayload {
    if (e instanceof clsAppError) {
        return e.detail === undefined
            ? { code: e.code, message: e.message }
            : { code: e.code, message: e.message, detail: e.detail };
    }
    if (e instanceof ZodError) {
        return { code: "VALIDATION", message: ERROR_MESSAGES.VALIDATION, detail: f_ZodDetail(e) };
    }
    return { code: "INTERNAL", message: ERROR_MESSAGES.INTERNAL };
}

export function ok<T>(data: T): typApiResult<T> {
    return { ok: true, data };
}

export function fail(e: unknown): typApiResult<never> {
    return { ok: false, error: toErrorPayload(e) };
}
