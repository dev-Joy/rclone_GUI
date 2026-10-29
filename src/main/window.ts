/**
 * 메인 창 생성과 보안 설정.
 * contextIsolation·sandbox를 켜고 nodeIntegration·webview를 끈다. 새 창·외부 탐색은 막는다.
 * hidden이면(로그인 시 시작 `--hidden`) 준비돼도 보이지 않고 트레이에만 있는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { join } from "node:path";
import { BrowserWindow, shell } from "electron";

const DEV_URL = process.env.ELECTRON_RENDERER_URL;

export interface itfMainWindowOptions {
    /** 준비돼도 창을 보이지 않는다 */
    hidden?: boolean;
}

export function createMainWindow(opts: itfMainWindowOptions = {}): BrowserWindow {
    const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 960,
        minHeight: 640,
        show: false,
        title: "rcloneGUI",
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webviewTag: false,
            spellcheck: false,
        },
    });

    if (!opts.hidden) win.once("ready-to-show", () => win.show());

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://")) void shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
        if (!isAppUrl(url)) event.preventDefault();
    });

    if (DEV_URL) {
        void win.loadURL(DEV_URL);
    } else {
        void win.loadFile(join(__dirname, "../renderer/index.html"));
    }
    return win;
}

/** 앱 자신의 화면 주소인지 */
export function isAppUrl(url: string): boolean {
    if (DEV_URL) return url.startsWith(DEV_URL);
    return url.startsWith("file://") && url.includes("/renderer/index.html");
}
