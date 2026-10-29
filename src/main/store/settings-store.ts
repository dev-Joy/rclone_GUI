/**
 * 앱 설정 저장소 (settings.json). patch를 병합한 최종 값을 검증한 뒤에만 저장한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { join } from "node:path";

// ========== Internal imports ==========
import { clsJsonStore } from "@/main/store/json-store";
import { createDefaultSettings } from "@/shared/defaults";
import type { itfAppNotice } from "@/shared/ipc-contract";
import {
    zSettings,
    zSettingsPatch,
    type typSettings,
    type typSettingsPatch,
} from "@/shared/schemas/settings";

function f_IsPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 객체는 재귀 병합, 배열·원시값은 통째로 교체. undefined는 무시 */
export function deepMerge<T>(base: T, patch: unknown): T {
    if (!f_IsPlainObject(base) || !f_IsPlainObject(patch))
        return (patch === undefined ? base : patch) as T;
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        out[key] =
            f_IsPlainObject(value) && f_IsPlainObject(out[key])
                ? deepMerge(out[key], value)
                : value;
    }
    return out as T;
}

export class clsSettingsStore {
    private readonly store: clsJsonStore<typSettings>;
    private readonly onChange: ((s: typSettings, prev: typSettings) => void) | undefined;

    /** onChange: 저장에 성공한 뒤 새 값·이전 값으로 부른다(트레이·테마·로그인 항목 반영) */
    constructor(
        userDataDir: string,
        onNotice?: (n: itfAppNotice) => void,
        onChange?: (s: typSettings, prev: typSettings) => void,
    ) {
        this.onChange = onChange;
        this.store = new clsJsonStore({
            file: join(userDataDir, "settings.json"),
            label: "설정",
            schema: zSettings,
            createDefault: createDefaultSettings,
            // 새 버전에서 추가된 설정 항목은 기본값으로 채운다
            prepare: (data) => deepMerge(createDefaultSettings(), data),
            ...(onNotice ? { onNotice } : {}),
        });
    }

    load(): Promise<typSettings> {
        return this.store.load();
    }

    get(): typSettings {
        return this.store.get();
    }

    async update(patch: typSettingsPatch): Promise<typSettings> {
        const checked = zSettingsPatch.parse(patch);
        const prev = this.store.get();
        const next = await this.store.update((current) => deepMerge(current, checked));
        if (this.onChange) {
            try {
                this.onChange(next, prev);
            } catch {
                // 반영 실패로 저장 결과를 바꾸지 않는다
            }
        }
        return next;
    }
}
