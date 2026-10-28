/**
 * 설정·Job 기본값 (MVP_SPEC §5.6).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typJobDraft } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";

export const DEFAULT_EXCLUDES: readonly string[] = [
    "node_modules/**",
    "_session/**",
    "_gsdata_/**",
    ".codegraph/daemon.sock",
];

export function createDefaultSettings(): typSettings {
    return {
        version: 1,
        rclonePath: null,
        configPath: null,
        defaults: {
            excludes: [...DEFAULT_EXCLUDES],
            checkers: 8,
            transfers: 4,
            fastList: true,
            skipLinks: true,
            ignoreErrors: false,
            checkHashes: false,
            modtimeToleranceMs: 2000,
            preflightBeforeDestructive: true,
        },
        compare: { caseInsensitivePaths: true },
        safety: {
            deleteConfirmFiles: 50,
            deleteConfirmPercent: 10,
            autoMaxDeletes: 50,
            compareMaxAgeMinutes: 10,
        },
        scheduler: { paused: false },
        logs: { retentionDays: 30, historyLimit: 500 },
        ui: { theme: "system", minimizeToTray: true, launchAtLogin: false },
    };
}

/** 설정의 기본 옵션으로 빈 Job 초안을 만든다. 화면의 "새 작업"에서 쓴다. */
export function createJobDraft(settings: typSettings): typJobDraft {
    const { excludes, ...options } = settings.defaults;
    return {
        name: "",
        notes: "",
        source: "",
        destination: "",
        mode: "copy",
        excludes: [...excludes],
        options: { ...options },
        configPathOverride: null,
        autoSync: { enabled: false, intervalMinutes: 60, allowDeletes: false },
    };
}
