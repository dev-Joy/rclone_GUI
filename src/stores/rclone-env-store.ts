/**
 * rclone 환경 상태 (zustand): 감지 결과, remote 목록, WSL 배포판 목록.
 * rclone.exe·rclone.conf 지정은 설정(settings:update)을 바꾼 뒤 다시 감지한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import type { itfRcloneEnvironment } from "@/shared/ipc-contract";
import { createLatestGate } from "@/shared/latest-request";
import type { typSettingsPatch } from "@/shared/schemas/settings";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";

interface itfRcloneEnvState {
    env: itfRcloneEnvironment | null;
    detecting: boolean;
    /** envelope 실패(INTERNAL 등)만. 감지 실패는 env.problem */
    error: string | null;
    distros: string[] | null;
    wslError: string | null;
    detect: (force?: boolean) => Promise<void>;
    loadDistros: () => Promise<void>;
    /** rclone.exe를 고르고 다시 감지. 취소하면 아무것도 하지 않는다 */
    pickRclone: () => Promise<void>;
    /** rclone.conf를 고르고 다시 감지 */
    pickConfig: () => Promise<void>;
    /** 수동 지정을 지우고 자동 감지 */
    resetToAuto: (target: "rclonePath" | "configPath") => Promise<void>;
}

function f_Toast(e: unknown): void {
    useToastStore.getState().push("error", errorText(e));
}

function f_PickFile(title: string, name: string, extensions: string[]) {
    return unwrap(getApi().dialog.pickFile({ title, filters: [{ name, extensions }] }));
}

export const useRcloneEnvStore = create<itfRcloneEnvState>((set, get) => {
    /** 마지막 detect 요청의 결과만 반영한다(늦게 온 이전 응답이 덮지 않게) */
    const detectGate = createLatestGate();

    /** 설정을 바꾸고 성공하면 다시 감지한다 */
    async function f_UpdateAndDetect(patch: typSettingsPatch): Promise<void> {
        const saved = await useSettingsStore.getState().update(patch);
        if (!saved) {
            useToastStore
                .getState()
                .push("error", useSettingsStore.getState().error ?? "설정을 저장하지 못했습니다.");
            return;
        }
        await get().detect(true);
    }

    return {
        env: null,
        detecting: false,
        error: null,
        distros: null,
        wslError: null,
        detect: async (force = false) => {
            const isLatest = detectGate.next();
            set({ detecting: true });
            try {
                const env = await unwrap(getApi().rclone.detect(force));
                if (isLatest()) set({ env, error: null });
            } catch (e) {
                if (isLatest()) set({ error: errorText(e) });
            } finally {
                if (isLatest()) set({ detecting: false });
            }
        },
        loadDistros: async () => {
            try {
                const r = await unwrap(getApi().wsl.listDistros());
                set({ distros: r.distros, wslError: null });
            } catch (e) {
                set({ distros: null, wslError: errorText(e) });
            }
        },
        pickRclone: async () => {
            try {
                const path = await f_PickFile("rclone.exe 고르기", "rclone", ["exe"]);
                if (path) await f_UpdateAndDetect({ rclonePath: path });
            } catch (e) {
                f_Toast(e);
            }
        },
        pickConfig: async () => {
            try {
                const path = await f_PickFile("rclone.conf 고르기", "rclone 설정", ["conf", "*"]);
                if (path) await f_UpdateAndDetect({ configPath: path });
            } catch (e) {
                f_Toast(e);
            }
        },
        resetToAuto: async (target) => {
            await f_UpdateAndDetect(
                target === "rclonePath" ? { rclonePath: null } : { configPath: null },
            );
        },
    };
});
