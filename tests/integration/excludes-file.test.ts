/**
 * 실제 rclone으로 필터 파일 방식(--filter-from)을 확인한다 (INT-007). 임시 폴더만 쓴다.
 * 공용 100개 + 작업 전용 100개(그중 1개는 #로 시작)를 앱이 필터 파일로 넘겨 비교·동기화한 결과가
 * 같은 패턴을 모두 --exclude 인자로 준 rclone 결과와 같은지, 실행 뒤 임시 파일이 남지 않는지 본다.
 * 끝 공백 패턴은 파일에 `[ ]`로 쓰여 rclone이 그 이름만 빼는지 `--dump filters`로 확인한다
 * (Windows 로컬은 끝 공백 이름을 만들 수 없다).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { runRclone } from "@/main/rclone/process";
import { buildFilterFileContent } from "@/shared/exclude-patterns";
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

describe.skipIf(!HAS_RCLONE)("--filter-from 파일 방식 (실제 rclone, 임시 폴더)", () => {
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
        expect(log).toContain("--filter-from");
        // 필터 파일 내용(패턴)은 로그에 남기지 않는다(경로만 가려서 기록)
        expect(log).not.toContain("#hash.txt");
    });

    it("#·;·앞 공백·! 패턴이 저장한 그대로 적용된다(AC-8)", async () => {
        const src = join(root, "b", "src");
        const dst = join(root, "b", "dst");
        mkdirSync(dst, { recursive: true });
        for (const n of ["#a", ";a", " lead", "!a", "a", "c"]) writeFile(join(src, n), n);

        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "copy",
            excludes: ["#a", ";a", " lead", "!a"],
        });
        const cmp = await env.compare.run(env.job.id);
        // 네 파일이 빠지고 a·c만 남는다
        expect(cmp.summary.sourceFiles).toBe(2);
        expect(existsSync(env.excludeFileDir) ? readdirSync(env.excludeFileDir) : []).toEqual([]);
    });

    it("끝 공백 패턴은 파일에 [ ]로 쓰여 그 이름만 뺀다(AC-10)", async () => {
        const src = join(root, "c", "src");
        const dst = join(root, "c", "dst");
        mkdirSync(dst, { recursive: true });
        writeFile(join(src, "trail"), "t");
        writeFile(join(src, "keep.txt"), "k");

        /** 앱이 첫 rclone 실행에 넘긴 필터 파일 내용 */
        let captured: string | null = null;
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "copy",
            excludes: ["trail "],
            wrapRun: (run) => (bin, args, opts) => {
                const i = args.indexOf("--filter-from");
                if (i !== -1 && captured === null) captured = readFileSync(args[i + 1]!, "utf8");
                return run(bin, args, opts);
            },
        });
        const { runId } = await env.runs.start({ jobId: env.job.id, dryRun: true });
        await env.waitFinished(runId);

        expect(captured).toBe(buildFilterFileContent(["trail "]));
        const filterFile = join(root, "c", "captured-filter.txt");
        writeFileSync(filterFile, captured!);
        // 앱은 --dump*를 쓰지 않는다. 해석 결과 확인은 테스트 코드에서만 한다.
        const dump = spawnSync(
            RCLONE,
            ["lsf", "--config", conf, "--filter-from", filterFile, "--dump", "filters", "--", src],
            { shell: false, windowsHide: true, encoding: "utf8" },
        );
        expect(dump.status).toBe(0);
        expect(dump.stdout).toContain("(^|/)trail[ ]$");
    });
});
