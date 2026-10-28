/**
 * 실제 rclone으로 copy 실행과 취소를 확인한다. 임시 폴더와 임시 rclone.conf만 쓴다.
 * 비교 → 실제 copy → 대상 파일·lastRun·비교 결과 무효화·같은 토큰 재사용 거부,
 * 작은 파일 여러 개를 하나씩 복사하는 중 취소 → canceled·프로세스 종료·active-run 삭제를 본다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { HAS_RCLONE, makeEnv, makeRoot, NEWER, snapshotTree, writeFile } from "./run-harness";

const { root, conf } = makeRoot("rclonegui-run-copy-");

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

function f_Alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function f_Files(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name);
}

describe.skipIf(!HAS_RCLONE)("copy 실행 (실제 rclone, 임시 폴더)", () => {
    it("비교 → 복사 실행 → 대상 반영·lastRun·비교 무효화, 같은 토큰 재사용은 PLAN_REQUIRED", async () => {
        const src = join(root, "a", "src");
        const dst = join(root, "a", "dst");
        writeFile(join(src, "same.txt"), "same");
        writeFile(join(src, "changed.txt"), "changed-longer", NEWER);
        writeFile(join(src, "sub", "new.txt"), "new");
        writeFile(join(src, "한글 파일.txt"), "unicode");
        writeFile(join(dst, "same.txt"), "same");
        writeFile(join(dst, "changed.txt"), "changed");
        writeFile(join(dst, "extra.txt"), "extra");
        const env = await makeEnv({ root, conf, source: src, destination: dst, mode: "copy" });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary).toMatchObject({ createFiles: 2, updateFiles: 1, deleteFiles: 1 });

        const input = {
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 0,
        };
        const { runId } = await env.runs.start(input);
        const { record } = await env.waitFinished(runId);

        expect(record).toMatchObject({ status: "success", dryRun: false, exitCode: 0 });
        expect(record.stats).toMatchObject({ transfers: 3, errors: 0 });
        const after = snapshotTree(dst);
        expect(Object.keys(after).toSorted()).toEqual(
            ["changed.txt", "extra.txt", "same.txt", "sub/new.txt", "한글 파일.txt"].toSorted(),
        );
        expect(readFileSync(join(dst, "changed.txt"), "utf8")).toBe("changed-longer");
        expect(readFileSync(join(dst, "한글 파일.txt"), "utf8")).toBe("unicode");
        // copy는 대상에만 있는 파일을 지우지 않는다
        expect(readFileSync(join(dst, "extra.txt"), "utf8")).toBe("extra");
        expect(env.jobs.get(env.job.id).lastRun).toMatchObject({ runId, status: "success" });
        expect(env.jobs.get(env.job.id).rev).toBe(env.job.rev);
        expect(env.compare.get(env.job.id)).toBeNull();
        expect(existsSync(env.activeRunFile)).toBe(false);
        await expect(env.runs.start(input)).rejects.toMatchObject({ code: "PLAN_REQUIRED" });
        expect(env.history.list()).toHaveLength(1);

        // 다시 비교하면 바꿀 파일이 없다
        const again = await env.compare.run(env.job.id);
        expect(again.summary).toMatchObject({ createFiles: 0, updateFiles: 0 });
    });

    it("복사 중 취소 → canceled, 프로세스 종료, active-run 삭제, lastRun canceled", async () => {
        const src = join(root, "b", "src");
        const dst = join(root, "b", "dst");
        const COUNT = 400;
        const body = Buffer.alloc(32 * 1024, 7);
        for (let i = 0; i < COUNT; i += 1) {
            writeFile(join(src, `f${String(i).padStart(4, "0")}.bin`), body);
        }
        let canceledAt: number | null = null;
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "copy",
            options: { transfers: 1, checkers: 1 },
            // 첫 "Copied" 로그 줄에서 취소한다
            wrapRun: (run, runs) => (bin, args, opts) =>
                run(bin, args, {
                    ...opts,
                    onStderrLine: (line) => {
                        opts.onStderrLine?.(line);
                        if (canceledAt === null && line.includes("Copied")) {
                            canceledAt = Date.now();
                            const a = runs().getActive();
                            if (a) runs().cancel(a.runId);
                        }
                    },
                }),
        });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary.createFiles).toBe(COUNT);
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 0,
        });
        const { record } = await env.waitFinished(runId);

        expect(canceledAt).not.toBeNull();
        expect(record.status).toBe("canceled");
        expect(record.error?.code).toBe("CANCELED");
        expect(record.pid).toBeGreaterThan(0);
        expect(f_Alive(record.pid!)).toBe(false);
        expect(existsSync(env.activeRunFile)).toBe(false);
        expect(env.jobs.get(env.job.id).lastRun).toMatchObject({ runId, status: "canceled" });
        expect(env.compare.get(env.job.id)).toBeNull();
        const files = f_Files(dst);
        const partial = files.filter((f) => f.endsWith(".partial"));
        // 관찰 기록(rclone-notes): 복사된 수와 남은 .partial 수
        console.info(
            `[test:int] 취소: 대상 파일 ${files.length}/${COUNT}개, .partial ${partial.length}개`,
        );
        expect(files.length - partial.length).toBeLessThan(COUNT);
    });
});
