/**
 * 알림 영역(트레이) 아이콘 (MVP_SPEC §13, intent T-14). 메뉴: 열기 / 로그 폴더 열기 / 자동 실행 일시정지 / 종료.
 * 툴팁에는 실행 중 여부, 일시정지, 다음 자동 실행 시각(작업 이름)만 쓴다(경로 없음).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { Menu, nativeImage, Tray } from "electron";

// ========== Internal imports ==========
import type { itfSchedulerState } from "@/shared/types/scheduler";

export interface itfTrayOptions {
    /** 아이콘 PNG 경로 */
    icon: string;
    onShow: () => void;
    onOpenLogs: () => void;
    onTogglePause: (paused: boolean) => void;
    onQuit: () => void;
}

export interface itfAppTray {
    update: (state: itfSchedulerState) => void;
    destroy: () => void;
}

const APP_TITLE = "rcloneGUI";

function f_Pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/** 툴팁 문구. 예: "rcloneGUI — 다음 자동 실행 14:30 ‘백업’" */
export function trayTooltip(state: itfSchedulerState): string {
    if (state.running) {
        const what = state.running.trigger === "scheduler" ? "자동 실행 중" : "실행 중";
        return `${APP_TITLE} — ${what} ‘${state.running.jobName}’`;
    }
    if (state.paused) return `${APP_TITLE} — 자동 실행 일시정지됨`;
    if (state.next) {
        const d = new Date(state.next.at);
        const time = Number.isNaN(d.getTime())
            ? "-"
            : `${f_Pad2(d.getHours())}:${f_Pad2(d.getMinutes())}`;
        return `${APP_TITLE} — 다음 자동 실행 ${time} ‘${state.next.jobName}’`;
    }
    return APP_TITLE;
}

export function createTray(o: itfTrayOptions): itfAppTray {
    const tray = new Tray(nativeImage.createFromPath(o.icon));
    let paused = false;
    const f_Menu = () =>
        Menu.buildFromTemplate([
            { label: "열기", click: o.onShow },
            { label: "로그 폴더 열기", click: o.onOpenLogs },
            {
                label: "자동 실행 일시정지",
                type: "checkbox",
                checked: paused,
                click: (item) => o.onTogglePause(item.checked),
            },
            { type: "separator" },
            { label: "종료", click: o.onQuit },
        ]);
    tray.setToolTip(APP_TITLE);
    tray.setContextMenu(f_Menu());
    tray.on("click", o.onShow);
    return {
        update: (state) => {
            if (tray.isDestroyed()) return;
            tray.setToolTip(trayTooltip(state));
            if (state.paused !== paused) {
                paused = state.paused;
                tray.setContextMenu(f_Menu());
            }
        },
        destroy: () => {
            if (!tray.isDestroyed()) tray.destroy();
        },
    };
}
