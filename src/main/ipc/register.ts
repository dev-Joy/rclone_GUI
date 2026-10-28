/**
 * 모든 IPC 채널 등록. 채널 이름과 타입은 @/shared/ipc-contract 에만 정의한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { app, shell } from "electron";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { registerCompareIpc, type itfCompareIpcDeps } from "@/main/ipc/compare";
import { registerDialogIpc, type itfDialogIpcDeps } from "@/main/ipc/dialog";
import { handle } from "@/main/ipc/handle";
import { registerRcloneIpc, type itfRcloneIpcDeps } from "@/main/ipc/rclone";
import { registerRunIpc, type itfRunIpcDeps } from "@/main/ipc/run";
import { registerSystemIpc } from "@/main/ipc/system";
import { registerWslIpc, type itfWslIpcDeps } from "@/main/ipc/wsl";
import type { clsJobStore } from "@/main/store/job-store";
import type { clsSettingsStore } from "@/main/store/settings-store";
import { IPC_CHANNELS, type itfAppInfo, type itfAppNotice } from "@/shared/ipc-contract";
import { zJobCreateInput, zJobId, zJobUpdateInput } from "@/shared/schemas/job";
import { zSettingsPatch } from "@/shared/schemas/settings";

export interface itfIpcServices
    extends itfRcloneIpcDeps, itfWslIpcDeps, itfDialogIpcDeps, itfCompareIpcDeps, itfRunIpcDeps {
    settings: clsSettingsStore;
    jobs: clsJobStore;
    paths: { userData: string; logs: string };
    notices: () => itfAppNotice[];
}

/** 실행 중인 작업은 고치거나 지울 수 없다(실행 기록·비교 계획 보호) */
function f_AssertNotRunning(s: itfIpcServices, jobId: string, action: string): void {
    if (!s.runs.isRunningJob(jobId)) return;
    throw new clsAppError(
        "BUSY",
        `실행 중인 작업은 ${action} 수 없습니다. 끝나거나 취소한 뒤 다시 시도하세요.`,
    );
}

export function registerIpc(s: itfIpcServices): void {
    handle(s, IPC_CHANNELS.appGetInfo, (): itfAppInfo => ({
        appVersion: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        platform: process.platform,
        userDataPath: s.paths.userData,
        logsPath: s.paths.logs,
    }));
    handle(s, IPC_CHANNELS.appGetNotices, () => s.notices());
    handle(s, IPC_CHANNELS.appOpenLogsFolder, async () => {
        const err = await shell.openPath(s.paths.logs);
        if (err) throw new clsAppError("INTERNAL", "로그 폴더를 열지 못했습니다.", err);
    });

    handle(s, IPC_CHANNELS.settingsGet, () => s.settings.get());
    handle(s, IPC_CHANNELS.settingsUpdate, (patch) => s.settings.update(patch), zSettingsPatch);

    handle(s, IPC_CHANNELS.jobsList, () => s.jobs.list());
    handle(s, IPC_CHANNELS.jobsCreate, (draft) => s.jobs.create(draft), zJobCreateInput);
    handle(
        s,
        IPC_CHANNELS.jobsUpdate,
        ({ id, patch }) => {
            f_AssertNotRunning(s, id, "고칠");
            return s.jobs.update(id, patch);
        },
        zJobUpdateInput,
    );
    handle(
        s,
        IPC_CHANNELS.jobsDelete,
        ({ id }) => {
            f_AssertNotRunning(s, id, "지울");
            return s.jobs.remove(id);
        },
        zJobId,
    );
    handle(s, IPC_CHANNELS.jobsDuplicate, ({ id }) => s.jobs.duplicate(id), zJobId);

    registerCompareIpc(s);
    registerRunIpc(s);
    registerRcloneIpc(s);
    registerWslIpc(s);
    registerDialogIpc(s);
    registerSystemIpc(s);
}
