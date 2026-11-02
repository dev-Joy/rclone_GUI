// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsActivityLock } from "@/main/services/activity-lock";
import { clsRemoteOps } from "@/main/services/remote-ops";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import type { typJob } from "@/shared/schemas/job";

const AT = "2026-10-30T00:00:00.000Z";

function f_Job(id: string, source: string, destination: string): typJob {
    return {
        ...createJobDraft(createDefaultSettings()),
        id,
        name: `작업 ${id}`,
        source,
        destination,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            kind: "interval",
            timeOfDay: "09:00",
            weekdays: 62,
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 0,
        createdAt: AT,
        updatedAt: AT,
        lastRun: null,
    };
}

function f_Make() {
    const jobs = new Map<string, typJob>([
        ["j-remote", f_Job("j-remote", "gdrive:a", "C:\\tmp\\dst")],
        ["j-local", f_Job("j-local", "C:\\tmp\\src", "D:\\tmp\\dst")],
    ]);
    const activity = new clsActivityLock();
    const ops = new clsRemoteOps({
        activity,
        jobs: {
            get: (id) => {
                const j = jobs.get(id);
                if (!j) throw new Error("없는 작업");
                return j;
            },
        },
    });
    return { ops, activity };
}

describe("clsRemoteOps", () => {
    it("탐색 작업을 하나씩 실행하고, 끝나면 탐색 락을 푼다", async () => {
        const { ops, activity } = f_Make();
        const order: string[] = [];
        let started: (() => void) | null = null;
        const startedPromise = new Promise<void>((resolve) => {
            started = resolve;
        });
        const p1 = ops.run(["gdrive"], async () => {
            started!();
            order.push("a-start");
            await new Promise((r) => setTimeout(r, 10));
            order.push("a-end");
            return 1;
        });
        const p2 = ops.run(["s3"], () => {
            order.push("b");
            return 2;
        });
        await startedPromise;
        expect(activity.browseRemotes()).toEqual(["gdrive"]);
        await expect(p1).resolves.toBe(1);
        await expect(p2).resolves.toBe(2);
        expect(order).toEqual(["a-start", "a-end", "b"]);
        expect(activity.browseRemotes()).toBeNull();
    });

    it("실패해도 탐색 락을 푼다", async () => {
        const { ops, activity } = f_Make();
        await expect(
            ops.run(["gdrive"], () => {
                throw new Error("실패");
            }),
        ).rejects.toThrow("실패");
        expect(activity.browseRemotes()).toBeNull();
    });

    it("같은 리모트를 비교·실행 중이면 BUSY, 다른 리모트는 허용", async () => {
        const { ops, activity } = f_Make();
        const release = activity.acquire(
            { kind: "compare", jobId: "j-remote", startedAt: AT },
            () => "바쁨",
        );
        await expect(ops.run(["GDrive"], () => 1)).rejects.toMatchObject({ code: "BUSY" });
        await expect(ops.run(["s3"], () => 2)).resolves.toBe(2);
        release();
        await expect(ops.run(["gdrive"], () => 3)).resolves.toBe(3);
    });

    it("탐색 중인 리모트를 비교·실행이 쓰려 하면 assertNoBrowse가 막는다", async () => {
        const { ops, activity } = f_Make();
        let started: (() => void) | null = null;
        let release: (() => void) | null = null;
        const startedPromise = new Promise<void>((resolve) => {
            started = resolve;
        });
        const p = ops.run(["gdrive"], () => {
            started!();
            return new Promise<void>((resolve) => {
                release = resolve;
            });
        });
        await startedPromise;
        expect(() => activity.assertNoBrowse(["gdrive"])).toThrow(
            expect.objectContaining({ code: "BUSY" }),
        );
        expect(() => activity.assertNoBrowse(["s3"])).not.toThrow();
        release!();
        await p;
    });

    it("활동의 작업을 찾지 못하면 보수적으로 BUSY", async () => {
        const { ops, activity } = f_Make();
        const release = activity.acquire(
            { kind: "run", jobId: "gone", runId: "r1", startedAt: AT },
            () => "바쁨",
        );
        await expect(ops.run(["s3"], () => 1)).rejects.toMatchObject({ code: "BUSY" });
        release();
    });

    it("탐색 중 다른 탐색은 큐에서 기다리며 BUSY로 실패하지 않는다", async () => {
        const { ops } = f_Make();
        let started: (() => void) | null = null;
        let finish: (() => void) | null = null;
        const startedPromise = new Promise<void>((resolve) => {
            started = resolve;
        });
        const first = ops.run(["gdrive"], () => {
            started!();
            return new Promise<void>((resolve) => {
                finish = resolve;
            });
        });
        let secondStarted = false;
        const second = ops.run(["gdrive"], () => {
            secondStarted = true;
            return 2;
        });
        await startedPromise;
        expect(secondStarted).toBe(false);
        finish!();
        await first;
        await expect(second).resolves.toBe(2);
    });
});
