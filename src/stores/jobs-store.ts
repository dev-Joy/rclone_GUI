/**
 * 작업(Job) 목록 상태 (zustand). main이 보내는 jobs:changed 이벤트로도 갱신된다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import type { typJob } from "@/shared/schemas/job";

interface itfJobsState {
    jobs: typJob[];
    selectedJobId: string | null;
    loading: boolean;
    error: string | null;
    load: () => Promise<void>;
    select: (id: string | null) => void;
    /** main 이벤트 구독. 해제 함수를 돌려준다 */
    subscribe: () => () => void;
}

export const useJobsStore = create<itfJobsState>((set) => ({
    jobs: [],
    selectedJobId: null,
    loading: false,
    error: null,
    load: async () => {
        set({ loading: true });
        try {
            set({ jobs: await unwrap(getApi().jobs.list()), error: null, loading: false });
        } catch (e) {
            set({ error: errorText(e), loading: false });
        }
    },
    select: (id) => set({ selectedJobId: id }),
    subscribe: () => getApi().events.onJobsChanged(({ jobs }) => set({ jobs })),
}));
