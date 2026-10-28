// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsActivityLock, type typActivity } from "@/main/services/activity-lock";

const AT = "2026-10-28T00:00:00.000Z";
const COMPARE: typActivity = { kind: "compare", jobId: "a", startedAt: AT };
const RUN: typActivity = { kind: "run", jobId: "b", runId: "r1", startedAt: AT };
const msg = (cur: typActivity) => `바쁨:${cur.kind}:${cur.jobId}`;

describe("clsActivityLock", () => {
    it("비어 있으면 잡고, 차 있으면 BUSY(현재 활동으로 만든 문구)", () => {
        const lock = new clsActivityLock();
        expect(lock.current()).toBeNull();
        lock.acquire(COMPARE, msg);
        expect(lock.current()).toEqual(COMPARE);
        expect(() => lock.acquire(RUN, msg)).toThrow(
            expect.objectContaining({ code: "BUSY", message: "바쁨:compare:a" }),
        );
    });

    it("비교와 실행은 서로 배타적이다", () => {
        const lock = new clsActivityLock();
        const release = lock.acquire(RUN, msg);
        expect(() => lock.acquire(COMPARE, msg)).toThrow(
            expect.objectContaining({ code: "BUSY", message: "바쁨:run:b" }),
        );
        release();
        expect(() => lock.acquire(COMPARE, msg)).not.toThrow();
    });

    it("해제는 여러 번 불러도 한 번만 적용된다(다음 활동을 풀지 않음)", () => {
        const lock = new clsActivityLock();
        const release1 = lock.acquire(COMPARE, msg);
        release1();
        const release2 = lock.acquire(RUN, msg);
        release1();
        expect(lock.current()).toEqual(RUN);
        release2();
        release2();
        expect(lock.current()).toBeNull();
    });
});
