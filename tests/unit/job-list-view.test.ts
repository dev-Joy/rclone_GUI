// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { isOsTaskMissing, jobListItem, scheduleSummary, STATUS_LABEL } from "@/lib/job-list-view";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import { formatLocalDateTime } from "@/shared/format";
import type { typJob } from "@/shared/schemas/job";

function f_Job(over: Partial<typJob> = {}): typJob {
    const draft = createJobDraft(createDefaultSettings());
    return {
        ...draft,
        name: "작업",
        source: "C:\\tmp\\src",
        destination: "D:\\tmp\\dst",
        id: "00000000-0000-4000-8000-000000000001",
        autoSync: { ...draft.autoSync, nextRunAt: null, lastAutoRunAt: null },
        rev: 0,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        lastRun: null,
        ...over,
    };
}

const AT = "2026-11-02T01:30:00.000Z";

describe("scheduleSummary (INT-002 T-04)", () => {
    it("자동 실행이 꺼져 있으면 null", () => {
        expect(scheduleSummary(f_Job())).toBeNull();
    });

    it("켜져 있으면 주기와 다음 실행(MM-DD HH:mm)", () => {
        const job = f_Job({
            autoSync: {
                enabled: true,
                intervalMinutes: 60,
                allowDeletes: false,
                kind: "interval",
                timeOfDay: "09:00",
                weekdays: 62,
                backend: "app",
                nextRunAt: AT,
                lastAutoRunAt: null,
            },
        });
        expect(scheduleSummary(job)).toBe(
            `1시간마다 · 다음 ${formatLocalDateTime(AT).slice(5, 16)}`,
        );
        expect(scheduleSummary({ autoSync: { ...job.autoSync, nextRunAt: null } })).toBe(
            "1시간마다",
        );
        expect(
            scheduleSummary({
                autoSync: { ...job.autoSync, intervalMinutes: 30, nextRunAt: null },
            }),
        ).toBe("30분마다");
    });

    it("매일·요일 예약 표시 (INT-002 T-06)", () => {
        const base = f_Job().autoSync;
        const on = { ...base, enabled: true, nextRunAt: null };
        expect(scheduleSummary({ autoSync: { ...on, kind: "daily", timeOfDay: "07:30" } })).toBe(
            "매일 07:30",
        );
        expect(
            scheduleSummary({
                autoSync: {
                    ...on,
                    kind: "weekly",
                    timeOfDay: "09:00",
                    weekdays: (1 << 1) | (1 << 3),
                },
            }),
        ).toBe("매주 월·수 09:00");
    });

    it("Windows 작업 스케줄러 예약은 다음 시각 없이 표시 (INT-003 T-01)", () => {
        const on = { ...f_Job().autoSync, enabled: true, backend: "os" as const };
        expect(scheduleSummary({ autoSync: { ...on, kind: "daily", timeOfDay: "09:00" } })).toBe(
            "Windows 예약 · 매일 09:00",
        );
        expect(
            scheduleSummary({ autoSync: { ...on, nextRunAt: "2026-11-02T00:00:00.000Z" } }),
        ).toBe("Windows 예약 · 1시간마다");
        expect(scheduleSummary({ autoSync: { ...on, enabled: false } })).toBeNull();
    });
});

describe("jobListItem (INT-002 T-04)", () => {
    it("원본 → 대상, 실행 기록 없음, 상태 없음", () => {
        const item = jobListItem(f_Job(), { showStatus: true });
        expect(item).toEqual({
            pathsText: "C:\\tmp\\src → D:\\tmp\\dst",
            pathsTitle: "C:\\tmp\\src → D:\\tmp\\dst",
            scheduleText: null,
            lastRunText: "실행 기록 없음",
            statusText: null,
        });
    });

    it("긴 경로는 줄이고 title은 전체 경로", () => {
        const long = `C:\\${"a".repeat(60)}`;
        const item = jobListItem(f_Job({ source: long }), { showStatus: true });
        expect(item.pathsText.split(" → ")[0]).toHaveLength(36);
        expect(item.pathsTitle).toContain(long);
    });

    it("최근 실행 시각과 상태 문구(showStatus 끄면 숨김)", () => {
        const job = f_Job({ lastRun: { runId: null, at: AT, status: "success" } });
        const on = jobListItem(job, { showStatus: true });
        expect(on.lastRunText).toBe(`최근 실행 ${formatLocalDateTime(AT)}`);
        expect(on.statusText).toBe(STATUS_LABEL.success);
        expect(jobListItem(job, { showStatus: false }).statusText).toBeNull();
    });
});

function f_OsJob(enabled = true): typJob {
    const j = f_Job();
    return { ...j, autoSync: { ...j.autoSync, enabled, backend: "os" } };
}

function f_OsStatus(task: { registered: boolean; error: string | null } | null, available = true) {
    return {
        available,
        reason: available ? null : "설치한 앱에서만",
        tasks: task
            ? [{ jobId: "00000000-0000-4000-8000-000000000001", exeMatches: null, ...task }]
            : [],
    };
}

describe("isOsTaskMissing (INT-003 T-01)", () => {
    const os = f_OsJob;
    const st = f_OsStatus;

    it("등록 안 됨·실패 문구 → true", () => {
        expect(isOsTaskMissing(os(), st({ registered: false, error: null }))).toBe(true);
        expect(isOsTaskMissing(os(), st({ registered: true, error: "실패" }))).toBe(true);
    });

    it("등록됨·상태 모름·쓸 수 없음·꺼짐·앱 예약 → false", () => {
        expect(isOsTaskMissing(os(), st({ registered: true, error: null }))).toBe(false);
        expect(isOsTaskMissing(os(), st(null))).toBe(false);
        expect(isOsTaskMissing(os(), null)).toBe(false);
        expect(isOsTaskMissing(os(), st({ registered: false, error: null }, false))).toBe(false);
        expect(isOsTaskMissing(os(false), st({ registered: false, error: null }))).toBe(false);
        const app = f_Job();
        expect(
            isOsTaskMissing(
                { ...app, autoSync: { ...app.autoSync, enabled: true } },
                st({ registered: false, error: null }),
            ),
        ).toBe(false);
    });
});
