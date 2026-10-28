/**
 * IPC 핸들러 등록 도우미.
 * 모든 invoke는 (1) 보낸 창 확인 (2) zod 입력 검증 (3) envelope 응답 순서로 처리한다.
 * 예외는 그대로 넘기지 않고 { ok: false, error } 로 바꾼다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { z } from "zod";

// ========== Internal imports ==========
import { clsAppError, fail, ok } from "@/main/lib/app-error";
import type { clsLogger } from "@/main/lib/logger";
import type { typApiResult } from "@/shared/schemas/common";
import type { typIpcChannel } from "@/shared/ipc-contract";

export interface itfIpcContext {
    logger: clsLogger;
    /** 요청을 받아도 되는 창인지 확인 */
    isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

/** 입력이 없는 채널 */
export function handle<R>(
    ctx: itfIpcContext,
    channel: typIpcChannel,
    fn: () => Promise<R> | R,
): void;
/** 입력을 zod로 검증하는 채널 */
export function handle<S extends z.ZodType, R>(
    ctx: itfIpcContext,
    channel: typIpcChannel,
    fn: (input: z.infer<S>) => Promise<R> | R,
    schema: S,
): void;
export function handle(
    ctx: itfIpcContext,
    channel: typIpcChannel,
    fn: (input?: unknown) => unknown,
    schema?: z.ZodType,
): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<typApiResult<unknown>> => {
        if (!ctx.isTrustedSender(event)) {
            ctx.logger.warn(`IPC 거부(알 수 없는 sender): ${channel}`);
            return fail(new clsAppError("FORBIDDEN_SENDER"));
        }
        try {
            const input = schema ? schema.parse(raw) : undefined;
            const data = await fn(input);
            return ok(data === undefined ? null : data);
        } catch (e) {
            if (!(e instanceof clsAppError)) ctx.logger.error(`IPC 처리 실패: ${channel}`, e);
            return fail(e);
        }
    });
}
