/**
 * IPC 채널과 타입의 단일 정의 (AGENTS.md §4.6, MVP_SPEC §12).
 * preload 번들에 들어가므로 런타임 import는 두지 않는다(타입만 import).
 * 채널은 기능이 구현될 때 추가한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typApiResult } from "@/shared/schemas/common";
import type { typJob, typJobDraft, typJobPatch } from "@/shared/schemas/job";
import type { typSettings, typSettingsPatch } from "@/shared/schemas/settings";

export const IPC_CHANNELS = {
    appGetInfo: "app:getInfo",
    appGetNotices: "app:getNotices",
    appOpenLogsFolder: "app:openLogsFolder",
    settingsGet: "settings:get",
    settingsUpdate: "settings:update",
    jobsList: "jobs:list",
    jobsCreate: "jobs:create",
    jobsUpdate: "jobs:update",
    jobsDelete: "jobs:delete",
    jobsDuplicate: "jobs:duplicate",
} as const;

export const IPC_EVENTS = {
    jobsChanged: "jobs:changed",
} as const;

export type typIpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface itfAppInfo {
    appVersion: string;
    electron: string;
    node: string;
    chrome: string;
    platform: string;
    userDataPath: string;
    logsPath: string;
}

/** 시작 시 저장 파일 복구 등 사용자에게 알려야 할 일 */
export interface itfAppNotice {
    level: "warning" | "error";
    message: string;
}

export interface itfJobsChangedEvent {
    jobs: typJob[];
}

/** preload가 window.rclonegui로 노출하는 API */
export interface itfRcloneGuiApi {
    app: {
        getInfo(): Promise<typApiResult<itfAppInfo>>;
        getNotices(): Promise<typApiResult<itfAppNotice[]>>;
        openLogsFolder(): Promise<typApiResult<null>>;
    };
    settings: {
        get(): Promise<typApiResult<typSettings>>;
        update(patch: typSettingsPatch): Promise<typApiResult<typSettings>>;
    };
    jobs: {
        list(): Promise<typApiResult<typJob[]>>;
        create(draft: typJobDraft): Promise<typApiResult<typJob>>;
        update(id: string, patch: typJobPatch): Promise<typApiResult<typJob>>;
        remove(id: string): Promise<typApiResult<null>>;
        duplicate(id: string): Promise<typApiResult<typJob>>;
    };
    events: {
        onJobsChanged(cb: (e: itfJobsChangedEvent) => void): () => void;
    };
}
