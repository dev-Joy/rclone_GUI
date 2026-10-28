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
import { clsRcloneEnv } from "@/main/rclone/detect";
import { clsActivityLock } from "@/main/services/activity-lock";
import { clsCompareService } from "@/main/services/compare-service";
import { clsPathService } from "@/main/services/path-service";
import { clsActiveRunStore, recoverActiveRun } from "@/main/services/run-recovery";
import { clsRunService } from "@/main/services/run-service";
import { clsWslService } from "@/main/services/wsl";
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
/** 실행 중 종료: 취소 후 이 시간까지 기다린다(D2) */
const QUIT_WAIT_MS = 10_000;

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
    // 지난번 실행 중 비정상 종료로 남은 rclone을 먼저 정리하고, 남은 running 이력을 중단됨으로 바꾼다
    const activeRun = new clsActiveRunStore(paths.userData);
    const recovered = await recoverActiveRun({ store: activeRun, logger }).catch((e: unknown) => {
        logger.error("active-run 복구 실패", e);
        return null;
    });
    if (recovered && "notice" in recovered) f_AddNotice(recovered.notice);
    const interrupted = await history.markInterrupted();
    if (interrupted.length > 0) {
        f_AddNotice({
            level: "warning",
            message: `지난번 앱 종료 때 실행 중이던 작업 ${interrupted.length}건을 '중단됨'으로 기록했습니다.`,
        });
    }

    // rclone 감지는 시작을 늦추지 않도록 화면이 rclone:detect를 부를 때 한다
    const rcloneEnv = new clsRcloneEnv({ getSettings: () => settings.get(), logger });
    const pathService = new clsPathService({ rcloneEnv });
    const wsl = new clsWslService();
    // 비교·실행·자동 실행이 함께 쓰는 전역 활동 락 (Phase 6 실행 서비스도 이것을 받는다)
    const activity = new clsActivityLock();
    const compare = new clsCompareService({
        jobs,
        settings,
        rcloneEnv,
        pathService,
        activity,
        logger,
        emit: (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_EVENTS.compareProgress, e);
            }
        },
    });
    const runs = new clsRunService({
        jobs,
        settings,
        rcloneEnv,
        compare,
        history,
        activity,
        activeRun,
        logsDir: paths.logs,
        logger,
        emit: (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_EVENTS.runEvent, e);
            }
        },
    });
    // 앱을 닫으면 진행 중인 비교·실행(rclone 프로세스 트리)을 끝낸다.
    // 실행 중이면 종료를 미루고 취소 → 최대 10초 기다린 뒤 종료한다(확인 창 없음).
    // 끝을 확인하지 못하면 active-run.json이 남아 다음 시작 때 정리된다.
    let quitting = false;
    app.on("before-quit", (event) => {
        const active = compare.getActive();
        if (active) compare.cancel(active.jobId);
        const run = runs.getActive();
        if (!run || quitting) return;
        quitting = true;
        event.preventDefault();
        logger.info(`종료 전 실행 취소: run=${run.runId}`);
        runs.cancel(run.runId);
        void (async () => {
            const idle = await runs.whenIdle(QUIT_WAIT_MS);
            if (!idle) {
                logger.warn(
                    `실행이 ${QUIT_WAIT_MS / 1000}초 안에 끝나지 않아 그대로 종료: run=${run.runId}`,
                );
            }
            app.quit();
        })();
    });

    registerIpc({
        logger,
        isTrustedSender: f_IsTrustedSender,
        settings,
        jobs,
        paths,
        notices: () => [...notices],
        rcloneEnv,
        pathService,
        wsl,
        compare,
        runs,
        getWindow: () => mainWindow,
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
