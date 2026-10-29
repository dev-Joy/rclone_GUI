// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { isRclonePartial, mayLeavePartial } from "@/shared/partial-files";
import { zRunRecord } from "@/shared/schemas/run";
import { readFixture } from "./fixtures";

describe("isRclonePartial", () => {
    it("실제 취소 뒤 대상 목록(fixture lsjson-dst-after-cancel)의 .partial을 알아본다", () => {
        const items = JSON.parse(readFixture("lsjson-dst-after-cancel", "stdout")) as Array<{
            Path: string;
        }>;
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) expect(isRclonePartial(item.Path)).toBe(true);
    });

    it.each([
        ["x.bin.0123abcd.partial", true],
        ["big.bin.74798C6B.partial", true],
        ["sub/dir/movie.mkv.deadbeef.partial", true],
        ["sub\\dir\\movie.mkv.deadbeef.partial", true],
        ["noext.00000000.partial", true],
    ])("맞는 이름 %j → %s", (path, expected) => {
        expect(isRclonePartial(path)).toBe(expected);
    });

    it.each([
        "report.partial",
        "x.bin.partial",
        "x.bin.0123abc.partial",
        "x.bin.0123abcde.partial",
        "x.bin.0123abcg.partial",
        "x.bin.0123abcd.partial.txt",
        "x.bin.0123abcd.partials",
        ".0123abcd.partial",
        "x.bin.0123abcd.partial/inner.txt",
        "sub/report.partial",
        "",
    ])("사용자 파일 %j는 아님", (path) => {
        expect(isRclonePartial(path)).toBe(false);
    });
});

describe("mayLeavePartial", () => {
    const base = { dryRun: false, status: "canceled" as const, transferStarted: true };

    it("실제 실행이 전송 중 취소·실패·비정상 종료로 끝나면 true", () => {
        expect(mayLeavePartial(base)).toBe(true);
        expect(mayLeavePartial({ ...base, status: "failed" })).toBe(true);
        expect(mayLeavePartial({ ...base, status: "interrupted" })).toBe(true);
    });

    it("dry-run·전송 전(사전 확인·rclone 시작 전)·필드 없는 예전 기록은 false", () => {
        expect(mayLeavePartial({ ...base, dryRun: true })).toBe(false);
        expect(mayLeavePartial({ ...base, transferStarted: false })).toBe(false);
        expect(mayLeavePartial({ dryRun: false, status: "failed" })).toBe(false);
    });

    it.each(["success", "partial", "blocked", "noop", "running"] as const)(
        "%s는 false",
        (status) => {
            expect(mayLeavePartial({ ...base, status })).toBe(false);
        },
    );

    it("history.json에 transferStarted가 없는 예전 기록도 그대로 읽는다", () => {
        const rec = zRunRecord.parse({
            id: "00000000-0000-4000-8000-000000000001",
            jobId: "00000000-0000-4000-8000-000000000002",
            jobName: "작업",
            mode: "copy",
            dryRun: false,
            trigger: "manual",
            status: "canceled",
            phase: "finalizing",
            startedAt: "2026-10-29T00:00:00.000Z",
            finishedAt: "2026-10-29T00:00:01.000Z",
            durationMs: 1000,
            plan: null,
            preflight: null,
            stats: null,
            exitCode: null,
            pid: 1,
            error: null,
            logFile: null,
        });
        expect(rec.transferStarted).toBeUndefined();
        expect(mayLeavePartial(rec)).toBe(false);
    });
});
