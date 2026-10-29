/**
 * 앱 설정 스키마와 타입. settings.json 저장 형식과 IPC 입력 검증에 같이 쓴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { PATH_MAX_INPUT, PATH_MAX_STORED } from "@/shared/option-limits";
import { zExcludes, zJobRunOptions } from "@/shared/schemas/job";
import type { typDeepPartial } from "@/shared/schemas/common";

export const zThemeMode = z.enum(["system", "light", "dark"]);
export type typThemeMode = z.infer<typeof zThemeMode>;

export const zJobDefaults = zJobRunOptions.extend({ excludes: zExcludes });
export type typJobDefaults = z.infer<typeof zJobDefaults>;

export const zSettings = z.object({
    version: z.literal(1),
    rclonePath: z.string().trim().min(1).max(PATH_MAX_STORED).nullable(),
    configPath: z.string().trim().min(1).max(PATH_MAX_STORED).nullable(),
    defaults: zJobDefaults,
    compare: z.object({
        caseInsensitivePaths: z.boolean(),
    }),
    safety: z.object({
        deleteConfirmFiles: z.number().int().min(0).max(1_000_000),
        deleteConfirmPercent: z.number().min(0).max(100),
        autoMaxDeletes: z.number().int().min(0).max(1_000_000),
        compareMaxAgeMinutes: z.number().int().min(1).max(1440),
    }),
    scheduler: z.object({ paused: z.boolean() }),
    logs: z.object({
        retentionDays: z.number().int().min(1).max(365),
        historyLimit: z.number().int().min(100).max(5000),
    }),
    ui: z.object({
        theme: zThemeMode,
        minimizeToTray: z.boolean(),
        launchAtLogin: z.boolean(),
    }),
});
export type typSettings = z.infer<typeof zSettings>;

export type typSettingsPatch = typDeepPartial<Omit<typSettings, "version">>;

/** 새로 저장하는 경로 입력 한도(읽기는 PATH_MAX_STORED) */
export const zSettingsPathInput = z
    .string()
    .trim()
    .min(1)
    .max(PATH_MAX_INPUT, `경로는 ${PATH_MAX_INPUT}자 이내로 입력하세요.`)
    .nullable();

/**
 * 모양만 느슨하게 확인하는 patch 스키마. 값 범위는 병합 후 zSettings로 다시 검사한다.
 * 경로는 새 입력 한도(PATH_MAX_INPUT)로 막는다. 알 수 없는 키는 거부한다.
 */
export const zSettingsPatch = z
    .object({
        rclonePath: zSettingsPathInput,
        configPath: zSettingsPathInput,
        defaults: zJobDefaults.partial().strict(),
        compare: zSettings.shape.compare.partial().strict(),
        safety: zSettings.shape.safety.partial().strict(),
        scheduler: zSettings.shape.scheduler.partial().strict(),
        logs: zSettings.shape.logs.partial().strict(),
        ui: zSettings.shape.ui.partial().strict(),
    })
    .partial()
    .strict();
