// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    filterHistory,
    historyCounts,
    historyKind,
    nextAutoRunText,
    statusTone,
} from "@/lib/history-view";
import type { typRunRecord } from "@/shared/schemas/run";

function f_T(iso: string): string {
    return `T(${iso})`;
}

function f_Rec(over: Partial<typRunRecord>): typRunRecord {
    return {
        id: "00000000-0000-4000-8000-000000000001",
        jobId: "00000000-0000-4000-8000-000000000002",
        jobName: "작업",
        mode: "copy",
        dryRun: false,
        trigger: "manual",
        status: "success",
        phase: "finalizing",
        startedAt: "2026-10-29T00:00:00.000Z",
        finishedAt: null,
        durationMs: null,
        plan: null,
        preflight: null,
        stats: null,
        exitCode: null,
        pid: null,
        error: null,
        logFile: null,
        ...over,
    };
}

describe("history-view", () => {
    it("종류: 미리보기 > 자동 > 수동", () => {
        expect(historyKind(f_Rec({ dryRun: true, trigger: "scheduler" }))).toBe("dryRun");
        expect(historyKind(f_Rec({ trigger: "scheduler" }))).toBe("auto");
        expect(historyKind(f_Rec({}))).toBe("manual");
    });

    it("필터: 종류·결과(실패에는 일부 실패·중단됨 포함)", () => {
        const rows = [
            f_Rec({ status: "success" }),
            f_Rec({ status: "partial", trigger: "scheduler" }),
            f_Rec({ status: "interrupted" }),
            f_Rec({ status: "blocked", trigger: "scheduler" }),
            f_Rec({ status: "success", dryRun: true }),
        ];
        expect(filterHistory(rows, { kind: "all", status: "failed" })).toHaveLength(2);
        expect(filterHistory(rows, { kind: "auto", status: "all" })).toHaveLength(2);
        expect(filterHistory(rows, { kind: "dryRun", status: "success" })).toHaveLength(1);
        expect(filterHistory(rows, { kind: "manual", status: "blocked" })).toHaveLength(0);
    });

    it("배지 색·요약 문구", () => {
        expect(statusTone("failed")).toBe("danger");
        expect(statusTone("blocked")).toBe("warning");
        expect(statusTone("success")).toBe("success");
        expect(historyCounts(f_Rec({}))).toBe("-");
        expect(
            historyCounts(
                f_Rec({
                    plan: {
                        sourceFiles: 1,
                        destFiles: 1,
                        createFiles: 1,
                        updateFiles: 0,
                        deleteFiles: 2,
                        transferBytes: 0,
                        deleteBytes: 0,
                        conflictFiles: 0,
                        caseOnlyFiles: 0,
                    },
                }),
            ),
        ).toBe("계획: 새 1 · 변경 0 · 삭제 2");
    });

    it("다음 자동 실행 문구: 일시정지·자동 실행 중·없음·예약", () => {
        const t = f_T;
        expect(nextAutoRunText(null, t)).toBe("");
        expect(nextAutoRunText({ paused: true, running: null, next: null }, t)).toBe(
            "자동 실행 일시정지됨",
        );
        expect(
            nextAutoRunText(
                {
                    paused: false,
                    running: { jobId: "j", jobName: "백업", trigger: "scheduler" },
                    next: null,
                },
                t,
            ),
        ).toBe("자동 실행 중: ‘백업’");
        expect(nextAutoRunText({ paused: false, running: null, next: null }, t)).toBe(
            "예약된 자동 실행 없음",
        );
        expect(
            nextAutoRunText(
                { paused: false, running: null, next: { jobId: "j", jobName: "백업", at: "X" } },
                t,
            ),
        ).toBe("다음 자동 실행 T(X) ‘백업’");
    });
});
