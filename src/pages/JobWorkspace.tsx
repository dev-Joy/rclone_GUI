/**
 * 선택한 작업 화면: 헤더(이름·경로·모드, 복제·삭제·비교·미리보기·실행)와 탭(비교·실행·이력·작업 설정).
 * "비교" 버튼은 저장된 작업에서 비교를 시작하고 비교 탭으로 옮긴다(안 되면 이유를 표시).
 * "미리보기"는 dry-run(파일을 바꾸지 않음), "복사 실행"·"동기화 실행"은 유효한 비교 결과가 있을 때만 확인 창을
 * 거쳐 실행한다. 삭제가 있는 동기화는 삭제 확인 모달(DeleteConfirmModal), 그 밖에는 간단한 확인 창을 쓴다.
 * 사전 확인 불일치(PLAN_DRIFT)는 PlanDriftModal로 알린다. 실행 중에는 비교·실행을 시작할 수 없다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useState } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import ZBCTabs, { type itfZBCTab } from "@/components/ZBCTabs";
import { canStartCompare } from "@/lib/compare-view";
import { sortJobs } from "@/lib/job-form";
import { canStartRun, realRunConfirmText } from "@/lib/run-view";
import { createDefaultSettings } from "@/shared/defaults";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { selectDirty, useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useRunStore } from "@/stores/run-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";
import { useUiStore, type typJobTab } from "@/stores/ui-store";
import CompareView from "./CompareView";
import DeleteConfirmModal from "./DeleteConfirmModal";
import JobEditor from "./JobEditor";
import PlanDriftModal from "./PlanDriftModal";
import RunView from "./RunView";
import styles from "./JobWorkspace.module.css";

const MODE_LABEL = { copy: "복사", sync: "동기화(삭제 포함)" } as const;

const CANCEL_NOTE = "취소해도 이미 복사된 파일은 대상에 남습니다.";
const RUN_LABEL = { copy: "복사 실행", sync: "동기화 실행" } as const;
/** 설정을 아직 못 읽었을 때의 삭제 확인 기준 */
const DEFAULT_SAFETY = createDefaultSettings().safety;
/** 비교 결과 낡음 판정을 다시 하는 간격 */
const STALE_TICK_MS = 30_000;

/** 비교·실행 탭은 저장된 작업에서만 연다 */
function f_Tabs(isNew: boolean): readonly itfZBCTab<typJobTab>[] {
    return [
        { id: "compare", label: "비교", disabled: isNew },
        { id: "run", label: "실행", disabled: isNew },
        { id: "history", label: "이력", disabled: true, badge: "준비 중" },
        { id: "edit", label: "작업 설정" },
    ];
}

export default function JobWorkspace() {
    // ========== hook & state 변수 선언 ==========
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmRun, setConfirmRun] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const jobId = useJobEditorStore((s) => s.jobId);
    const draft = useJobEditorStore((s) => s.draft);
    const dirty = useJobEditorStore(selectDirty);
    const guard = useJobEditorStore((s) => s.guard);
    const closeEditor = useJobEditorStore((s) => s.close);
    const jobs = useJobsStore((s) => s.jobs);
    const select = useJobsStore((s) => s.select);
    const removeJob = useJobsStore((s) => s.remove);
    const duplicateJob = useJobsStore((s) => s.duplicate);
    const tab = useUiStore((s) => s.tab);
    const setTab = useUiStore((s) => s.setTab);
    const pushToast = useToastStore((s) => s.push);
    const compareActive = useCompareStore((s) => s.active);
    const compareRunningJobId = useCompareStore((s) => s.runningJobId);
    const runCompare = useCompareStore((s) => s.run);
    const compareResult = useCompareStore((s) => s.result);
    const runActive = useRunStore((s) => s.active);
    const runStartingJobId = useRunStore((s) => s.startingJobId);
    const startRun = useRunStore((s) => s.start);
    const caseInsensitive = useSettingsStore(
        (s) => s.settings?.compare.caseInsensitivePaths ?? true,
    );
    const maxAgeMinutes = useSettingsStore((s) => s.settings?.safety.compareMaxAgeMinutes ?? 10);
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
    // 새 작업에서는 비교·실행 탭을 열 수 없으므로 작업 설정으로 보인다
    const activeTab: typJobTab = isNew && (tab === "compare" || tab === "run") ? "edit" : tab;
    const running = runningCompare(compareActive, compareRunningJobId);
    const comparing = job !== null && running?.jobId === job.id;
    const runningJobId = runActive?.jobId ?? runStartingJobId;
    const baseCompareCheck = canStartCompare({ job, dirty, running, caseInsensitive });
    const compareCheck =
        baseCompareCheck.ok && runningJobId !== null
            ? { ok: false as const, reason: "실행 중에는 비교할 수 없습니다." }
            : baseCompareCheck;
    const compareReason = compareCheck.ok ? null : compareCheck.reason;
    const runInput = {
        job,
        dirty,
        caseInsensitive,
        comparing: running,
        runningJobId,
        compare: compareResult,
        maxAgeMinutes,
        nowMs,
    };
    const dryCheck = canStartRun({ ...runInput, dryRun: true });
    const realCheck = canStartRun({ ...runInput, dryRun: false });
    const dryReason = dryCheck.ok ? null : dryCheck.reason;
    const realReason = realCheck.ok ? null : realCheck.reason;
    const shownCompare =
        compareResult && job && compareResult.jobId === job.id ? compareResult : null;
    const deleteCount = shownCompare && job?.mode === "sync" ? shownCompare.summary.deleteFiles : 0;
    const askDeletes = confirmRun && shownCompare !== null && realCheck.ok && deleteCount > 0;
    const reasonText = isNew ? "먼저 작업을 저장하세요." : (compareReason ?? realReason ?? "");
    const duplicateReason = dirty ? "저장하지 않은 변경이 있어 복제할 수 없습니다." : undefined;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
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
    const h_Compare = () => {
        if (!job) return;
        setTab("compare");
        void runCompare(job.id);
    };
    const h_DryRun = () => {
        if (!job) return;
        setTab("run");
        void startRun(job.id, true);
    };
    const h_AskRun = () => setConfirmRun(true);
    const h_CancelRun = () => setConfirmRun(false);
    const h_ConfirmRun = () => {
        setConfirmRun(false);
        if (!job) return;
        setTab("run");
        void startRun(job.id, false);
    };
    const h_ConfirmDeletes = (confirm: { largeDeletes: boolean }) => {
        setConfirmRun(false);
        if (!job) return;
        setTab("run");
        void startRun(job.id, false, confirm);
    };
    const h_Duplicate = () => void f_Duplicate();
    const h_AskDelete = () => setConfirmDelete(true);
    const h_CancelDelete = () => setConfirmDelete(false);
    const h_ConfirmDelete = () => void f_Delete();
    /** 새 작업 작성 취소: 첫 작업으로 돌아간다 */
    const h_CancelNew = () =>
        guard(() => {
            const first = sortJobs(useJobsStore.getState().jobs)[0]?.id ?? null;
            if (first === null) closeEditor();
            select(first);
        });

    return (
        <section className={styles.JobWorkspace} aria-labelledby="job-title">
            <header className={styles.header}>
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
                        <ZBCBadge tone="accent">자동 {job.autoSync.intervalMinutes}분</ZBCBadge>
                    )}
                </div>
                {job && (
                    <p className={styles.paths} title={`${job.source} → ${job.destination}`}>
                        {job.source} → {job.destination}
                    </p>
                )}
                <div className={styles.actions}>
                    {isNew ? (
                        <ZBCButton onClick={h_CancelNew}>작성 취소</ZBCButton>
                    ) : (
                        <>
                            <ZBCButton
                                onClick={h_Duplicate}
                                disabled={dirty || busy}
                                title={duplicateReason}
                            >
                                복제
                            </ZBCButton>
                            <ZBCButton variant="danger" onClick={h_AskDelete} disabled={busy}>
                                삭제
                            </ZBCButton>
                        </>
                    )}
                    <span className={styles.spacer} />
                    <ZBCButton
                        onClick={h_Compare}
                        disabled={!compareCheck.ok}
                        title={
                            compareReason ??
                            "원본·대상 목록을 읽어 차이를 봅니다(파일은 바꾸지 않음)."
                        }
                    >
                        {comparing ? "비교 중…" : "비교"}
                    </ZBCButton>
                    <ZBCButton
                        onClick={h_DryRun}
                        disabled={!dryCheck.ok}
                        title={dryReason ?? "rclone이 할 일을 미리 봅니다(파일은 바꾸지 않음)."}
                    >
                        미리보기
                    </ZBCButton>
                    <ZBCButton
                        variant="primary"
                        onClick={h_AskRun}
                        disabled={!realCheck.ok}
                        title={
                            realReason ??
                            (job?.mode === "sync"
                                ? "비교 결과대로 대상을 원본과 같게 만듭니다(삭제 포함)."
                                : "비교 결과대로 대상에 복사합니다.")
                        }
                    >
                        {RUN_LABEL[job?.mode ?? "copy"]}
                    </ZBCButton>
                </div>
                <output className={styles.reason}>{reasonText}</output>
            </header>

            <ZBCTabs
                id="job-tabs"
                tabs={f_Tabs(isNew)}
                active={activeTab === "compare" || activeTab === "run" ? activeTab : "edit"}
                onChange={setTab}
                aria-label="작업 화면"
            />
            {activeTab === "run" && job ? (
                <div
                    className={styles.panel}
                    role="tabpanel"
                    id="job-tabs-panel-run"
                    aria-labelledby="job-tabs-tab-run"
                >
                    <RunView job={job} />
                </div>
            ) : activeTab === "compare" && job ? (
                <div
                    className={styles.panel}
                    role="tabpanel"
                    id="job-tabs-panel-compare"
                    aria-labelledby="job-tabs-tab-compare"
                >
                    <CompareView job={job} />
                </div>
            ) : (
                <div
                    className={styles.panel}
                    role="tabpanel"
                    id="job-tabs-panel-edit"
                    aria-labelledby="job-tabs-tab-edit"
                >
                    <JobEditor />
                </div>
            )}

            <ZBCModal
                open={confirmRun && shownCompare !== null && realCheck.ok && !askDeletes}
                title={RUN_LABEL[job?.mode ?? "copy"]}
                onClose={h_CancelRun}
                footer={
                    <>
                        <ZBCButton onClick={h_CancelRun} initialFocus>
                            취소
                        </ZBCButton>
                        <ZBCButton variant="primary" onClick={h_ConfirmRun}>
                            {RUN_LABEL[job?.mode ?? "copy"]}
                        </ZBCButton>
                    </>
                }
            >
                {shownCompare && job && (
                    <>
                        <p>
                            ‘{job.name}’: {realRunConfirmText(shownCompare.summary, job.mode)}
                        </p>
                        <p>
                            {job.mode === "sync"
                                ? "삭제는 일어나지 않습니다(대상에만 있는 파일 없음)."
                                : "대상에만 있는 파일은 지우지 않습니다."}{" "}
                            {CANCEL_NOTE}
                        </p>
                    </>
                )}
            </ZBCModal>

            {askDeletes && job && shownCompare && (
                <DeleteConfirmModal
                    open
                    job={job}
                    compare={shownCompare}
                    safety={safety}
                    onCancel={h_CancelRun}
                    onConfirm={h_ConfirmDeletes}
                />
            )}

            <PlanDriftModal compareBlockedReason={compareReason} />

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
