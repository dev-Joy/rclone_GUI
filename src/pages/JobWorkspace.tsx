/**
 * 선택한 작업 화면: 헤더(이름·모드·예약 배지, 원본 → 대상, 오른쪽 ‘작업 화면으로’·‘이력’·‘작업 설정’·‘⋯’(복제·삭제))와
 * 본문 화면(pane). 주 화면은 작업 화면(JobWorkView: 단계 막대·‘대상에 일어날 일’·파일 목록·하단 실행 막대)이고,
 * 이력(HistoryView)·작업 설정(JobEditor)은 헤더 버튼으로 여는 보조 화면이다. 새 작업은 항상 작업 설정으로 보인다.
 * 실제 실행 확인 창은 작업 목록과 같은 흐름(useRunFlow·RunConfirmModals)을 쓴다: 삭제가 있는 동기화는
 * 삭제 확인 모달, 그 밖에는 간단한 확인 창. 사전 확인 불일치(PLAN_DRIFT)는 PlanDriftModal로 알린다.
 * 확인 창·작업 삭제 확인은 보고 있는 화면과 상관없이 뜬다. 중지 막대는 화면마다 한 곳(작업 화면은 실행 막대 안,
 * 보조 화면은 헤더 아래)에만 있다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useCallback, useEffect, useRef, useState } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import { sortJobs } from "@/lib/job-form";
import { isOsTaskMissing, missingRemoteNames } from "@/lib/job-list-view";
import { useRunFlow } from "@/lib/use-run-flow";
import { createDefaultSettings } from "@/shared/defaults";
import { scheduleText } from "@/shared/schedule";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { selectDirty, useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useRunStore } from "@/stores/run-store";
import { useSchedulerStore } from "@/stores/scheduler-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";
import { useUiStore, type typJobPane } from "@/stores/ui-store";
import HistoryView from "./HistoryView";
import JobActivityBar from "./JobActivityBar";
import JobEditor from "./JobEditor";
import JobWorkView from "./JobWorkView";
import PlanDriftModal from "./PlanDriftModal";
import RunConfirmModals from "./RunConfirmModals";
import styles from "./JobWorkspace.module.css";

const MODE_LABEL = { copy: "복사", sync: "동기화(삭제 포함)" } as const;

/** 설정을 아직 못 읽었을 때의 삭제 확인 기준 */
const DEFAULT_SAFETY = createDefaultSettings().safety;
/** 비교 결과 낡음 판정을 다시 하는 간격 */
const STALE_TICK_MS = 30_000;

export default function JobWorkspace() {
    // ========== hook & state 변수 선언 ==========
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const moreRef = useRef<HTMLDetailsElement | null>(null);
    /**
     * ⋯ 메뉴 ref: 붙을 때 Escape 처리기를 단다(열려 있으면 닫고 메뉴 단추로 포커스). details에는 JSX 키 처리기를
     * 달 수 없어(비대화형 요소) 직접 등록하고, 떨어질 때 뗀다
     */
    const f_MoreRef = useCallback((el: HTMLDetailsElement | null) => {
        moreRef.current = el;
        if (!el) return;
        const f_OnKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || !el.open) return;
            e.preventDefault();
            el.open = false;
            el.querySelector("summary")?.focus();
        };
        el.addEventListener("keydown", f_OnKey);
        return () => {
            el.removeEventListener("keydown", f_OnKey);
            moreRef.current = null;
        };
    }, []);
    const jobId = useJobEditorStore((s) => s.jobId);
    const draft = useJobEditorStore((s) => s.draft);
    const dirty = useJobEditorStore(selectDirty);
    const guard = useJobEditorStore((s) => s.guard);
    const closeEditor = useJobEditorStore((s) => s.close);
    const jobs = useJobsStore((s) => s.jobs);
    const select = useJobsStore((s) => s.select);
    const removeJob = useJobsStore((s) => s.remove);
    const duplicateJob = useJobsStore((s) => s.duplicate);
    const uiPane = useUiStore((s) => s.pane);
    const setPane = useUiStore((s) => s.setPane);
    const pushToast = useToastStore((s) => s.push);
    const compareActive = useCompareStore((s) => s.active);
    const compareRunningJobId = useCompareStore((s) => s.runningJobId);
    const runActive = useRunStore((s) => s.active);
    const runStartingJobId = useRunStore((s) => s.startingJobId);
    const osStatus = useSchedulerStore((s) => s.osStatus);
    const env = useRcloneEnvStore((s) => s.env);
    const flow = useRunFlow();
    const safety = useSettingsStore((s) => s.settings?.safety ?? DEFAULT_SAFETY);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        const timer = setInterval(() => setNowMs(Date.now()), STALE_TICK_MS);
        return () => clearInterval(timer);
    }, []);

    // ========== 내부 변수 (_V) ==========
    const job = jobId === null ? null : (jobs.find((j) => j.id === jobId) ?? null);
    const isNew = jobId === null;
    const title = job?.name ?? (draft?.name.trim() || "새 작업");
    // 새 작업에서는 작업 화면·이력을 열 수 없으므로 작업 설정으로 보인다
    const pane: typJobPane = isNew ? "edit" : uiPane;
    const running = runningCompare(compareActive, compareRunningJobId);
    const runningJobId = runActive?.jobId ?? runStartingJobId;
    // "다시 비교"는 막힌 작업으로 옮겨 비교하므로 지금 보이는 작업의 저장 여부·경로는 보지 않는다
    let recompareReason: string | null = null;
    if (running) recompareReason = "다른 비교가 진행 중입니다.";
    else if (runningJobId !== null) recompareReason = "실행 중에는 비교할 수 없습니다.";
    const duplicateReason = dirty ? "저장하지 않은 변경이 있어 복제할 수 없습니다." : undefined;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const f_CloseMore = () => {
        if (moreRef.current) moreRef.current.open = false;
    };
    const f_Duplicate = async () => {
        if (!job) return;
        setBusy(true);
        const r = await duplicateJob(job.id);
        setBusy(false);
        if (r.ok) pushToast("success", `‘${r.data.name}’ 작업을 만들었습니다.`);
        else pushToast("error", r.error.message);
    };
    const f_Delete = async () => {
        if (!job) return;
        setBusy(true);
        const r = await removeJob(job.id);
        setBusy(false);
        setConfirmDelete(false);
        if (r.ok) pushToast("success", `‘${job.name}’ 작업을 지웠습니다.`);
        else pushToast("error", r.error.message);
    };
    const h_AskRun = (id: string) => flow.ask(id);
    const h_Back = () => setPane("work");
    const h_OpenHistory = () => setPane("history");
    const h_OpenEdit = () => setPane("edit");
    const h_Duplicate = () => {
        f_CloseMore();
        void f_Duplicate();
    };
    const h_AskDelete = () => {
        f_CloseMore();
        setConfirmDelete(true);
    };
    const h_CancelDelete = () => setConfirmDelete(false);
    const h_ConfirmDelete = () => void f_Delete();
    /** 새 작업 작성 취소: 첫 작업의 작업 화면으로 돌아간다 */
    const h_CancelNew = () =>
        guard(() => {
            const first = sortJobs(useJobsStore.getState().jobs)[0]?.id ?? null;
            if (first === null) closeEditor();
            select(first);
            setPane("work");
        });

    return (
        <section className={styles.JobWorkspace} aria-labelledby="job-title">
            <header className={styles.header}>
                <div className={styles.headerRow}>
                    <div className={styles.heading}>
                        <h2 id="job-title" className={styles.title} title={title}>
                            {title}
                        </h2>
                        {isNew && <ZBCBadge tone="warning">저장 안 됨</ZBCBadge>}
                        {job && (
                            <ZBCBadge tone={job.mode === "sync" ? "warning" : "neutral"}>
                                {MODE_LABEL[job.mode]}
                            </ZBCBadge>
                        )}
                        {job?.autoSync.enabled && (
                            <ZBCBadge tone="accent">
                                {job.autoSync.backend === "os" ? "Windows 예약" : "자동"} ·{" "}
                                {scheduleText(job.autoSync)}
                            </ZBCBadge>
                        )}
                        {job && isOsTaskMissing(job, osStatus) && (
                            <ZBCBadge tone="warning">OS 예약 미등록</ZBCBadge>
                        )}
                        {job &&
                            env !== null &&
                            env.problem === null &&
                            missingRemoteNames(job, env.remotes).length > 0 && (
                                <ZBCBadge tone="warning">remote 없음</ZBCBadge>
                            )}
                    </div>
                    <div className={styles.actions}>
                        {isNew ? (
                            <ZBCButton onClick={h_CancelNew}>작성 취소</ZBCButton>
                        ) : (
                            <>
                                {pane !== "work" && (
                                    <ZBCButton id="job-back" onClick={h_Back}>
                                        작업 화면으로
                                    </ZBCButton>
                                )}
                                <ZBCButton id="job-open-history" onClick={h_OpenHistory}>
                                    이력
                                </ZBCButton>
                                <ZBCButton id="job-open-edit" onClick={h_OpenEdit}>
                                    작업 설정
                                </ZBCButton>
                                <details ref={f_MoreRef} className={styles.more}>
                                    <summary
                                        className={styles.moreButton}
                                        aria-label="작업 더 보기"
                                        title="복제·삭제"
                                    >
                                        ⋯
                                    </summary>
                                    <div className={styles.moreMenu}>
                                        <ZBCButton
                                            variant="ghost"
                                            onClick={h_Duplicate}
                                            disabled={dirty || busy}
                                            title={duplicateReason}
                                        >
                                            복제
                                        </ZBCButton>
                                        <ZBCButton
                                            variant="danger"
                                            onClick={h_AskDelete}
                                            disabled={busy}
                                        >
                                            삭제
                                        </ZBCButton>
                                    </div>
                                </details>
                            </>
                        )}
                    </div>
                </div>
                {job && (
                    <p className={styles.paths} title={`${job.source} → ${job.destination}`}>
                        {job.source} → {job.destination}
                    </p>
                )}
            </header>

            {pane === "work" && job ? (
                <JobWorkView job={job} nowMs={nowMs} onAskRun={h_AskRun} />
            ) : pane === "history" && job ? (
                <div className={styles.panel}>
                    <JobActivityBar jobId={job.id} />
                    <HistoryView job={job} />
                </div>
            ) : (
                <div className={styles.panel}>
                    {job && <JobActivityBar jobId={job.id} />}
                    <JobEditor />
                </div>
            )}

            <RunConfirmModals flow={flow} safety={safety} />

            <PlanDriftModal compareBlockedReason={recompareReason} />

            <ZBCModal
                open={confirmDelete}
                title="작업 삭제"
                onClose={h_CancelDelete}
                footer={
                    <>
                        <ZBCButton onClick={h_CancelDelete} initialFocus>
                            취소
                        </ZBCButton>
                        <ZBCButton variant="danger" onClick={h_ConfirmDelete} disabled={busy}>
                            작업 삭제
                        </ZBCButton>
                    </>
                }
            >
                <p>
                    ‘{job?.name}’ 작업 설정을 지웁니다. 원본·대상 폴더의 파일은 건드리지 않습니다.
                </p>
                {dirty && <p>저장하지 않은 변경도 함께 버립니다.</p>}
            </ZBCModal>
        </section>
    );
}
