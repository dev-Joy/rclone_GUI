/**
 * main 프로세스 진입점: 앱 수명주기, 단일 인스턴스, 저장소·IPC 초기화, 보안 정책.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { app, BrowserWindow, session, type IpcMainInvokeEvent } from "electron";

// ========== Internal imports ==========
import { setupAppPaths } from "@/main/app-paths";
import { registerIpc } from "@/main/ipc/register";
import { clsLogger } from "@/main/lib/logger";
import { clsHistoryStore } from "@/main/store/history-store";
import { clsJobStore } from "@/main/store/job-store";
import { clsSettingsStore } from "@/main/store/settings-store";
import { createMainWindow, isAppUrl } from "@/main/window";
import { IPC_EVENTS, type itfAppNotice } from "@/shared/ipc-contract";

const DEV_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' ws://localhost:* http://localhost:*",
    "object-src 'none'",
    "base-uri 'none'",
].join("; ");

const paths = setupAppPaths();
const logger = new clsLogger(paths.logs);
const notices: itfAppNotice[] = [];
let mainWindow: BrowserWindow | null = null;

process.on("uncaughtException", (e) => logger.error("uncaughtException", e));
process.on("unhandledRejection", (e) => logger.error("unhandledRejection", e));

function f_AddNotice(n: itfAppNotice): void {
    notices.push(n);
    logger.warn(`알림: ${n.message}`);
}

function f_IsTrustedSender(event: IpcMainInvokeEvent): boolean {
    const frame = event.senderFrame;
    return (
        mainWindow !== null &&
        !mainWindow.isDestroyed() &&
        event.sender.id === mainWindow.webContents.id &&
        frame !== null &&
        frame === event.sender.mainFrame &&
        isAppUrl(frame.url)
    );
}

function f_ApplySecurityPolicy(): void {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    if (process.env.ELECTRON_RENDERER_URL) {
        // 개발 서버(HMR)용 CSP. 운영 빌드는 index.html의 meta CSP를 쓴다
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    "Content-Security-Policy": [DEV_CSP],
                },
            });
        });
    }
    app.on("web-contents-created", (_e, contents) => {
        contents.on("will-attach-webview", (event) => event.preventDefault());
    });
}

async function f_Start(): Promise<void> {
    logger.info(
        `시작: v${app.getVersion()} electron ${process.versions.electron} node ${process.versions.node}`,
    );
    f_ApplySecurityPolicy();

    const settings = new clsSettingsStore(paths.userData, f_AddNotice);
    await settings.load();
    const jobs = new clsJobStore({
        userDataDir: paths.userData,
        caseInsensitive: () => settings.get().compare.caseInsensitivePaths,
        onNotice: f_AddNotice,
        onChange: (list) => mainWindow?.webContents.send(IPC_EVENTS.jobsChanged, { jobs: list }),
    });
    await jobs.load();
    const history = new clsHistoryStore(
        paths.userData,
        () => settings.get().logs.historyLimit,
        f_AddNotice,
    );
    await history.load();
    const interrupted = await history.markInterrupted();
    if (interrupted.length > 0) {
        f_AddNotice({
            level: "warning",
            message: `지난번 앱 종료 때 실행 중이던 작업 ${interrupted.length}건을 '중단됨'으로 기록했습니다.`,
        });
    }

    registerIpc({
        logger,
        isTrustedSender: f_IsTrustedSender,
        settings,
        jobs,
        paths,
        notices: () => [...notices],
    });

    mainWindow = createMainWindow();
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });
    app.on("window-all-closed", () => app.quit());
    app.whenReady()
        .then(f_Start)
        .catch((e: unknown) => {
            logger.error("시작 실패", e);
            app.quit();
        });
}
