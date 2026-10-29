/**
 * main 프로세스 진입점: 앱 수명주기, 단일 인스턴스, 저장소·IPC 초기화, 보안 정책,
 * 스케줄러·트레이·로그 보관 정리·테마·로그인 시 시작(Phase 8).
 *
 * - 창 X: 설정 ui.minimizeToTray(기본 켜짐)면 트레이로 숨기고 세션당 한 번 안내한다. 끄면 앱을 끝낸다.
 * - 종료(창 닫기·트레이 종료·before-quit)는 한 흐름(f_RequestQuit)을 쓴다: 실행 중이면 확인 창 →
 *   취소 후 최대 10초 대기 → 안 끝나면 다시 묻는다. 비교(자동 실행의 비교 단계 포함)만 진행 중이면 묻지 않고 취소.
 *   로그오프·PC 종료(session-end)는 묻지 않고 취소한다.
 * - `--hidden`(로그인 시 시작)이면 창을 보이지 않고 트레이로 시작한다. 로그인 항목은 설치본에서만 바꾼다.
 * - 저장소(SQLite, INT-002 T-01)는 창을 띄우기 전에 한 번 연다(무결성 검사·복구·마이그레이션·JSON 이전·일일 백업).
 *   will-quit에서 닫는다. 열지 못하면 오류 창을 보이고 끝낸다.
 *
 * @author dev-Joy 2026-10-28
 */

/// <reference types="electron-vite/node" />

// ========== External imports ==========
import {
    app,
    BrowserWindow,
    dialog,
    nativeTheme,
    Notification,
    powerMonitor,
    session,
    shell,
    type IpcMainInvokeEvent,
    type MessageBoxOptions,
} from "electron";

// ========== Internal imports ==========
import { setupAppPaths } from "@/main/app-paths";
import trayIconPath from "@/main/assets/tray.png?asset";
import { registerIpc } from "@/main/ipc/register";
import { clsLogger } from "@/main/lib/logger";
import { clsRcloneEnv } from "@/main/rclone/detect";
import { clsActivityLock } from "@/main/services/activity-lock";
import { clsCompareService } from "@/main/services/compare-service";
import { pruneRunLogs } from "@/main/services/log-retention";
import { clsPathService } from "@/main/services/path-service";
import { clsActiveRunStore, recoverActiveRun } from "@/main/services/run-recovery";
import { clsRunService } from "@/main/services/run-service";
import { clsScheduler } from "@/main/services/scheduler";
import { clsWslService } from "@/main/services/wsl";
import { openAppDb } from "@/main/store/app-db";
import { clsHistoryStore } from "@/main/store/history-store";
import { clsJobStore } from "@/main/store/job-store";
import { clsSettingsStore } from "@/main/store/settings-store";
import type { clsSqliteDb } from "@/main/store/sqlite-db";
import { createTray, type itfAppTray } from "@/main/tray";
import { createMainWindow, isAppUrl } from "@/main/window";
import { IPC_EVENTS, type itfAppNotice } from "@/shared/ipc-contract";
import type { typSettings } from "@/shared/schemas/settings";
import type { itfAppNotify, itfSchedulerState } from "@/shared/types/scheduler";

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
let tray: itfAppTray | null = null;
/** 실행 중 종료: 취소 후 이 시간까지 기다린다 */
const QUIT_WAIT_MS = 10_000;
/** 로그·이력 보관 정리 간격 */
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** electron-builder.yml appId와 같아야 Windows 알림이 앱 이름으로 뜬다 */
const APP_USER_MODEL_ID = "com.rclonegui.app";
/** 로그인 시 시작 인자: 창 없이 트레이로 시작 */
const HIDDEN_ARG = "--hidden";
const START_HIDDEN = process.argv.includes(HIDDEN_ARG);
/**
 * Playwright E2E: 트레이를 만들지 않고 창을 닫으면 앱을 끝낸다.
 * 임시 userData(RCLONEGUI_USER_DATA)와 함께 써서 실제 사용자 환경을 건드리지 않는다.
 */
const E2E = process.env.RCLONEGUI_E2E === "1";

/** 종료를 허락했는지(확인·취소를 마쳤거나 세션 종료). 그 전에는 창 닫기·before-quit를 막는다 */
let allowQuit = false;
/** 종료 확인·대기 중(두 번째 요청은 무시) */
let quitPending = false;
let trayHintShown = false;
let retentionTimer: NodeJS.Timeout | null = null;
/** 저장소 DB. will-quit에서 닫는다 */
let appDb: clsSqliteDb | null = null;

/** f_Start가 만든 서비스. 만들기 전에는 null */
interface itfServices {
    settings: clsSettingsStore;
    history: clsHistoryStore;
    compare: clsCompareService;
    runs: clsRunService;
    scheduler: clsScheduler;
}
let svc: itfServices | null = null;

process.on("uncaughtException", (e) => logger.error("uncaughtException", e));
process.on("unhandledRejection", (e) => logger.error("unhandledRejection", e));

function f_AddNotice(n: itfAppNotice): void {
    notices.push(n);
    logger.warn(`알림: ${n.message}`);
}

/** 개발 실행에서만: 스케줄러 tick 간격(ms). drive-app 확인용 */
function f_DevTickMs(): number | undefined {
    if (app.isPackaged) return undefined;
    const v = Number(process.env.RCLONEGUI_DEV_TICK_MS);
    return Number.isInteger(v) && v >= 500 ? v : undefined;
}

/** 개발 실행에서만: 종료 확인 창 대신 쓸 답(quit|keep). drive-app 확인용 */
function f_DevQuitChoice(): "quit" | "keep" | null {
    if (app.isPackaged) return null;
    const v = process.env.RCLONEGUI_DEV_QUIT_CHOICE;
    return v === "quit" || v === "keep" ? v : null;
}

function f_VisibleWindow(): BrowserWindow | null {
    const w = mainWindow;
    return w && !w.isDestroyed() && w.isVisible() ? w : null;
}

/** OS 알림(지원할 때만). 누르면 창을 연다 */
function f_OsNotify(message: string, silent: boolean): void {
    if (!Notification.isSupported()) return;
    const note = new Notification({ title: "rcloneGUI", body: message, silent });
    note.on("click", () => f_ShowWindow());
    note.show();
}

/** 앱 알림: 창이 보이고 포커스가 있으면 화면 토스트, 아니면 OS 알림. app.log에는 수준만 남긴다 */
function f_Notify(n: itfAppNotify): void {
    logger.info(`알림 보냄: level=${n.level}`);
    const w = f_VisibleWindow();
    if (w && w.isFocused()) {
        w.webContents.send(IPC_EVENTS.appNotify, n);
        return;
    }
    f_OsNotify(n.message, n.level === "info" || n.level === "success");
}

/** 로그인 시 시작 항목. 개발 실행은 electron.exe가 등록되므로 바꾸지 않는다 */
function f_SyncLoginItem(enabled: boolean): void {
    if (!app.isPackaged || E2E) return;
    try {
        // 값 이름을 고정해야 제거 프로그램(build/installer.nsh)이 같은 이름으로 지운다
        app.setLoginItemSettings({
            openAtLogin: enabled,
            args: [HIDDEN_ARG],
            name: APP_USER_MODEL_ID,
        });
    } catch (e) {
        logger.warn("로그인 항목을 바꾸지 못함", e);
    }
}

function f_ApplySettings(s: typSettings, prev: typSettings | null): void {
    nativeTheme.themeSource = s.ui.theme;
    if (prev === null || prev.ui.launchAtLogin !== s.ui.launchAtLogin) {
        f_SyncLoginItem(s.ui.launchAtLogin);
    }
}

/** 창을 보이고 앞으로 가져온다. 없으면 다시 만든다(시작이 끝난 뒤에만) */
function f_ShowWindow(): void {
    if (!svc) return;
    const w = mainWindow;
    if (!w || w.isDestroyed()) {
        f_OpenWindow(false);
        return;
    }
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
}

/** 메인 창을 만들고 닫기(트레이로 숨김·종료)·세션 종료를 연결한다 */
function f_OpenWindow(hidden: boolean): void {
    const win = createMainWindow({ hidden });
    mainWindow = win;
    win.on("close", (event) => {
        if (allowQuit) return;
        event.preventDefault();
        if (!E2E && svc?.settings.get().ui.minimizeToTray && tray) {
            win.hide();
            if (!trayHintShown) {
                trayHintShown = true;
                f_OsNotify(
                    "rcloneGUI는 알림 영역(트레이)에서 계속 실행되고 자동 실행도 계속합니다. 끝내려면 트레이 아이콘 메뉴의 ‘종료’를 누르세요.",
                    true,
                );
            }
            return;
        }
        f_RequestQuit();
    });
    // 로그오프·PC 종료: 묻지 않고 진행 중인 작업을 취소한다
    win.on("session-end", () => f_SessionEnd());
    win.on("closed", () => {
        if (mainWindow === win) mainWindow = null;
    });
}

function f_SendState(state: itfSchedulerState): void {
    const w = mainWindow;
    if (w && !w.isDestroyed()) w.webContents.send(IPC_EVENTS.schedulerState, state);
    tray?.update(state);
}

/** 정말 끝낸다: 스케줄러·정리 타이머·트레이를 멈추고 app.quit */
function f_FinalQuit(): void {
    allowQuit = true;
    svc?.scheduler.stop();
    if (retentionTimer) clearInterval(retentionTimer);
    retentionTimer = null;
    tray?.destroy();
    tray = null;
    app.quit();
}

async function f_AskQuit(kind: "running" | "stuck", jobName: string): Promise<"quit" | "keep"> {
    const dev = f_DevQuitChoice();
    if (dev) return dev;
    const opts: MessageBoxOptions =
        kind === "running"
            ? {
                  type: "warning",
                  title: "rcloneGUI 종료",
                  message: `‘${jobName}’ 작업을 실행하는 중입니다.`,
                  detail: "종료하면 실행을 취소합니다. 이미 복사·삭제된 파일은 되돌리지 않습니다.",
                  buttons: ["실행 중인 작업을 취소하고 종료", "앱 유지"],
                  defaultId: 1,
                  cancelId: 1,
                  noLink: true,
              }
            : {
                  type: "warning",
                  title: "rcloneGUI 종료",
                  message: `실행이 ${QUIT_WAIT_MS / 1000}초 안에 끝나지 않았습니다.`,
                  detail: "그래도 종료하면 남은 rclone 프로세스는 다음에 앱을 시작할 때 정리합니다.",
                  buttons: ["그래도 종료(다음 시작 때 정리)", "앱 유지"],
                  defaultId: 1,
                  cancelId: 1,
                  noLink: true,
              };
    const w = f_VisibleWindow();
    const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
    return r.response === 0 ? "quit" : "keep";
}

/** 종료 흐름(창 닫기·트레이 종료·before-quit 공통) */
async function f_QuitFlow(): Promise<void> {
    if (!svc) {
        f_FinalQuit();
        return;
    }
    const { compare, runs } = svc;
    const cmp = compare.getActive();
    if (cmp) compare.cancel(cmp.jobId);
    const run = runs.getActive();
    if (run) {
        // 자동 실행의 비교 단계는 파일을 바꾸지 않으므로 묻지 않는다
        if (run.phase !== "comparing" && (await f_AskQuit("running", run.jobName)) === "keep") {
            logger.info(`종료 취소(앱 유지): run=${run.runId}`);
            return;
        }
        logger.info(`종료 전 실행 취소: run=${run.runId}`);
        runs.cancel(run.runId);
        if (!(await runs.whenIdle(QUIT_WAIT_MS))) {
            logger.warn(`실행이 ${QUIT_WAIT_MS / 1000}초 안에 끝나지 않음: run=${run.runId}`);
            if ((await f_AskQuit("stuck", run.jobName)) === "keep") return;
            logger.warn(`끝나지 않은 실행을 두고 종료(다음 시작 때 정리): run=${run.runId}`);
        }
    }
    f_FinalQuit();
}

function f_RequestQuit(): void {
    if (allowQuit) {
        app.quit();
        return;
    }
    if (quitPending) return;
    quitPending = true;
    f_QuitFlow()
        .catch((e: unknown) => logger.error("종료 처리 실패", e))
        .finally(() => {
            quitPending = false;
        });
}

/** 세션 종료(로그오프·PC 종료): 묻지 않고 비교·실행을 취소한 뒤 끝낸다 */
function f_SessionEnd(): void {
    logger.info("세션 종료: 진행 중인 작업을 취소하고 종료");
    if (svc) {
        const cmp = svc.compare.getActive();
        if (cmp) svc.compare.cancel(cmp.jobId);
        const run = svc.runs.getActive();
        if (run) svc.runs.cancel(run.runId);
    }
    f_FinalQuit();
}

/** 보관 수를 넘은 이력과 보관 일수가 지난 실행 로그를 지운다(실행 중 기록의 로그는 남김) */
async function f_Retention(): Promise<void> {
    if (!svc) return;
    const { history, settings } = svc;
    const records = await history.prune().catch((e: unknown) => {
        logger.warn("이력 정리 실패", e);
        return 0;
    });
    const logs = await pruneRunLogs(
        paths.logs,
        settings.get().logs.retentionDays,
        new Date(),
        history.runningLogFiles(),
    );
    logger.info(`보관 정리: history=${records} logs=${logs}`);
}

/** 시작 실패 오류 창(E2E는 창이 테스트를 멈추므로 띄우지 않는다) */
function f_ShowStartError(e: unknown): void {
    if (E2E) return;
    const message = e instanceof Error ? e.message : String(e);
    try {
        dialog.showErrorBox(
            "rcloneGUI를 시작하지 못했습니다",
            `${message}\n\n데이터 폴더: ${paths.userData}\n자세한 내용은 로그 폴더의 app.log를 확인하세요.`,
        );
    } catch {
        // 오류 창도 못 띄우면 로그만 남긴다
    }
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
        `시작: v${app.getVersion()} electron ${process.versions.electron} node ${process.versions.node} hidden=${START_HIDDEN}`,
    );
    f_ApplySecurityPolicy();

    const { db } = await openAppDb({ userDataDir: paths.userData, logger, onNotice: f_AddNotice });
    appDb = db;
    // 늦게 끝난 이력 갱신은 닫힌 뒤 STORE_ERROR로 실패한다(다음 시작 때 markInterrupted가 정리)
    app.on("will-quit", () => {
        try {
            appDb?.close();
        } catch (e) {
            logger.warn("저장소를 닫지 못함", e);
        }
        appDb = null;
    });

    let scheduler: clsScheduler | null = null;
    const settings = new clsSettingsStore(db, f_AddNotice, (s, prev) => f_ApplySettings(s, prev));
    await settings.load();
    f_ApplySettings(settings.get(), null);
    const jobs = new clsJobStore({
        db,
        caseInsensitive: () => settings.get().compare.caseInsensitivePaths,
        onNotice: f_AddNotice,
        onChange: (list) => {
            mainWindow?.webContents.send(IPC_EVENTS.jobsChanged, { jobs: list });
            scheduler?.emitState();
        },
    });
    await jobs.load();
    const history = new clsHistoryStore(db, () => settings.get().logs.historyLimit, f_AddNotice);
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
    // 비교·실행·자동 실행이 함께 쓰는 전역 활동 락
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
            if (e.type === "started" || e.type === "finished") scheduler?.emitState();
        },
    });
    const devTickMs = f_DevTickMs();
    scheduler = new clsScheduler({
        jobs,
        settings,
        runs,
        logger,
        notify: f_Notify,
        emitState: f_SendState,
        ...(devTickMs ? { tickMs: devTickMs } : {}),
    });
    svc = { settings, history, compare, runs, scheduler };

    app.on("before-quit", (event) => {
        if (allowQuit) return;
        event.preventDefault();
        f_RequestQuit();
    });
    powerMonitor.on("resume", () => {
        logger.info("절전에서 깨어남: 지난 자동 실행 예약 조정");
        void scheduler?.onResume();
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
        history,
        scheduler,
        getWindow: () => mainWindow,
    });

    f_OpenWindow(START_HIDDEN && !E2E);
    if (E2E) {
        // 트레이가 없으므로 --hidden으로 시작해도 창을 보인다(E2E가 화면을 조작한다)
        if (START_HIDDEN) f_ShowWindow();
    } else {
        try {
            tray = createTray({
                icon: trayIconPath,
                onShow: f_ShowWindow,
                onOpenLogs: () => {
                    void shell.openPath(paths.logs);
                },
                onTogglePause: (paused) => {
                    scheduler?.setPaused(paused).catch((e: unknown) => {
                        logger.warn("일시정지 변경 실패", e);
                    });
                },
                onQuit: f_RequestQuit,
            });
        } catch (e) {
            logger.error("트레이 아이콘을 만들지 못함", e);
            tray = null;
            // 트레이가 없으면 숨긴 창을 다시 찾을 방법이 없으므로 보인다
            if (START_HIDDEN) f_ShowWindow();
        }
    }

    await f_Retention().catch((e: unknown) => logger.warn("보관 정리 실패", e));
    retentionTimer = setInterval(() => {
        f_Retention().catch((e: unknown) => logger.warn("보관 정리 실패", e));
    }, RETENTION_INTERVAL_MS);
    await scheduler.start();
}

if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    // 이미 실행 중이면 숨겨진 창을 보인다(없으면 다시 만든다)
    app.on("second-instance", () => f_ShowWindow());
    // 트레이 모드에서는 창이 없어도 끝내지 않는다. 종료는 f_RequestQuit 흐름으로만 한다
    app.on("window-all-closed", () => {
        if (allowQuit || !tray) f_RequestQuit();
    });
    app.whenReady()
        .then(f_Start)
        .catch((e: unknown) => {
            logger.error("시작 실패", e);
            f_ShowStartError(e);
            allowQuit = true;
            app.quit();
        });
}
