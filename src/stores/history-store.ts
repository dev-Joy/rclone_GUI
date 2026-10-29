/**
 * 이력 화면 상태 (zustand). 화면에 보이는 작업 1개의 이력(최신순)과 필터·선택한 실행·로그 끝부분을 둔다.
 * 실행이 끝나면(run:event finished) 그 작업의 이력을 다시 받는다. 마지막 요청만 반영한다.
 * 이력 비우기는 main이 실행 중이면 BUSY로 막는다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { getApi } from "@/lib/api";
import { DEFAULT_HISTORY_FILTER, type itfHistoryFilter } from "@/lib/history-view";
import { ERROR_MESSAGES } from "@/shared/errors";
import { createLatestGate } from "@/shared/latest-request";
import type { typApiResult } from "@/shared/schemas/common";
import type { typRunRecord } from "@/shared/schemas/run";
import type { itfRunLogView } from "@/shared/types/history";
import { useToastStore } from "@/stores/toast-store";

/** 한 번에 받는 이력 수(설정의 최대 보관 수와 같음) */
export const HISTORY_FETCH_LIMIT = 5000;

interface itfHistoryState {
    /** 화면에 보이는 작업. null이면 모든 작업 */
    jobId: string | null;
    records: typRunRecord[];
    loading: boolean;
    error: string | null;
    filter: itfHistoryFilter;
    /** 상세를 연 실행 */
    selectedId: string | null;
    log: itfRunLogView | null;
    logLoading: boolean;
    logError: string | null;
    /** 작업 전환·다시 불러오기 */
    load: (jobId: string | null) => Promise<void>;
    setFilter: (patch: Partial<itfHistoryFilter>) => void;
    /** 상세 열기(로그 끝부분을 읽는다)·닫기(null) */
    select: (runId: string | null) => Promise<void>;
    /** 이력 비우기. 성공하면 true(토스트·다시 불러오기) */
    clear: (deleteLogs: boolean) => Promise<boolean>;
    /** run:event finished 구독. 해제 함수를 돌려준다 */
    subscribe: () => () => void;
}

const listGate = createLatestGate();
const logGate = createLatestGate();

/** IPC 자체가 실패(창 종료 등)해도 envelope로 돌려준다 */
function f_Call<T>(pending: Promise<typApiResult<T>>): Promise<typApiResult<T>> {
    return pending.catch((): typApiResult<T> => ({
        ok: false,
        error: { code: "INTERNAL", message: ERROR_MESSAGES.INTERNAL },
    }));
}

export const useHistoryStore = create<itfHistoryState>((set, get) => ({
    jobId: null,
    records: [],
    loading: false,
    error: null,
    filter: DEFAULT_HISTORY_FILTER,
    selectedId: null,
    log: null,
    logLoading: false,
    logError: null,
    load: async (jobId) => {
        const isLatest = listGate.next();
        const changed = get().jobId !== jobId;
        set({
            jobId,
            loading: true,
            error: null,
            ...(changed
                ? { records: [], selectedId: null, log: null, logError: null, logLoading: false }
                : {}),
        });
        if (changed) logGate.invalidate();
        const query =
            jobId === null ? { limit: HISTORY_FETCH_LIMIT } : { jobId, limit: HISTORY_FETCH_LIMIT };
        const r = await f_Call(getApi().history.list(query));
        if (!isLatest()) return;
        if (r.ok) set({ records: r.data, loading: false });
        else set({ loading: false, error: r.error.message });
    },
    setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
    select: async (runId) => {
        const isLatest = logGate.next();
        if (runId === null) {
            set({ selectedId: null, log: null, logLoading: false, logError: null });
            return;
        }
        set({ selectedId: runId, log: null, logLoading: true, logError: null });
        const r = await f_Call(getApi().history.readLog(runId));
        if (!isLatest()) return;
        if (r.ok) set({ log: r.data, logLoading: false });
        else set({ logLoading: false, logError: r.error.message });
    },
    clear: async (deleteLogs) => {
        const push = useToastStore.getState().push;
        const r = await f_Call(getApi().history.clear(deleteLogs));
        if (!r.ok) {
            push(r.error.code === "BUSY" ? "warning" : "error", r.error.message);
            return false;
        }
        const { removed, deletedLogs } = r.data;
        push(
            "success",
            deleteLogs
                ? `이력 ${removed}건과 로그 파일 ${deletedLogs}개를 지웠습니다.`
                : `이력 ${removed}건을 지웠습니다. 로그 파일은 남겨 두었습니다.`,
        );
        set({ selectedId: null, log: null, logError: null });
        await get().load(get().jobId);
        return true;
    },
    subscribe: () =>
        getApi().events.onRunEvent((e) => {
            if (e.type !== "finished") return;
            const { jobId } = get();
            if (jobId === null || jobId === e.record.jobId) void get().load(jobId);
        }),
}));
