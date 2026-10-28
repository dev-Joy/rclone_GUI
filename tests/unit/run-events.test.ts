// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsRunEventBatcher, type itfBatcherTimers } from "@/main/services/run-events";
import { normalizeStats } from "@/main/parsers/log-parser";
import type { itfRunLogLine, typRunEvent } from "@/shared/types/run";

const RUN = "00000000-0000-4000-8000-0000000000aa";

/** 수동으로 진행하는 가짜 타이머 */
function f_FakeTimers() {
    let now = 1_000_000;
    let seq = 0;
    const tasks = new Map<number, { at: number; fn: () => void }>();
    const timers: itfBatcherTimers = {
        setTimeout: (fn, ms) => {
            seq += 1;
            tasks.set(seq, { at: now + ms, fn });
            return seq;
        },
        clearTimeout: (h) => {
            tasks.delete(h as number);
        },
        now: () => now,
    };
    const advance = (ms: number) => {
        const end = now + ms;
        for (;;) {
            const next = [...tasks.entries()]
                .filter(([, t]) => t.at <= end)
                .toSorted((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            tasks.delete(next[0]);
            now = next[1].at;
            next[1].fn();
        }
        now = end;
    };
    return { timers, advance, pending: () => tasks.size };
}

function s(bytes: number) {
    return normalizeStats({ bytes })!;
}

function f_Line(n: number): itfRunLogLine {
    return { at: "2026-10-28T00:00:00.000Z", level: "info", message: `line ${n}` };
}

function f_Setup(over: { maxLines?: number } = {}) {
    const t = f_FakeTimers();
    const events: typRunEvent[] = [];
    const b = new clsRunEventBatcher({
        runId: RUN,
        emit: (e) => events.push(e),
        timers: t.timers,
        ...over,
    });
    return { b, events, ...t };
}

describe("clsRunEventBatcher", () => {
    it("log는 200ms 동안 모아 한 번에 보낸다", () => {
        const { b, events, advance } = f_Setup();
        b.pushLog(f_Line(1));
        b.pushLog(f_Line(2));
        advance(199);
        expect(events).toHaveLength(0);
        advance(1);
        expect(events).toEqual([
            expect.objectContaining({
                type: "log",
                runId: RUN,
                lines: [f_Line(1), f_Line(2)],
                dropped: 0,
            }),
        ]);
    });

    it("한 묶음 최대 100줄: 넘친 오래된 줄은 버리고 dropped로 센다", () => {
        const { b, events, advance } = f_Setup();
        for (let i = 0; i < 130; i += 1) b.pushLog(f_Line(i));
        advance(200);
        const e = events[0]!;
        if (e.type !== "log") throw new Error("log 이벤트가 아님");
        expect(e.lines).toHaveLength(100);
        expect(e.lines[0]!.message).toBe("line 30");
        expect(e.dropped).toBe(30);
    });

    it("stats는 1초에 한 번: 첫 값은 바로, 사이 값은 마지막 것만 남은 시간 뒤에", () => {
        const { b, events, advance } = f_Setup();
        b.pushStats(s(1));
        b.pushStats(s(2));
        b.pushStats(s(3));
        expect(events.map((e) => (e.type === "stats" ? e.stats.bytes : -1))).toEqual([1]);
        advance(999);
        expect(events).toHaveLength(1);
        advance(1);
        expect(events.map((e) => (e.type === "stats" ? e.stats.bytes : -1))).toEqual([1, 3]);
        advance(5000);
        b.pushStats(s(4));
        expect(events).toHaveLength(3);
    });

    it("flush는 남은 log·stats를 바로 보내고 타이머를 멈춘다", () => {
        const { b, events, pending } = f_Setup();
        b.pushStats(normalizeStats({ bytes: 1 })!);
        b.pushStats(normalizeStats({ bytes: 2 })!);
        b.pushLog(f_Line(1));
        b.flush();
        expect(events.map((e) => e.type)).toEqual(["stats", "log", "stats"]);
        expect(pending()).toBe(0);
        b.flush();
        expect(events).toHaveLength(3);
    });

    it("emit 예외는 삼킨다", () => {
        const t = f_FakeTimers();
        const b = new clsRunEventBatcher({
            runId: RUN,
            emit: () => {
                throw new Error("window closed");
            },
            timers: t.timers,
        });
        b.pushLog(f_Line(1));
        expect(() => b.flush()).not.toThrow();
    });
});
