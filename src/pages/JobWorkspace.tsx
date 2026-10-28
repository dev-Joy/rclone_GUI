/**
 * 선택한 작업 화면: 헤더(이름·경로·모드, 복제·삭제·비교·실행)와 탭(비교·실행·이력·작업 설정).
 * "비교" 버튼은 저장된 작업에서 비교를 시작하고 비교 탭으로 옮긴다(안 되면 이유를 표시).
 * 실행(복사·동기화) 버튼은 다음 단계까지 항상 비활성이다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useState } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import ZBCTabs, { type itfZBCTab } from "@/components/ZBCTabs";
import { canStartCompare } from "@/lib/compare-view";
import { sortJobs } from "@/lib/job-form";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { selectDirty, useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";
import { useUiStore, type typJobTab } from "@/stores/ui-store";
import CompareView from "./CompareView";
import JobEditor from "./JobEditor";
import styles from "./JobWorkspace.module.css";

const MODE_LABEL = { copy: "복사", sync: "동기화(삭제 포함)" } as const;

const RUN_REASON = "실행은 다음 단계에서 제공합니다.";

/** 비교 탭은 저장된 작업에서만 연다 */
function f_Tabs(isNew: boolean): readonly itfZBCTab<typJobTab>[] {
    return [
        { id: "compare", label: "비교", disabled: isNew },
        { id: "run", label: "실행", disabled: true, badge: "준비 중" },
        { id: "history", label: "이력", disabled: true, badge: "준비 중" },
        { id: "edit", label: "작업 설정" },
    ];
}

export default function JobWorkspace() {
    // ========== hook & state 변수 선언 ==========
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);
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
    const caseInsensitive = useSettingsStore(
        (s) => s.settings?.compare.caseInsensitivePaths ?? true,
    );

    // ========== 내부 변수 (_V) ==========
    const job = jobId === null ? null : (jobs.find((j) => j.id === jobId) ?? null);
    const isNew = jobId === null;
    const title = job?.name ?? (draft?.name.trim() || "새 작업");
    // 새 작업에서는 비교 탭을 열 수 없으므로 작업 설정으로 보인다
    const activeTab: typJobTab = isNew && tab === "compare" ? "edit" : tab;
    const running = runningCompare(compareActive, compareRunningJobId);
    const comparing = job !== null && running?.jobId === job.id;
    const compareCheck = canStartCompare({ job, dirty, running, caseInsensitive });
    const compareReason = compareCheck.ok ? null : compareCheck.reason;
    const runReason = isNew
        ? "먼저 작업을 저장하세요."
        : [compareReason, RUN_REASON].filter(Boolean).join(" ");
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
                    <ZBCButton variant="primary" disabled title={RUN_REASON}>
                        {job?.mode === "sync" ? "동기화 실행" : "복사 실행"}
                    </ZBCButton>
                </div>
                <output className={styles.reason}>{runReason}</output>
            </header>

            <ZBCTabs
                id="job-tabs"
                tabs={f_Tabs(isNew)}
                active={activeTab === "compare" ? "compare" : "edit"}
                onChange={setTab}
                aria-label="작업 화면"
            />
            {activeTab === "compare" && job ? (
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
