/**
 * WSL IPC (wsl:listDistros).
 * `/home/...` → UNC 변환은 화면에서 @/shared/path-utils 로 하므로 IPC가 없다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import type { clsWslService } from "@/main/services/wsl";
import { IPC_CHANNELS } from "@/shared/ipc-contract";

export interface itfWslIpcDeps extends itfIpcContext {
    wsl: clsWslService;
}

export function registerWslIpc(d: itfWslIpcDeps): void {
    handle(d, IPC_CHANNELS.wslListDistros, () => d.wsl.listDistros());
}
