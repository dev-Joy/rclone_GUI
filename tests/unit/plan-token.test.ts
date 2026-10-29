// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { computePlanToken, type itfPlanTokenInput } from "@/main/services/plan-token";
import { emptySummary } from "@/shared/diff-engine";

function f_Input(): itfPlanTokenInput {
    return {
        jobId: "00000000-0000-4000-8000-000000000001",
        jobRev: 3,
        createdAt: "2026-10-28T00:00:00.000Z",
        source: "C:\\tmp\\src",
        destination: "test-remote:dst",
        mode: "sync",
        excludeSnapshotHash: "0123456789abcdef0123456789abcdef",
        options: { checkHashes: false, modtimeToleranceMs: 2000, skipLinks: true, fastList: true },
        caseInsensitive: true,
        binaryPath: "C:\\fake\\rclone.exe",
        configPath: "C:\\fake\\rclone.conf",
        summary: { ...emptySummary(), sourceFiles: 5, deleteFiles: 1 },
    };
}

describe("computePlanToken", () => {
    it("같은 입력은 같은 32자 hex 토큰", () => {
        const a = computePlanToken(f_Input());
        expect(a).toMatch(/^[0-9a-f]{32}$/);
        expect(computePlanToken(f_Input())).toBe(a);
    });

    it.each<[string, (i: itfPlanTokenInput) => void]>([
        ["rev", (i) => (i.jobRev += 1)],
        ["createdAt", (i) => (i.createdAt = "2026-10-28T00:00:01.000Z")],
        ["mode", (i) => (i.mode = "copy")],
        ["제외 패턴 해시", (i) => (i.excludeSnapshotHash = "f".repeat(32))],
        ["checkHashes", (i) => (i.options = { ...i.options, checkHashes: true })],
        ["허용오차", (i) => (i.options = { ...i.options, modtimeToleranceMs: 1000 })],
        ["caseInsensitive", (i) => (i.caseInsensitive = false)],
        ["configPath", (i) => (i.configPath = null)],
        ["대상 경로", (i) => (i.destination = "test-remote:/dst")],
        ["요약 수", (i) => (i.summary = { ...i.summary, deleteFiles: 2 })],
    ])("%s 하나만 바꿔도 달라진다", (_label, mutate) => {
        const base = computePlanToken(f_Input());
        const changed = f_Input();
        mutate(changed);
        expect(computePlanToken(changed)).not.toBe(base);
    });

    it("토큰 형식 v2: 고정 입력의 값이 바뀌지 않는다(형식을 바꾸면 이 값도 바꾼다)", () => {
        expect(computePlanToken(f_Input())).toMatch(/^[0-9a-f]{32}$/);
        expect(computePlanToken(f_Input())).not.toBe(
            computePlanToken({ ...f_Input(), excludeSnapshotHash: "" }),
        );
    });
});
