/**
 * 왼쪽 작업 목록(250px 고정, INT-008 FR-5·FR-17).
 * 그룹이 있으면 그룹 머리글(이름·작업 수·접기/펼치기) 아래에 소속 작업을, 그룹 없는 작업은 마지막에
 * `그룹 없음` 머리글로 묶는다. 그룹이 하나도 없으면 지금처럼 평평한 목록이다. 접힘 상태는 세션 안에서만 둔다.
 * 항목: 상태 점·이름·mode 배지·`원본 → 대상`·하위 문구(예약·최근 실행·상태)와 remote 없음·OS 예약 배지.
 * 선택 항목은 왼쪽 accent 막대(inset 3px)와 --panel-2 배경이다. 작업 선택은 선택만 하고 편집기는 열지 않는다.
 * 저장하지 않은 변경이 있으면 다른 작업으로 옮기기 전에 확인한다(guard).
 * "지금 실행"은 그 작업을 비교한 뒤 확인 창(삭제가 있는 동기화는 삭제 확인 모달)을 거쳐 실행한다
 * (useRunFlow, INT-002 T-04). 하단의 `+ 새 작업`은 편집기를, `+ 새 그룹`은 그룹 이름 대화상자를 연다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useMemo, useState } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCDot from "@/components/ZBCDot";
import ZBCModal from "@/components/ZBCModal";
import { canStartCompare } from "@/lib/compare-view";
import { sortJobs } from "@/lib/job-form";
import { isOsTaskMissing, jobListItem, missingRemoteNames } from "@/lib/job-list-view";
import { shortenPath } from "@/lib/path-display";
import { useRunFlow } from "@/lib/use-run-flow";
import { createDefaultSettings } from "@/shared/defaults";
import { formatLocalDateTime } from "@/shared/format";
import type { itfGroup } from "@/shared/schemas/group";
import type { typJob } from "@/shared/schemas/job";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { useGroupsStore } from "@/stores/groups-store";
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useRunStore } from "@/stores/run-store";
import { useSchedulerStore } from "@/stores/scheduler-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import GroupNameDialog from "./GroupNameDialog";
import RunConfirmModals from "./RunConfirmModals";
import styles from "./JobSidebar.module.css";

/** 설정을 아직 못 읽었을 때의 삭제 확인 기준 */
const DEFAULT_SAFETY = createDefaultSettings().safety;
const RUN_NOW_TITLE = "비교한 뒤 확인 창을 거쳐 실행합니다.";
/** 그룹 없음 묶음의 접힘 상태 키(그룹 id와 겹치지 않는다) */
const UNGROUPED_KEY = "__ungrouped__";

export default function JobSidebar() {
    // ========== hook & state 변수 선언 ==========
    const jobs = useJobsStore((s) => s.jobs);
    const error = useJobsStore((s) => s.error);
    const selectedJobId = useJobsStore((s) => s.selectedJobId);
    const select = useJobsStore((s) => s.select);
    const groups = useGroupsStore((s) => s.groups);
    const removeGroup = useGroupsStore((s) => s.remove);
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
    /** 접힌 그룹(세션 안에서만. 저장하지 않는다) */
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
    /** 이름 대화상자 대상: "new" 또는 그룹 */
    const [naming, setNaming] = useState<itfGroup | "new" | null>(null);
    /** 삭제 확인 대화상자 대상 */
    const [deleting, setDeleting] = useState<itfGroup | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // ========== 내부 변수 (_V) ==========
    const sorted = useMemo(() => sortJobs(jobs), [jobs]);
    const showStatus = settings?.ui.showJobStatusText ?? true;
    const caseInsensitive = settings?.compare.caseInsensitivePaths ?? true;
    const safety = settings?.safety ?? DEFAULT_SAFETY;
    const comparing = runningCompare(compareActive, compareRunningJobId);
    const runningJobId = runActive?.jobId ?? runStartingJobId;
    const grouped = groups.length > 0;
    const groupIds = new Set(groups.map((g) => g.id));
    const ungrouped = grouped
        ? sorted.filter((j) => j.groupId === null || !groupIds.has(j.groupId))
        : sorted;

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
    /** 그룹을 접거나 편다(세션 안에서만) */
    const h_ToggleGroup = (key: string) => () => {
        setCollapsed((cur) => {
            const next = new Set(cur);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };
    const h_OpenNewGroup = () => setNaming("new");
    const h_RenameGroup = (group: itfGroup) => () => setNaming(group);
    const h_DeleteGroup = (group: itfGroup) => () => {
        setDeleteError(null);
        setDeleting(group);
    };
    const h_CloseNaming = () => setNaming(null);
    const h_CancelDelete = () => {
        setDeleting(null);
        setDeleteError(null);
    };
    const h_ConfirmDelete = () => {
        if (deleting === null) return;
        void removeGroup(deleting.id).then((r) => {
            if (r.ok) setDeleting(null);
            else setDeleteError(r.error.message);
            return undefined;
        });
    };

    /** 작업 한 줄 */
    const f_JobItem = (job: typJob) => {
        const item = jobListItem(job, { showStatus });
        const reason = f_RunNowReason(job);
        const nameId = `job-item-name-${job.id}`;
        const missing =
            env === null || env.problem !== null ? [] : missingRemoteNames(job, env.remotes);
        return (
            <li key={job.id} className={styles.row}>
                <button
                    type="button"
                    className={styles.item}
                    aria-current={job.id === selectedJobId ? "true" : undefined}
                    onClick={h_Select(job.id)}
                    title={[job.name, `원본: ${job.source}`, `대상: ${job.destination}`].join("\n")}
                >
                    <ZBCDot tone={job.lastRun?.status ?? "none"} />
                    <span className={styles.text}>
                        <span className={styles.nameRow}>
                            <span id={nameId} className={styles.name}>
                                {job.name}
                            </span>
                            <ZBCBadge tone={job.mode === "sync" ? "warning" : "neutral"}>
                                {job.mode === "sync" ? "동기화" : "복사"}
                            </ZBCBadge>
                        </span>
                        <span className={styles.route} title={item.pathsTitle}>
                            <span className={styles.routePart}>{shortenPath(job.source)}</span>
                            <span className={styles.routeArrow}>→</span>
                            <span className={styles.routePart}>{shortenPath(job.destination)}</span>
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
    };

    /** 그룹 하나(없으면 `그룹 없음`)와 그 작업들 */
    const f_Section = (group: itfGroup | null, members: typJob[]) => {
        const key = group?.id ?? UNGROUPED_KEY;
        const open = !collapsed.has(key);
        const ariaName = group?.name ?? "그룹 없음";
        return (
            <li key={`group:${key}`} className={styles.section}>
                <div className={styles.groupHead}>
                    <button
                        type="button"
                        className={styles.groupToggle}
                        aria-expanded={open}
                        onClick={h_ToggleGroup(key)}
                        title={open ? `${ariaName} 접기` : `${ariaName} 펼치기`}
                    >
                        <span className={styles.groupCaret} aria-hidden="true">
                            {open ? "▾" : "▸"}
                        </span>
                        <span className={styles.groupName}>{ariaName}</span>
                        <span className={styles.groupCount}>{members.length}</span>
                    </button>
                    {group !== null && (
                        <>
                            <ZBCButton
                                small
                                variant="ghost"
                                aria-label={`${group.name} 그룹 이름 바꾸기`}
                                onClick={h_RenameGroup(group)}
                            >
                                이름 바꾸기
                            </ZBCButton>
                            <ZBCButton
                                small
                                variant="ghost"
                                aria-label={`${group.name} 그룹 지우기`}
                                onClick={h_DeleteGroup(group)}
                            >
                                지우기
                            </ZBCButton>
                        </>
                    )}
                </div>
                {open && <ul className={styles.members}>{members.map(f_JobItem)}</ul>}
            </li>
        );
    };

    const deleteMemberCount =
        deleting === null ? 0 : sorted.filter((j) => j.groupId === deleting.id).length;

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
                {!grouped && sorted.map(f_JobItem)}
                {grouped &&
                    groups.map((group) =>
                        f_Section(
                            group,
                            sorted.filter((j) => j.groupId === group.id),
                        ),
                    )}
                {grouped && ungrouped.length > 0 && f_Section(null, ungrouped)}
            </ul>
            {jobs.length === 0 && !editingNew && (
                <p className={styles.empty}>아직 저장된 작업이 없습니다.</p>
            )}
            <div className={styles.addRow}>
                <ZBCButton variant="primary" onClick={h_New} disabled={!settings}>
                    + 새 작업
                </ZBCButton>
                <ZBCButton onClick={h_OpenNewGroup}>+ 새 그룹</ZBCButton>
            </div>
            {naming !== null && (
                <GroupNameDialog
                    {...(naming === "new" ? {} : { group: naming })}
                    onClose={h_CloseNaming}
                />
            )}
            {deleting !== null && (
                <ZBCModal
                    open
                    title="그룹 지우기"
                    onClose={h_CancelDelete}
                    footer={
                        <>
                            <ZBCButton onClick={h_CancelDelete}>취소</ZBCButton>
                            <ZBCButton variant="danger" onClick={h_ConfirmDelete}>
                                지우기
                            </ZBCButton>
                        </>
                    }
                >
                    <div className={styles.deleteBody}>
                        <p>
                            ‘{deleting.name}’ 그룹을 지웁니다.{" "}
                            {deleteMemberCount > 0
                                ? `속한 작업 ${deleteMemberCount}개는 그룹 없음으로 옮깁니다.`
                                : "속한 작업은 없습니다."}
                        </p>
                        <p className={styles.muted}>작업 자체는 지워지지 않습니다.</p>
                        {deleteError !== null && (
                            <p className={styles.error} role="alert">
                                {deleteError}
                            </p>
                        )}
                    </div>
                </ZBCModal>
            )}
            <RunConfirmModals flow={flow} safety={safety} />
        </nav>
    );
}
