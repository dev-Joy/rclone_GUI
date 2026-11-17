/**
 * 선택한 작업 화면: header(제목·mode·상태 배지, 편집·복제·삭제·⋯, 경로 줄) → toolbar(비교·동기화)
 * → 안내 줄(previewNotice·빈 폴더 불가 안내) → 실행 배너(#job-run-panel) → 밑줄 탭(파일 목록·기록) → footer(비교 시각·계획 상태).
 * 파일 목록(CompareView)과 실행 진행·결과(RunView kind="real")를 탭 본문에 두고, 실행 중에는 toolbar 아래
 * 실행 배너에 공통 중지(JobActivityBar)·진행률·남은 시간과 ‘진행 글 보기’를 둔다.
 * 실제 실행 확인 창은 작업 목록과 같은 흐름(useRunFlow·RunConfirmModals)을 쓴다: 삭제가 있는 동기화는
 * 삭제 확인 모달, 그 밖에는 간단한 확인 창. 사전 확인 불일치(PLAN_DRIFT)는 PlanDriftModal로 알린다.
 * 작업 편집은 HomePage가 모달로 띄운다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import {
    useEffect,
    useState,
    type ChangeEvent as typReactChangeEvent,
    type MouseEvent as typReactMouseEvent,
} from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import ZBCTabs from "@/components/ZBCTabs";
import { errorText, getApi, unwrap } from "@/lib/api";
import { canStartCompare, compareStaleReason, emptyDirsUnsupportedText } from "@/lib/compare-view";
import { isOsTaskMissing, missingRemoteNames } from "@/lib/job-list-view";
import { planFooterText, previewNotice, runPanelShown, syncButtonText } from "@/lib/job-steps";
import { sortJobs } from "@/lib/job-form";
import { activityStop, canStartRun, etaText, progressPercent } from "@/lib/run-view";
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
import { useUiStore } from "@/stores/ui-store";
import CompareView from "./CompareView";
import HistoryView from "./HistoryView";
import ItemMenu from "./ItemMenu";
import JobActivityBar from "./JobActivityBar";
import PlanDriftModal from "./PlanDriftModal";
import RunConfirmModals from "./RunConfirmModals";
import RunView from "./RunView";
import styles from "./JobWorkspace.module.css";

const MODE_LABEL = { copy: "복사", sync: "동기화(삭제 포함)" } as const;

/** 설정을 아직 못 읽었을 때의 삭제 확인 기준 */
const DEFAULT_SAFETY = createDefaultSettings().safety;
/** 비교 결과 낡음 판정을 다시 하는 간격 */
const STALE_TICK_MS = 30_000;
/** ⋯ 메뉴 폭(px) */
const TOOLS_MENU_WIDTH = 200;

export default function JobWorkspace() {
    // ========== hook & state 변수 선언 ==========
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [tools, setTools] = useState<{ x: number; y: number } | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const draft = useJobEditorStore((s) => s.draft);
    const dirty = useJobEditorStore(selectDirty);
    const guard = useJobEditorStore((s) => s.guard);
    const openJob = useJobEditorStore((s) => s.openJob);
    const closeDraft = useJobEditorStore((s) => s.close);
    const jobs = useJobsStore((s) => s.jobs);
    const selectedJobId = useJobsStore((s) => s.selectedJobId);
    const select = useJobsStore((s) => s.select);
    const removeJob = useJobsStore((s) => s.remove);
    const tab = useUiStore((s) => s.tab);
    const setTab = useUiStore((s) => s.setTab);
    const openEditor = useUiStore((s) => s.openEditor);
    const closeEditor = useUiStore((s) => s.closeEditor);
    const pushToast = useToastStore((s) => s.push);
    const compareActive = useCompareStore((s) => s.active);
    const compareRunningJobId = useCompareStore((s) => s.runningJobId);
    const compareResult = useCompareStore((s) => s.result);
    const runCompare = useCompareStore((s) => s.run);
    const runActive = useRunStore((s) => s.active);
    const runStartingJobId = useRunStore((s) => s.startingJobId);
    const last = useRunStore((s) => s.last);
    const runError = useRunStore((s) => s.error);
    const startRun = useRunStore((s) => s.start);
    const osStatus = useSchedulerStore((s) => s.osStatus);
    const env = useRcloneEnvStore((s) => s.env);
    const flow = useRunFlow();
    const safety = useSettingsStore((s) => s.settings?.safety ?? DEFAULT_SAFETY);
    const caseInsensitive = useSettingsStore(
        (s) => s.settings?.compare.caseInsensitivePaths ?? true,
    );
    const maxAgeMinutes = useSettingsStore((s) => s.settings?.safety.compareMaxAgeMinutes ?? 10);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        const timer = setInterval(() => setNowMs(Date.now()), STALE_TICK_MS);
        return () => clearInterval(timer);
    }, []);

    // ========== 내부 변수 (_V) ==========
    // 편집 모달은 HomePage가 띄운다. 작업 화면은 선택한 작업만 보여 준다
    const jobId = selectedJobId;
    const job = jobId === null ? null : (jobs.find((j) => j.id === jobId) ?? null);
    const isNew = jobId === null;
    const title = job?.name ?? (draft?.name.trim() || "새 작업");
    const running = runningCompare(compareActive, compareRunningJobId);
    const comparing = job !== null && running?.jobId === job.id;
    const runningJobId = runActive?.jobId ?? runStartingJobId;
    const shown = job && compareResult && compareResult.jobId === job.id ? compareResult : null;
    const stale = job && shown ? compareStaleReason(shown, job, maxAgeMinutes, nowMs) : null;
    const lastReal =
        job && last && last.record.jobId === job.id && !last.record.dryRun ? last : null;

    // "다시 비교"는 막힌 작업으로 옮겨 비교하므로 지금 보이는 작업의 저장 여부·경로는 보지 않는다
    let recompareReason: string | null = null;
    if (running) recompareReason = "다른 비교가 진행 중입니다.";
    else if (runningJobId !== null) recompareReason = "실행 중에는 비교할 수 없습니다.";

    const baseCompareCheck = canStartCompare({ job, dirty, running, caseInsensitive });
    const compareCheck =
        baseCompareCheck.ok && runningJobId !== null
            ? { ok: false as const, reason: "실행 중에는 비교할 수 없습니다." }
            : baseCompareCheck;
    const compareReason = compareCheck.ok ? null : compareCheck.reason;
    const compareLabel = comparing ? "비교 중…" : shown ? "다시 비교" : "비교";

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
    const syncText = job
        ? syncButtonText({
              job,
              compare: shown,
              staleReason: stale,
              maxAgeMinutes,
              nowMs,
              lastReal,
              realReady: realCheck.ok,
          })
        : { label: "동기화 — 먼저 [비교]를 누르세요", disabled: true };
    const syncReason =
        compareReason ??
        realReason ??
        (job?.mode === "sync"
            ? "비교 결과대로 대상을 원본과 같게 만듭니다(삭제 포함)."
            : "비교 결과대로 대상에 복사합니다.");

    const notice = job
        ? previewNotice({ jobId: job.id, compare: shown, run: runActive, last })
        : null;
    const emptyText = shown
        ? emptyDirsUnsupportedText(shown.summary, shown.destCanHaveEmptyDirs)
        : null;
    const runPanel = job
        ? runPanelShown({
              jobId: job.id,
              run: runActive,
              comparing,
              compareCreatedAt: shown?.createdAt ?? null,
              startError: runError,
              last,
          })
        : false;
    const footerText = planFooterText({ compare: shown, staleReason: stale });

    // 진행 중인 활동(비교·미리보기·실행)은 toolbar 아래 실행 배너에서 멈춘다
    const stopInfo = job ? activityStop({ jobId: job.id, compare: running, run: runActive }) : null;
    const jobRun = job && runActive && runActive.jobId === job.id ? runActive : null;
    const runLive = jobRun && !jobRun.dryRun ? jobRun : null;
    const percent = runLive ? progressPercent(runLive.stats) : null;

    const duplicateReason = dirty ? "저장하지 않은 변경이 있어 복제할 수 없습니다." : undefined;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    /** 복제: 값을 채운 편집 모달을 열고, 저장하면 새 작업이 된다(즉시 복제하지 않는다) */
    const f_Duplicate = () => {
        if (!job) return;
        useJobEditorStore.getState().openDuplicate(job);
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
    /** 터미널 명령 복사(비교·동기화). 실패는 notice로 알린다 */
    const f_CopyCommand = async (kind: "compare" | "sync") => {
        if (!job) return;
        try {
            const cmds = await unwrap(getApi().run.command(job.id));
            await unwrap(getApi().app.copyText(kind === "compare" ? cmds.compare : cmds.sync));
            pushToast(
                "success",
                kind === "compare" ? "비교 명령을 복사했습니다." : "동기화 명령을 복사했습니다.",
            );
        } catch (error) {
            pushToast("error", errorText(error));
        }
    };
    const h_AskRun = (id: string) => flow.ask(id);
    const h_Compare = () => {
        if (!job) return;
        void runCompare(job.id);
    };
    const h_Run = () => {
        if (!job) return;
        h_AskRun(job.id);
    };
    const h_Preview = () => {
        if (!job) return;
        void startRun(job.id, true);
    };
    const h_OpenEdit = () => {
        if (!job) return;
        const es = useJobEditorStore.getState();
        if (es.jobId !== job.id || es.draft === null) openJob(job);
        openEditor({ mode: "edit", jobId: job.id });
    };
    const h_OpenTools = (event: typReactMouseEvent<HTMLButtonElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setTools({ x: rect.right - TOOLS_MENU_WIDTH, y: rect.bottom + 4 });
    };
    const h_CloseTools = () => setTools(null);
    const h_CopyCompare = () => void f_CopyCommand("compare");
    const h_CopySync = () => void f_CopyCommand("sync");
    const h_ToggleDetail = (event: typReactChangeEvent<HTMLInputElement>) =>
        setDetailOpen(event.currentTarget.checked);
    const h_Duplicate = () => void f_Duplicate();
    const h_AskDelete = () => setConfirmDelete(true);
    const h_CancelDelete = () => setConfirmDelete(false);
    const h_ConfirmDelete = () => void f_Delete();
    /** 새 작업 작성 취소: 첫 작업의 작업 화면으로 돌아간다 */
    const h_CancelNew = () =>
        guard(() => {
            const first = sortJobs(useJobsStore.getState().jobs)[0]?.id ?? null;
            closeDraft();
            closeEditor();
            select(first);
            setTab("files");
        });

    const menuItems = [
        {
            id: "job-preview",
            label: "미리보기 실행",
            onSelect: h_Preview,
            disabled: !dryCheck.ok,
            title: dryReason ?? "rclone이 할 일을 미리 봅니다(파일은 바꾸지 않음).",
        },
        { label: "비교 명령 복사", onSelect: h_CopyCompare },
        { label: "동기화 명령 복사", onSelect: h_CopySync },
    ];

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
                            <ZBCButton id="job-open-edit" small onClick={h_OpenEdit}>
                                편집
                            </ZBCButton>
                            <ZBCButton
                                small
                                onClick={h_Duplicate}
                                disabled={dirty || busy}
                                title={duplicateReason}
                            >
                                복제
                            </ZBCButton>
                            <ZBCButton small variant="danger" onClick={h_AskDelete} disabled={busy}>
                                삭제
                            </ZBCButton>
                            <ZBCButton
                                small
                                onClick={h_OpenTools}
                                aria-label="작업 더 보기"
                                title="미리보기·명령 복사"
                            >
                                ⋯
                            </ZBCButton>
                        </>
                    )}
                </div>
                {job && (
                    <div className={styles.paths} title={`${job.source} → ${job.destination}`}>
                        <span className={styles.path}>{job.source}</span>
                        <span className={styles.arrow}>→</span>
                        <span className={styles.path}>{job.destination}</span>
                    </div>
                )}
            </header>

            {job && (
                <>
                    <div className={styles.toolbar}>
                        <ZBCButton
                            id="job-compare"
                            onClick={h_Compare}
                            disabled={!compareCheck.ok}
                            title={
                                compareReason ??
                                "원본·대상 목록을 읽어 차이를 봅니다(파일은 바꾸지 않음)."
                            }
                        >
                            {compareLabel}
                        </ZBCButton>
                        <ZBCButton
                            id="job-sync"
                            variant="primary"
                            onClick={h_Run}
                            disabled={syncText.disabled}
                            title={syncReason}
                        >
                            {syncText.label}
                        </ZBCButton>
                    </div>

                    {shown && (
                        <div className={styles.notices}>
                            {stale && (
                                <p className={styles.notice} data-level="warning" data-kind="stale">
                                    {stale}
                                </p>
                            )}
                            {shown.summary.conflictFiles > 0 && (
                                <p className={styles.notice} data-level="danger">
                                    파일과 폴더 이름이 겹치는 항목 {shown.summary.conflictFiles}개는
                                    직접 정리해야 합니다.
                                </p>
                            )}
                            {shown.warnings.map((w) => (
                                <p key={w} className={styles.notice} data-level="warning">
                                    {w}
                                </p>
                            ))}
                            {emptyText && (
                                <p
                                    className={styles.notice}
                                    data-level="warning"
                                    data-kind="emptyDirsUnsupported"
                                    id="compare-empty-dirs-unsupported"
                                >
                                    {emptyText}
                                </p>
                            )}
                            {notice && (
                                <p
                                    className={styles.notice}
                                    data-level={notice.tone}
                                    id="job-preview-notice"
                                    aria-live="polite"
                                >
                                    {notice.text}
                                </p>
                            )}
                        </div>
                    )}

                    {stopInfo !== null && (
                        <section
                            id="job-run-panel"
                            className={styles.runPanel}
                            aria-label="실행 진행·결과"
                        >
                            <div className={styles.runBanner}>
                                <JobActivityBar jobId={job.id} />
                                {(runLive !== null || stopInfo.target === "run") && (
                                    <div className={styles.runMetaRow}>
                                        {percent !== null && (
                                            <progress
                                                className={styles.progressBar}
                                                max={100}
                                                value={percent}
                                                aria-label="실행 진행률"
                                            />
                                        )}
                                        {runLive && (
                                            <span className={styles.runMeta}>
                                                남은 시간 {etaText(runLive.stats, true)}
                                            </span>
                                        )}
                                        {stopInfo.target === "run" && (
                                            <label className={styles.detailToggle}>
                                                <input
                                                    type="checkbox"
                                                    id="job-run-detail"
                                                    checked={detailOpen}
                                                    onChange={h_ToggleDetail}
                                                />
                                                진행 글 보기
                                            </label>
                                        )}
                                    </div>
                                )}
                            </div>
                            {detailOpen && stopInfo.target === "run" && (
                                <RunView job={job} kind={jobRun?.dryRun ? "preview" : "real"} />
                            )}
                        </section>
                    )}

                    <ZBCTabs
                        id="job"
                        aria-label="아래에 볼 것"
                        active={tab}
                        onChange={setTab}
                        tabs={[
                            { id: "files", label: "파일 목록" },
                            { id: "history", label: "기록", domId: "job-open-history" },
                        ]}
                    />

                    <div
                        className={styles.tabPanel}
                        id={`job-panel-${tab}`}
                        role="tabpanel"
                        aria-labelledby={tab === "history" ? "job-open-history" : `job-tab-${tab}`}
                    >
                        {tab === "history" ? (
                            <HistoryView job={job} />
                        ) : runPanel && stopInfo === null ? (
                            <section
                                id="job-run-panel"
                                className={styles.runPanel}
                                aria-label="실행 진행·결과"
                            >
                                <RunView job={job} kind="real" />
                            </section>
                        ) : (
                            <CompareView job={job} />
                        )}
                    </div>

                    <footer className={styles.footer}>
                        <span className={styles.footerItem}>
                            {footerText ?? "아직 비교하지 않았습니다"}
                        </span>
                    </footer>
                </>
            )}

            <ItemMenu
                open={tools !== null}
                items={menuItems}
                onClose={h_CloseTools}
                x={tools?.x}
                y={tools?.y}
                label="작업 더 보기"
                width={TOOLS_MENU_WIDTH}
            />

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
