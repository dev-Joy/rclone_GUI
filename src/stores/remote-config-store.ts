/**
 * remote 설정 화면 상태(zustand): providers 정의, OAuth 진행 상태, 추가·수정·삭제 호출 (INT-006 T-03~T-05).
 * 비밀 값은 상태에 오래 두지 않는다(입력 폼이 제출할 때만 넘긴다).
 * OAuth 진행 이벤트는 패널이 구독을 시작하면 store에 반영한다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { errorText, getApi } from "@/lib/api";
import type { typApiResult } from "@/shared/schemas/common";
import type {
    typRemoteConfigCreateInput,
    typRemoteConfigDeleteInput,
    typRemoteConfigUpdateInput,
} from "@/shared/schemas/remote-config";
import type {
    itfRemoteAuthAnswerResult,
    itfRemoteAuthProgress,
    itfRemoteConfigView,
    itfRemoteDeleteResult,
    itfRemoteProvider,
    itfRemoteUsage,
} from "@/shared/types/remote-config";

interface itfRemoteConfigState {
    providers: itfRemoteProvider[] | null;
    providersLoading: boolean;
    providersError: string | null;
    /** 진행 중인 OAuth 상태(없으면 null) */
    auth: itfRemoteAuthProgress | null;
    /** 진행 이벤트 구독을 시작했는지 */
    subscribed: boolean;
    loadProviders: (force?: boolean) => Promise<void>;
    get: (name: string) => Promise<typApiResult<itfRemoteConfigView>>;
    usage: (name: string) => Promise<typApiResult<itfRemoteUsage>>;
    create: (
        input: typRemoteConfigCreateInput,
        oauth: boolean,
    ) => Promise<typApiResult<{ name: string; oauth: boolean }>>;
    update: (
        input: typRemoteConfigUpdateInput,
    ) => Promise<typApiResult<{ name: string; reauthSuggested: boolean }>>;
    remove: (input: typRemoteConfigDeleteInput) => Promise<typApiResult<itfRemoteDeleteResult>>;
    reconnect: (name: string) => Promise<typApiResult<{ name: string }>>;
    answer: (state: string, result: string) => Promise<itfRemoteAuthAnswerResult | null>;
    cancelAuth: () => Promise<void>;
    clearAuth: () => void;
    subscribe: () => () => void;
}

export const useRemoteConfigStore = create<itfRemoteConfigState>((set, get) => ({
    providers: null,
    providersLoading: false,
    providersError: null,
    auth: null,
    subscribed: false,
    loadProviders: async (force = false) => {
        if (!force && (get().providers !== null || get().providersLoading)) return;
        set({ providersLoading: true, providersError: null });
        try {
            const r = await getApi().remoteConfig.providers();
            if (r.ok) set({ providers: r.data, providersLoading: false });
            else set({ providersError: r.error.message, providersLoading: false });
        } catch (e) {
            set({ providersError: errorText(e), providersLoading: false });
        }
    },
    get: (name) => getApi().remoteConfig.get({ name }),
    usage: (name) => getApi().remoteConfig.usage({ name }),
    create: async (input, oauth) => {
        if (oauth) set({ auth: { phase: "starting", name: input.name } });
        const r = await getApi().remoteConfig.create(input);
        if (!r.ok) {
            if (oauth && r.error.code !== "CANCELED") {
                set({ auth: { phase: "failed", name: input.name, message: r.error.message } });
            }
            return r;
        }
        if (!r.data.oauth) set({ auth: null });
        return r;
    },
    update: (input) => getApi().remoteConfig.update(input),
    remove: (input) => getApi().remoteConfig.remove(input),
    reconnect: async (name) => {
        set({ auth: { phase: "starting", name } });
        const r = await getApi().remoteConfig.reconnect({ name });
        if (!r.ok && r.error.code !== "CANCELED") {
            set({ auth: { phase: "failed", name, message: r.error.message } });
        }
        return r;
    },
    answer: async (state, result) => {
        try {
            const r = await getApi().remoteConfig.answer({ state, result });
            if (!r.ok) {
                set((s) => ({
                    auth: s.auth ? { ...s.auth, phase: "failed", message: r.error.message } : null,
                }));
                return null;
            }
            set((s) => ({
                auth: s.auth
                    ? {
                          ...s.auth,
                          phase: r.data.phase,
                          ...(r.data.question ? { question: r.data.question } : {}),
                          ...(r.data.message ? { message: r.data.message } : {}),
                      }
                    : null,
            }));
            return r.data;
        } catch (e) {
            set((s) => ({
                auth: s.auth ? { ...s.auth, phase: "failed", message: errorText(e) } : null,
            }));
            return null;
        }
    },
    cancelAuth: async () => {
        try {
            await getApi().remoteConfig.cancelAuth();
        } catch {
            // 취소 실패는 화면 상태만 정리한다
        }
        set((s) => ({
            auth: s.auth ? { ...s.auth, phase: "canceled" } : null,
        }));
    },
    clearAuth: () => set({ auth: null }),
    subscribe: () => {
        if (get().subscribed) return () => undefined;
        set({ subscribed: true });
        const off = getApi().events.onRemoteConfigAuthProgress((e) => {
            set({ auth: e });
        });
        return () => {
            off();
            set({ subscribed: false });
        };
    },
}));
