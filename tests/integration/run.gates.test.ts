/**
 * 실제 rclone으로 실제 실행 게이트(락 전 차단)를 확인한다. 임시 폴더와 임시 rclone.conf만 쓴다.
 * 빈 원본 sync, 파일·폴더 형식 충돌, 오류 무시 sync, 대량 삭제 미확인 → 오류 코드, rclone 실행 0회,
 * 이력 없음, 대상 불변. 비교 뒤 공용 제외 패턴을 지우면(작업 rev는 그대로) PLAN_STALE(INT-002 AC-5).
 * 백업 폴더(INT-003 T-03): 비교 뒤 백업 폴더를 바꾸면 PLAN_STALE(AC-12), 대상 안·원본 안·다른 드라이브·다른 remote는
 * 저장 거부(AC-11·AC-17). 오류 무시 sync(백업 없음)는 지금처럼 SAFETY_BLOCKED(AC-9).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import type { typRunMode } from "@/shared/schemas/common";
import type { typJobRunOptions } from "@/shared/schemas/job";
import { HAS_RCLONE, makeEnv, makeRoot, snapshotTree, writeFile } from "./run-harness";

const { root, conf } = makeRoot("rclonegui-run-gates-");

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

interface itfGateCase {
    name: string;
    code: string;
    mode?: typRunMode;
    options?: Partial<typJobRunOptions>;
    /** 원본·대상 준비 */
    prepare: (src: string, dst: string) => void;
    confirmLargeDeletes?: boolean;
}

const CASES: itfGateCase[] = [
    {
        name: "빈 원본 sync → EMPTY_SOURCE_BLOCKED",
        code: "EMPTY_SOURCE_BLOCKED",
        prepare: (src, dst) => {
            mkdirSync(src, { recursive: true });
            writeFile(join(dst, "keep.txt"), "keep");
        },
        confirmLargeDeletes: true,
    },
    {
        name: "파일·폴더 형식 충돌 → SAFETY_BLOCKED",
        code: "SAFETY_BLOCKED",
        mode: "copy",
        prepare: (src, dst) => {
            writeFile(join(src, "x"), "file");
            writeFile(join(src, "a.txt"), "a");
            writeFile(join(dst, "x", "inner.txt"), "dir");
        },
    },
    {
        name: "오류 무시 sync → SAFETY_BLOCKED",
        code: "SAFETY_BLOCKED",
        options: { ignoreErrors: true },
        prepare: (src, dst) => {
            writeFile(join(src, "a.txt"), "a");
            writeFile(join(dst, "b.txt"), "b");
        },
        confirmLargeDeletes: true,
    },
    {
        name: "대량 삭제 미확인 → SAFETY_BLOCKED",
        code: "SAFETY_BLOCKED",
        prepare: (src, dst) => {
            writeFile(join(src, "a.txt"), "a");
            writeFile(join(dst, "a.txt"), "a");
            writeFile(join(dst, "b.txt"), "b");
        },
    },
];

describe.skipIf(!HAS_RCLONE)("실제 실행 게이트 (실제 rclone, 임시 폴더)", () => {
    CASES.forEach((c, i) => {
        it(`${c.name}, rclone 실행 0회·이력 없음·대상 불변`, async () => {
            const src = join(root, `g${i}`, "src");
            const dst = join(root, `g${i}`, "dst");
            c.prepare(src, dst);
            let spawned = 0;
            const env = await makeEnv({
                root,
                conf,
                source: src,
                destination: dst,
                mode: c.mode ?? "sync",
                ...(c.options ? { options: c.options } : {}),
                wrapRun: (run) => (bin, args, opts) => {
                    spawned += 1;
                    return run(bin, args, opts);
                },
            });
            const cmp = await env.compare.run(env.job.id);
            const before = snapshotTree(dst);
            await expect(
                env.runs.start({
                    jobId: env.job.id,
                    dryRun: false,
                    planToken: cmp.planToken,
                    confirmedDeletes: c.mode === "copy" ? 0 : cmp.summary.deleteFiles,
                    ...(c.confirmLargeDeletes ? { confirmLargeDeletes: true } : {}),
                }),
            ).rejects.toMatchObject({ code: c.code });
            expect(spawned).toBe(0);
            expect(env.history.list()).toEqual([]);
            expect(env.runs.getActive()).toBeNull();
            expect(snapshotTree(dst)).toEqual(before);
            // 차단은 비교 결과를 버리지 않는다(이력 없는 IPC 오류)
            expect(env.compare.get(env.job.id)).not.toBeNull();
        });
    });

    it("비교 → 공용 제외 패턴 삭제 → 실행: PLAN_STALE, rclone 실행 0회·이력 없음·대상 불변", async () => {
        const src = join(root, "lib", "src");
        const dst = join(root, "lib", "dst");
        writeFile(join(src, "a.txt"), "a");
        writeFile(join(src, "skip.log"), "log");
        writeFile(join(dst, "old.log"), "old");
        let spawned = 0;
        const env = await makeEnv({
            root,
            conf,
            source: src,
            destination: dst,
            mode: "sync",
            libraryPatterns: ["*.log"],
            wrapRun: (run) => (bin, args, opts) => {
                spawned += 1;
                return run(bin, args, opts);
            },
        });
        const cmp = await env.compare.run(env.job.id);
        expect(cmp.summary.deleteFiles).toBe(0);
        const rev = env.jobs.get(env.job.id).rev;
        spawned = 0;
        const before = snapshotTree(dst);
        env.excludeStore.remove(env.job.excludePatternIds[0]!);
        env.jobs.refreshExcludeLinks();
        expect(env.jobs.get(env.job.id).rev).toBe(rev);
        await expect(
            env.runs.start({
                jobId: env.job.id,
                dryRun: false,
                planToken: cmp.planToken,
                confirmedDeletes: 0,
            }),
        ).rejects.toMatchObject({ code: "PLAN_STALE" });
        expect(spawned).toBe(0);
        expect(env.history.list()).toEqual([]);
        expect(snapshotTree(dst)).toEqual(before);
        expect(env.compare.get(env.job.id)).toBeNull();
    });
});

/** 원본 a.txt, 대상 x.txt(삭제 1) */
function f_Pair(name: string): { src: string; dst: string } {
    const src = join(root, name, "src");
    const dst = join(root, name, "dst");
    writeFile(join(src, "a.txt"), "a");
    writeFile(join(dst, "x.txt"), "x");
    return { src, dst };
}

describe.skipIf(!HAS_RCLONE)(
    "백업 폴더 게이트·저장 검사 (실제 rclone, 임시 폴더, INT-003 T-03)",
    () => {
        it("AC-12: 비교 → 백업 폴더 변경 → 실행: PLAN_STALE, rclone 실행 0회·대상 불변", async () => {
            const { src, dst } = f_Pair("bkg1");
            let spawned = 0;
            const env = await makeEnv({
                root,
                conf,
                source: src,
                destination: dst,
                mode: "sync",
                backupDir: join(root, "bkg1", "bk"),
                wrapRun: (run) => (bin, args, opts) => {
                    spawned += 1;
                    return run(bin, args, opts);
                },
            });
            const cmp = await env.compare.run(env.job.id);
            await env.jobs.update(env.job.id, { backupDir: join(root, "bkg1", "bk2") });
            const before = snapshotTree(dst);
            spawned = 0;
            await expect(
                env.runs.start({
                    jobId: env.job.id,
                    dryRun: false,
                    planToken: cmp.planToken,
                    confirmedDeletes: 1,
                    confirmLargeDeletes: true,
                }),
            ).rejects.toMatchObject({ code: "PLAN_STALE" });
            expect(spawned).toBe(0);
            expect(env.history.list()).toEqual([]);
            expect(snapshotTree(dst)).toEqual(before);
        });

        it("AC-11·AC-17: 대상 안·원본 안·다른 드라이브·다른 remote 백업 폴더는 저장 거부, DB 불변", async () => {
            const { src, dst } = f_Pair("bkg2");
            const env = await makeEnv({ root, conf, source: src, destination: dst, mode: "sync" });
            const drive = dst.charAt(0).toUpperCase();
            const other = drive === "Z" ? "Y" : "Z";
            const rev = env.jobs.get(env.job.id).rev;
            for (const backupDir of [
                join(dst, "bk"),
                join(src, "bk"),
                `${other}:\\rclonegui-bk`, // 문자열만 검사하므로 실제 드라이브에 접근하지 않는다
                "it-run:bk",
            ]) {
                await expect(env.jobs.update(env.job.id, { backupDir })).rejects.toMatchObject({
                    code: "SAFETY_BLOCKED",
                    message: expect.stringMatching(/^백업 폴더: /),
                });
            }
            expect(env.jobs.get(env.job.id)).toMatchObject({ rev, backupDir: null });
            // copy 모드는 값을 저장하지만 검사·사용하지 않는다
            const copy = await env.jobs.update(env.job.id, {
                mode: "copy",
                backupDir: join(dst, "bk"),
            });
            expect(copy.backupDir).toBe(join(dst, "bk"));
            // copy → sync로 바꿔 저장하면 그때 검사한다
            await expect(env.jobs.update(env.job.id, { mode: "sync" })).rejects.toMatchObject({
                code: "SAFETY_BLOCKED",
            });
        });
    },
);
