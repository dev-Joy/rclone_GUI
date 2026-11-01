/**
 * 실제 실행 확인 흐름 공용 훅 (INT-002 T-04, spec Q7). 작업 화면 헤더와 작업 목록이 같이 쓴다.
 *
 * - ask: 화면에 있는 그 작업의 비교 결과로 확인 창을 연다(작업 화면의 실행 버튼).
 * - compareThenAsk: 작업을 선택하고 비교한 뒤 확인 창을 연다(작업 목록의 "지금 실행").
 *   설정·편집 변경 확인(leaveSettings·guard)을 거친다. 실패·취소는 compare-store가 알린다.
 * - 확인 창은 항상 수동 흐름이다: 삭제가 있는 동기화는 삭제 확인 모달, 그 밖에는 간단한 확인 창.
 *   자동 실행 경로(startAuto)는 쓰지 않는다.
 * - pending은 렌더마다 지금 상태로 다시 계산한다. 실행할 수 없게 되면(비교 무효·실행 중 등) null이 되어
 *   확인 창이 닫힌다. 낡음 판정 시각은 확인 창을 연 시각(askedAt)으로 고정한다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { useState } from "react";

// ========== Internal imports ==========
import { canStartRun } from "@/lib/run-view";
import { planFromCompare, plannedDeleteCount } from "@/shared/run-plan";
import type { typJob } from "@/shared/schemas/job";
import type { itfCompareResult } from "@/shared/types/compare";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { selectDirty, useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useRunStore, type itfRunConfirm } from "@/stores/run-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";
import { useUiStore } from "@/stores/ui-store";

export interface itfRunFlowPending {
    job: typJob;
    compare: itfCompareResult;
    /** 삭제(파일 또는 폴더)가 있는 동기화 → 삭제 확인 모달 */
    askDeletes: boolean;
}

export interface itfRunFlow {
    pending: itfRunFlowPending | null;
    /** 화면의 비교 결과로 확인 창(작업 화면 헤더) */
    ask: (jobId: string) => void;
    /** 선택 → 비교 → 확인 창(작업 목록) */
    compareThenAsk: (jobId: string) => void;
    cancel: () => void;
    /** 실행 탭으로 옮기고 수동 실제 실행을 시작한다 */
    confirm: (confirm?: itfRunConfirm) => void;
}

/** 지금 store 값으로 실제 실행 가능 여부(getState용) */
function f_CheckNow(jobId: string, nowMs: number) {
    const job = useJobsStore.getState().jobs.find((j) => j.id === jobId) ?? null;
    const editor = useJobEditorStore.getState();
    const cmp = useCompareStore.getState();
    const run = useRunStore.getState();
    const settings = useSettingsStore.getState().settings;
    return canStartRun({
        job,
        dirty: editor.jobId === jobId && selectDirty(editor),
        caseInsensitive: settings?.compare.caseInsensitivePaths ?? true,
        comparing: runningCompare(cmp.active, cmp.runningJobId),
        runningJobId: run.active?.jobId ?? run.startingJobId,
        dryRun: false,
        compare: cmp.result,
        maxAgeMinutes: settings?.safety.compareMaxAgeMinutes ?? 10,
        nowMs,
    });
}

export function useRunFlow(): itfRunFlow {
    // ========== hook & state 변수 선언 ==========
    const [pendingJobId, setPendingJobId] = useState<string | null>(null);
    const [askedAt, setAskedAt] = useState(0);
    const jobs = useJobsStore((s) => s.jobs);
    const editorJobId = useJobEditorStore((s) => s.jobId);
    const editorDirty = useJobEditorStore(selectDirty);
    const compareResult = useCompareStore((s) => s.result);
    const compareActive = useCompareStore((s) => s.active);
    const compareRunningJobId = useCompareStore((s) => s.runningJobId);
    const runActive = useRunStore((s) => s.active);
    const runStartingJobId = useRunStore((s) => s.startingJobId);
    const caseInsensitive = useSettingsStore(
        (s) => s.settings?.compare.caseInsensitivePaths ?? true,
    );
    const maxAgeMinutes = useSettingsStore((s) => s.settings?.safety.compareMaxAgeMinutes ?? 10);

    // ========== 내부 변수 (_V) ==========
    let pending: itfRunFlowPending | null = null;
    const job = pendingJobId === null ? null : (jobs.find((j) => j.id === pendingJobId) ?? null);
    if (job && compareResult && compareResult.jobId === job.id) {
        const check = canStartRun({
            job,
            dirty: editorJobId === job.id && editorDirty,
            caseInsensitive,
            comparing: runningCompare(compareActive, compareRunningJobId),
            runningJobId: runActive?.jobId ?? runStartingJobId,
            dryRun: false,
            compare: compareResult,
            maxAgeMinutes,
            nowMs: askedAt,
        });
        if (check.ok) {
            const plan = planFromCompare(compareResult.summary, job.mode);
            pending = {
                job,
                compare: compareResult,
                askDeletes: job.mode === "sync" && plannedDeleteCount(plan) > 0,
            };
        }
    }

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const f_Open = (jobId: string) => {
        setAskedAt(Date.now());
        setPendingJobId(jobId);
    };
    const f_CompareThenAsk = async (jobId: string) => {
        await useCompareStore.getState().run(jobId);
        const r = useCompareStore.getState().result;
        if (!r || r.jobId !== jobId) return; // 실패·취소는 compare-store가 알렸다
        const now = Date.now();
        const check = f_CheckNow(jobId, now);
        if (!check.ok) {
            useToastStore.getState().push("info", check.reason);
            return;
        }
        setAskedAt(now);
        setPendingJobId(jobId);
    };
    const ask = (jobId: string) => f_Open(jobId);
    const compareThenAsk = (jobId: string) => {
        const ui = useUiStore.getState();
        ui.leaveSettings(() =>
            useJobEditorStore.getState().guard(() => {
                useJobsStore.getState().select(jobId);
                ui.setView("job");
                ui.setTab("compare");
                void f_CompareThenAsk(jobId);
            }),
        );
    };
    const cancel = () => setPendingJobId(null);
    const confirm = (c?: itfRunConfirm) => {
        const id = pendingJobId;
        setPendingJobId(null);
        if (id === null) return;
        useUiStore.getState().setTab("run");
        void useRunStore.getState().start(id, false, c);
    };

    return { pending, ask, compareThenAsk, cancel, confirm };
}
