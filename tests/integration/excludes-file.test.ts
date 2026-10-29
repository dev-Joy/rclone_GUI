/**
 * 실제 rclone으로 제외 패턴 파일 방식(--exclude-from)을 확인한다 (INT-002 T-09). 임시 폴더만 쓴다.
 * 공용 100개 + 작업 전용 100개(그중 1개는 #로 시작)를 앱이 파일로 넘겨 비교·동기화한 결과가
 * 같은 패턴을 모두 --exclude 인자로 준 rclone 결과와 같은지, 실행 뒤 임시 파일이 남지 않는지 본다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { runRclone } from "@/main/rclone/process";
import { HAS_RCLONE, makeEnv, makeRoot, RCLONE, snapshotTree, writeFile } from "./run-harness";

const { root, conf } = makeRoot("rclonegui-excl-file-");

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

const LIBRARY = Array.from({ length: 100 }, (_v, i) => `lib${String(i).padStart(3, "0")}.dat`);
const JOB_ONLY = [
    ...Array.from({ length: 99 }, (_v, i) => `job${String(i).padStart(3, "0")}.dat`),
    "#hash.txt",
];

function f_Prepare(src: string, dst: string): void {
    for (let i = 0; i < 120; i += 1) {
        const n = String(i).padStart(3, "0");
        writeFile(join(src, `lib${n}.dat`), `l${n}`);
        writeFile(join(src, "sub", `job${n}.dat`), `j${n}`);
        writeFile(join(src, `keep${n}.txt`), `k${n}`);
    }
    writeFile(join(src, "#hash.txt"), "hash");
    // 대상에만 있는 파일: 제외 패턴에 걸린 것은 sync가 지우지 않아야 한다
    writeFile(join(dst, "lib000.dat"), "old-excluded");
    writeFile(join(dst, "#hash.txt"), "old-excluded");
    writeFile(join(dst, "gone.txt"), "delete-me");
}

describe.skipIf(!HAS_RCLONE)("--exclude-from 파일 방식 (실제 rclone, 임시 폴더)", () => {
    it("200개 패턴: 파일 방식 비교·sync 결과가 인자 방식과 같고, 실행 뒤 exclude-files/가 비어 있다", async () => {
        const src = join(root, "a", "src");
        const dst = join(root, "a", "dst");
        const dst2 = join(root, "a", "dst-args");
        f_Prepare(src, dst);
        cpSync(dst, dst2, { recursive: true });

        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            excludes: JOB_ONLY,
            libraryPatterns: LIBRARY,
        });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary.deleteFiles).toBe(1);
        expect(existsSync(env.excludeFileDir) ? readdirSync(env.excludeFileDir) : []).toEqual([]);

        // 인자 방식 lsjson과 원본 목록 수가 같다
        const argEx = [...LIBRARY, ...JOB_ONLY].flatMap((p) => ["--exclude", p]);
        const ls = await runRclone(
            RCLONE,
            ["lsjson", "--recursive", "--files-only", "--config", conf, ...argEx, "--", src],
            { timeoutMs: 60_000 },
        );
        expect(ls.exitCode).toBe(0);
        const argList = (JSON.parse(ls.stdout) as Array<{ Path: string }>).map((e) => e.Path);
        expect(cmp.summary.sourceFiles).toBe(argList.length);
        expect(argList).not.toContain("#hash.txt");

        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: cmp.summary.deleteFiles,
            // 제외된 대상 파일은 세지 않아 대상 1개 중 1개 삭제(대량 삭제)로 본다
            confirmLargeDeletes: true,
        });
        const { record } = await env.waitFinished(runId);
        expect(record.status).toBe("success");

        const direct = await runRclone(
            RCLONE,
            ["sync", "--config", conf, ...argEx, "--", src, dst2],
            { timeoutMs: 120_000 },
        );
        expect(direct.exitCode).toBe(0);
        expect(snapshotTree(dst)).toEqual(snapshotTree(dst2));
        expect(snapshotTree(dst)["lib000.dat"]).toMatch(/^old-excluded@/);
        expect(snapshotTree(dst)["gone.txt"]).toBeUndefined();

        expect(existsSync(env.excludeFileDir) ? readdirSync(env.excludeFileDir) : []).toEqual([]);
        const log = readFileSync(join(env.logsDir, record.logFile!), "utf8");
        expect(log).toContain("--exclude-from");
        expect(log).toContain("#hash.txt");
    });
});
