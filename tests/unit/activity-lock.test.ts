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

describe("clsActivityLock 탐색 락 (INT-002 T-02)", () => {
    it("탐색은 한 번에 하나만, 같은 리모트라도 겹치면 BUSY", () => {
        const lock = new clsActivityLock();
        expect(lock.browseRemotes()).toBeNull();
        const release = lock.beginBrowse(["gdrive"]);
        expect(lock.browseRemotes()).toEqual(["gdrive"]);
        expect(() => lock.beginBrowse(["gdrive"])).toThrow(
            expect.objectContaining({ code: "BUSY" }),
        );
        release();
        expect(lock.browseRemotes()).toBeNull();
        expect(() => lock.beginBrowse(["gdrive"])).not.toThrow();
    });

    it("해제는 여러 번 불러도 한 번만 적용된다", () => {
        const lock = new clsActivityLock();
        const release = lock.beginBrowse(["a", "b"]);
        release();
        release();
        expect(lock.browseRemotes()).toBeNull();
    });

    it("assertNoBrowse: 같은 remote(대소문자 무시)만 BUSY, 다른 리모트는 통과", () => {
        const lock = new clsActivityLock();
        const release = lock.beginBrowse(["GDrive"]);
        expect(() => lock.assertNoBrowse(["gdrive"])).toThrow(
            expect.objectContaining({
                code: "BUSY",
                message: "‘GDrive:’ 리모트를 탐색하는 중입니다. 탐색이 끝난 뒤 다시 시도하세요.",
            }),
        );
        expect(() => lock.assertNoBrowse(["s3"])).not.toThrow();
        expect(() => lock.assertNoBrowse([])).not.toThrow();
        release();
        expect(() => lock.assertNoBrowse(["gdrive"])).not.toThrow();
    });

    it("빈 목록은 아무것도 잠그지 않는다", () => {
        const lock = new clsActivityLock();
        const release = lock.beginBrowse([]);
        expect(lock.browseRemotes()).toBeNull();
        expect(() => lock.beginBrowse(["a"])).not.toThrow();
        release();
    });

    it("탐색 락은 비교·실행 락과 별개다(호출부가 assertNoBrowse로 막는다)", () => {
        const lock = new clsActivityLock();
        lock.beginBrowse(["a"]);
        expect(lock.current()).toBeNull();
        const release = lock.acquire(COMPARE, msg);
        expect(lock.current()).toEqual(COMPARE);
        release();
    });
});
