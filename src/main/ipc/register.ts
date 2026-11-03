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
import { registerExcludesIpc, type itfExcludesIpcDeps } from "@/main/ipc/excludes";
import { handle } from "@/main/ipc/handle";
import { registerHistoryIpc, type itfHistoryIpcDeps } from "@/main/ipc/history";
import { registerRcloneIpc, type itfRcloneIpcDeps } from "@/main/ipc/rclone";
import { registerRemoteConfigIpc, type itfRemoteConfigIpcDeps } from "@/main/ipc/remote-config";
import { registerRemotesIpc, type itfRemotesIpcDeps } from "@/main/ipc/remotes";
import { registerRunIpc, type itfRunIpcDeps } from "@/main/ipc/run";
import { registerSchedulerIpc, type itfSchedulerIpcDeps } from "@/main/ipc/scheduler";
import { registerSystemIpc } from "@/main/ipc/system";
import { registerWslIpc, type itfWslIpcDeps } from "@/main/ipc/wsl";
import type { clsJobStore } from "@/main/store/job-store";
import type { clsSettingsStore } from "@/main/store/settings-store";
import { IPC_CHANNELS, type itfAppInfo, type itfAppNotice } from "@/shared/ipc-contract";
import {
    zJobCreateInput,
    zJobId,
    zJobUpdateInput,
    type typScheduleBackend,
} from "@/shared/schemas/job";
import { zSettingsPatch } from "@/shared/schemas/settings";

export interface itfIpcServices
    extends
        itfRcloneIpcDeps,
        itfWslIpcDeps,
        itfDialogIpcDeps,
        itfCompareIpcDeps,
        itfRunIpcDeps,
        itfHistoryIpcDeps,
        itfSchedulerIpcDeps,
        itfExcludesIpcDeps,
        itfRemotesIpcDeps,
        itfRemoteConfigIpcDeps {
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

/** OS 예약 사용 불가 환경에서 예약 방식을 os로 바꾸는 저장을 막는다(화면 비활성화의 방어선, FR-11) */
export const OS_BACKEND_UNAVAILABLE_TEXT =
    "Windows 작업 스케줄러 예약은 설치한 앱에서만 쓸 수 있습니다.";

function f_AssertOsBackendAllowed(
    s: Pick<itfIpcServices, "osScheduler">,
    prev: typScheduleBackend | null,
    next: typScheduleBackend | undefined,
): void {
    if (next !== "os" || prev === "os") return;
    if (s.osScheduler.status().available) return;
    throw new clsAppError("VALIDATION", OS_BACKEND_UNAVAILABLE_TEXT);
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
        isPackaged: app.isPackaged,
    }));
    handle(s, IPC_CHANNELS.appGetNotices, () => s.notices());
    handle(s, IPC_CHANNELS.appOpenLogsFolder, async () => {
        const err = await shell.openPath(s.paths.logs);
        if (err) throw new clsAppError("INTERNAL", "로그 폴더를 열지 못했습니다.", err);
    });

    handle(s, IPC_CHANNELS.settingsGet, () => s.settings.get());
    handle(
        s,
        IPC_CHANNELS.settingsUpdate,
        (patch) => {
            // 일시정지는 scheduler:setPaused로만 바꾼다(해제할 때 지난 예약을 다시 정해야 한다)
            if (patch.scheduler !== undefined) {
                throw new clsAppError(
                    "VALIDATION",
                    "자동 실행 일시정지는 설정 저장으로 바꿀 수 없습니다.",
                );
            }
            return s.settings.update(patch);
        },
        zSettingsPatch,
    );

    handle(s, IPC_CHANNELS.jobsList, () => s.jobs.list());
    handle(
        s,
        IPC_CHANNELS.jobsCreate,
        (draft) => {
            f_AssertOsBackendAllowed(s, null, draft.autoSync.backend);
            return s.jobs.create(draft);
        },
        zJobCreateInput,
    );
    handle(
        s,
        IPC_CHANNELS.jobsUpdate,
        ({ id, patch }) => {
            f_AssertNotRunning(s, id, "고칠");
            if (patch.autoSync) {
                f_AssertOsBackendAllowed(
                    s,
                    s.jobs.get(id).autoSync.backend,
                    patch.autoSync.backend,
                );
            }
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

    registerExcludesIpc(s);
    registerRemotesIpc(s);
    registerRemoteConfigIpc(s);
    registerCompareIpc(s);
    registerRunIpc(s);
    registerHistoryIpc(s);
    registerSchedulerIpc(s);
    registerRcloneIpc(s);
    registerWslIpc(s);
    registerDialogIpc(s);
    registerSystemIpc(s);
}
