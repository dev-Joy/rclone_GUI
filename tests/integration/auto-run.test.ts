/**
 * 실제 rclone으로 자동 실행(startAuto)을 확인한다. 임시 폴더와 임시 rclone.conf만 쓴다.
 * copy 반영, 삭제 허용 끔 sync → blocked·대상 불변, 허용 + 소량 삭제 → 사전 확인 뒤 반영(다음 자동 실행은 noop),
 * autoMaxDeletes 초과 → blocked·대상 불변.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
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
});
