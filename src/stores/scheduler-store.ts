/**
 * 스케줄러 상태 (zustand): 일시정지 여부, 진행 중 실행, 다음 자동 실행. main의 scheduler:state 이벤트로 갱신한다.
 * 일시정지는 scheduler:setPaused로만 바꾼다(settings:update는 거부됨).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { getApi, unwrap } from "@/lib/api";
import type { itfSchedulerState } from "@/shared/types/scheduler";
import { useToastStore } from "@/stores/toast-store";

interface itfSchedulerStoreState {
    state: itfSchedulerState | null;
    /** setPaused 응답 대기 중 */
    pending: boolean;
    setPaused: (paused: boolean) => Promise<void>;
    /** scheduler:state 구독 + getState 1회. 해제 함수를 돌려준다 */
    subscribe: () => () => void;
}

export const useSchedulerStore = create<itfSchedulerStoreState>((set, get) => ({
    state: null,
    pending: false,
    setPaused: async (paused) => {
        if (get().pending) return;
        set({ pending: true });
        try {
            set({ state: await unwrap(getApi().scheduler.setPaused(paused)) });
            useToastStore
                .getState()
                .push(
                    "info",
                    paused
                        ? "자동 실행을 일시정지했습니다. 진행 중인 실행은 계속됩니다."
                        : "자동 실행을 다시 시작합니다. 지난 예약은 30초 뒤에 실행합니다.",
                );
        } catch {
            useToastStore.getState().push("error", "자동 실행 일시정지를 바꾸지 못했습니다.");
        } finally {
            set({ pending: false });
        }
    },
    subscribe: () => {
        const api = getApi();
        const off = api.events.onSchedulerState((state) => set({ state }));
        unwrap(api.scheduler.getState())
            .then((state) => (get().state === null ? set({ state }) : undefined))
            .catch(() => undefined);
        return off;
    },
}));
