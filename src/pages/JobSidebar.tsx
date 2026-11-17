/**
 * 왼쪽 작업 목록(250px 고정, INT-008 FR-5). 이름순으로 보여 준다.
 * 항목: 상태 점·이름·mode 배지·`원본 → 대상`·하위 문구(예약·최근 실행·상태)와 remote 없음·OS 예약 배지.
 * 선택 항목은 왼쪽 accent 막대(inset 3px)와 --panel-2 배경이다. 작업 선택은 선택만 하고 편집기는 열지 않는다.
 * 저장하지 않은 변경이 있으면 다른 작업으로 옮기기 전에 확인한다(guard).
 * "지금 실행"은 그 작업을 비교한 뒤 확인 창(삭제가 있는 동기화는 삭제 확인 모달)을 거쳐 실행한다
 * (useRunFlow, INT-002 T-04). 하단의 `+ 새 작업`은 편집기를 연다. 상태 문구는 설정 ui.showJobStatusText로 숨길 수 있다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useMemo } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCDot from "@/components/ZBCDot";
import { canStartCompare } from "@/lib/compare-view";
import { sortJobs } from "@/lib/job-form";
import { isOsTaskMissing, jobListItem, missingRemoteNames } from "@/lib/job-list-view";
import { shortenPath } from "@/lib/path-display";
import { useRunFlow } from "@/lib/use-run-flow";
import { createDefaultSettings } from "@/shared/defaults";
import { formatLocalDateTime } from "@/shared/format";
import type { typJob } from "@/shared/schemas/job";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useRunStore } from "@/stores/run-store";
import { useSchedulerStore } from "@/stores/scheduler-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import RunConfirmModals from "./RunConfirmModals";
import styles from "./JobSidebar.module.css";

/** 설정을 아직 못 읽었을 때의 삭제 확인 기준 */
const DEFAULT_SAFETY = createDefaultSettings().safety;
const RUN_NOW_TITLE = "비교한 뒤 확인 창을 거쳐 실행합니다.";

export default function JobSidebar() {
    // ========== hook & state 변수 선언 ==========
    const jobs = useJobsStore((s) => s.jobs);
    const error = useJobsStore((s) => s.error);
    const selectedJobId = useJobsStore((s) => s.selectedJobId);
    const select = useJobsStore((s) => s.select);
    const editor = useUiStore((s) => s.editor);
    const settingsOpen = useUiStore((s) => s.settingsOpen);
    const editingNew = editor?.mode === "new";
    const guard = useJobEditorStore((s) => s.guard);
    const closeDraft = useJobEditorStore((s) => s.close);
    const openNew = useJobEditorStore((s) => s.openNew);
    const settings = useSettingsStore((s) => s.settings);
    const setTab = useUiStore((s) => s.setTab);
    const closeEditor = useUiStore((s) => s.closeEditor);
    const closeSettings = useUiStore((s) => s.closeSettings);
    const leaveSettings = useUiStore((s) => s.leaveSettings);
    const compareActive = useCompareStore((s) => s.active);
    const compareRunningJobId = useCompareStore((s) => s.runningJobId);
    const runActive = useRunStore((s) => s.active);
    const runStartingJobId = useRunStore((s) => s.startingJobId);
    const osStatus = useSchedulerStore((s) => s.osStatus);
    const env = useRcloneEnvStore((s) => s.env);
    const flow = useRunFlow();

    // ========== 내부 변수 (_V) ==========
    const sorted = useMemo(() => sortJobs(jobs), [jobs]);
    const showStatus = settings?.ui.showJobStatusText ?? true;
    const caseInsensitive = settings?.compare.caseInsensitivePaths ?? true;
    const safety = settings?.safety ?? DEFAULT_SAFETY;
    const comparing = runningCompare(compareActive, compareRunningJobId);
    const runningJobId = runActive?.jobId ?? runStartingJobId;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_New = () => {
        if (!settings) return;
        leaveSettings(() =>
            guard(() => {
                select(null);
                openNew(settings);
                setTab("files");
                closeSettings();
            }),
        );
    };
    /** 지금 실행할 수 없는 이유(없으면 null). 편집 중 변경은 선택할 때 guard가 확인한다 */
    const f_RunNowReason = (job: typJob): string | null => {
        if (runningJobId !== null) return "실행 중에는 시작할 수 없습니다.";
        const c = canStartCompare({ job, dirty: false, running: comparing, caseInsensitive });
        return c.ok ? null : c.reason;
    };
    const h_RunNow = (id: string) => () => flow.compareThenAsk(id);
    const h_Select = (id: string) => () => {
        if (id === selectedJobId && editor === null && !settingsOpen) return;
        leaveSettings(() =>
            guard(() => {
                select(id);
                setTab("files");
                closeEditor();
                closeDraft();
                closeSettings();
            }),
        );
    };

    return (
        <nav className={styles.JobSidebar} aria-labelledby="jobs-title">
            <div className={styles.head}>
                <h2 id="jobs-title" className={styles.title}>
                    저장된 작업 {jobs.length}개
                </h2>
            </div>
            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}
            <ul className={styles.list}>
                {editingNew && (
                    <li>
                        <div className={styles.item} aria-current={editingNew ? "true" : undefined}>
                            <ZBCDot />
                            <span className={styles.text}>
                                <span className={styles.name}>새 작업(저장 안 됨)</span>
                            </span>
                        </div>
                    </li>
                )}
                {sorted.map((job) => {
                    const item = jobListItem(job, { showStatus });
                    const reason = f_RunNowReason(job);
                    const nameId = `job-item-name-${job.id}`;
                    const missing =
                        env === null || env.problem !== null
                            ? []
                            : missingRemoteNames(job, env.remotes);
                    return (
                        <li key={job.id} className={styles.row}>
                            <button
                                type="button"
                                className={styles.item}
                                aria-current={job.id === selectedJobId ? "true" : undefined}
                                onClick={h_Select(job.id)}
                                title={[
                                    job.name,
                                    `원본: ${job.source}`,
                                    `대상: ${job.destination}`,
                                ].join("\n")}
                            >
                                <ZBCDot tone={job.lastRun?.status ?? "none"} />
                                <span className={styles.text}>
                                    <span className={styles.nameRow}>
                                        <span id={nameId} className={styles.name}>
                                            {job.name}
                                        </span>
                                        <ZBCBadge
                                            tone={job.mode === "sync" ? "warning" : "neutral"}
                                        >
                                            {job.mode === "sync" ? "동기화" : "복사"}
                                        </ZBCBadge>
                                    </span>
                                    <span className={styles.route} title={item.pathsTitle}>
                                        <span className={styles.routePart}>
                                            {shortenPath(job.source)}
                                        </span>
                                        <span className={styles.routeArrow}>→</span>
                                        <span className={styles.routePart}>
                                            {shortenPath(job.destination)}
                                        </span>
                                    </span>
                                    <span className={styles.sub}>
                                        {job.autoSync.enabled && job.autoSync.backend !== "os" && (
                                            <ZBCBadge
                                                tone="accent"
                                                title={`다음 실행: ${formatLocalDateTime(job.autoSync.nextRunAt)}`}
                                            >
                                                자동
                                            </ZBCBadge>
                                        )}
                                        {job.autoSync.enabled && job.autoSync.backend === "os" && (
                                            <ZBCBadge
                                                tone="accent"
                                                title="Windows 작업 스케줄러가 앱이 꺼져 있어도 실행합니다"
                                            >
                                                Windows 예약
                                            </ZBCBadge>
                                        )}
                                        {isOsTaskMissing(job, osStatus) && (
                                            <ZBCBadge tone="warning">OS 예약 미등록</ZBCBadge>
                                        )}
                                        {missing.length > 0 && (
                                            <ZBCBadge
                                                tone="warning"
                                                title={`rclone 설정에 없는 리모트: ${missing.map((n) => `${n}:`).join(", ")}`}
                                            >
                                                remote 없음
                                            </ZBCBadge>
                                        )}
                                        <span className={styles.subText}>
                                            {[item.scheduleText, item.lastRunText, item.statusText]
                                                .filter((t) => t !== null)
                                                .join(" · ")}
                                        </span>
                                    </span>
                                </span>
                            </button>
                            <ZBCButton
                                small
                                aria-label="지금 실행"
                                aria-describedby={nameId}
                                title={reason ?? RUN_NOW_TITLE}
                                disabled={reason !== null}
                                onClick={h_RunNow(job.id)}
                            >
                                실행
                            </ZBCButton>
                        </li>
                    );
                })}
            </ul>
            {jobs.length === 0 && !editingNew && (
                <p className={styles.empty}>아직 저장된 작업이 없습니다.</p>
            )}
            <div className={styles.addRow}>
                <ZBCButton variant="primary" onClick={h_New} disabled={!settings}>
                    + 새 작업
                </ZBCButton>
            </div>
            <RunConfirmModals flow={flow} safety={safety} />
        </nav>
    );
}
