/**
 * 앱 설정 상태 (zustand). main의 settings:get / settings:update 결과를 그대로 보관한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import type { typSettings, typSettingsPatch } from "@/shared/schemas/settings";

interface itfSettingsState {
    settings: typSettings | null;
    error: string | null;
    load: () => Promise<void>;
    update: (patch: typSettingsPatch) => Promise<boolean>;
}

export const useSettingsStore = create<itfSettingsState>((set) => ({
    settings: null,
    error: null,
    load: async () => {
        try {
            set({ settings: await unwrap(getApi().settings.get()), error: null });
        } catch (e) {
            set({ error: errorText(e) });
        }
    },
    update: async (patch) => {
        try {
            set({ settings: await unwrap(getApi().settings.update(patch)), error: null });
            return true;
        } catch (e) {
            set({ error: errorText(e) });
            return false;
        }
    },
}));
