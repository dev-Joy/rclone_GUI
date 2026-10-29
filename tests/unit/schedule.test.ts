// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    nextAfterFinish,
    nextAutoRun,
    nextRunAfterEdit,
    pickDue,
    reconcileNextRun,
    rescheduleOnUnpause,
    STARTUP_DELAY_MS,
} from "@/shared/schedule";

const NOW = new Date("2026-10-29T10:00:00.000Z");
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function f_Job(id: string, enabled: boolean, nextRunAt: string | null, intervalMinutes = 60) {
    return { id, name: `작업 ${id}`, autoSync: { enabled, intervalMinutes, nextRunAt } };
}

describe("nextRunAfterEdit", () => {
    it("새 작업·복제: 켜져 있으면 now + 주기, 꺼져 있으면 null", () => {
        expect(nextRunAfterEdit(null, { enabled: true, intervalMinutes: 15 }, NOW)).toBe(
            iso(15 * 60_000),
        );
        expect(nextRunAfterEdit(null, { enabled: false, intervalMinutes: 15 }, NOW)).toBeNull();
    });

    it("켬 → now + 주기, 끔 → null, 주기 변경 → now + 새 주기, 그대로면 유지", () => {
        const off = { enabled: false, intervalMinutes: 30, nextRunAt: null };
        const on = { enabled: true, intervalMinutes: 30, nextRunAt: iso(5 * 60_000) };
        expect(nextRunAfterEdit(off, { enabled: true, intervalMinutes: 30 }, NOW)).toBe(
            iso(30 * 60_000),
        );
        expect(nextRunAfterEdit(on, { enabled: false, intervalMinutes: 30 }, NOW)).toBeNull();
        expect(nextRunAfterEdit(on, { enabled: true, intervalMinutes: 10 }, NOW)).toBe(
            iso(10 * 60_000),
        );
        expect(nextRunAfterEdit(on, { enabled: true, intervalMinutes: 30 }, NOW)).toBe(
            on.nextRunAt,
        );
    });

    it("켜져 있는데 예약이 없으면(이전 버전 데이터) now + 주기", () => {
        const on = { enabled: true, intervalMinutes: 30, nextRunAt: null };
        expect(nextRunAfterEdit(on, { enabled: true, intervalMinutes: 30 }, NOW)).toBe(
            iso(30 * 60_000),
        );
    });
});

describe("reconcileNextRun / rescheduleOnUnpause", () => {
    it("시작: 없거나 지난 예약은 now + 60초(몰아서 따라잡지 않음), 미래는 유지, 꺼짐은 null", () => {
        expect(reconcileNextRun(f_Job("a", true, null).autoSync, NOW, STARTUP_DELAY_MS)).toBe(
            iso(60_000),
        );
        expect(
            reconcileNextRun(f_Job("a", true, iso(-86_400_000)).autoSync, NOW, STARTUP_DELAY_MS),
        ).toBe(iso(60_000));
        expect(reconcileNextRun(f_Job("a", true, iso(1000)).autoSync, NOW, STARTUP_DELAY_MS)).toBe(
            iso(1000),
        );
        expect(
            reconcileNextRun(f_Job("a", false, iso(1000)).autoSync, NOW, STARTUP_DELAY_MS),
        ).toBeNull();
    });

    it("일시정지 해제: 지난 예약만 now + 30초", () => {
        expect(rescheduleOnUnpause(f_Job("a", true, iso(-1)).autoSync, NOW)).toBe(iso(30_000));
        expect(rescheduleOnUnpause(f_Job("a", true, iso(5000)).autoSync, NOW)).toBe(iso(5000));
        expect(rescheduleOnUnpause(f_Job("a", true, null).autoSync, NOW)).toBeNull();
    });
});

describe("pickDue / nextAutoRun / nextAfterFinish", () => {
    it("켜져 있고 지난 것 중 가장 이른 1건(같은 시각도 지난 것)", () => {
        const jobs = [
            f_Job("a", true, iso(-1000)),
            f_Job("b", true, iso(-5000)),
            f_Job("c", false, iso(-9000)),
            f_Job("d", true, iso(1000)),
            f_Job("e", true, null),
        ];
        expect(pickDue(jobs, NOW)?.id).toBe("b");
        expect(pickDue([f_Job("x", true, iso(0))], NOW)?.id).toBe("x");
        expect(pickDue([f_Job("d", true, iso(1000))], NOW)).toBeNull();
    });

    it("다음 자동 실행은 켜진 작업 중 가장 이른 예약", () => {
        expect(
            nextAutoRun([
                f_Job("a", true, iso(9000)),
                f_Job("b", true, iso(3000)),
                f_Job("c", false, iso(1)),
            ]),
        ).toEqual({ jobId: "b", jobName: "작업 b", at: iso(3000) });
        expect(nextAutoRun([f_Job("c", false, iso(1))])).toBeNull();
    });

    it("끝난 시각 + 주기", () => {
        expect(nextAfterFinish(NOW.toISOString(), 5)).toBe(iso(5 * 60_000));
    });
});
