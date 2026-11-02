/**
 * main 프로세스 진입점: 앱 수명주기, 단일 인스턴스, 저장소·IPC 초기화, 보안 정책,
 * 스케줄러·트레이·로그 보관 정리·테마·로그인 시 시작(Phase 8).
 *
 * - 창 X: 설정 ui.minimizeToTray(기본 켜짐)면 트레이로 숨기고 세션당 한 번 안내한다. 끄면 앱을 끝낸다.
 * - 종료(창 닫기·트레이 종료·before-quit)는 한 흐름(f_RequestQuit)을 쓴다: 실행 중이면 확인 창 →
 *   취소 후 최대 10초 대기 → 안 끝나면 다시 묻는다. 비교(자동 실행의 비교 단계 포함)만 진행 중이면 묻지 않고 취소.
 *   로그오프·PC 종료(session-end)는 묻지 않고 취소한다.
 *   트레이 ‘종료’에서만, 실행 중이 아니고 자동 실행 예약이 있으면 "다음 예약" 경고를 먼저 띄운다(INT-002 T-06).
 *   창 X·before-quit은 경고하지 않는다(설치 스모크·drive-app이 대화상자에서 멈추지 않도록).
 * - `--hidden`(로그인 시 시작)이면 창을 보이지 않고 트레이로 시작한다. 로그인 항목은 설치본에서만 바꾼다.
 * - 저장소(SQLite, INT-002 T-01)는 창을 띄우기 전에 한 번 연다(무결성 검사·복구·마이그레이션·JSON 이전·일일 백업).
 *   will-quit에서 닫는다. 열지 못하면 오류 창을 보이고 끝낸다.
 * - `--run-job <id>`(Windows 작업 스케줄러, INT-003 T-01)이면 헤드리스로 시작한다: 저장소·서비스만 만들고
 *   창·트레이·IPC·앱 스케줄러·보관 정리 없이 OS 예약 대기열만 돌린 뒤, 대기열이 비면 DB를 닫고 첫 항목의
 *   종료 코드(0 성공·1 실패·2 인자 오류·차단·3 시작 실패)로 끝난다. 대화상자를 띄우지 않는다.
 *   이미 앱이 실행 중이면 second-instance additionalData로 넘기고 0으로 끝난다(넘겨받은 쪽은 창을 보이지 않음).
 *   헤드리스 중 사용자가 앱을 열면(데이터 없는 second-instance·알림 클릭) GUI로 바뀌고 실행은 계속된다.
 *
 * @author dev-Joy 2026-10-28
 */

/// <reference types="electron-vite/node" />

// ========== External imports ==========
import { join } from "node:path";
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
import { HIDDEN_ARG, parseLaunchArgs } from "@/main/launch-args";
import { clsLogger } from "@/main/lib/logger";
import { clsRcloneEnv } from "@/main/rclone/detect";
import { clsActivityLock } from "@/main/services/activity-lock";
import { cleanupExcludeFiles, EXCLUDE_FILE_DIR } from "@/main/services/exclude-file";
import { clsExcludeService } from "@/main/services/exclude-service";
import { clsCompareService } from "@/main/services/compare-service";
import { pruneRunLogs } from "@/main/services/log-retention";
import {
    clsOsRunQueue,
    headlessExitDecision,
    precheckJobPaths,
    type typHeadlessExitCode,
} from "@/main/services/os-run-queue";
import { clsOsScheduler, osSchedulerAvailability } from "@/main/services/os-scheduler";
import { clsPathService } from "@/main/services/path-service";
import { clsRemoteOps } from "@/main/services/remote-ops";
import { clsRemoteService } from "@/main/services/remote-service";
import { clsActiveRunStore, recoverActiveRun } from "@/main/services/run-recovery";
import { clsRunService } from "@/main/services/run-service";
import { clsScheduler } from "@/main/services/scheduler";
import { clsWslService } from "@/main/services/wsl";
import { openAppDb } from "@/main/store/app-db";
import { clsExcludeStore } from "@/main/store/exclude-store";
import { clsHistoryStore } from "@/main/store/history-store";
import { clsJobStore } from "@/main/store/job-store";
import { clsRemoteStore } from "@/main/store/remote-store";
import { clsSettingsStore } from "@/main/store/settings-store";
import type { clsSqliteDb } from "@/main/store/sqlite-db";
import { createTray, type itfAppTray } from "@/main/tray";
import { createMainWindow, isAppUrl } from "@/main/window";
import { formatLocalDateTime } from "@/shared/format";
import { IPC_EVENTS, type itfAppNotice } from "@/shared/ipc-contract";
import { quitScheduleWarning } from "@/shared/schedule";
import { zRunJobAdditionalData } from "@/shared/schemas/scheduler";
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
/** 시작 인자(첫 프로세스에서만 본다. second-instance는 additionalData만 본다) */
const LAUNCH = parseLaunchArgs(process.argv, process.defaultApp ? 2 : 1);
/** 로그인 시 시작(--hidden): 창 없이 트레이로 시작 */
const START_HIDDEN = LAUNCH.hidden;
/** 헤드리스 종료 전 OS 알림이 사라지지 않게 기다리는 시간 */
const HEADLESS_NOTIFY_SETTLE_MS = 1_500;
/** 헤드리스 종료 전 진행 중인 schtasks 등록·삭제를 기다리는 최대 시간 */
const HEADLESS_OS_IDLE_WAIT_MS = 10_000;
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
/** 저장소 DB. will-quit(GUI) 또는 f_HeadlessExit(헤드리스)에서 닫는다 */
let appDb: clsSqliteDb | null = null;

type typAppMode = "gui" | "headless";
/** 헤드리스(--run-job)로 시작해도 사용자가 앱을 열면 gui로 바뀐다(되돌아가지 않음) */
let appMode: typAppMode = LAUNCH.runJob.kind === "ok" ? "headless" : "gui";
/** 서비스가 준비되기 전에 도착한 second-instance 요청 */
const pendingSecond: { runJobs: string[]; gui: boolean } = { runJobs: [], gui: false };
/** GUI 시작(IPC 등록·창·트레이)은 한 번만 한다(ipcMain.handle 중복 금지) */
let guiStarted = false;
/** 헤드리스에서 OS 알림을 보냈는지(보냈으면 종료 전 잠깐 기다린다) */
let headlessNotified = false;
/** f_HeadlessExit가 기다리는 중(재진입 금지). 기다리는 동안 다시 불리면 again을 켜 한 번 더 판단한다 */
const headlessExit = { running: false, again: false };

/** f_InitCore가 만든 서비스. 만들기 전에는 null */
interface itfServices {
    settings: clsSettingsStore;
    jobs: clsJobStore;
    history: clsHistoryStore;
    compare: clsCompareService;
    runs: clsRunService;
    scheduler: clsScheduler;
    osScheduler: clsOsScheduler;
    osRuns: clsOsRunQueue;
    rcloneEnv: clsRcloneEnv;
    remoteService: clsRemoteService;
    wsl: clsWslService;
    excludes: clsExcludeService;
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
    if (appMode === "headless" && Notification.isSupported()) headlessNotified = true;
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
    // 로그인 항목은 GUI에서만 맞춘다(헤드리스는 레지스트리를 건드리지 않는다. GUI 시작 때 f_StartGui가 맞춤)
    if (!guiStarted) return;
    if (prev === null || prev.ui.launchAtLogin !== s.ui.launchAtLogin) {
        f_SyncLoginItem(s.ui.launchAtLogin);
    }
}

/** 창을 보이고 앞으로 가져온다. 없으면 다시 만든다(시작이 끝난 뒤에만). 헤드리스면 GUI로 바꾼다 */
function f_ShowWindow(): void {
    if (appMode === "headless") {
        f_EnterGui();
        return;
    }
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
        f_RequestQuit("window");
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
    // 대기 중인 OS 예약 요청은 버린다(이력 없음, 다음 예약 때 다시 돈다)
    svc?.osRuns.dispose();
    if (retentionTimer) clearInterval(retentionTimer);
    retentionTimer = null;
    tray?.destroy();
    tray = null;
    app.quit();
}

type typQuitSource = "tray" | "window" | "app";

/**
 * 종료 확인 창. running·stuck의 text는 작업 이름, schedule의 text는 경고 문구(detail은 scheduleDetail).
 */
async function f_AskQuit(
    kind: "running" | "stuck" | "schedule",
    text: string,
    scheduleDetail = "",
): Promise<"quit" | "keep"> {
    const dev = f_DevQuitChoice();
    if (dev) return dev;
    const base = {
        type: "warning",
        title: "rcloneGUI 종료",
        defaultId: 1,
        cancelId: 1,
        noLink: true,
    } as const;
    let opts: MessageBoxOptions;
    if (kind === "running") {
        opts = {
            ...base,
            message: `‘${text}’ 작업을 실행하는 중입니다.`,
            detail: "종료하면 실행을 중지합니다. 이미 복사·삭제된 파일은 되돌리지 않습니다.",
            buttons: ["실행 중인 작업을 중지하고 종료", "앱 유지"],
        };
    } else if (kind === "stuck") {
        opts = {
            ...base,
            message: `실행이 ${QUIT_WAIT_MS / 1000}초 안에 끝나지 않았습니다.`,
            detail: "그래도 종료하면 남은 rclone 프로세스는 다음에 앱을 시작할 때 정리합니다.",
            buttons: ["그래도 종료(다음 시작 때 정리)", "앱 유지"],
        };
    } else {
        opts = {
            ...base,
            message: text,
            detail: scheduleDetail,
            buttons: ["종료(자동 실행 멈춤)", "앱 유지"],
        };
    }
    const w = f_VisibleWindow();
    const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
    return r.response === 0 ? "quit" : "keep";
}

/** 종료 흐름(창 닫기·트레이 종료·before-quit 공통) */
async function f_QuitFlow(source: typQuitSource): Promise<void> {
    if (!svc) {
        f_FinalQuit();
        return;
    }
    const { compare, runs, scheduler } = svc;
    // 트레이 종료: 실행 중이 아니면 다음 예약을 알린다(실행 중이면 아래 확인 창 하나만)
    if (source === "tray" && !runs.getActive()) {
        const state = scheduler.getState();
        const warn = quitScheduleWarning(state.paused, state.next, formatLocalDateTime);
        if (warn && (await f_AskQuit("schedule", warn.message, warn.detail)) === "keep") {
            logger.info("종료 취소(앱 유지): 자동 실행 예약 있음");
            return;
        }
    }
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

function f_RequestQuit(source: typQuitSource = "app"): void {
    if (allowQuit) {
        app.quit();
        return;
    }
    if (appMode === "headless") {
        // 헤드리스는 대화상자 없이 실행을 취소하고(최대 10초 대기) 끝낸다
        if (quitPending) return;
        quitPending = true;
        void (async () => {
            const runs = svc?.runs;
            const run = runs?.getActive();
            if (runs && run) {
                runs.cancel(run.runId);
                await runs.whenIdle(QUIT_WAIT_MS);
            }
            await f_HeadlessExit(1, true);
        })();
        return;
    }
    if (quitPending) return;
    quitPending = true;
    f_QuitFlow(source)
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

function f_Delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 헤드리스 종료: 알림·진행 중인 schtasks를 잠깐 기다리고 DB를 닫은 뒤 app.exit(code).
 * app.exit은 before-quit·will-quit을 내지 않으므로 DB를 직접 닫는다.
 * 기다리는 동안 GUI로 바뀌었거나 second-instance로 새 요청이 들어와 대기열이 비지 않았으면 끝내지 않는다
 * (그 요청이 끝나면 onIdle이 다시 부른다). force는 종료 요청(f_RequestQuit)으로, 대기열이 남아도 끝낸다.
 */
async function f_HeadlessExit(code: typHeadlessExitCode, force = false): Promise<void> {
    if (headlessExit.running) {
        headlessExit.again = true;
        return;
    }
    headlessExit.running = true;
    try {
        for (;;) {
            headlessExit.again = false;
            const before = headlessExitDecision({
                headless: appMode === "headless",
                quitting: allowQuit,
                queueIdle: svc?.osRuns.isIdle() ?? true,
                force,
            });
            if (before === "stay") return;
            // 알림을 보냈으면 OS 알림이 사라지지 않게 잠깐 기다린다
            if (headlessNotified) await f_Delay(HEADLESS_NOTIFY_SETTLE_MS);
            const os = svc?.osScheduler;
            if (os) await Promise.race([os.idle(), f_Delay(HEADLESS_OS_IDLE_WAIT_MS)]);
            const after = headlessExitDecision({
                headless: appMode === "headless",
                quitting: allowQuit,
                queueIdle: svc?.osRuns.isIdle() ?? true,
                force,
            });
            if (after === "exit") break;
            // 대기열에 새 요청이 있으면 그 처리가 끝난 뒤 onIdle이 다시 부른다(기다리는 사이 이미 불렸으면 다시 판단)
            if (!headlessExit.again) return;
        }
        allowQuit = true;
        svc?.osRuns.dispose();
        try {
            appDb?.close();
        } catch (e) {
            logger.warn("저장소를 닫지 못함", e);
        }
        appDb = null;
        logger.info(`헤드리스 종료: code=${code}`);
        app.exit(code);
    } finally {
        headlessExit.running = false;
    }
}

/** 헤드리스 → GUI(사용자가 앱을 열었음). 진행 중인 OS 실행·대기열은 계속된다 */
function f_EnterGui(): void {
    if (appMode === "gui") {
        f_ShowWindow();
        return;
    }
    appMode = "gui";
    logger.info("헤드리스 → GUI 전환");
    f_StartGui(false).catch((e: unknown) => logger.error("GUI 전환 실패", e));
}

/** 두 번째 프로세스의 요청. argv는 보지 않고 additionalData만 본다(FR-14) */
function f_OnSecondInstance(data: unknown): void {
    const r = zRunJobAdditionalData.safeParse(data);
    if (r.success) {
        // OS 예약 넘김: 창은 보이지 않는다(GUI 모드여도)
        const jobId = r.data.runJob.toLowerCase();
        if (!svc) {
            pendingSecond.runJobs.push(jobId);
            return;
        }
        svc.osRuns.enqueue(jobId);
        return;
    }
    // 그 밖(데이터 없음·형식 다름·예전 버전) = 사용자가 앱을 연 것
    if (!svc) {
        pendingSecond.gui = true;
        return;
    }
    if (appMode === "headless") f_EnterGui();
    else f_ShowWindow();
}

/**
 * 저장소·복구·서비스를 만든다(GUI·헤드리스 공통). 창·트레이·IPC·앱 스케줄러 시작은 하지 않는다.
 */
async function f_InitCore(): Promise<itfServices> {
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
    // OS 예약(INT-003 T-01): 설치본·실제 프로필에서만 schtasks를 부른다(임시 프로필이면 아무것도 하지 않음).
    // 설치 스모크만 RCLONEGUI_OS_SCHEDULER_TEST=1로 임시 프로필에서도 허용한다
    const osScheduler = new clsOsScheduler({
        userDataDir: paths.userData,
        execPath: process.execPath,
        availability: osSchedulerAvailability({
            platform: process.platform,
            isPackaged: app.isPackaged,
            e2e: E2E,
            userDataOverride: Boolean(process.env.RCLONEGUI_USER_DATA),
            smokeOptIn: process.env.RCLONEGUI_OS_SCHEDULER_TEST === "1",
        }),
        logger,
        onStatus: (st) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_EVENTS.schedulerOsStatus, st);
            }
        },
    });
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
            // 생성·수정·삭제·복제·백엔드 변경 모두 이 한 경로로 등록·삭제한다(바뀐 것만)
            osScheduler.syncJobs(list);
        },
    });
    await jobs.load();
    const excludeStore = new clsExcludeStore({ db });
    excludeStore.load();
    const remoteStore = new clsRemoteStore({ db });
    remoteStore.load();
    // 지난번 비정상 종료로 남은 --exclude-from 임시 파일 정리
    const excludeFileDir = join(paths.userData, EXCLUDE_FILE_DIR);
    const leftover = await cleanupExcludeFiles(excludeFileDir);
    if (leftover > 0) logger.info(`남은 제외 패턴 파일 정리: ${leftover}개`);
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
    const remoteOps = new clsRemoteOps({ activity, jobs });
    const remoteService = new clsRemoteService({
        store: remoteStore,
        rcloneEnv,
        pathService,
        remoteOps,
    });
    const compare = new clsCompareService({
        jobs,
        settings,
        rcloneEnv,
        pathService,
        activity,
        excludes: excludeStore,
        excludeFileDir,
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
        excludes: excludeStore,
        excludeFileDir,
        features: remoteService,
        logger,
        emit: (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(IPC_EVENTS.runEvent, e);
            }
            if (e.type === "started" || e.type === "finished") scheduler?.emitState();
        },
    });
    const excludes = new clsExcludeService({
        store: excludeStore,
        jobs,
        compare,
        activity,
        logger,
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
    const osRuns = new clsOsRunQueue({
        jobs,
        settings,
        runs,
        checkPaths: (job) => precheckJobPaths(job, { pathService, settings }),
        notify: f_Notify,
        logger,
        onIdle: (code) => {
            void f_HeadlessExit(code ?? 2);
        },
    });

    // 헤드리스는 app.exit만 쓰므로 오지 않지만, 대화상자를 띄우지 않도록 막는다
    app.on("before-quit", (event) => {
        if (allowQuit || appMode === "headless") return;
        event.preventDefault();
        f_RequestQuit();
    });

    return {
        settings,
        jobs,
        history,
        compare,
        runs,
        scheduler,
        osScheduler,
        osRuns,
        rcloneEnv,
        remoteService,
        wsl,
        excludes,
    };
}

/**
 * GUI 시작(처음 GUI로 시작하거나 헤드리스에서 바뀔 때 한 번): resume·IPC·창·트레이·보관 정리·앱 스케줄러.
 */
async function f_StartGui(hidden: boolean): Promise<void> {
    if (guiStarted || !svc) return;
    guiStarted = true;
    const { settings, jobs, history, compare, runs, scheduler, osScheduler } = svc;
    const { rcloneEnv, remoteService, wsl, excludes } = svc;
    f_SyncLoginItem(settings.get().ui.launchAtLogin);

    powerMonitor.on("resume", () => {
        logger.info("절전에서 깨어남: 지난 자동 실행 예약 조정");
        void scheduler.onResume();
    });

    registerIpc({
        logger,
        isTrustedSender: f_IsTrustedSender,
        settings,
        jobs,
        paths,
        notices: () => [...notices],
        rcloneEnv,
        remoteService,
        wsl,
        compare,
        runs,
        history,
        scheduler,
        osScheduler,
        excludes,
        remotes: remoteService,
        getWindow: () => mainWindow,
    });

    f_OpenWindow(hidden && !E2E);
    if (E2E) {
        // 트레이가 없으므로 --hidden으로 시작해도 창을 보인다(E2E가 화면을 조작한다)
        if (hidden) f_ShowWindow();
    } else {
        try {
            tray = createTray({
                icon: trayIconPath,
                onShow: f_ShowWindow,
                onOpenLogs: () => {
                    void shell.openPath(paths.logs);
                },
                onTogglePause: (paused) => {
                    scheduler.setPaused(paused).catch((e: unknown) => {
                        logger.warn("일시정지 변경 실패", e);
                    });
                },
                onQuit: () => f_RequestQuit("tray"),
            });
        } catch (e) {
            logger.error("트레이 아이콘을 만들지 못함", e);
            tray = null;
            // 트레이가 없으면 숨긴 창을 다시 찾을 방법이 없으므로 보인다
            if (hidden) f_ShowWindow();
        }
    }

    await f_Retention().catch((e: unknown) => logger.warn("보관 정리 실패", e));
    retentionTimer = setInterval(() => {
        f_Retention().catch((e: unknown) => logger.warn("보관 정리 실패", e));
    }, RETENTION_INTERVAL_MS);
    await scheduler.start();
}

/** 서비스 준비 전에 온 second-instance 요청: 실행 요청을 도착 순서로 넣는다(창 요청은 f_Main이 마지막에 처리) */
function f_FlushPendingRuns(): void {
    const ids = pendingSecond.runJobs.splice(0);
    for (const id of ids) svc?.osRuns.enqueue(id);
}

async function f_Main(): Promise<void> {
    logger.info(
        `시작: v${app.getVersion()} electron ${process.versions.electron} node ${process.versions.node} mode=${appMode} hidden=${START_HIDDEN}`,
    );
    svc = await f_InitCore();
    const { jobs, osScheduler, osRuns } = svc;
    if (LAUNCH.runJob.kind === "ok" && appMode === "headless") {
        // 첫 항목 = 종료 코드 대상
        osRuns.enqueue(LAUNCH.runJob.jobId);
    }
    f_FlushPendingRuns();
    // GUI·헤드리스 모두(FR-10). 실행·대기 중인 작업은 다시 등록하지 않는다. 시작을 막지 않고 실패는 app.log에만
    void osScheduler.reconcile(jobs.list(), osRuns.activeJobIds());
    if (appMode === "gui") await f_StartGui(START_HIDDEN);
    if (pendingSecond.gui) {
        pendingSecond.gui = false;
        if (appMode === "headless") f_EnterGui();
        else f_ShowWindow();
    }
}

function f_StartFailed(e: unknown): void {
    logger.error("시작 실패", e);
    if (LAUNCH.runJob.kind === "ok") {
        // 헤드리스로 시작한 경우: 대화상자 없이 끝낸다(NFR-3)
        allowQuit = true;
        try {
            appDb?.close();
        } catch {
            // 닫지 못해도 끝낸다
        }
        appDb = null;
        app.exit(3);
        return;
    }
    f_ShowStartError(e);
    allowQuit = true;
    app.quit();
}

if (LAUNCH.runJob.kind === "invalid") {
    // 값은 남기지 않는다. 이력도 남기지 않는다(FR-13)
    logger.warn(`--run-job 인자 오류: reason=${LAUNCH.runJob.reason}`);
    app.exit(2);
} else {
    if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);
    const runJobData = LAUNCH.runJob.kind === "ok" ? { runJob: LAUNCH.runJob.jobId } : undefined;
    if (!app.requestSingleInstanceLock(runJobData)) {
        // 이미 실행 중: 요청을 넘겼으므로 성공(0)으로 끝난다
        if (runJobData) logger.info(`OS 예약 요청을 실행 중인 앱에 넘김: job=${runJobData.runJob}`);
        app.quit();
    } else {
        app.on("second-instance", (_e, _argv, _cwd, data) => f_OnSecondInstance(data));
        // 트레이 모드에서는 창이 없어도 끝내지 않는다. 종료는 f_RequestQuit 흐름으로만 한다
        app.on("window-all-closed", () => {
            if (allowQuit || !tray) f_RequestQuit();
        });
        app.whenReady().then(f_Main).catch(f_StartFailed);
    }
}
