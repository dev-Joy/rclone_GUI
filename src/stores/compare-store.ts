/**
 * 비교 화면 상태 (zustand). 결과는 화면에 보이는 작업 1개만 보관한다(큰 결과 × 여러 작업 메모리 방지).
 * main 캐시가 작업별 결과를 갖고 있으므로 작업을 바꾸면 compare:get으로 다시 받는다(마지막 요청만 반영).
 * compare:progress 이벤트로 앱 전역 진행 중 비교(active)를 갱신하고, 화면을 다시 열면 getActive로 복구한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { getApi, unwrap } from "@/lib/api";
import { DEFAULT_COMPARE_VIEW, type itfCompareViewState } from "@/lib/compare-view";
import { ERROR_MESSAGES } from "@/shared/errors";
import { createLatestGate } from "@/shared/latest-request";
import type { typApiResult, typAppErrorPayload } from "@/shared/schemas/common";
import type { itfCompareActive, itfCompareResult } from "@/shared/types/compare";
import { useToastStore } from "@/stores/toast-store";

interface itfCompareState {
    /** 화면에 보이는 작업 */
    jobId: string | null;
    result: itfCompareResult | null;
    /** compare:get 중 */
    loading: boolean;
    /** 앱 전역 진행 중 비교(어느 작업이든) */
    active: itfCompareActive | null;
    /** 이 창이 compare:run 응답을 기다리는 작업 */
    runningJobId: string | null;
    /** 현재 작업의 마지막 비교 실패 */
    error: typAppErrorPayload | null;
    view: itfCompareViewState;
    /** 작업 전환: 결과를 비우고 compare:get (검색어만 비우고 필터는 유지) */
    show: (jobId: string | null) => Promise<void>;
    /** compare:run. 실패는 error + 토스트(취소는 안내 토스트) */
    run: (jobId: string) => Promise<void>;
    /** 진행 중인 비교 취소 */
    cancel: () => Promise<void>;
    setView: (patch: Partial<itfCompareViewState>) => void;
    /** compare:progress 구독 + getActive 1회. 해제 함수를 돌려준다 */
    subscribe: () => () => void;
}

const gate = createLatestGate();

/** IPC 자체가 실패(창 종료 등)해도 envelope로 돌려준다 */
function f_Call<T>(pending: Promise<typApiResult<T>>): Promise<typApiResult<T>> {
    return pending.catch((): typApiResult<T> => ({
        ok: false,
        error: { code: "INTERNAL", message: ERROR_MESSAGES.INTERNAL },
    }));
}

/**
 * 진행 중인 비교. 이벤트가 오기 전이라도 이 창이 run을 기다리면 그 작업으로 본다.
 * 새 객체를 만들 수 있으므로 zustand 선택자로 쓰지 말고, active·runningJobId를 따로 골라 넘긴다.
 */
export function runningCompare(
    active: itfCompareActive | null,
    runningJobId: string | null,
): itfCompareActive | null {
    if (active) return active;
    if (runningJobId === null) return null;
    return { jobId: runningJobId, phase: "check", startedAt: "", sourceFiles: 0, destFiles: 0 };
}

export const useCompareStore = create<itfCompareState>((set, get) => ({
    jobId: null,
    result: null,
    loading: false,
    active: null,
    runningJobId: null,
    error: null,
    view: DEFAULT_COMPARE_VIEW,
    show: async (jobId) => {
        const isLatest = gate.next();
        const cur = get();
        set({
            jobId,
            result: null,
            error: cur.jobId === jobId ? cur.error : null,
            loading: jobId !== null,
            view: cur.jobId === jobId ? cur.view : { ...cur.view, query: "" },
        });
        if (jobId === null) return;
        const r = await f_Call(getApi().compare.get(jobId));
        if (!isLatest()) return;
        set({ loading: false, result: r.ok ? r.data : null });
        if (!r.ok) useToastStore.getState().push("error", r.error.message);
    },
    run: async (jobId) => {
        set((s) => ({ runningJobId: jobId, error: s.jobId === jobId ? null : s.error }));
        const r = await f_Call(getApi().compare.run(jobId));
        set({ runningJobId: null });
        const isCurrent = get().jobId === jobId;
        if (r.ok) {
            if (isCurrent) {
                // 진행 중이던 compare:get(이전 결과)이 새 결과를 덮지 않게 한다
                gate.invalidate();
                set({ result: r.data, error: null, loading: false });
            }
            return;
        }
        const toast = useToastStore.getState().push;
        if (r.error.code === "BUSY") {
            toast("warning", r.error.message);
            return;
        }
        if (isCurrent) set({ result: null, error: r.error });
        if (r.error.code === "CANCELED") toast("info", "비교를 취소했습니다.");
        else toast("error", r.error.message);
    },
    cancel: async () => {
        const jobId = get().active?.jobId ?? get().runningJobId;
        if (jobId === null) return;
        await f_Call(getApi().compare.cancel(jobId));
    },
    setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
    subscribe: () => {
        const api = getApi();
        const off = api.events.onCompareProgress((e) => {
            const s = get();
            if (e.phase === "done" || e.phase === "failed" || e.phase === "canceled") {
                set({ active: null });
                // 이 창이 run을 기다리지 않는 경우(화면을 다시 연 뒤 등)만 결과를 다시 받는다
                if (s.jobId === e.jobId && s.runningJobId !== e.jobId) {
                    if (e.phase === "done") void get().show(e.jobId);
                    else set({ result: null });
                }
                return;
            }
            set({
                active: {
                    jobId: e.jobId,
                    phase: e.phase,
                    startedAt: s.active?.jobId === e.jobId ? s.active.startedAt : e.at,
                    sourceFiles: e.sourceFiles,
                    destFiles: e.destFiles,
                },
            });
        });
        unwrap(api.compare.getActive())
            .then((active) => (get().active === null ? set({ active }) : undefined))
            .catch(() => undefined);
        return off;
    },
}));
