/**
 * 실행 화면 상태 (zustand). 진행 중인 실행(앱 전역 하나)은 run:event로 갱신하고, 화면을 다시 열면
 * run:getActive로 복구한다. 끝난 실행은 마지막 1건만 보관한다(자세한 기록은 이력·로그 파일).
 * 실제 실행은 compare-store의 비교 결과(planToken·삭제 예정 수)를 함께 보낸다.
 * 실제 실행이 끝나면 main이 비교 결과를 버리므로 비교 화면을 다시 불러온다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { getApi, unwrap } from "@/lib/api";
import { appendTail, runStatusText } from "@/lib/run-view";
import { ERROR_MESSAGES } from "@/shared/errors";
import { expectedDeletes } from "@/shared/run-plan";
import type { typApiResult, typAppErrorPayload } from "@/shared/schemas/common";
import type { typRunRecord, typStartRunInput } from "@/shared/schemas/run";
import type {
    itfDryRunSummary,
    itfRunLogLine,
    itfRunSnapshot,
    typRunEvent,
} from "@/shared/types/run";
import { useCompareStore } from "@/stores/compare-store";
import { useToastStore } from "@/stores/toast-store";

export interface itfFinishedRun {
    record: typRunRecord;
    dryRunSummary: itfDryRunSummary | null;
    tail: itfRunLogLine[];
}

interface itfRunState {
    /** 앱 전역 진행 중 실행 */
    active: itfRunSnapshot | null;
    /** 화면 묶음 상한으로 보내지 않은 로그 줄 수(진행 중 실행) */
    dropped: number;
    /** 마지막으로 끝난 실행 */
    last: itfFinishedRun | null;
    /** run:start 응답을 기다리는 작업 */
    startingJobId: string | null;
    /** 마지막 시작 실패(작업별 표시용) */
    error: { jobId: string; payload: typAppErrorPayload } | null;
    /** 미리보기(dryRun) 또는 실제 실행 시작. 시작했으면 true */
    start: (jobId: string, dryRun: boolean) => Promise<boolean>;
    cancel: () => Promise<void>;
    /** run:event 구독 + getActive 1회. 해제 함수를 돌려준다 */
    subscribe: () => () => void;
}

/** IPC 자체가 실패(창 종료 등)해도 envelope로 돌려준다 */
function f_Call<T>(pending: Promise<typApiResult<T>>): Promise<typApiResult<T>> {
    return pending.catch((): typApiResult<T> => ({
        ok: false,
        error: { code: "INTERNAL", message: ERROR_MESSAGES.INTERNAL },
    }));
}

/** 실제 실행 입력: 화면에 있는 그 작업의 비교 결과에서 토큰·삭제 예정 수를 넣는다 */
function f_Input(jobId: string, dryRun: boolean): typStartRunInput {
    if (dryRun) return { jobId, dryRun };
    const r = useCompareStore.getState().result;
    if (!r || r.jobId !== jobId) return { jobId, dryRun };
    return {
        jobId,
        dryRun,
        planToken: r.planToken,
        confirmedDeletes: expectedDeletes(r.summary, r.mode),
    };
}

function f_FinishToast(rec: typRunRecord): void {
    const push = useToastStore.getState().push;
    const text = runStatusText(rec.status, rec.dryRun, rec.mode);
    switch (rec.status) {
        case "success":
            push("success", text);
            return;
        case "canceled":
            push("info", rec.dryRun ? text : `${text}: 이미 복사된 파일은 대상에 남습니다.`);
            return;
        default:
            push(
                rec.status === "partial" ? "warning" : "error",
                `${text}: ${rec.error?.message ?? ""}`,
            );
    }
}

export const useRunStore = create<itfRunState>((set, get) => {
    const f_OnEvent = (e: typRunEvent) => {
        const a = get().active;
        switch (e.type) {
            case "started":
                set({ active: e.snapshot, dropped: 0 });
                return;
            case "phase":
                if (a?.runId === e.runId) set({ active: { ...a, phase: e.phase } });
                return;
            case "stats":
                if (a?.runId === e.runId) set({ active: { ...a, stats: e.stats } });
                return;
            case "log":
                if (a?.runId !== e.runId) return;
                set((s) => ({
                    active: { ...a, tail: appendTail(a.tail, e.lines) },
                    dropped: s.dropped + e.dropped,
                }));
                return;
            case "finished": {
                const tail = a?.runId === e.runId ? a.tail : [];
                set({
                    active: a?.runId === e.runId ? null : a,
                    last: { record: e.record, dryRunSummary: e.dryRunSummary, tail },
                });
                f_FinishToast(e.record);
                // 실제 실행은 main이 비교 결과를 버린다 → 비교 화면을 다시 불러온다
                const compare = useCompareStore.getState();
                if (!e.record.dryRun && compare.jobId === e.record.jobId) {
                    void compare.show(e.record.jobId);
                }
                return;
            }
        }
    };

    return {
        active: null,
        dropped: 0,
        last: null,
        startingJobId: null,
        error: null,
        start: async (jobId, dryRun) => {
            set({ startingJobId: jobId, error: null });
            const r = await f_Call(getApi().run.start(f_Input(jobId, dryRun)));
            set({ startingJobId: null });
            if (r.ok) return true;
            set({ error: { jobId, payload: r.error } });
            useToastStore
                .getState()
                .push(r.error.code === "BUSY" ? "warning" : "error", r.error.message);
            return false;
        },
        cancel: async () => {
            const a = get().active;
            if (!a || a.cancelRequested) return;
            set({ active: { ...a, cancelRequested: true } });
            await f_Call(getApi().run.cancel(a.runId));
        },
        subscribe: () => {
            const api = getApi();
            const off = api.events.onRunEvent(f_OnEvent);
            unwrap(api.run.getActive())
                .then((active) => (get().active === null ? set({ active }) : undefined))
                .catch(() => undefined);
            return off;
        },
    };
});
