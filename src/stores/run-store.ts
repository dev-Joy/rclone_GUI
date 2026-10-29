/**
 * 실행 화면 상태 (zustand). 진행 중인 실행(앱 전역 하나)은 run:event로 갱신하고, 화면을 다시 열면
 * run:getActive로 복구한다. 끝난 실행은 마지막 1건만 보관한다(자세한 기록은 이력·로그 파일).
 * 실제 실행은 compare-store의 비교 결과(planToken·삭제 예정 수)와 대량 삭제 확인을 함께 보낸다.
 * 실제 실행이 끝나면 main이 비교 결과를 버리므로 비교 화면을 다시 불러온다.
 * 사전 확인이 비교 결과와 달라 막히면(PLAN_DRIFT) driftNotice로 알린다(PlanDriftModal).
 * "다시 비교"(recompareDrift)는 막힌 작업을 선택하고 비교 탭으로 옮긴 뒤 비교한다(설정·편집 변경 확인을 거친다).
 * 자동 실행(trigger scheduler)의 결과는 main이 app:notify로 알리므로 여기서 토스트를 띄우지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { getApi, unwrap } from "@/lib/api";
import { appendTail, runStatusText } from "@/lib/run-view";
import { ERROR_MESSAGES } from "@/shared/errors";
import { mayLeavePartial, PARTIAL_LEFT_NOTICE } from "@/shared/partial-files";
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
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useToastStore } from "@/stores/toast-store";
import { useUiStore } from "@/stores/ui-store";

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
    /** 사전 확인 불일치(PLAN_DRIFT)로 막힌 실행. 사용자가 닫을 때까지 */
    driftNotice: typRunRecord | null;
    /** 미리보기(dryRun) 또는 실제 실행 시작. confirm은 삭제 확인 모달의 대량 삭제 확인. 시작했으면 true */
    start: (jobId: string, dryRun: boolean, confirm?: itfRunConfirm) => Promise<boolean>;
    dismissDrift: () => void;
    /**
     * PLAN_DRIFT 안내의 "다시 비교": 안내를 닫고, 막힌 작업을 선택·작업 화면 비교 탭으로 옮긴 뒤 비교한다.
     * 설정 화면이나 다른 작업에 저장하지 않은 변경이 있으면 버리기 확인(leaveSettings·guard)을 거친다.
     */
    recompareDrift: () => void;
    cancel: () => Promise<void>;
    /** run:event 구독 + getActive 1회. 해제 함수를 돌려준다 */
    subscribe: () => () => void;
}

export interface itfRunConfirm {
    largeDeletes: boolean;
}

/** IPC 자체가 실패(창 종료 등)해도 envelope로 돌려준다 */
function f_Call<T>(pending: Promise<typApiResult<T>>): Promise<typApiResult<T>> {
    return pending.catch((): typApiResult<T> => ({
        ok: false,
        error: { code: "INTERNAL", message: ERROR_MESSAGES.INTERNAL },
    }));
}

/** 실제 실행 입력: 화면에 있는 그 작업의 비교 결과에서 토큰·삭제 예정 수를 넣는다 */
function f_Input(jobId: string, dryRun: boolean, confirm?: itfRunConfirm): typStartRunInput {
    if (dryRun) return { jobId, dryRun };
    const r = useCompareStore.getState().result;
    if (!r || r.jobId !== jobId) return { jobId, dryRun };
    return {
        jobId,
        dryRun,
        planToken: r.planToken,
        confirmedDeletes: expectedDeletes(r.summary, r.mode),
        ...(confirm?.largeDeletes ? { confirmLargeDeletes: true } : {}),
    };
}

function f_FinishToast(rec: typRunRecord): void {
    f_ResultToast(rec);
    // 전송 중 멈췄으면 .partial 안내를 결과 토스트 뒤에 따로 띄운다
    if (mayLeavePartial(rec)) useToastStore.getState().push("warning", PARTIAL_LEFT_NOTICE);
}

function f_ResultToast(rec: typRunRecord): void {
    const push = useToastStore.getState().push;
    const text = runStatusText(rec.status, rec.dryRun, rec.mode);
    switch (rec.status) {
        case "success":
            push("success", text);
            return;
        case "canceled":
            push(
                "info",
                rec.dryRun || rec.error?.message.startsWith("사전 확인")
                    ? text
                    : `${text}: ${rec.mode === "sync" ? "이미 복사·삭제된 파일은 되돌리지 않습니다." : "이미 복사된 파일은 대상에 남습니다."}`,
            );
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
                    ...(e.record.error?.code === "PLAN_DRIFT" ? { driftNotice: e.record } : {}),
                });
                if (e.record.trigger !== "scheduler") f_FinishToast(e.record);
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
        driftNotice: null,
        start: async (jobId, dryRun, confirm) => {
            set({ startingJobId: jobId, error: null });
            const r = await f_Call(getApi().run.start(f_Input(jobId, dryRun, confirm)));
            set({ startingJobId: null });
            if (r.ok) return true;
            set({ error: { jobId, payload: r.error } });
            useToastStore
                .getState()
                .push(r.error.code === "BUSY" ? "warning" : "error", r.error.message);
            return false;
        },
        dismissDrift: () => set({ driftNotice: null }),
        recompareDrift: () => {
            const notice = get().driftNotice;
            if (!notice) return;
            const jobId = notice.jobId;
            set({ driftNotice: null });
            if (!useJobsStore.getState().jobs.some((j) => j.id === jobId)) {
                useToastStore
                    .getState()
                    .push("warning", `‘${notice.jobName}’ 작업이 지워져 다시 비교할 수 없습니다.`);
                return;
            }
            const ui = useUiStore.getState();
            ui.leaveSettings(() =>
                useJobEditorStore.getState().guard(() => {
                    useJobsStore.getState().select(jobId);
                    ui.setView("job");
                    ui.setTab("compare");
                    void useCompareStore.getState().run(jobId);
                }),
            );
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
