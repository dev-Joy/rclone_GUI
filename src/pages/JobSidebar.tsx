/**
 * 왼쪽 작업 목록. 이름순으로 보여 주고(모드·자동·마지막 실행), "새 작업"으로 초안을 연다.
 * 저장하지 않은 변경이 있으면 다른 작업으로 옮기기 전에 확인한다(guard).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useMemo } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import { sortJobs } from "@/lib/job-form";
import { formatLocalDateTime } from "@/shared/format";
import type { typRunStatus } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import styles from "./JobSidebar.module.css";

const STATUS_LABEL: Record<typRunStatus, string> = {
    running: "실행 중",
    success: "성공",
    partial: "일부 실패",
    failed: "실패",
    canceled: "취소됨",
    blocked: "차단됨",
    noop: "변경 없음",
    interrupted: "중단됨",
};

function f_LastRunText(job: typJob): string {
    if (!job.lastRun) return "실행 기록 없음";
    return `${STATUS_LABEL[job.lastRun.status]} · ${formatLocalDateTime(job.lastRun.at)}`;
}

export default function JobSidebar() {
    // ========== hook & state 변수 선언 ==========
    const jobs = useJobsStore((s) => s.jobs);
    const error = useJobsStore((s) => s.error);
    const selectedJobId = useJobsStore((s) => s.selectedJobId);
    const select = useJobsStore((s) => s.select);
    const editorOpen = useJobEditorStore((s) => s.open);
    const editingNew = useJobEditorStore((s) => s.open && s.jobId === null);
    const guard = useJobEditorStore((s) => s.guard);
    const openNew = useJobEditorStore((s) => s.openNew);
    const settings = useSettingsStore((s) => s.settings);
    const view = useUiStore((s) => s.view);
    const setView = useUiStore((s) => s.setView);
    const setTab = useUiStore((s) => s.setTab);
    const leaveSettings = useUiStore((s) => s.leaveSettings);

    // ========== 내부 변수 (_V) ==========
    const sorted = useMemo(() => sortJobs(jobs), [jobs]);
    const inJobView = view === "job" && editorOpen;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_New = () => {
        if (!settings) return;
        leaveSettings(() =>
            guard(() => {
                select(null);
                openNew(settings);
                setView("job");
                setTab("edit");
            }),
        );
    };
    const h_Select = (id: string) => () => {
        if (id === selectedJobId && inJobView) return;
        leaveSettings(() =>
            guard(() => {
                select(id);
                setView("job");
            }),
        );
    };

    return (
        <nav className={styles.JobSidebar} aria-labelledby="jobs-title">
            <div className={styles.head}>
                <h2 id="jobs-title" className={styles.title}>
                    저장된 작업 {jobs.length}개
                </h2>
                <ZBCButton variant="primary" onClick={h_New} disabled={!settings}>
                    새 작업
                </ZBCButton>
            </div>
            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}
            <ul className={styles.list}>
                {editingNew && (
                    <li>
                        <div
                            className={styles.item}
                            aria-current={view === "job" ? "true" : undefined}
                        >
                            <span className={styles.name}>새 작업(저장 안 됨)</span>
                        </div>
                    </li>
                )}
                {sorted.map((job) => (
                    <li key={job.id}>
                        <button
                            type="button"
                            className={styles.item}
                            aria-current={
                                inJobView && job.id === selectedJobId ? "true" : undefined
                            }
                            onClick={h_Select(job.id)}
                            title={`${job.source} → ${job.destination}`}
                        >
                            <span className={styles.name}>{job.name}</span>
                            <span className={styles.badges}>
                                <ZBCBadge tone={job.mode === "sync" ? "warning" : "neutral"}>
                                    {job.mode === "sync" ? "동기화" : "복사"}
                                </ZBCBadge>
                                {job.autoSync.enabled && (
                                    <ZBCBadge
                                        tone="accent"
                                        title={`다음 실행: ${formatLocalDateTime(job.autoSync.nextRunAt)}`}
                                    >
                                        자동
                                    </ZBCBadge>
                                )}
                            </span>
                            <span className={styles.meta}>{f_LastRunText(job)}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {jobs.length === 0 && !editingNew && (
                <p className={styles.empty}>아직 저장된 작업이 없습니다.</p>
            )}
        </nav>
    );
}
