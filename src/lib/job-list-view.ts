/**
 * 작업 목록(JobSidebar) 한 줄에 보일 문구를 만드는 순수 함수 (INT-002 T-04).
 * 원본 → 대상(가운데 줄임), 자동 실행 요약, 최근 실행 시각, 상태 문구(설정으로 숨김), Windows 예약 미등록 여부.
 * DOM·window 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-11-02
 */

// ========== Internal imports ==========
import { shortenPath } from "@/lib/path-display";
import { formatLocalDateTime } from "@/shared/format";
import { parsePath } from "@/shared/path-utils";
import { scheduleText } from "@/shared/schedule";
import type { typRunStatus } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import type { itfOsScheduleStatus } from "@/shared/types/scheduler";

/** 최근 실행 상태 문구 */
export const STATUS_LABEL: Record<typRunStatus, string> = {
    running: "실행 중",
    success: "성공",
    partial: "일부 실패",
    failed: "실패",
    canceled: "중지됨",
    blocked: "차단됨",
    noop: "바꿀 것 없음",
    interrupted: "중단됨",
};

export interface itfJobListItem {
    /** "원본 → 대상" (각 경로 가운데 줄임) */
    pathsText: string;
    /** 줄이지 않은 "원본 → 대상" (title) */
    pathsTitle: string;
    /** 자동 실행이 꺼져 있으면 null */
    scheduleText: string | null;
    /** "최근 실행 YYYY-MM-DD HH:mm:ss" 또는 "실행 기록 없음" */
    lastRunText: string;
    /** 상태 문구 표시가 켜져 있고 실행 기록이 있을 때만 */
    statusText: string | null;
}

/**
 * 자동 실행 요약. 꺼져 있으면 null, 켜져 있으면 "30분마다 · 다음 11-02 10:30",
 * "매일 09:00 · 다음 …", "매주 월·수 09:00 · 다음 …".
 * Windows 작업 스케줄러 예약은 앱이 다음 시각을 모르므로 "Windows 예약 · 매일 09:00".
 */
export function scheduleSummary(job: Pick<typJob, "autoSync">): string | null {
    const a = job.autoSync;
    if (!a.enabled) return null;
    const every = scheduleText(a);
    if (a.backend === "os") return `Windows 예약 · ${every}`;
    const next = formatLocalDateTime(a.nextRunAt);
    return next === "-" ? every : `${every} · 다음 ${next.slice(5, 16)}`;
}

/** 작업 목록 한 줄의 문구 */
export function jobListItem(job: typJob, opts: { showStatus: boolean }): itfJobListItem {
    const last = job.lastRun;
    return {
        pathsText: `${shortenPath(job.source)} → ${shortenPath(job.destination)}`,
        pathsTitle: `${job.source} → ${job.destination}`,
        scheduleText: scheduleSummary(job),
        lastRunText: last ? `최근 실행 ${formatLocalDateTime(last.at)}` : "실행 기록 없음",
        statusText: opts.showStatus && last ? STATUS_LABEL[last.status] : null,
    };
}

/**
 * Windows 예약이 켜진 작업인데 등록되지 않았거나 등록·삭제 실패 문구가 있는지(배지 "OS 예약 미등록").
 * OS 예약을 쓸 수 없는 환경이거나 아직 상태를 모르면(목록에 없음) false.
 */
export function isOsTaskMissing(
    job: Pick<typJob, "id" | "autoSync">,
    status: itfOsScheduleStatus | null,
): boolean {
    if (!job.autoSync.enabled || job.autoSync.backend !== "os") return false;
    if (!status?.available) return false;
    const id = job.id.toLowerCase();
    const task = status.tasks.find((t) => t.jobId === id);
    return task !== undefined && (!task.registered || task.error !== null);
}

/**
 * 기본 conf를 쓰는 작업이 가리키는 remote 중 목록에 없는 이름(FR-25).
 * remotes가 null이면(아직 못 읽음) 표시하지 않는다. 작업별 conf를 쓰는 작업도 확인하지 않는다.
 */
export function missingRemoteNames(
    job: Pick<typJob, "source" | "destination" | "configPathOverride">,
    remotes: readonly string[] | null,
): string[] {
    if (remotes === null || job.configPathOverride !== null) return [];
    const known = new Set(remotes.map((n) => n.toLowerCase()));
    const out: string[] = [];
    for (const raw of [job.source, job.destination]) {
        const r = parsePath(raw);
        if (!r.ok || r.path.kind !== "remote") continue;
        const name = r.path.root.slice(0, -1);
        if (!known.has(name.toLowerCase()) && !out.includes(name)) out.push(name);
    }
    return out;
}
