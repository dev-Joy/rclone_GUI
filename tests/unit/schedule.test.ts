// 로컬 시각 계산을 서울 시간대(UTC+9, DST 없음)로 고정한다. 이 파일은 별도 worker에서 돈다.
process.env.TZ = "Asia/Seoul";

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    isSameSchedule,
    nextAfterFinish,
    nextAutoRun,
    nextLocalTimeOfDay,
    nextOccurrence,
    nextRunAfterEdit,
    parseTimeOfDay,
    pickDue,
    quitScheduleWarning,
    reconcileNextRun,
    rescheduleOnUnpause,
    scheduleText,
    STARTUP_DELAY_MS,
    type typScheduleSpec,
    weekdaysText,
} from "@/shared/schedule";

const NOW = new Date("2026-10-29T10:00:00.000Z");
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const INTERVAL = { kind: "interval", timeOfDay: "09:00", weekdays: 62 } as const;

function f_Spec(over: Partial<typScheduleSpec> = {}): typScheduleSpec {
    return { ...INTERVAL, intervalMinutes: 60, ...over };
}

function f_Auto(enabled: boolean, intervalMinutes: number, over: Partial<typScheduleSpec> = {}) {
    return { enabled, ...f_Spec({ intervalMinutes, ...over }) };
}

function f_Job(id: string, enabled: boolean, nextRunAt: string | null, intervalMinutes = 60) {
    return { id, name: `작업 ${id}`, autoSync: { ...f_Auto(enabled, intervalMinutes), nextRunAt } };
}

/** 서울 로컬 시각 → Date */
function f_Local(y: number, mo: number, d: number, h = 0, mi = 0): Date {
    return new Date(y, mo - 1, d, h, mi, 0, 0);
}

describe("시간대 고정", () => {
    it("Asia/Seoul이 적용되어 있다(적용 안 되면 이 파일 결과를 믿을 수 없음)", () => {
        expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-540);
    });
});

describe("nextRunAfterEdit", () => {
    it("새 작업·복제: 켜져 있으면 now + 주기, 꺼져 있으면 null", () => {
        expect(nextRunAfterEdit(null, f_Auto(true, 15), NOW)).toBe(iso(15 * 60_000));
        expect(nextRunAfterEdit(null, f_Auto(false, 15), NOW)).toBeNull();
    });

    it("켬 → now + 주기, 끔 → null, 주기 변경 → now + 새 주기, 그대로면 유지", () => {
        const off = { ...f_Auto(false, 30), nextRunAt: null };
        const on = { ...f_Auto(true, 30), nextRunAt: iso(5 * 60_000) };
        expect(nextRunAfterEdit(off, f_Auto(true, 30), NOW)).toBe(iso(30 * 60_000));
        expect(nextRunAfterEdit(on, f_Auto(false, 30), NOW)).toBeNull();
        expect(nextRunAfterEdit(on, f_Auto(true, 10), NOW)).toBe(iso(10 * 60_000));
        expect(nextRunAfterEdit(on, f_Auto(true, 30), NOW)).toBe(on.nextRunAt);
    });

    it("켜져 있는데 예약이 없으면(이전 버전 데이터) now + 주기", () => {
        const on = { ...f_Auto(true, 30), nextRunAt: null };
        expect(nextRunAfterEdit(on, f_Auto(true, 30), NOW)).toBe(iso(30 * 60_000));
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

    it("끝난 시각 + 주기(interval), 끝난 뒤 다음 정시(daily)", () => {
        expect(nextAfterFinish(NOW.toISOString(), f_Spec({ intervalMinutes: 5 }))).toBe(
            iso(5 * 60_000),
        );
        // 2026-10-29 19:00 KST에 끝남 → 다음 날 09:00
        expect(nextAfterFinish(NOW.toISOString(), f_Spec({ kind: "daily" }))).toBe(
            f_Local(2026, 10, 30, 9, 0).toISOString(),
        );
    });
});

describe("parseTimeOfDay / nextLocalTimeOfDay", () => {
    it("HH:MM 형식만 받는다", () => {
        expect(parseTimeOfDay("09:05")).toEqual({ hour: 9, minute: 5 });
        expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
        expect(parseTimeOfDay("24:00")).toBeNull();
        expect(parseTimeOfDay("9:00")).toBeNull();
        expect(parseTimeOfDay("")).toBeNull();
    });

    it("from보다 엄격히 뒤인 첫 시각(같은 시각이면 다음 날)", () => {
        const at9 = f_Local(2026, 11, 2, 9, 0); // 월요일
        expect(nextLocalTimeOfDay(at9, "09:00", 127)?.getTime()).toBe(
            f_Local(2026, 11, 3, 9, 0).getTime(),
        );
        expect(nextLocalTimeOfDay(f_Local(2026, 11, 2, 8, 59), "09:00", 127)?.getTime()).toBe(
            at9.getTime(),
        );
    });

    it("요일이 없거나 시각이 틀리면 null", () => {
        expect(nextLocalTimeOfDay(NOW, "09:00", 0)).toBeNull();
        expect(nextLocalTimeOfDay(NOW, "25:00", 127)).toBeNull();
    });
});

describe("nextOccurrence", () => {
    it("interval: from + 주기", () => {
        expect(nextOccurrence(f_Spec({ intervalMinutes: 90 }), NOW)).toBe(iso(90 * 60_000));
    });

    it("daily: 오늘 시각이 지나면 내일, 안 지났으면 오늘", () => {
        const spec = f_Spec({ kind: "daily", timeOfDay: "21:30" });
        // NOW = 2026-10-29 19:00 KST
        expect(nextOccurrence(spec, NOW)).toBe(f_Local(2026, 10, 29, 21, 30).toISOString());
        expect(nextOccurrence({ ...spec, timeOfDay: "07:00" }, NOW)).toBe(
            f_Local(2026, 10, 30, 7, 0).toISOString(),
        );
    });

    it("AC-12: 매주 월·수 09:00", () => {
        const spec = f_Spec({ kind: "weekly", timeOfDay: "09:00", weekdays: (1 << 1) | (1 << 3) });
        // 2026-10-29(목) 19:00 → 11-02(월) 09:00
        const mon = nextOccurrence(spec, NOW);
        expect(mon).toBe(f_Local(2026, 11, 2, 9, 0).toISOString());
        // 월 09:00 실행 뒤 → 수 09:00
        const wed = nextOccurrence(spec, new Date(mon));
        expect(wed).toBe(f_Local(2026, 11, 4, 9, 0).toISOString());
        // 수 09:00 뒤 → 다음 주 월
        expect(nextOccurrence(spec, new Date(wed))).toBe(f_Local(2026, 11, 9, 9, 0).toISOString());
    });

    it("weekly인데 요일이 없으면 from + 24시간으로 방어", () => {
        expect(nextOccurrence(f_Spec({ kind: "weekly", weekdays: 0 }), NOW)).toBe(iso(86_400_000));
    });

    it("불변식: 어떤 종류·시각에서도 결과는 from보다 뒤다", () => {
        const midnight = f_Spec({ kind: "daily", timeOfDay: "00:00" });
        const specs: typScheduleSpec[] = [
            f_Spec({ intervalMinutes: 1 }),
            f_Spec({ intervalMinutes: 10_080 }),
            midnight,
            f_Spec({ kind: "daily", timeOfDay: "23:59" }),
            f_Spec({ kind: "weekly", timeOfDay: "09:00", weekdays: 1 }),
            f_Spec({ kind: "weekly", timeOfDay: "12:30", weekdays: 1 << 6 }),
            f_Spec({ kind: "weekly", timeOfDay: "09:00", weekdays: 0 }),
        ];
        const start = f_Local(2026, 1, 1, 0, 0).getTime();
        for (let i = 0; i < 400; i++) {
            // 하루 + 37분씩 옮겨 여러 요일·시각을 훑는다
            const from = new Date(start + i * (86_400_000 + 37 * 60_000));
            for (const spec of specs) {
                const next = Date.parse(nextOccurrence(spec, from));
                expect(next).toBeGreaterThan(from.getTime());
                expect(next - from.getTime()).toBeLessThanOrEqual(8 * 86_400_000);
            }
            // 정확히 예약 시각인 경우도 다음 예약으로 넘어간다
            const at = new Date(nextOccurrence(midnight, from));
            expect(Date.parse(nextOccurrence(midnight, at))).toBeGreaterThan(at.getTime());
        }
    });
});

describe("isSameSchedule / nextRunAfterEdit (종류)", () => {
    it("종류에 따라 쓰는 값만 비교한다", () => {
        expect(isSameSchedule(f_Spec(), f_Spec({ timeOfDay: "10:00" }))).toBe(true);
        expect(isSameSchedule(f_Spec(), f_Spec({ intervalMinutes: 30 }))).toBe(false);
        expect(
            isSameSchedule(f_Spec({ kind: "daily" }), f_Spec({ kind: "daily", weekdays: 1 })),
        ).toBe(true);
        expect(
            isSameSchedule(f_Spec({ kind: "weekly" }), f_Spec({ kind: "weekly", weekdays: 1 })),
        ).toBe(false);
        expect(isSameSchedule(f_Spec(), f_Spec({ kind: "daily" }))).toBe(false);
    });

    it("종류·시각을 바꾸면 지금 기준 다음 정시로 다시 정한다", () => {
        const on = { ...f_Auto(true, 30), nextRunAt: iso(5 * 60_000) };
        expect(
            nextRunAfterEdit(on, f_Auto(true, 30, { kind: "daily", timeOfDay: "21:00" }), NOW),
        ).toBe(f_Local(2026, 10, 29, 21, 0).toISOString());
        const daily = { ...f_Auto(true, 30, { kind: "daily" }), nextRunAt: iso(1000) };
        expect(nextRunAfterEdit(daily, f_Auto(true, 30, { kind: "daily" }), NOW)).toBe(iso(1000));
        // daily에서 주기만 바꾼 것은 예약에 영향 없음
        expect(nextRunAfterEdit(daily, f_Auto(true, 45, { kind: "daily" }), NOW)).toBe(iso(1000));
    });
});

function f_DailyState(nextRunAt: string | null) {
    return { ...f_Auto(true, 60, { kind: "daily", timeOfDay: "09:00" }), nextRunAt };
}

describe("reconcileNextRun (daily·weekly)", () => {
    it("지난 예약은 now + 지연 한 번(몰아서 따라잡지 않음)", () => {
        expect(reconcileNextRun(f_DailyState(iso(-3 * 86_400_000)), NOW, STARTUP_DELAY_MS)).toBe(
            iso(60_000),
        );
        expect(reconcileNextRun(f_DailyState(null), NOW, STARTUP_DELAY_MS)).toBe(iso(60_000));
    });

    it("지연 이내의 미래 예약은 그대로(따라잡기·해제 +30초 보존)", () => {
        expect(reconcileNextRun(f_DailyState(iso(30_000)), NOW, STARTUP_DELAY_MS)).toBe(
            iso(30_000),
        );
    });

    it("더 먼 미래는 지금 기준 다음 정시로 맞춘다(시간대 변경 대비)", () => {
        const right = f_Local(2026, 10, 30, 9, 0).toISOString();
        expect(reconcileNextRun(f_DailyState(right), NOW, STARTUP_DELAY_MS)).toBe(right);
        // 잘못 기록된 값(10:00)은 09:00으로 고친다
        expect(
            reconcileNextRun(
                f_DailyState(f_Local(2026, 10, 30, 10, 0).toISOString()),
                NOW,
                STARTUP_DELAY_MS,
            ),
        ).toBe(right);
    });

    it("interval의 미래 예약은 그대로", () => {
        expect(
            reconcileNextRun(f_Job("a", true, iso(3_600_000)).autoSync, NOW, STARTUP_DELAY_MS),
        ).toBe(iso(3_600_000));
    });
});

describe("weekdaysText / scheduleText", () => {
    it("요일 표시", () => {
        expect(weekdaysText(127)).toBe("매일");
        expect(weekdaysText(62)).toBe("평일");
        expect(weekdaysText(65)).toBe("주말");
        expect(weekdaysText((1 << 1) | (1 << 3))).toBe("월·수");
        expect(weekdaysText((1 << 0) | (1 << 1))).toBe("월·일");
    });

    it("예약 표시", () => {
        expect(scheduleText(f_Spec({ intervalMinutes: 30 }))).toBe("30분마다");
        expect(scheduleText(f_Spec({ intervalMinutes: 60 }))).toBe("1시간마다");
        expect(scheduleText(f_Spec({ intervalMinutes: 120 }))).toBe("2시간마다");
        expect(scheduleText(f_Spec({ kind: "daily", timeOfDay: "07:30" }))).toBe("매일 07:30");
        expect(
            scheduleText(
                f_Spec({ kind: "weekly", timeOfDay: "09:00", weekdays: (1 << 1) | (1 << 3) }),
            ),
        ).toBe("매주 월·수 09:00");
        expect(scheduleText(f_Spec({ kind: "weekly", weekdays: 62 }))).toBe("평일 09:00");
    });
});

describe("quitScheduleWarning", () => {
    const next = { jobId: "a", jobName: "백업", at: iso(60_000) };

    it("일시정지했거나 예약이 없으면 null", () => {
        expect(quitScheduleWarning(true, next, (v) => v)).toBeNull();
        expect(quitScheduleWarning(false, null, (v) => v)).toBeNull();
    });

    it("다음 예약 작업과 시각을 알린다", () => {
        const w = quitScheduleWarning(false, next, () => "10-29 19:01");
        expect(w?.message).toBe("다음 예약: ‘백업’ 10-29 19:01 — 종료하면 실행되지 않습니다.");
        expect(w?.detail).toContain("한 번만");
    });
});
