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
    },
};

contextBridge.exposeInMainWorld("rclonegui", api);
