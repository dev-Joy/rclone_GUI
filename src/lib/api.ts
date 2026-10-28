/**
 * 화면에서 main을 부르는 유일한 통로(window.rclonegui) 도우미.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typApiResult, typAppErrorPayload } from "@/shared/schemas/common";
import type { itfRcloneGuiApi } from "@/shared/ipc-contract";

export function getApi(): itfRcloneGuiApi {
    return window.rclonegui;
}

export class clsApiError extends Error {
    readonly payload: typAppErrorPayload;

    constructor(payload: typAppErrorPayload) {
        super(payload.message);
        this.name = "clsApiError";
        this.payload = payload;
    }
}

/** 실패 envelope를 clsApiError로 바꾼다 */
export async function unwrap<T>(pending: Promise<typApiResult<T>>): Promise<T> {
    const r = await pending;
    if (!r.ok) throw new clsApiError(r.error);
    return r.data;
}

/** 사용자에게 보일 오류 문구 */
export function errorText(e: unknown): string {
    if (e instanceof clsApiError) return e.payload.message;
    return "알 수 없는 오류가 발생했습니다.";
}
