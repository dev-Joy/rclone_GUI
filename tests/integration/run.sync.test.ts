/**
 * 실제 rclone으로 sync 실제 실행과 사전 확인·삭제 한도를 확인한다. 임시 폴더와 임시 rclone.conf만 쓴다.
 * 비교 → 실제 sync → 대상이 원본과 같음, 비교 뒤 대상에 파일 추가 → 사전 확인 불일치(PLAN_DRIFT)·대상 불변,
 * 사전 확인을 끄면 --max-delete 백스톱으로 exit 7(MAX_DELETE_EXCEEDED)·삭제 수 ≤ 계획.
 * 백업 폴더(INT-003 T-03): 오류 무시 + --backup-dir로 지우거나 덮어쓴 파일이 실행별 하위 폴더로 옮겨지고(AC-10),
 * 덮어쓰기 이동은 --max-delete에 들어가지 않으며, 연달아 실행해도 예전 백업이 보존된다. Move 없는 remote는 차단(AC-18).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import type { typRunRclone } from "@/main/rclone/process";
import {
    ALIAS,
    HAS_RCLONE,
    makeEnv,
    makeRoot,
    NEWER,
    snapshotTree,
    writeFile,
} from "./run-harness";

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

/** 실행별 하위 폴더 이름: YYYY-MM-DD_HHmmss_<jobId 앞 8자> */
const SUBDIR_RE = /^\d{4}-\d{2}-\d{2}_\d{6}_[0-9a-f]{8}$/;

/** 원본: a(새 파일)·b(덮어쓰기), 대상: b(예전)·x(삭제) */
function f_BackupTree(name: string): { src: string; dst: string; bk: string } {
    const src = join(root, name, "src");
    const dst = join(root, name, "dst");
    writeFile(join(src, "a.txt"), "a");
    writeFile(join(src, "b.txt"), "b-new-longer", NEWER);
    writeFile(join(dst, "b.txt"), "b-old");
    writeFile(join(dst, "x.txt"), "x-del");
    return { src, dst, bk: join(root, name, "bk") };
}

/** rclone 인자를 모은다 */
function f_Collect(calls: string[][]) {
    return (run: typRunRclone): typRunRclone =>
        (bin, args, opts) => {
            calls.push([...args]);
            return run(bin, args, opts);
        };
}

describe.skipIf(!HAS_RCLONE)("백업 폴더 sync (실제 rclone, 임시 폴더, INT-003 T-03)", () => {
    it("AC-10: 오류 무시 + 백업 폴더 → 성공, 지운·덮어쓴 파일이 하위 폴더에 있다", async () => {
        const { src, dst, bk } = f_BackupTree("bk1");
        const calls: string[][] = [];
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            options: { ignoreErrors: true },
            backupDir: bk,
            wrapRun: f_Collect(calls),
        });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary).toMatchObject({ createFiles: 1, updateFiles: 1, deleteFiles: 1 });
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 1,
            confirmLargeDeletes: true,
        });
        const { record } = await env.waitFinished(runId);
        expect(record).toMatchObject({ status: "success", exitCode: 0 });
        expect(record.preflight).toMatchObject({ deletes: 1, errors: 0 });
        expect(snapshotTree(dst)).toEqual(snapshotTree(src));
        const subs = readdirSync(bk);
        expect(subs).toHaveLength(1);
        expect(subs[0]).toMatch(SUBDIR_RE);
        expect(subs[0]!.endsWith(env.job.id.slice(0, 8))).toBe(true);
        expect(record.backupDir).toBe(join(bk, subs[0]!));
        expect(readFileSync(join(bk, subs[0]!, "x.txt"), "utf8")).toBe("x-del");
        expect(readFileSync(join(bk, subs[0]!, "b.txt"), "utf8")).toBe("b-old");
        const real = calls.at(-1)!;
        expect(real).toContain("--ignore-errors");
        expect(real[real.indexOf("--backup-dir") + 1]).toBe(record.backupDir);
        expect(real[real.indexOf("--max-delete") + 1]).toBe("1");
        // 사전 확인도 같은 값
        const pre = calls.at(-2)!;
        expect(pre).toContain("--dry-run");
        expect(pre[pre.indexOf("--backup-dir") + 1]).toBe(record.backupDir);
    });

    it("덮어쓰기 3 + 삭제 1 → 사전 확인 통과, --max-delete 1로 성공(덮어쓰기 이동은 한도에 안 듦)", async () => {
        const src = join(root, "bk2", "src");
        const dst = join(root, "bk2", "dst");
        for (const n of ["c1", "c2", "c3"]) {
            writeFile(join(src, `${n}.txt`), `${n}-new-longer`, NEWER);
            writeFile(join(dst, `${n}.txt`), `${n}-old`);
        }
        writeFile(join(dst, "x.txt"), "x");
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            backupDir: join(root, "bk2", "bk"),
        });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary).toMatchObject({ updateFiles: 3, deleteFiles: 1 });
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 1,
            confirmLargeDeletes: true,
        });
        const { record } = await env.waitFinished(runId);
        expect(record.status).toBe("success");
        expect(record.stats).toMatchObject({ deletes: 1, errors: 0 });
        expect(Object.keys(snapshotTree(record.backupDir!)).toSorted()).toEqual([
            "c1.txt",
            "c2.txt",
            "c3.txt",
            "x.txt",
        ]);
    });

    it("같은 작업을 연달아 두 번 → 하위 폴더 2개, 예전 백업 보존(rclone-notes #31 회귀)", async () => {
        const { src, dst, bk } = f_BackupTree("bk3");
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            backupDir: bk,
        });
        const f_Run = async () => {
            const cmp = await env.compare.run(env.job.id);
            const { runId } = await env.runs.start({
                jobId: env.job.id,
                dryRun: false,
                planToken: cmp.planToken,
                confirmedDeletes: cmp.summary.deleteFiles,
                confirmLargeDeletes: true,
            });
            return (await env.waitFinished(runId)).record;
        };
        const first = await f_Run();
        expect(first.status).toBe("success");
        // 대상에 다시 지울 파일·덮어쓸 파일을 만든다(같은 이름)
        writeFile(join(dst, "x.txt"), "x-second");
        writeFile(join(dst, "b.txt"), "b-second");
        const second = await f_Run();
        expect(second.status).toBe("success");
        expect(second.backupDir).not.toBe(first.backupDir);
        expect(readdirSync(bk)).toHaveLength(2);
        expect(readFileSync(join(first.backupDir!, "x.txt"), "utf8")).toBe("x-del");
        expect(readFileSync(join(second.backupDir!, "x.txt"), "utf8")).toBe("x-second");
    });

    it("자동 실행 + 백업 폴더 + 오류 무시 → 사전 확인 뒤 성공", async () => {
        const { src, dst, bk } = f_BackupTree("bk4");
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            options: { ignoreErrors: true },
            backupDir: bk,
            autoSync: { enabled: true, intervalMinutes: 1, allowDeletes: true },
        });
        env.settings.safety.deleteConfirmPercent = 100;
        const o = await (await env.runs.startAuto(env.job.id)).done;
        expect(o.status).toBe("success");
        const rec = env.history.get(o.runId);
        expect(rec?.preflight).toMatchObject({ deletes: 1, errors: 0 });
        expect(readFileSync(join(rec!.backupDir!, "x.txt"), "utf8")).toBe("x-del");
    });

    it("remote(alias, Move 지원) 대상 + 백업 폴더 → backend features 확인 뒤 성공", async () => {
        const { src } = f_BackupTree("bk5");
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: `${ALIAS}:bk5/dst`,
            mode: "sync",
            backupDir: `${ALIAS}:bk5/bk`,
        });
        const cmp = await env.compare.run(env.job.id);
        const { runId } = await env.runs.start({
            jobId: env.job.id,
            dryRun: false,
            planToken: cmp.planToken,
            confirmedDeletes: 1,
            confirmLargeDeletes: true,
        });
        const { record } = await env.waitFinished(runId);
        expect(record.status).toBe("success");
        expect(record.backupDir).toMatch(new RegExp(`^${ALIAS}:bk5/bk/\\d{4}-`));
        expect(
            readFileSync(
                join(root, "bk5", "bk", readdirSync(join(root, "bk5", "bk"))[0]!, "x.txt"),
                "utf8",
            ),
        ).toBe("x-del");
    });

    it("AC-18: Move를 지원하지 않는 remote(memory) 대상 + 백업 폴더 → 전송 없이 SAFETY_BLOCKED", async () => {
        const memConf = join(root, "mem.conf");
        // 테스트 준비용 설정 파일(앱 코드는 읽지 않고 경로만 넘긴다)
        writeFileSync(
            memConf,
            `[${ALIAS}]\ntype = alias\nremote = ${root}\n\n[it-mem]\ntype = memory\n`,
        );
        const src = join(root, "bk6", "src");
        writeFile(join(src, "a.txt"), "a");
        const calls: string[][] = [];
        const env = await makeEnv({
            root,
            conf: memConf,
            source: src,
            destination: "it-mem:bk6/dst",
            mode: "sync",
            options: { ignoreErrors: true },
            backupDir: "it-mem:bk6/bk",
            wrapRun: f_Collect(calls),
        });
        const cmp = await env.compare.run(env.job.id);
        const before = calls.length;
        await expect(
            env.runs.start({
                jobId: env.job.id,
                dryRun: false,
                planToken: cmp.planToken,
                confirmedDeletes: 0,
            }),
        ).rejects.toMatchObject({ code: "SAFETY_BLOCKED" });
        expect(calls.length).toBe(before);
        expect(env.history.list()).toEqual([]);
        // 자동 실행도 blocked 이력
        const o = await (await env.runs.startAuto(env.job.id)).done;
        expect(o).toMatchObject({ status: "blocked", recorded: true });
        expect(o.error?.code).toBe("SAFETY_BLOCKED");
        expect(calls.length).toBe(before);
    });
});
