/**
 * INT-004 남은 시간 계산 테스트: 분모 결정·"계산 중" 판정·누적 평균·긴 쪽 선택·평활.
 * 실제 Google Drive stats fixture를 재생해 안정성(AC-8a)·정확도(AC-8b)도 확인한다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { parseLogLine } from "@/main/parsers/log-parser";
import { etaTotals, nextEta, rawEtaSeconds, type itfEtaState } from "@/main/services/run-eta";
import type { typRunPlan, typRunStats } from "@/shared/schemas/run";
import { zRunRecord } from "@/shared/schemas/run";
import { fixtureLines } from "./fixtures";

function f_Stats(over: Partial<typRunStats> = {}): typRunStats {
    return {
        bytes: 0,
        totalBytes: 0,
        transfers: 0,
        totalTransfers: 0,
        deletes: 0,
        deletedDirs: 0,
        checks: 0,
        totalChecks: 0,
        listed: 0,
        errors: 0,
        speedBps: null,
        etaSeconds: null,
        partialFiles: 0,
        etaPending: false,
        elapsedMs: 0,
        fatalError: false,
        lastError: null,
        ...over,
    };
}

function f_Plan(over: Partial<typRunPlan> = {}): typRunPlan {
    return {
        sourceFiles: 0,
        destFiles: 0,
        createFiles: 0,
        updateFiles: 0,
        deleteFiles: 0,
        transferBytes: 0,
        deleteBytes: 0,
        conflictFiles: 0,
        caseOnlyFiles: 0,
        createDirs: 0,
        deleteDirs: 0,
        ...over,
    };
}

function f_FixtureStats(name: string): typRunStats[] {
    return fixtureLines(name)
        .map(parseLogLine)
        .flatMap((p) => (p.stats ? [p.stats] : []));
}

function f_Replay(
    stats: typRunStats[],
    plan: typRunPlan | null,
): Array<{ atMs: number; etaSeconds: number | null; pending: boolean }> {
    let state: itfEtaState | null = null;
    const points: Array<{ atMs: number; etaSeconds: number | null; pending: boolean }> = [];
    for (const s of stats) {
        const step = nextEta(state, s, plan);
        state = step.state;
        points.push({ atMs: s.elapsedMs, etaSeconds: step.etaSeconds, pending: step.etaPending });
    }
    return points;
}

/** 인접한 표시값의 최대 배율(0 이하 값은 건너뛴다) */
function f_MaxAdjacentRatio(values: number[]): number {
    let max = 1;
    for (let i = 1; i < values.length; i += 1) {
        const a = values[i - 1]!;
        const b = values[i]!;
        if (a <= 0 || b <= 0) continue;
        max = Math.max(max, Math.max(a, b) / Math.min(a, b));
    }
    return max;
}

describe("etaTotals (FR-2)", () => {
    it("계획이 있으면 계획과 rclone 값 중 큰 쪽을 쓰고 처음부터 확정", () => {
        const totals = etaTotals(
            f_Stats({ totalTransfers: 200, totalBytes: 900 }),
            f_Plan({ createFiles: 900, updateFiles: 100, transferBytes: 1000 }),
            0,
        );
        expect(totals).toEqual({ totalFiles: 1000, totalBytes: 1000, settled: true });
    });

    it("계획이 없으면 확인이 끝나거나 totalTransfers가 5초 그대로일 때 확정", () => {
        const checking = f_Stats({ totalTransfers: 200, totalChecks: 0, checks: 0 });
        expect(etaTotals(checking, null, 4_999).settled).toBe(false);
        expect(etaTotals(checking, null, 5_000).settled).toBe(true);
        expect(
            etaTotals(f_Stats({ totalTransfers: 200, totalChecks: 200, checks: 200 }), null, 0)
                .settled,
        ).toBe(true);
    });
});

describe("rawEtaSeconds (FR-3~FR-5, FR-7, FR-8)", () => {
    it("파일 기준 1,900초와 바이트 기준 100초 중 긴 쪽", () => {
        const stats = f_Stats({
            bytes: 50,
            totalBytes: 100,
            transfers: 50,
            totalTransfers: 1000,
            elapsedMs: 100_000,
        });
        expect(rawEtaSeconds(stats, { totalFiles: 1000, totalBytes: 100, settled: true })).toBe(
            1_900,
        );
    });

    it("부분 전송분을 완료 파일 수에 더한다(FR-3)", () => {
        const stats = f_Stats({
            bytes: 0,
            totalBytes: 1000,
            transfers: 4,
            partialFiles: 1,
            totalTransfers: 100,
            elapsedMs: 10_000,
        });
        // 완료 파일 5개, 파일 기준 10 × 95 / 5 = 190초
        expect(rawEtaSeconds(stats, { totalFiles: 100, totalBytes: 1000, settled: true })).toBe(
            190,
        );
    });

    it("경과 10초 미만·완료 5개 미만·바이트 5% 미만·분모 미확정이면 pending", () => {
        const base = {
            totalFiles: 1000,
            totalBytes: 1000,
            settled: true,
        };
        expect(
            rawEtaSeconds(
                f_Stats({
                    elapsedMs: 9_000,
                    transfers: 50,
                    totalTransfers: 1000,
                    bytes: 50,
                    totalBytes: 1000,
                }),
                base,
            ),
        ).toBe("pending");
        expect(
            rawEtaSeconds(
                f_Stats({
                    elapsedMs: 20_000,
                    transfers: 3,
                    totalTransfers: 1000,
                    bytes: 20,
                    totalBytes: 1000,
                }),
                base,
            ),
        ).toBe("pending");
        expect(
            rawEtaSeconds(
                f_Stats({
                    elapsedMs: 20_000,
                    transfers: 3,
                    totalTransfers: 1000,
                    bytes: 60,
                    totalBytes: 1000,
                }),
                base,
            ),
        ).not.toBe("pending");
        expect(
            rawEtaSeconds(
                f_Stats({
                    elapsedMs: 20_000,
                    transfers: 50,
                    totalTransfers: 1000,
                    bytes: 50,
                    totalBytes: 1000,
                }),
                { ...base, settled: false },
            ),
        ).toBe("pending");
    });

    it("남은 파일·바이트가 모두 0이면 0초(FR-7), 전체가 0이면 null(FR-8)", () => {
        expect(
            rawEtaSeconds(f_Stats({ transfers: 3, totalTransfers: 3, bytes: 10, totalBytes: 10 }), {
                totalFiles: 3,
                totalBytes: 10,
                settled: true,
            }),
        ).toBe(0);
        expect(
            rawEtaSeconds(f_Stats(), { totalFiles: 0, totalBytes: 0, settled: true }),
        ).toBeNull();
    });
});

describe("nextEta (FR-4~FR-7, FR-9)", () => {
    it("경과 9초·완료 50개면 '계산 중'", () => {
        const step = nextEta(
            null,
            f_Stats({
                elapsedMs: 9_000,
                transfers: 50,
                totalTransfers: 1000,
                bytes: 500,
                totalBytes: 1000,
            }),
            f_Plan({ createFiles: 1000, transferBytes: 1000 }),
        );
        expect(step).toMatchObject({ etaSeconds: null, etaPending: true });
    });

    it("파일 3개·바이트 2%는 '계산 중', 바이트 6%면 숫자(AC-3)", () => {
        const plan = f_Plan({ createFiles: 1000, transferBytes: 1000 });
        const pending = nextEta(
            null,
            f_Stats({
                elapsedMs: 20_000,
                transfers: 3,
                totalTransfers: 1000,
                bytes: 20,
                totalBytes: 1000,
            }),
            plan,
        );
        expect(pending).toMatchObject({ etaSeconds: null, etaPending: true });
        const shown = nextEta(
            null,
            f_Stats({
                elapsedMs: 20_000,
                transfers: 3,
                totalTransfers: 1000,
                bytes: 60,
                totalBytes: 1000,
            }),
            plan,
        );
        expect(shown.etaPending).toBe(false);
        expect(shown.etaSeconds).toBeGreaterThan(0);
    });

    it("원시 총 소요가 일정하면 표시값이 뒤따르지 않고 1초 안에 따라간다(AC-6)", () => {
        const plan = f_Plan({ transferBytes: 3600 });
        let state: itfEtaState | null = null;
        for (let elapsed = 180; elapsed <= 300; elapsed += 1) {
            const step = nextEta(
                state,
                f_Stats({
                    elapsedMs: elapsed * 1000,
                    bytes: elapsed,
                    totalBytes: elapsed,
                }),
                plan,
            );
            state = step.state;
            expect(step.etaPending).toBe(false);
            expect(Math.abs(step.etaSeconds! - (3600 - elapsed))).toBeLessThanOrEqual(1);
        }
    });

    it("원시 총 소요가 3,600초 → 36,000초로 튀면 평활 계수만큼만 움직인다(AC-7)", () => {
        const first = nextEta(
            null,
            f_Stats({ elapsedMs: 180_000, bytes: 180, totalBytes: 180, transfers: 5 }),
            f_Plan({ createFiles: 5, transferBytes: 3600 }),
        );
        expect(first.state.totalMs).toBe(3_600_000);
        const jumped = nextEta(
            first.state,
            f_Stats({ elapsedMs: 181_000, bytes: 181, totalBytes: 181, transfers: 5 }),
            f_Plan({ createFiles: 5, transferBytes: 36_000 }),
        );
        const expected = 3_600_000 + (36_000_000 - 3_600_000) * (1 - Math.exp(-1 / 30));
        expect(jumped.state.totalMs).toBeCloseTo(expected, 6);
        expect(jumped.etaSeconds).toBeCloseTo((expected - 181_000) / 1000, 6);
    });

    it("totalTransfers가 5초 그대로여야 계획 없는 실행이 확정된다(AC-13)", () => {
        let state: itfEtaState | null = null;
        let step = nextEta(null, f_Stats(), null);
        state = step.state;
        const byElapsed: Array<{ elapsed: number; pending: boolean; etaSeconds: number | null }> =
            [];
        for (let elapsed = 1; elapsed <= 11; elapsed += 1) {
            step = nextEta(
                state,
                f_Stats({
                    elapsedMs: elapsed * 1000,
                    transfers: 20,
                    totalTransfers: elapsed >= 6 ? 200 : 100,
                    bytes: 100,
                    totalBytes: 1000,
                }),
                null,
            );
            state = step.state;
            byElapsed.push({
                elapsed,
                pending: step.etaPending,
                etaSeconds: step.etaSeconds,
            });
        }

        expect(byElapsed.find((p) => p.elapsed === 10)).toMatchObject({ pending: true });
        expect(byElapsed.find((p) => p.elapsed === 11)).toMatchObject({
            pending: false,
            etaSeconds: expect.any(Number),
        });

        const justBefore = nextEta(
            state,
            f_Stats({
                elapsedMs: 12_000,
                transfers: 20,
                totalTransfers: 201,
                bytes: 100,
                totalBytes: 1000,
            }),
            null,
        );
        expect(justBefore.etaPending).toBe(true);
    });
});

describe("이력 호환성 (AC-10)", () => {
    it("새 필드가 없는 예전 stats를 partialFiles 0·etaPending false로 읽는다", () => {
        const rec = zRunRecord.parse({
            id: "00000000-0000-4000-8000-000000000001",
            jobId: "00000000-0000-4000-8000-000000000002",
            jobName: "작업",
            mode: "copy",
            dryRun: false,
            trigger: "manual",
            status: "success",
            phase: "finalizing",
            startedAt: "2026-11-03T00:00:00.000Z",
            finishedAt: "2026-11-03T00:00:01.000Z",
            durationMs: 1000,
            plan: null,
            preflight: null,
            stats: {
                bytes: 1,
                totalBytes: 2,
                transfers: 1,
                totalTransfers: 2,
                deletes: 0,
                deletedDirs: 0,
                checks: 0,
                totalChecks: 0,
                listed: 2,
                errors: 0,
                speedBps: 1,
                etaSeconds: 10,
                elapsedMs: 1000,
                fatalError: false,
                lastError: null,
            },
            exitCode: 0,
            pid: 1,
            error: null,
            logFile: null,
        });
        expect(rec.stats).toMatchObject({ partialFiles: 0, etaPending: false });
    });
});

describe("실제 Google Drive stats fixture 재생", () => {
    it("끝까지 완료한 실행에서 표시값이 실제 남은 시간의 1/4~3배, 인접 2배 이내다(AC-8b)", () => {
        const stats = f_FixtureStats("drive-small-files-progress");
        const first = stats[0]!;
        const last = stats[stats.length - 1]!;
        expect(last.transfers).toBe(last.totalTransfers);
        expect(last.errors).toBe(0);

        const plan = f_Plan({
            createFiles: first.totalTransfers,
            transferBytes: first.totalBytes,
        });
        const points = f_Replay(stats, plan)
            .filter((p) => !p.pending && p.etaSeconds !== null && p.etaSeconds > 0)
            .map((p) => ({ ...p, actualSeconds: (last.elapsedMs - p.atMs) / 1000 }))
            .filter((p) => p.actualSeconds >= 60);

        expect(points.length).toBeGreaterThan(10);
        for (const p of points) {
            // Drive가 초반에 몰아서 올린 뒤 속도 제한으로 느려지는 구간이 있어 하한은 1/4까지 허용한다(spec §10 Q-4)
            expect(p.etaSeconds!).toBeGreaterThanOrEqual(p.actualSeconds / 4);
            expect(p.etaSeconds!).toBeLessThanOrEqual(p.actualSeconds * 3);
        }
        expect(f_MaxAdjacentRatio(points.map((p) => p.etaSeconds!))).toBeLessThanOrEqual(2);
    });

    it("중단된 실행(1,815개 중 667개)에서 표시값이 인접 지점끼리 2배를 넘지 않는다(AC-8a)", () => {
        const stats = f_FixtureStats("drive-small-files-progress-partial");
        const first = stats[0]!;
        const plan = f_Plan({
            createFiles: first.totalTransfers,
            transferBytes: first.totalBytes,
        });
        const points = f_Replay(stats, plan);
        const shown = points
            .filter((p) => !p.pending && p.etaSeconds !== null && p.etaSeconds >= 60)
            .map((p) => p.etaSeconds!);

        expect(shown.length).toBeGreaterThan(100);
        expect(f_MaxAdjacentRatio(shown)).toBeLessThanOrEqual(2);
        // rclone eta가 20초~5.7시간을 오가는 구간에서도 표시값은 시간 단위에 머문다
        expect(Math.min(...shown)).toBeGreaterThan(3_000);
        expect(Math.max(...shown)).toBeLessThan(24 * 3_600);
    });
});
