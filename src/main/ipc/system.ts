/**
 * 외부 링크 열기·클립보드 복사 IPC (system:openExternal / app:copyText).
 * 외부 링크는 허용 목록의 https 주소만 연다. 복사 내용은 로그·파일에 남기지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { clipboard, shell } from "electron";

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import { clsAppError } from "@/main/lib/app-error";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { zCopyTextInput, zOpenExternalInput } from "@/shared/schemas/system";

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
    handle(
        d,
        IPC_CHANNELS.appCopyText,
        ({ text }) => {
            clipboard.writeText(text);
            return true;
        },
        zCopyTextInput,
    );
}
