/**
 * 실제 rclone으로 동기화 범위(INT-002 T-05)를 확인한다. 임시 폴더와 임시 rclone.conf만 쓴다.
 * copy 전체 범위는 원본의 빈 폴더를 만들고 파일만 범위는 만들지 않는다(AC-9), sync 전체 범위는 대상에만 있는
 * 폴더를 계획(deleteDirs)에 넣고 사전 확인 뒤 지운다, 확인한 폴더 삭제 수가 다르면 거부, 비교 뒤 범위를
 * 바꾸면 이전 계획으로 실행할 수 없다(AC-10).
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import type { typSyncScope } from "@/shared/schemas/job";
import { HAS_RCLONE, makeEnv, makeRoot, snapshotTree, writeFile } from "./run-harness";

const { root, conf } = makeRoot("rclonegui-run-scope-");

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

/** 폴더 안 하위 폴더(/ 구분, 정렬) */
function f_Dirs(dir: string): string[] {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) =>
            join(d.parentPath, d.name)
                .slice(dir.length + 1)
                .replaceAll("\\", "/"),
        )
        .toSorted();
}

/** 원본: a.txt, 빈 폴더 empty·nest/x. 대상: a.txt, 대상에만 있는 빈 폴더 old·old/sub */
function f_Tree(name: string): { src: string; dst: string } {
    const src = join(root, name, "src");
    const dst = join(root, name, "dst");
    writeFile(join(src, "a.txt"), "a");
    mkdirSync(join(src, "empty"), { recursive: true });
    mkdirSync(join(src, "nest", "x"), { recursive: true });
    writeFile(join(dst, "a.txt"), "a");
    mkdirSync(join(dst, "old", "sub"), { recursive: true });
    return { src, dst };
}

async function f_Env(name: string, mode: "copy" | "sync", scope: typSyncScope) {
    const { src, dst } = f_Tree(name);
    const env = await makeEnv({ root, conf, source: src, destination: dst, mode, scope });
    return { env, src, dst };
}

describe.skipIf(!HAS_RCLONE)("동기화 범위 (실제 rclone, 임시 폴더)", () => {
    it("copy 전체 범위: 원본의 빈 폴더를 만들고 대상에만 있는 폴더는 남긴다 (AC-9)", async () => {
        const { env, dst } = await f_Env("copy-all", "copy", "all");
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.scope).toBe("all");
        expect(cmp.summary).toMatchObject({ createFiles: 0, createDirs: 3, deleteDirs: 2 });
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 0,
        });
        const { record } = await env.waitFinished(runId);
        expect(record).toMatchObject({ status: "success" });
        expect(record.plan).toMatchObject({ createDirs: 3, deleteDirs: 0 });
        expect(f_Dirs(dst)).toEqual(["empty", "nest", "nest/x", "old", "old/sub"]);
    });

    it("copy 파일만 범위: 빈 폴더를 만들지 않고 바꿀 것이 없다", async () => {
        const { env, dst } = await f_Env("copy-files", "copy", "files");
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary).toMatchObject({ createFiles: 0, createDirs: 0, deleteDirs: 0 });
        expect(cmp.dirChanges).toEqual([]);
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 0,
        });
        expect((await env.waitFinished(runId)).record.status).toBe("success");
        expect(f_Dirs(dst)).toEqual(["old", "old/sub"]);
    });

    it("sync 전체 범위: 폴더 삭제가 계획에 잡히고 사전 확인을 지나 대상이 원본과 같아진다", async () => {
        const { env, src, dst } = await f_Env("sync-all", "sync", "all");
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary).toMatchObject({ deleteFiles: 0, createDirs: 3, deleteDirs: 2 });
        expect(cmp.dirChanges.filter((c) => c.action === "delete").map((c) => c.path)).toEqual([
            "old",
            "old/sub",
        ]);
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 0,
            confirmedDeleteDirs: 2,
        });
        const { record } = await env.waitFinished(runId);
        expect(record.status).toBe("success");
        expect(record.preflight).toMatchObject({ deletes: 0, deletedDirs: 2, errors: 0 });
        expect(f_Dirs(dst)).toEqual(f_Dirs(src));
        expect(snapshotTree(dst)).toEqual(snapshotTree(src));
    });

    it("sync 전체 범위: 확인한 폴더 삭제 수가 다르면 SAFETY_BLOCKED, 대상 불변", async () => {
        const { env, dst } = await f_Env("sync-wrong", "sync", "all");
        const cmp = await env.compare.run(env.job.id);
        const before = f_Dirs(dst);
        await expect(
            env.runs.start({
                jobId: env.job.id,
                dryRun: false,
                planToken: cmp.planToken,
                confirmedDeletes: 0,
            }),
        ).rejects.toMatchObject({ code: "SAFETY_BLOCKED" });
        expect(f_Dirs(dst)).toEqual(before);
    });

    it("비교 뒤 범위를 바꾸면 이전 계획 토큰으로 실행할 수 없다 (AC-10)", async () => {
        const { env, dst } = await f_Env("scope-change", "copy", "files");
        const cmp = await env.compare.run(env.job.id);
        await env.jobs.update(env.job.id, { scope: "all" });
        await expect(
            env.runs.start({
                jobId: env.job.id,
                dryRun: false,
                planToken: cmp.planToken,
                confirmedDeletes: 0,
            }),
        ).rejects.toMatchObject({ code: "PLAN_STALE" });
        expect(f_Dirs(dst)).toEqual(["old", "old/sub"]);
    });
});
