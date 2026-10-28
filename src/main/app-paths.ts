/**
 * userData/logs 경로 결정. app.getPath("userData") 전에 앱 이름을 rcloneGUI로 고정하고,
 * 테스트·E2E는 RCLONEGUI_USER_DATA 로 임시 폴더를 쓸 수 있다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { app } from "electron";

export const APP_NAME = "rcloneGUI";

export interface itfAppPaths {
    userData: string;
    logs: string;
}

export function setupAppPaths(): itfAppPaths {
    app.setName(APP_NAME);
    const override = process.env.RCLONEGUI_USER_DATA;
    if (override && isAbsolute(override)) app.setPath("userData", override);
    const userData = app.getPath("userData");
    const logs = join(userData, "logs");
    mkdirSync(logs, { recursive: true });
    return { userData, logs };
}
