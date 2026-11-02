/**
 * 실제 rclone으로 동기화 범위(INT-002 T-05)를 확인한다. 임시 폴더와 임시 rclone.conf만 쓴다.
 * copy 전체 범위는 원본의 빈 폴더를 만들고 파일만 범위는 만들지 않는다(AC-9), sync 전체 범위는 대상에만 있는
 * 폴더를 계획(deleteDirs)에 넣고 사전 확인 뒤 지운다, 확인한 폴더 삭제 수가 다르면 거부, 비교 뒤 범위를
 * 바꾸면 이전 계획으로 실행할 수 없다(AC-10).
 * 빈 폴더를 만들 수 없는 대상(INT-003 T-05, AC-13 로컬 대용): memory remote는 CanHaveEmptyDirectories가 false라
 * 빈 폴더 차이만으로는 자동 실행이 noop이다. memory는 rclone 프로세스마다 비어 있어 원본은 빈 폴더만 둔다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import type { typRunRclone } from "@/main/rclone/process";
import type { typSyncScope } from "@/shared/schemas/job";
import { ALIAS, HAS_RCLONE, makeEnv, makeRoot, snapshotTree, writeFile } from "./run-harness";

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

/** 실행 서비스가 부른 rclone 하위 명령(copy·sync 등) 기록 */
function f_CountTransfers(subcommands: string[]) {
    return (run: typRunRclone): typRunRclone =>
        (bin, args, opts) => {
            subcommands.push(args[0] ?? "");
            return run(bin, args, opts);
        };
}

/** 원본: 빈 폴더 e1·e2/sub만 */
function f_EmptyDirsSource(name: string): string {
    const src = join(root, name, "src");
    mkdirSync(join(src, "e1"), { recursive: true });
    mkdirSync(join(src, "e2", "sub"), { recursive: true });
    return src;
}

describe.skipIf(!HAS_RCLONE)("빈 폴더를 만들 수 없는 대상 (실제 rclone, INT-003 T-05)", () => {
    it("AC-13: memory remote 대상 + 빈 폴더 차이만 → destCanHaveEmptyDirs false, 자동 실행 noop", async () => {
        const memConf = join(root, "mem.conf");
        // 테스트 준비용 설정 파일(앱 코드는 읽지 않고 경로만 넘긴다)
        writeFileSync(
            memConf,
            `[${ALIAS}]\ntype = alias\nremote = ${root}\n\n[it-mem]\ntype = memory\n`,
        );
        const subcommands: string[] = [];
        const env = await makeEnv({
            root,
            conf: memConf,
            source: f_EmptyDirsSource("t05-mem"),
            destination: "it-mem:t05/dst",
            mode: "copy",
            scope: "all",
            wrapRun: f_CountTransfers(subcommands),
        });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.destCanHaveEmptyDirs).toBe(false);
        expect(cmp.summary.createFiles).toBe(0);
        expect(cmp.summary.createDirs).toBeGreaterThan(0);
        const o = await (await env.runs.startAuto(env.job.id)).done;
        expect(o).toMatchObject({ status: "noop", recorded: false });
        expect(subcommands.filter((c) => c === "copy" || c === "sync")).toEqual([]);
        expect(env.history.list()).toEqual([]);
    });

    it("대조: 같은 원본, 로컬 대상 → true, 자동 실행이 빈 폴더를 만든다", async () => {
        const dst = join(root, "t05-local", "dst");
        mkdirSync(dst, { recursive: true });
        const env = await makeEnv({
            root,
            conf,
            source: f_EmptyDirsSource("t05-local"),
            destination: dst,
            mode: "copy",
            scope: "all",
        });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.destCanHaveEmptyDirs).toBe(true);
        const o = await (await env.runs.startAuto(env.job.id)).done;
        expect(o.status).toBe("success");
        expect(f_Dirs(dst)).toEqual(["e1", "e2", "e2/sub"]);
    });

    it("가짜 false(alias remote 대상) + 파일은 같고 빈 폴더만 다름 → 자동 noop, 폴더가 생기지 않음", async () => {
        const src = join(root, "t05-fake", "src");
        const dst = join(root, "t05-fake", "dst");
        writeFile(join(src, "a.txt"), "a");
        mkdirSync(join(src, "empty"), { recursive: true });
        writeFile(join(dst, "a.txt"), "a");
        const subcommands: string[] = [];
        const env = await makeEnv({
            root,
            conf,
            source: src,
            // 로컬 대상은 조회하지 않으므로 같은 폴더를 alias remote로 지정한다
            destination: `${ALIAS}:t05-fake/dst`,
            mode: "copy",
            scope: "all",
            emptyDirs: { canHaveEmptyDirs: async () => false },
            wrapRun: f_CountTransfers(subcommands),
        });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.destCanHaveEmptyDirs).toBe(false);
        expect(cmp.summary).toMatchObject({ createFiles: 0, updateFiles: 0, createDirs: 1 });
        const o = await (await env.runs.startAuto(env.job.id)).done;
        expect(o).toMatchObject({ status: "noop", recorded: false });
        expect(subcommands).toEqual([]);
        expect(existsSync(join(dst, "empty"))).toBe(false);
    });
});
