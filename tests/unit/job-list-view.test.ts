// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { jobListItem, scheduleSummary, STATUS_LABEL } from "@/lib/job-list-view";
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
                nextRunAt: AT,
                lastAutoRunAt: null,
            },
        });
        expect(scheduleSummary(job)).toBe(
            `60분마다 · 다음 ${formatLocalDateTime(AT).slice(5, 16)}`,
        );
        expect(scheduleSummary({ autoSync: { ...job.autoSync, nextRunAt: null } })).toBe(
            "60분마다",
        );
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
