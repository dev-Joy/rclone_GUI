/**
 * rclone 환경 상태 (zustand): 감지 결과, remote 목록, WSL 배포판 목록.
 * rclone.exe·rclone.conf 지정은 설정(settings:update)을 바꾼 뒤 다시 감지한다.
 * 작업별 rclone.conf(configPathOverride)의 remote 목록은 경로별로 캐시한다(remotesByConfig).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import type { itfRcloneEnvironment } from "@/shared/ipc-contract";
import { createLatestGate, type itfLatestGate } from "@/shared/latest-request";
import type { typSettingsPatch } from "@/shared/schemas/settings";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";

/** 한 rclone.conf의 remote 목록 */
export interface itfRemoteList {
    /** null = 아직 불러오지 않음 또는 실패 */
    remotes: string[] | null;
    loading: boolean;
    error: string | null;
}

interface itfRcloneEnvState {
    env: itfRcloneEnvironment | null;
    detecting: boolean;
    /** envelope 실패(INTERNAL 등)만. 감지 실패는 env.problem */
    error: string | null;
    distros: string[] | null;
    wslError: string | null;
    /** key = 작업에 지정한 rclone.conf 경로 원문 */
    remotesByConfig: Record<string, itfRemoteList>;
    detect: (force?: boolean) => Promise<void>;
    loadDistros: () => Promise<void>;
    /** configPath가 null이면 감지 결과(env.remotes)를 쓰므로 IPC를 부르지 않는다. 경로별로 마지막 요청만 반영 */
    loadRemotes: (configPath: string | null, force?: boolean) => Promise<void>;
    /** rclone.exe를 고르고 다시 감지. 취소하면 아무것도 하지 않는다 */
    pickRclone: () => Promise<void>;
    /** rclone.conf를 고르고 다시 감지 */
    pickConfig: () => Promise<void>;
    /** 수동 지정을 지우고 자동 감지 */
    resetToAuto: (target: "rclonePath" | "configPath") => Promise<void>;
}

/** 기본 설정(null)은 감지 결과, 작업별 설정 파일은 remotesByConfig 캐시 */
export function selectRemotesFor(
    s: Pick<itfRcloneEnvState, "env" | "detecting" | "error" | "remotesByConfig">,
    configPath: string | null,
): itfRemoteList {
    if (configPath === null) {
        return {
            remotes: s.env?.remotes ?? null,
            loading: s.detecting,
            error: s.env?.problem?.message ?? s.error,
        };
    }
    return s.remotesByConfig[configPath] ?? { remotes: null, loading: false, error: null };
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
    /** remote 목록 요청: 설정 파일 경로별 */
    const remoteGates = new Map<string, itfLatestGate>();

    function f_SetRemotes(configPath: string, value: itfRemoteList): void {
        set((s) => ({ remotesByConfig: { ...s.remotesByConfig, [configPath]: value } }));
    }

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
        remotesByConfig: {},
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
        loadRemotes: async (configPath, force = false) => {
            if (configPath === null) return;
            const cur = get().remotesByConfig[configPath];
            if (cur && !force && (cur.loading || cur.remotes !== null)) return;
            let gate = remoteGates.get(configPath);
            if (!gate) {
                gate = createLatestGate();
                remoteGates.set(configPath, gate);
            }
            const isLatest = gate.next();
            f_SetRemotes(configPath, { remotes: cur?.remotes ?? null, loading: true, error: null });
            try {
                const remotes = await unwrap(getApi().rclone.listRemotes(configPath));
                if (isLatest()) f_SetRemotes(configPath, { remotes, loading: false, error: null });
            } catch (e) {
                if (isLatest()) {
                    f_SetRemotes(configPath, {
                        remotes: null,
                        loading: false,
                        error: errorText(e),
                    });
                }
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
