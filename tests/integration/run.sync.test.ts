/**
 * 실제 rclone으로 sync 실제 실행과 사전 확인·삭제 한도를 확인한다. 임시 폴더와 임시 rclone.conf만 쓴다.
 * 비교 → 실제 sync → 대상이 원본과 같음, 비교 뒤 대상에 파일 추가 → 사전 확인 불일치(PLAN_DRIFT)·대상 불변,
 * 사전 확인을 끄면 --max-delete 백스톱으로 exit 7(MAX_DELETE_EXCEEDED)·삭제 수 ≤ 계획.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { HAS_RCLONE, makeEnv, makeRoot, NEWER, snapshotTree, writeFile } from "./run-harness";

const { root, conf } = makeRoot("rclonegui-run-sync-");

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

/** 원본: same·changed(새로움)·sub/new, 대상: same·changed·extra·gone/old (sync 삭제 2개) */
function f_Tree(name: string): { src: string; dst: string } {
    const src = join(root, name, "src");
    const dst = join(root, name, "dst");
    writeFile(join(src, "same.txt"), "same");
    writeFile(join(src, "changed.txt"), "changed-longer", NEWER);
    writeFile(join(src, "sub", "new.txt"), "new");
    writeFile(join(dst, "same.txt"), "same");
    writeFile(join(dst, "changed.txt"), "changed");
    writeFile(join(dst, "extra.txt"), "extra");
    writeFile(join(dst, "gone", "old.txt"), "old");
    return { src, dst };
}

describe.skipIf(!HAS_RCLONE)("sync 실행 (실제 rclone, 임시 폴더)", () => {
    it("비교 → 사전 확인 → 실제 sync → 대상이 원본과 같음, lastRun·비교 무효화", async () => {
        const { src, dst } = f_Tree("a");
        const env = await makeEnv({ root, conf, source: src, destination: dst, mode: "sync" });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary).toMatchObject({ createFiles: 1, updateFiles: 1, deleteFiles: 2 });
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 2,
            confirmLargeDeletes: true,
        });
        const { record } = await env.waitFinished(runId);
        expect(record).toMatchObject({ status: "success", dryRun: false, exitCode: 0 });
        expect(record.preflight).toMatchObject({ deletes: 2, errors: 0 });
        expect(record.stats).toMatchObject({ deletes: 2, errors: 0 });
        expect(snapshotTree(dst)).toEqual(snapshotTree(src));
        expect(env.jobs.get(env.job.id).lastRun).toMatchObject({ runId, status: "success" });
        expect(env.compare.get(env.job.id)).toBeNull();
        const again = await env.compare.run(env.job.id);
        expect(again.summary).toMatchObject({ createFiles: 0, updateFiles: 0, deleteFiles: 0 });
    });

    it("비교 뒤 대상에 파일 추가 + 사전 확인 켜짐 → blocked PLAN_DRIFT, 대상 불변", async () => {
        const { src, dst } = f_Tree("b");
        const env = await makeEnv({ root, conf, source: src, destination: dst, mode: "sync" });
        const cmp = await env.compare.run(env.job.id);
        writeFile(join(dst, "late.txt"), "late");
        const before = snapshotTree(dst);
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 2,
            confirmLargeDeletes: true,
        });
        const { record } = await env.waitFinished(runId);
        expect(record.status).toBe("blocked");
        expect(record.error?.code).toBe("PLAN_DRIFT");
        expect(record.error?.detail).toContain("계획 2개");
        expect(record.preflight).toMatchObject({ deletes: 3 });
        expect(record.stats).toBeNull();
        expect(snapshotTree(dst)).toEqual(before);
        expect(env.jobs.get(env.job.id).lastRun).toMatchObject({ runId, status: "blocked" });
        expect(env.compare.get(env.job.id)).toBeNull();
    });

    it("사전 확인 꺼짐 + 비교 뒤 삭제 대상 추가 → exit 7 MAX_DELETE_EXCEEDED, 삭제 수 ≤ 계획", async () => {
        const { src, dst } = f_Tree("c");
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            options: { preflightBeforeDestructive: false },
        });
        const cmp = await env.compare.run(env.job.id);
        writeFile(join(dst, "late1.txt"), "late1");
        writeFile(join(dst, "late2.txt"), "late2");
        const before = Object.keys(snapshotTree(dst));
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 2,
            confirmLargeDeletes: true,
        });
        const { record } = await env.waitFinished(runId);
        expect(record.status).toBe("failed");
        expect(record.exitCode).toBe(7);
        expect(record.error?.code).toBe("MAX_DELETE_EXCEEDED");
        expect(record.preflight).toBeNull();
        const after = Object.keys(snapshotTree(dst));
        const removed = before.filter((p) => !after.includes(p));
        expect(removed.length).toBeLessThanOrEqual(2);
        expect(record.stats?.deletes ?? 0).toBeLessThanOrEqual(2);
        // 관찰 기록(rclone-notes): 한도까지 지우고 멈추는지
        console.info(`[test:int] max-delete 2, 삭제 대상 4 → 지운 파일 ${removed.length}개`);
    });
});
