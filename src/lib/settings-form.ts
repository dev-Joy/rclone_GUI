/**
 * 설정 화면 폼의 순수 로직: 범위 검증과 한국어 문구, 화면에 노출된 섹션만 patch로 만들기, 변경 여부 비교.
 * DOM·window 의존 없음.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import {
    excludesIssueText,
    numberIssueText,
    stableStringify,
    type itfNumberRange,
} from "@/lib/form-utils";
import {
    zSettings,
    zSettingsPathInput,
    type typSettings,
    type typSettingsPatch,
} from "@/shared/schemas/settings";

export type typSettingsFormField =
    | "rclonePath"
    | "configPath"
    | "defaults.excludes"
    | "defaults.checkers"
    | "defaults.transfers"
    | "defaults.modtimeToleranceMs"
    | "safety.deleteConfirmFiles"
    | "safety.deleteConfirmPercent"
    | "safety.autoMaxDeletes"
    | "safety.compareMaxAgeMinutes"
    | "logs.retentionDays"
    | "logs.historyLimit";

export interface itfSettingsFormCheck {
    fieldErrors: Partial<Record<typSettingsFormField, string>>;
    ok: boolean;
}

export const SETTINGS_NUMBER_RANGES = {
    "defaults.checkers": { min: 1, max: 64, int: true },
    "defaults.transfers": { min: 1, max: 32, int: true },
    "defaults.modtimeToleranceMs": { min: 0, max: 600_000, int: true },
    "safety.deleteConfirmFiles": { min: 0, max: 1_000_000, int: true },
    "safety.deleteConfirmPercent": { min: 0, max: 100, int: false },
    "safety.autoMaxDeletes": { min: 0, max: 1_000_000, int: true },
    "safety.compareMaxAgeMinutes": { min: 1, max: 1440, int: true },
    "logs.retentionDays": { min: 1, max: 365, int: true },
    "logs.historyLimit": { min: 100, max: 5000, int: true },
} as const satisfies Record<string, itfNumberRange>;

type typNumberField = keyof typeof SETTINGS_NUMBER_RANGES;

export function validateSettingsDraft(s: typSettings): itfSettingsFormCheck {
    const fieldErrors: itfSettingsFormCheck["fieldErrors"] = {};
    const parsed = zSettings.safeParse(s);
    if (!parsed.success) {
        for (const issue of parsed.error.issues) {
            const [head, sub, ...rest] = issue.path;
            const key = `${String(head)}.${String(sub)}`;
            let field: typSettingsFormField | null = null;
            let text = "";
            if (key === "defaults.excludes") {
                field = key;
                text = excludesIssueText(issue, rest);
            } else if (key in SETTINGS_NUMBER_RANGES) {
                field = key as typNumberField;
                const group = s[head as keyof typSettings] as unknown as Record<string, unknown>;
                text = numberIssueText(group[String(sub)], SETTINGS_NUMBER_RANGES[field]);
            }
            if (field && fieldErrors[field] === undefined) fieldErrors[field] = text;
        }
    }
    // 읽기 한도(4096)는 넘지 않아도 새로 저장하는 경로는 입력 한도로 막는다
    for (const key of ["rclonePath", "configPath"] as const) {
        const r = zSettingsPathInput.safeParse(s[key]);
        if (!r.success && fieldErrors[key] === undefined) {
            fieldErrors[key] = r.error.issues[0]?.message ?? "경로를 확인하세요.";
        }
    }
    return { fieldErrors, ok: Object.keys(fieldErrors).length === 0 && parsed.success };
}

/**
 * 화면에 노출된 섹션만 patch로 (defaults, compare, safety, logs, ui).
 * scheduler(일시정지)는 넣지 않는다: settings:update가 거부하며 scheduler:setPaused로만 바꾼다.
 */
export function settingsToPatch(s: typSettings): typSettingsPatch {
    return {
        defaults: { ...s.defaults, excludes: [...s.defaults.excludes] },
        compare: { ...s.compare },
        safety: { ...s.safety },
        logs: { ...s.logs },
        ui: {
            theme: s.ui.theme,
            minimizeToTray: s.ui.minimizeToTray,
            launchAtLogin: s.ui.launchAtLogin,
        },
    };
}

export function isSettingsEqual(a: typSettings, b: typSettings): boolean {
    return stableStringify(settingsToPatch(a)) === stableStringify(settingsToPatch(b));
}
