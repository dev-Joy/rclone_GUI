/**
 * 실제 rclone으로 미리보기(dry-run)를 확인한다. 임시 폴더와 임시 rclone.conf(alias remote)만 쓴다.
 * 비교 계획과 dry-run 결과가 같은 일을 하는지, 대상이 그대로인지, 이력·실행 로그가 남는지 본다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { matchPlanWithDryRun, planFromCompare } from "@/shared/run-plan";
import {
    ALIAS,
    HAS_RCLONE,
    makeEnv,
    makeRoot,
    NEWER,
    snapshotTree,
    writeFile,
} from "./run-harness";

const { root, conf } = makeRoot("rclonegui-run-dry-");
let caseNo = 0;
let src = "";
let dst = "";
let rel = "";

beforeEach(() => {
    caseNo += 1;
    rel = `c${caseNo}`;
    src = join(root, rel, "src");
    dst = join(root, rel, "dst");
    writeFile(join(src, "same.txt"), "same");
    writeFile(join(src, "touch.txt"), "touch", NEWER);
    writeFile(join(src, "changed.txt"), "changed-longer", NEWER);
    writeFile(join(src, "sub", "new.txt"), "new");
    writeFile(join(src, "한글 파일.txt"), "unicode");
    writeFile(join(src, "skip.tmp"), "excluded");
    writeFile(join(dst, "same.txt"), "same");
    writeFile(join(dst, "touch.txt"), "touch");
    writeFile(join(dst, "changed.txt"), "changed");
    writeFile(join(dst, "extra.txt"), "extra");
    writeFile(join(dst, "gone", "old.txt"), "old");
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!HAS_RCLONE)("미리보기 (실제 rclone, 임시 폴더)", () => {
    it("copy: 계획과 일치, 대상 불변, 이력·로그(경로·설정 내용 없음), lastRun 그대로", async () => {
        const env = await makeEnv({ root, conf, source: src, destination: dst, mode: "copy" });
        const before = snapshotTree(dst);
        const cmp = await env.compare.run(env.job.id);
        const { runId } = await env.runs.start({ jobId: env.job.id, dryRun: true });
        const { record, dryRunSummary } = await env.waitFinished(runId);

        expect(record).toMatchObject({ status: "success", dryRun: true, exitCode: 0 });
        expect(dryRunSummary).toMatchObject({ copyFiles: 3, touchFiles: 1, deleteFiles: 0 });
        expect(matchPlanWithDryRun(planFromCompare(cmp.summary, "copy"), dryRunSummary!)).toEqual({
            ok: true,
            mismatches: [],
        });
        expect(snapshotTree(dst)).toEqual(before);
        // 이력: 한 건, 계획 포함. dry-run은 lastRun·비교 결과를 건드리지 않는다
        expect(env.history.list()).toHaveLength(1);
        expect(env.history.get(runId)?.plan).toMatchObject({ createFiles: 2, updateFiles: 2 });
        expect(env.jobs.get(env.job.id).lastRun).toBeNull();
        expect(env.compare.get(env.job.id)?.planToken).toBe(cmp.planToken);
        // 실행 로그
        expect(readdirSync(env.logsDir)).toEqual([record.logFile]);
        const log = readFileSync(join(env.logsDir, record.logFile!), "utf8");
        const header = log.split("\n").slice(0, 3).join("\n");
        expect(header).toContain("--dry-run");
        expect(header).toContain("-- <원본> <대상>");
        expect(header).not.toContain(root);
        expect(log).not.toContain(`type = alias`);
        expect(log).toContain("Skipped copy as --dry-run is set");
        expect(existsSync(env.activeRunFile)).toBe(false);
    });

    it("sync(대상은 alias remote): 삭제 2·빈 폴더 1까지 계획과 일치, 대상 불변", async () => {
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: `${ALIAS}:${rel}/dst`,
            mode: "sync",
        });
        const before = snapshotTree(dst);
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary.deleteFiles).toBe(2);
        const { runId } = await env.runs.start({ jobId: env.job.id, dryRun: true });
        const { record, dryRunSummary } = await env.waitFinished(runId);
        expect(record.status).toBe("success");
        expect(dryRunSummary).toMatchObject({
            copyFiles: 3,
            touchFiles: 1,
            deleteFiles: 2,
            removeDirs: 1,
        });
        expect(matchPlanWithDryRun(planFromCompare(cmp.summary, "sync"), dryRunSummary!).ok).toBe(
            true,
        );
        expect(snapshotTree(dst)).toEqual(before);
        const log = readFileSync(join(env.logsDir, record.logFile!), "utf8");
        expect(log).not.toContain("type = alias");
        expect(log.split("\n")[2]).toContain("--config <설정 파일>");
    });

    it("실제 실행 경로는 sync에서 막힌다(SAFETY_BLOCKED, 이력 없음)", async () => {
        const env = await makeEnv({ root, conf, source: src, destination: dst, mode: "sync" });
        const cmp = await env.compare.run(env.job.id);
        await expect(
            env.runs.start({
                jobId: env.job.id,
                dryRun: false,
                planToken: cmp.planToken,
                confirmedDeletes: cmp.summary.deleteFiles,
            }),
        ).rejects.toMatchObject({ code: "SAFETY_BLOCKED" });
        expect(env.history.list()).toEqual([]);
        expect(snapshotTree(dst)).toMatchObject({ "extra.txt": expect.any(String) });
    });
});
