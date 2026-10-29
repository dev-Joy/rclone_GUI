/**
 * contextBridge로 window.rclonegui 를 노출한다. 범용 invoke 통로는 노출하지 않는다.
 * sandbox preload는 CJS 단일 번들이어야 하므로 외부 패키지를 import 하지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// ========== Internal imports ==========
import { IPC_CHANNELS as C, IPC_EVENTS as E, type itfRcloneGuiApi } from "@/shared/ipc-contract";

function f_Subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

const api: itfRcloneGuiApi = {
    app: {
        getInfo: () => ipcRenderer.invoke(C.appGetInfo),
        getNotices: () => ipcRenderer.invoke(C.appGetNotices),
        openLogsFolder: () => ipcRenderer.invoke(C.appOpenLogsFolder),
    },
    settings: {
        get: () => ipcRenderer.invoke(C.settingsGet),
        update: (patch) => ipcRenderer.invoke(C.settingsUpdate, patch),
    },
    jobs: {
        list: () => ipcRenderer.invoke(C.jobsList),
        create: (draft) => ipcRenderer.invoke(C.jobsCreate, draft),
        update: (id, patch) => ipcRenderer.invoke(C.jobsUpdate, { id, patch }),
        remove: (id) => ipcRenderer.invoke(C.jobsDelete, { id }),
        duplicate: (id) => ipcRenderer.invoke(C.jobsDuplicate, { id }),
    },
    excludes: {
        list: () => ipcRenderer.invoke(C.excludesList),
        create: (pattern) => ipcRenderer.invoke(C.excludesCreate, { pattern }),
        update: (input) => ipcRenderer.invoke(C.excludesUpdate, input),
        remove: (input) => ipcRenderer.invoke(C.excludesDelete, input),
    },
    compare: {
        run: (jobId) => ipcRenderer.invoke(C.compareRun, { jobId }),
        cancel: (jobId) => ipcRenderer.invoke(C.compareCancel, { jobId }),
        get: (jobId) => ipcRenderer.invoke(C.compareGet, { jobId }),
        getActive: () => ipcRenderer.invoke(C.compareGetActive),
    },
    run: {
        start: (input) => ipcRenderer.invoke(C.runStart, input),
        cancel: (runId) => ipcRenderer.invoke(C.runCancel, { runId }),
        getActive: () => ipcRenderer.invoke(C.runGetActive),
    },
    history: {
        list: (query) => ipcRenderer.invoke(C.historyList, query ?? {}),
        get: (runId) => ipcRenderer.invoke(C.historyGet, { runId }),
        readLog: (runId, tailBytes) =>
            ipcRenderer.invoke(
                C.historyReadLog,
                tailBytes === undefined ? { runId } : { runId, tailBytes },
            ),
        clear: (deleteLogs) => ipcRenderer.invoke(C.historyClear, { deleteLogs }),
    },
    scheduler: {
        getState: () => ipcRenderer.invoke(C.schedulerGetState),
        setPaused: (paused) => ipcRenderer.invoke(C.schedulerSetPaused, { paused }),
    },
    rclone: {
        detect: (force) => ipcRenderer.invoke(C.rcloneDetect, { force: force ?? false }),
        listRemotes: (configPath) =>
            ipcRenderer.invoke(C.rcloneListRemotes, configPath === undefined ? {} : { configPath }),
        testPath: (path, configPath) =>
            ipcRenderer.invoke(
                C.rcloneTestPath,
                configPath === undefined ? { path } : { path, configPath },
            ),
    },
    wsl: {
        listDistros: () => ipcRenderer.invoke(C.wslListDistros),
    },
    dialog: {
        pickDirectory: (opts) => ipcRenderer.invoke(C.dialogPickDirectory, opts ?? {}),
        pickFile: (opts) => ipcRenderer.invoke(C.dialogPickFile, opts ?? {}),
    },
    system: {
        openExternal: (url) => ipcRenderer.invoke(C.systemOpenExternal, { url }),
    },
    events: {
        onJobsChanged: (cb) => f_Subscribe(E.jobsChanged, cb),
        onCompareProgress: (cb) => f_Subscribe(E.compareProgress, cb),
        onRunEvent: (cb) => f_Subscribe(E.runEvent, cb),
        onSchedulerState: (cb) => f_Subscribe(E.schedulerState, cb),
        onAppNotify: (cb) => f_Subscribe(E.appNotify, cb),
    },
};

contextBridge.exposeInMainWorld("rclonegui", api);
