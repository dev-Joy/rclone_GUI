/**
 * IPC 채널과 타입의 단일 정의 (AGENTS.md §4.6, MVP_SPEC §12).
 * preload 번들에 들어가므로 런타임 import는 두지 않는다(타입만 import).
 * 채널은 기능이 구현될 때 추가한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typPathKind } from "@/shared/path-utils";
import type { typApiResult, typAppErrorPayload } from "@/shared/schemas/common";
import type { typJob, typJobDraft, typJobPatch } from "@/shared/schemas/job";
import type { typSettings, typSettingsPatch } from "@/shared/schemas/settings";
import type { typPickDirectoryInput, typPickFileInput } from "@/shared/schemas/system";

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
    rcloneDetect: "rclone:detect",
    rcloneListRemotes: "rclone:listRemotes",
    rcloneTestPath: "rclone:testPath",
    wslListDistros: "wsl:listDistros",
    dialogPickDirectory: "dialog:pickDirectory",
    dialogPickFile: "dialog:pickFile",
    systemOpenExternal: "system:openExternal",
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

export type typBinarySource = "manual" | "path" | "common";
export type typConfigSource = "manual" | "env" | "auto" | "none";

/**
 * rclone:detect 결과. 감지 실패도 오류 envelope가 아니라 problem으로 돌려준다(화면이 온보딩을 그림).
 */
export interface itfRcloneEnvironment {
    binaryPath: string | null;
    binarySource: typBinarySource | null;
    /** "1.75.1" (접미사 포함 원문은 versionText) */
    version: string | null;
    /** "v1.75.1", "v1.66.0-beta.7" 등 첫 줄 원문 */
    versionText: string | null;
    os: string | null;
    arch: string | null;
    /** 이후 rclone 호출에 --config로 넘길 경로(파일이 있을 때만) */
    configPath: string | null;
    configExists: boolean;
    configSource: typConfigSource;
    /** 끝의 ":"를 뗀 이름, 정렬 */
    remotes: string[];
    /** RCLONE_NOT_FOUND | RCLONE_NOT_EXECUTABLE | RCLONE_VERSION_UNSUPPORTED | CONFIG_NOT_FOUND | null */
    problem: typAppErrorPayload | null;
    warnings: string[];
    /** ISO */
    detectedAt: string;
}

/** rclone:testPath 결과 */
export interface itfPathProbe {
    kind: typPathKind;
    displayPath: string;
    normalizedPath: string;
    exists: boolean;
    isDirectory: boolean;
    /** local/unc만. remote는 null */
    readable: boolean | null;
    /** 루트는 확인만 하고 작업 경로로는 쓰지 못한다(경고) */
    isRoot: boolean;
    message: string;
    warnings: string[];
}

export interface itfWslDistros {
    distros: string[];
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
    rclone: {
        /** force면 캐시를 무시하고 다시 감지한다 */
        detect(force?: boolean): Promise<typApiResult<itfRcloneEnvironment>>;
        listRemotes(configPath?: string | null): Promise<typApiResult<string[]>>;
        testPath(path: string, configPath?: string | null): Promise<typApiResult<itfPathProbe>>;
    };
    wsl: {
        listDistros(): Promise<typApiResult<itfWslDistros>>;
    };
    dialog: {
        /** 취소하면 null */
        pickDirectory(opts?: typPickDirectoryInput): Promise<typApiResult<string | null>>;
        pickFile(opts?: typPickFileInput): Promise<typApiResult<string | null>>;
    };
    system: {
        /** 허용 목록(https://rclone.org/)의 주소만 연다 */
        openExternal(url: string): Promise<typApiResult<null>>;
    };
    events: {
        onJobsChanged(cb: (e: itfJobsChangedEvent) => void): () => void;
    };
}
