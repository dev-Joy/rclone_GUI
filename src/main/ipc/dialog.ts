/**
 * 폴더·파일 선택 대화상자 IPC (dialog:pickDirectory / dialog:pickFile).
 * 선택한 경로만 돌려주고 파일을 열지 않는다. 취소하면 null.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { dialog, type BrowserWindow, type OpenDialogOptions } from "electron";

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import { clsAppError } from "@/main/lib/app-error";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { parsePath } from "@/shared/path-utils";
import { zPickDirectoryInput, zPickFileInput } from "@/shared/schemas/system";

export interface itfDialogIpcDeps extends itfIpcContext {
    getWindow: () => BrowserWindow | null;
}

async function f_Open(d: itfDialogIpcDeps, options: OpenDialogOptions): Promise<string | null> {
    const win = d.getWindow();
    if (!win || win.isDestroyed()) {
        throw new clsAppError("INTERNAL", "앱 창이 없어 선택 창을 열 수 없습니다.");
    }
    const r = await dialog.showOpenDialog(win, options);
    return r.canceled ? null : (r.filePaths[0] ?? null);
}

function f_IsLocalPath(p: string): boolean {
    const r = parsePath(p);
    return r.ok && r.path.kind !== "remote";
}

export function registerDialogIpc(d: itfDialogIpcDeps): void {
    handle(
        d,
        IPC_CHANNELS.dialogPickDirectory,
        (input) => {
            const options: OpenDialogOptions = { properties: ["openDirectory"] };
            if (input.title) options.title = input.title;
            if (input.defaultPath && f_IsLocalPath(input.defaultPath)) {
                options.defaultPath = input.defaultPath;
            }
            return f_Open(d, options);
        },
        zPickDirectoryInput,
    );
    handle(
        d,
        IPC_CHANNELS.dialogPickFile,
        (input) => {
            const options: OpenDialogOptions = { properties: ["openFile"] };
            if (input.title) options.title = input.title;
            if (input.filters) options.filters = input.filters;
            return f_Open(d, options);
        },
        zPickFileInput,
    );
}
