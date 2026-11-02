/**
 * 실제 rclone으로 자동 실행(startAuto)을 확인한다. 임시 폴더와 임시 rclone.conf만 쓴다.
 * copy 반영, 삭제 허용 끔 sync → blocked·대상 불변, 허용 + 소량 삭제 → 사전 확인 뒤 반영(다음 자동 실행은 noop),
 * autoMaxDeletes 초과 → blocked·대상 불변. OS 예약(INT-003 T-01): trigger os-scheduler, recordAutoBlocked,
 * 대기열(AC-15: 락이 풀린 뒤 차례로 실행), 실행 시간 제한(canceled + 시간 제한 문구).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { jobToDraft } from "@/lib/job-form";
import {
    clsOsRunQueue,
    precheckJobPaths,
    type itfOsRunLimits,
    type typHeadlessExitCode,
} from "@/main/services/os-run-queue";
import { TIME_LIMIT_CANCELED_TEXT } from "@/main/services/run-service";
import { HAS_RCLONE, makeEnv, makeRoot, snapshotTree, writeFile } from "./run-harness";

const { root, conf } = makeRoot("rclonegui-auto-run-");

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

/** 원본·대상에 같은 파일 sameN개, 원본에만 new.txt, 대상에만 extraN개 */
function f_Tree(name: string, same: number, extras: number): { src: string; dst: string } {
    const src = join(root, name, "src");
    const dst = join(root, name, "dst");
    for (let i = 0; i < same; i += 1) {
        writeFile(join(src, `same${i}.txt`), `same${i}`);
        writeFile(join(dst, `same${i}.txt`), `same${i}`);
    }
    writeFile(join(src, "new.txt"), "new");
    for (let i = 0; i < extras; i += 1) writeFile(join(dst, `extra${i}.txt`), `extra${i}`);
    return { src, dst };
}

describe.skipIf(!HAS_RCLONE)("자동 실행 (실제 rclone, 임시 폴더)", () => {
    it("copy: 비교 → 실행, 대상에 반영, 이력 trigger scheduler", async () => {
        const { src, dst } = f_Tree("copy", 2, 1);
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "copy",
            autoSync: { enabled: true, intervalMinutes: 1 },
        });
        const { runId, done } = await env.runs.startAuto(env.job.id);
        const o = await done;
        expect(o).toMatchObject({ runId, status: "success", recorded: true });
        expect(snapshotTree(dst)["new.txt"]).toBeDefined();
        expect(snapshotTree(dst)["extra0.txt"]).toBeDefined();
        expect(env.history.get(runId)).toMatchObject({ trigger: "scheduler", status: "success" });
        // 수동 비교 결과는 만들지 않는다
        expect(env.compare.get(env.job.id)).toBeNull();
    });

    it("sync + 삭제 허용 끔 → blocked 이력, 대상 불변", async () => {
        const { src, dst } = f_Tree("deny", 10, 1);
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            autoSync: { enabled: true, intervalMinutes: 1, allowDeletes: false },
        });
        const before = snapshotTree(dst);
        const { runId, done } = await env.runs.startAuto(env.job.id);
        const o = await done;
        expect(o.status).toBe("blocked");
        expect(o.error?.message).toContain("삭제를 허용하지 않아");
        expect(snapshotTree(dst)).toEqual(before);
        expect(env.history.get(runId)).toMatchObject({ status: "blocked", logFile: null });
    });

    it("sync + 삭제 허용 + 소량 삭제 → 사전 확인 뒤 반영, 다음 자동 실행은 noop(이력 없음)", async () => {
        const { src, dst } = f_Tree("allow", 10, 1);
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            autoSync: { enabled: true, intervalMinutes: 1, allowDeletes: true },
        });
        const first = await (await env.runs.startAuto(env.job.id)).done;
        expect(first.status).toBe("success");
        const rec = env.history.get(first.runId);
        expect(rec?.preflight).toMatchObject({ deletes: 1, errors: 0 });
        expect(rec?.stats).toMatchObject({ deletes: 1 });
        expect(snapshotTree(dst)).toEqual(snapshotTree(src));
        const count = env.history.list().length;
        const second = await (await env.runs.startAuto(env.job.id)).done;
        expect(second).toMatchObject({ status: "noop", recorded: false });
        expect(env.history.list()).toHaveLength(count);
        expect(env.jobs.get(env.job.id).lastRun).toMatchObject({ runId: null, status: "noop" });
    });

    it("sync + 삭제 허용이어도 autoMaxDeletes 초과면 blocked, 대상 불변", async () => {
        const { src, dst } = f_Tree("max", 30, 2);
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            autoSync: { enabled: true, intervalMinutes: 1, allowDeletes: true },
        });
        env.settings.safety.autoMaxDeletes = 1;
        const before = snapshotTree(dst);
        const o = await (await env.runs.startAuto(env.job.id)).done;
        expect(o.status).toBe("blocked");
        expect(o.error?.message).toContain("최대 삭제 수");
        expect(snapshotTree(dst)).toEqual(before);
    });

    it("OS 예약: startAuto(id, os-scheduler) → 대상 반영, 이력 trigger os-scheduler (INT-003 T-01)", async () => {
        const { src, dst } = f_Tree("os", 2, 0);
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "copy",
            autoSync: { enabled: true, intervalMinutes: 1, backend: "os" },
        });
        expect(env.job.autoSync).toMatchObject({ backend: "os", nextRunAt: null });
        const { runId, done } = await env.runs.startAuto(env.job.id, "os-scheduler");
        expect((await done).status).toBe("success");
        expect(snapshotTree(dst)["new.txt"]).toBeDefined();
        expect(env.history.get(runId)).toMatchObject({
            trigger: "os-scheduler",
            status: "success",
        });
    });

    it("OS 예약: recordAutoBlocked는 다른 실행 중에도 blocked 1건만 남기고 대상은 그대로", async () => {
        const { src, dst } = f_Tree("os-blocked", 2, 0);
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "copy",
            autoSync: { enabled: true, intervalMinutes: 1, backend: "os" },
        });
        const before = snapshotTree(dst);
        const running = await env.runs.start({ jobId: env.job.id, dryRun: true });
        const o = await env.runs.recordAutoBlocked(env.job.id, "os-scheduler", {
            code: "SCHEDULE_SKIPPED",
            message: "예약 실행 조건에 맞지 않아 실행하지 않았습니다.",
        });
        expect(o).toMatchObject({ status: "blocked", recorded: true });
        await env.waitFinished(running.runId);
        expect(snapshotTree(dst)).toEqual(before);
        expect(env.history.get(o.runId)).toMatchObject({
            trigger: "os-scheduler",
            status: "blocked",
            error: { code: "SCHEDULE_SKIPPED" },
        });
        expect(env.jobs.get(env.job.id).lastRun).toMatchObject({
            runId: o.runId,
            status: "blocked",
        });
    });
});

/** 실제 runs·실제 타이머로 대기열을 만들고, 비면(onIdle) 첫 항목 종료 코드를 돌려준다 */
function f_Queue(env: Awaited<ReturnType<typeof makeEnv>>, limits: Partial<itfOsRunLimits>) {
    let idle: ((code: typHeadlessExitCode | null) => void) | null = null;
    const idleCode = new Promise<typHeadlessExitCode | null>((r) => {
        idle = r;
    });
    const queue = new clsOsRunQueue({
        jobs: env.jobs,
        settings: { get: () => env.settings },
        runs: env.runs,
        checkPaths: (job) =>
            precheckJobPaths(job, {
                pathService: env.pathService,
                settings: { get: () => env.settings },
            }),
        notify: () => undefined,
        logger: { info: () => undefined, warn: () => undefined },
        limits,
        onIdle: (code) => idle?.(code),
    });
    return { queue, idleCode };
}

describe.skipIf(!HAS_RCLONE)("OS 예약 대기열 (실제 rclone, 임시 폴더, INT-003 T-01)", () => {
    it("AC-15: 다른 실행이 락을 쥐고 있으면 기다렸다가 A → B 차례로 실행, 둘 다 os-scheduler", async () => {
        const a = f_Tree("q-a", 2, 0);
        const b = f_Tree("q-b", 2, 0);
        let holdDryRun = true;
        const env = await makeEnv({
            root,
            conf,
            source: a.src,
            destination: a.dst,
            mode: "copy",
            autoSync: { enabled: true, intervalMinutes: 1, backend: "os" },
            // 첫 수동 미리보기만 1초 늦게 시작해 락을 쥐고 있게 한다
            wrapRun: (run) => async (bin, args, opts) => {
                if (holdDryRun && args.includes("--dry-run")) {
                    holdDryRun = false;
                    await new Promise((r) => setTimeout(r, 1000));
                }
                return run(bin, args, opts);
            },
        });
        const jobB = await env.jobs.create({
            ...jobToDraft(env.job),
            name: "실행 통합 B",
            source: b.src,
            destination: b.dst,
        });
        const manual = await env.runs.start({ jobId: env.job.id, dryRun: true });
        const { queue, idleCode } = f_Queue(env, { busyPollMs: 200 });
        expect(queue.enqueue(env.job.id)).toBe("queued");
        expect(queue.enqueue(jobB.id)).toBe("queued");
        expect(queue.enqueue(jobB.id)).toBe("duplicate");
        expect(await idleCode).toBe(0);
        const { record: dry } = await env.waitFinished(manual.runId);
        const os = env.history
            .list()
            .filter((r) => r.trigger === "os-scheduler")
            .toSorted((x, y) => Date.parse(x.startedAt) - Date.parse(y.startedAt));
        expect(os.map((r) => [r.jobId, r.status])).toEqual([
            [env.job.id, "success"],
            [jobB.id, "success"],
        ]);
        expect(Date.parse(os[0]!.startedAt)).toBeGreaterThanOrEqual(Date.parse(dry.finishedAt!));
        expect(Date.parse(os[1]!.startedAt)).toBeGreaterThanOrEqual(Date.parse(os[0]!.finishedAt!));
        expect(snapshotTree(a.dst)["new.txt"]).toBeDefined();
        expect(snapshotTree(b.dst)["new.txt"]).toBeDefined();
        expect(env.jobs.get(jobB.id).autoSync).toMatchObject({ nextRunAt: null });
        expect(env.jobs.get(jobB.id).autoSync.lastAutoRunAt).not.toBeNull();
        queue.dispose();
    });

    it("시간 제한: 넘으면 canceled + 시간 제한 문구, 종료 코드 1, active-run 정리, 대상 불변", async () => {
        const { src, dst } = f_Tree("q-limit", 2, 0);
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "copy",
            autoSync: { enabled: true, intervalMinutes: 1, backend: "os" },
            // 실제 전송은 취소될 때까지(최대 10초) 시작하지 않는다
            wrapRun: (run) => async (bin, args, opts) => {
                if (!args.includes("--dry-run")) {
                    await new Promise<void>((r) => {
                        const t = setTimeout(r, 10_000);
                        if (opts.signal?.aborted) r();
                        opts.signal?.addEventListener(
                            "abort",
                            () => {
                                clearTimeout(t);
                                r();
                            },
                            { once: true },
                        );
                    });
                }
                return run(bin, args, opts);
            },
        });
        const before = snapshotTree(dst);
        const { queue, idleCode } = f_Queue(env, { timeLimitMs: 300 });
        queue.enqueue(env.job.id);
        expect(await idleCode).toBe(1);
        const rec = env.history.list().find((r) => r.trigger === "os-scheduler")!;
        expect(rec).toMatchObject({
            status: "canceled",
            error: { code: "CANCELED", message: TIME_LIMIT_CANCELED_TEXT },
        });
        expect(existsSync(env.activeRunFile)).toBe(false);
        expect(snapshotTree(dst)).toEqual(before);
        queue.dispose();
    });
});
