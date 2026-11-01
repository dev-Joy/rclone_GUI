/**
 * rclone 환경·경로 확인 IPC (rclone:detect / rclone:listRemotes / rclone:listDir / rclone:testPath).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import type { clsRcloneEnv } from "@/main/rclone/detect";
import type { clsRemoteService } from "@/main/services/remote-service";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { zListDirInput } from "@/shared/schemas/remotes";
import { zListRemotesInput, zRcloneDetectInput, zTestPathInput } from "@/shared/schemas/rclone";

export interface itfRcloneIpcDeps extends itfIpcContext {
    rcloneEnv: clsRcloneEnv;
    remoteService: clsRemoteService;
}

export function registerRcloneIpc(d: itfRcloneIpcDeps): void {
    handle(
        d,
        IPC_CHANNELS.rcloneDetect,
        ({ force }) => d.rcloneEnv.detect(force),
        zRcloneDetectInput,
    );
    handle(
        d,
        IPC_CHANNELS.rcloneListRemotes,
        ({ configPath }) => d.rcloneEnv.listRemotes(configPath),
        zListRemotesInput,
    );
    handle(d, IPC_CHANNELS.rcloneListDir, (input) => d.remoteService.listDir(input), zListDirInput);
    handle(
        d,
        IPC_CHANNELS.rcloneTestPath,
        (input) => d.remoteService.probePath(input),
        zTestPathInput,
    );
}
