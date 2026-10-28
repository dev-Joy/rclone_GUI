/**
 * 외부 링크 열기 IPC (system:openExternal). 허용 목록의 https 주소만 연다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { shell } from "electron";

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import { clsAppError } from "@/main/lib/app-error";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { zOpenExternalInput } from "@/shared/schemas/system";

/** 열 수 있는 주소 접두어 */
export const EXTERNAL_URL_ALLOW: readonly string[] = ["https://rclone.org/"];

/** 허용 목록에 있는 https 주소인지 */
export function isAllowedExternalUrl(raw: string): boolean {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    return url.protocol === "https:" && EXTERNAL_URL_ALLOW.some((p) => url.href.startsWith(p));
}

export function registerSystemIpc(d: itfIpcContext): void {
    handle(
        d,
        IPC_CHANNELS.systemOpenExternal,
        async ({ url }) => {
            if (!isAllowedExternalUrl(url)) {
                throw new clsAppError("VALIDATION", "열 수 없는 주소입니다.");
            }
            await shell.openExternal(new URL(url).href);
        },
        zOpenExternalInput,
    );
}
