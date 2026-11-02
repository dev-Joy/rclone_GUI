// 미국 동부(DST 있음)로 고정한다. 이 파일은 별도 worker에서 돈다.
process.env.TZ = "America/New_York";

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { nextOccurrence, type typScheduleSpec } from "@/shared/schedule";

function f_Daily(timeOfDay: string): typScheduleSpec {
    return { kind: "daily", intervalMinutes: 60, timeOfDay, weekdays: 62 };
}

describe("DST (America/New_York)", () => {
    it("시간대가 적용되어 있다(EST -5h)", () => {
        expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(300);
    });

    it("봄(2026-03-08): 없는 02:30은 03:30에 한 번 실행하고, 다음 날은 다시 02:30", () => {
        const from = new Date(2026, 2, 8, 0, 0);
        const at = new Date(nextOccurrence(f_Daily("02:30"), from));
        expect(at.getDate()).toBe(8);
        expect(at.getHours()).toBe(3);
        expect(at.getMinutes()).toBe(30);
        const next = new Date(nextOccurrence(f_Daily("02:30"), at));
        expect(next.getDate()).toBe(9);
        expect(next.getHours()).toBe(2);
        expect(next.getMinutes()).toBe(30);
    });

    it("가을(2026-11-01): 두 번 있는 01:30은 한 번만 실행한다", () => {
        const from = new Date(2026, 10, 1, 0, 0);
        const first = new Date(nextOccurrence(f_Daily("01:30"), from));
        expect(first.getDate()).toBe(1);
        expect(first.getHours()).toBe(1);
        // 실행이 끝난 뒤(두 번째 01:30 근처) 다시 계산해도 다음 날로 넘어간다
        const afterSecond = new Date(first.getTime() + 61 * 60_000);
        const next = new Date(nextOccurrence(f_Daily("01:30"), afterSecond));
        expect(next.getDate()).toBe(2);
        expect(next.getHours()).toBe(1);
        expect(next.getMinutes()).toBe(30);
        // 바로 다음 계산도 같은 날의 두 번째 01:30이 아니다
        const fromFirst = new Date(nextOccurrence(f_Daily("01:30"), first));
        expect(fromFirst.getDate()).toBe(2);
    });

    it("interval은 DST와 관계없이 실제 경과 시간", () => {
        const from = new Date(2026, 2, 8, 1, 0);
        const at = Date.parse(
            nextOccurrence(
                { kind: "interval", intervalMinutes: 120, timeOfDay: "09:00", weekdays: 62 },
                from,
            ),
        );
        expect(at - from.getTime()).toBe(120 * 60_000);
    });
});
