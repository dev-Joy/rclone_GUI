/**
 * Google Drive 수용 테스트(INT-003 T-08, T-04 GCS 실측 대체). 명시적으로 켤 때만 실제 Drive에 돈다.
 * - RCLONEGUI_TEST_DRIVE_REMOTE: type = drive인 remote 이름(필수, 없으면 skip)
 * - RCLONEGUI_TEST_DRIVE_CONFIG: rclone.conf 절대 경로(선택, 없으면 `rclone config file`이 알려 주는 기본 conf)
 * 환경 변수는 실행 명령에서만 주고 영구 등록하지 않는다. remote 종류가 drive가 아니면 쓰기 전에 실패한다.
 * 쓰기는 Drive 최상위 rclonegui-test-it/rclonegui-it-<시각>-<난수>/ 아래만 하고, 끝나면 그 폴더만 지운다
 * (rclonegui-test-it과 Drive 루트는 지우지 않음. 정리는 Drive 기본 동작대로 휴지통으로 간다).
 * 출력·테스트 이름에는 remote 이름·경로·conf 경로를 남기지 않는다(<DRIVE>).
 * Drive는 빈 폴더·서버 쪽 Move를 지원하므로 기대값을 하나로 고정해 단언한다. 휴지통 동작은 기록만 한다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { parseConfigFileOutput, parseListRemotesLong } from "@/main/parsers/rclone-env-parser";

import {
    featureFlag,
    isExactRunPath,
    localFiles,
    makeRunDirName,
    purgeRunPath,
    rcloneSync,
    remoteDirs,
    remoteFeatures,
    remoteFiles,
    remoteMissing,
    runPlan,
} from "./remote-acceptance";
import { HAS_RCLONE, makeEnv, NEWER, RCLONE, writeFile } from "./run-harness";

type typDriveTarget =
    | { kind: "skip"; reason: string }
    | { kind: "reject"; reason: string }
    // conf가 null이면 기본 conf(beforeAll에서 경로 확인)
    | { kind: "ok"; remote: string; conf: string | null };

/** 2자 이상(한 글자는 Windows 드라이브), `:`·`,`·`/`·공백 금지 → 연결 문자열·하위 경로 주입 차단 */
const DRIVE_REMOTE_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{1,63}$/;
const TEST_ROOT = "rclonegui-test-it";
const CASE_MS = 300_000;
const WAIT_MS = 280_000;
const HOOK_MS = 120_000;
/** 기록만 하는 features 값(이름이 든 Name·Root·String은 쓰지 않는다) */
const FEATURE_LOG = [
    "CanHaveEmptyDirectories",
    "Move",
    "DirMove",
    "Copy",
    "Purge",
    "CaseInsensitive",
    "DuplicateFiles",
    "ReadMimeType",
    "WriteMimeType",
] as const;

/** path가 저장소 안(저장소 자체 포함)인지 */
function f_InsideRepo(path: string, repoRoot: string): boolean {
    const rel = relative(resolve(repoRoot), resolve(path));
    return !rel.startsWith("..") && !isAbsolute(rel);
}

/** 환경 변수로 받은 Drive 대상을 검사한다. 값 자체는 이유 문구에 넣지 않는다 */
function f_ResolveDriveTarget(
    env: Record<string, string | undefined>,
    repoRoot: string,
): typDriveTarget {
    const remote = env.RCLONEGUI_TEST_DRIVE_REMOTE ?? "";
    const conf = env.RCLONEGUI_TEST_DRIVE_CONFIG ?? "";
    if (!remote) {
        return {
            kind: "skip",
            reason: "RCLONEGUI_TEST_DRIVE_REMOTE가 없습니다(명시적으로 켤 때만 실행)",
        };
    }
    if (!DRIVE_REMOTE_RE.test(remote)) {
        return { kind: "reject", reason: "remote 이름 형식이 틀립니다" };
    }
    if (!conf) return { kind: "ok", remote, conf: null };
    if (!isAbsolute(conf))
        return { kind: "reject", reason: "rclone.conf 경로가 절대 경로가 아닙니다" };
    if (f_InsideRepo(conf, repoRoot)) {
        return { kind: "reject", reason: "rclone.conf가 저장소 안에 있습니다" };
    }
    if (!existsSync(conf)) return { kind: "reject", reason: "rclone.conf 파일이 없습니다" };
    return { kind: "ok", remote, conf };
}

describe("Drive 대상 검사", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rclonegui-drive-check-"));
    const outsideConf = join(tmp, "test.conf");
    writeFileSync(outsideConf, "");
    const repo = resolve(tmp, "repo");
    const ok = { RCLONEGUI_TEST_DRIVE_REMOTE: "drive-a" };
    afterAll(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    it("remote가 없으면 skip", () => {
        expect(f_ResolveDriveTarget({}, repo).kind).toBe("skip");
        expect(f_ResolveDriveTarget({ RCLONEGUI_TEST_DRIVE_REMOTE: "" }, repo).kind).toBe("skip");
    });

    it("remote 이름이 형식과 다르면 거부(한 글자·연결 문자열·하위 경로·공백·대시 시작·65자)", () => {
        for (const name of ["x", "a:b", "a,root_folder_id=1", "a/b", "a b", "-a", "a".repeat(65)]) {
            expect(f_ResolveDriveTarget({ RCLONEGUI_TEST_DRIVE_REMOTE: name }, repo).kind).toBe(
                "reject",
            );
        }
    });

    it("conf가 상대 경로·저장소 안·없는 파일이면 거부", () => {
        const f = (conf: string) =>
            f_ResolveDriveTarget({ ...ok, RCLONEGUI_TEST_DRIVE_CONFIG: conf }, repo).kind;
        expect(f("test.conf")).toBe("reject");
        expect(f(join(repo, "secret", "rclone.conf"))).toBe("reject");
        expect(f(join(tmp, "missing.conf"))).toBe("reject");
    });

    it("conf가 없으면 기본 conf로, 저장소 밖 실제 파일이면 그 conf로 ok", () => {
        expect(f_ResolveDriveTarget(ok, repo)).toEqual({
            kind: "ok",
            remote: "drive-a",
            conf: null,
        });
        expect(
            f_ResolveDriveTarget({ ...ok, RCLONEGUI_TEST_DRIVE_CONFIG: outsideConf }, repo),
        ).toEqual({ kind: "ok", remote: "drive-a", conf: outsideConf });
    });

    it("정리 가드: 정확히 <remote>:rclonegui-test-it/<실행 폴더>만 true", () => {
        const parent = `drive-a:${TEST_ROOT}`;
        const run = makeRunDirName();
        expect(isExactRunPath(`${parent}/${run}`, parent)).toBe(true);
        expect(isExactRunPath(parent, parent)).toBe(false);
        expect(isExactRunPath("drive-a:", parent)).toBe(false);
        expect(isExactRunPath(`${parent}/${run}/x`, parent)).toBe(false);
        expect(isExactRunPath(`drive-a:other/${run}`, parent)).toBe(false);
        expect(isExactRunPath(`drive-b:${TEST_ROOT}/${run}`, parent)).toBe(false);
        expect(isExactRunPath(`${parent}/../${run}`, parent)).toBe(false);
        const fixed = new Date("2026-11-02T01:02:03Z");
        expect(isExactRunPath(`${parent}/${makeRunDirName(fixed, "ABCDEF12-0000")}`, parent)).toBe(
            false,
        );
        expect(isExactRunPath(`${parent}/rclonegui-it-2026110201020-abcdef12`, parent)).toBe(false);
        expect(makeRunDirName(fixed, "abcdef12-0000")).toBe("rclonegui-it-20261102010203-abcdef12");
    });
});

const TARGET = f_ResolveDriveTarget(process.env, process.cwd());
if (TARGET.kind === "skip") {
    console.warn(`[test:int] Drive 수용 테스트를 건너뜁니다: ${TARGET.reason}`);
}

describe.skipIf(TARGET.kind === "skip" || !HAS_RCLONE)("Drive 수용 (<DRIVE>)", () => {
    const remote = TARGET.kind === "ok" ? TARGET.remote : "";
    const parent = `${remote}:${TEST_ROOT}`;
    const base = `${parent}/${makeRunDirName()}`;
    // 건너뛸 때도 describe 본문은 수집되므로 conf 확인·임시 폴더·원격 쓰기는 beforeAll에서 한다
    let conf = "";
    let local = "";
    let ready = false;

    beforeAll(() => {
        if (TARGET.kind === "reject") throw new Error(`Drive 수용 테스트 거부: ${TARGET.reason}`);
        if (TARGET.kind !== "ok") throw new Error("Drive 수용 테스트 거부: 대상이 없습니다");
        local = mkdtempSync(join(tmpdir(), "rclonegui-drive-"));
        // conf 확정(내용은 읽지 않는다). 경로는 출력하지 않는다
        if (TARGET.conf) conf = TARGET.conf;
        else {
            const r = spawnSync(RCLONE, ["config", "file"], {
                shell: false,
                windowsHide: true,
                encoding: "utf8",
            });
            const info = r.status === 0 ? parseConfigFileOutput(r.stdout) : null;
            if (info?.exists !== true) {
                throw new Error("Drive 수용 테스트 거부: 기본 rclone.conf를 찾지 못했습니다");
            }
            conf = info.path;
        }
        if (f_InsideRepo(conf, process.cwd())) {
            throw new Error("Drive 수용 테스트 거부: rclone.conf가 저장소 안에 있습니다");
        }
        // 종류 확인. 이 단계 전에는 쓰기 명령이 없다
        const lr = rcloneSync(conf, ["listremotes", "--long"]);
        if (lr.status !== 0) {
            throw new Error(
                "Drive 수용 테스트 거부: listremotes 실패 — 암호화 conf는 지원하지 않습니다",
            );
        }
        const row = parseListRemotesLong(lr.stdout).find((x) => x.name === remote);
        if (row?.type !== "drive") {
            throw new Error("Drive 수용 테스트 거부: remote가 없거나 drive가 아닙니다");
        }
        if (!isExactRunPath(base, parent)) {
            throw new Error("Drive 수용 테스트 거부: 실행 폴더 경로가 형식과 다릅니다");
        }
        if (!remoteMissing(conf, base)) {
            throw new Error("Drive 수용 테스트 거부: 실행 폴더가 이미 있습니다");
        }
        // 같은 이름 폴더가 둘 생기는 것을 줄이려고 부모를 먼저 만든다(이미 있으면 그대로)
        const mp = rcloneSync(conf, ["mkdir"], [parent]);
        if (mp.status !== 0) throw new Error(`테스트 폴더 만들기 실패(exit ${mp.status})`);
        const mb = rcloneSync(conf, ["mkdir"], [base]);
        if (mb.status !== 0) throw new Error(`실행 폴더 만들기 실패(exit ${mb.status})`);
        ready = true;
    }, HOOK_MS);

    afterAll(() => {
        try {
            // 이 실행이 만든 폴더가 없으면 원격은 건드리지 않는다
            if (ready) purgeRunPath(conf, base, parent);
        } finally {
            if (local) rmSync(local, { recursive: true, force: true });
        }
    }, HOOK_MS);

    /** 시나리오 하나의 로컬 원본·userData 폴더와 원격 대상 */
    function f_Case(name: string) {
        const root = join(local, name);
        const src = join(root, "src");
        mkdirSync(src, { recursive: true });
        return { root, src, dst: `${base}/${name}` };
    }

    /** 대상 폴더 아래 휴지통 파일 수와 gone.txt 여부를 기록한다(단언하지 않음) */
    function f_LogTrash(label: string, dst: string): void {
        try {
            const trashed = remoteFiles(conf, dst, ["--drive-trashed-only"]);
            const gone = trashed.some((f) => f === "gone.txt:4" || f.endsWith("/gone.txt:4"));
            console.info(
                `[test:int] Drive 휴지통: ${label} 뒤 휴지통 파일 ${trashed.length}개(gone.txt ${gone ? "있음" : "없음"})`,
            );
        } catch (e) {
            console.info(`[test:int] Drive 휴지통: ${label} 확인 불가(${(e as Error).message})`);
        }
    }

    it(
        "backend features: 값을 기록하고 빈 폴더·서버 쪽 이동을 지원한다",
        () => {
            const f = remoteFeatures(conf, `${remote}:`);
            const flags = FEATURE_LOG.map((k) => `${k} ${String(f.features[k])}`).join(", ");
            console.info(
                `[test:int] Drive backend features: ${flags}, Precision ${String(f.precision)}, Hashes [${f.hashes.join(",")}]`,
            );
            expect(featureFlag(f.features, "CanHaveEmptyDirectories")).toBe(true);
            expect(featureFlag(f.features, "Move")).toBe(true);
        },
        CASE_MS,
    );

    it(
        "copy: 원본 파일이 올라가고 다시 비교하면 바꿀 것이 없다",
        async () => {
            const c = f_Case("copy");
            const files = { "a.txt": "alpha", "sub/b.txt": "bravo-bravo" };
            for (const [p, t] of Object.entries(files)) writeFile(join(c.src, p), t);
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "copy",
            });
            const cmp0 = await env.compare.run(env.job.id);
            expect(cmp0.summary.createFiles).toBe(2);
            const { runId } = await env.runs.start({
                jobId: env.job.id,
                dryRun: false,
                planToken: cmp0.planToken,
                confirmedDeletes: 0,
            });
            const { record } = await env.waitFinished(runId, WAIT_MS);
            expect(record.status).toBe("success");
            expect(remoteFiles(conf, c.dst)).toEqual(localFiles(files));
            const again = await env.compare.run(env.job.id);
            expect(again.summary).toMatchObject({ createFiles: 0, updateFiles: 0 });
        },
        CASE_MS,
    );

    it(
        "sync 갱신: 바뀐 파일과 새 파일만 올라가고 원격이 원본과 같아진다",
        async () => {
            const c = f_Case("sync-update");
            const files: Record<string, string> = { "a.txt": "alpha", "b.txt": "bravo" };
            for (const [p, t] of Object.entries(files)) writeFile(join(c.src, p), t);
            const seed = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "copy",
            });
            expect((await runPlan(seed, WAIT_MS)).record.status).toBe("success");

            files["a.txt"] = "alpha-changed";
            files["c.txt"] = "charlie";
            writeFile(join(c.src, "a.txt"), files["a.txt"], NEWER);
            writeFile(join(c.src, "c.txt"), files["c.txt"]);
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "sync",
            });
            const { cmp, record } = await runPlan(env, WAIT_MS);
            expect(cmp.summary).toMatchObject({ updateFiles: 1, createFiles: 1, deleteFiles: 0 });
            expect(record.status).toBe("success");
            expect(remoteFiles(conf, c.dst)).toEqual(localFiles(files));
        },
        CASE_MS,
    );

    it(
        "sync 삭제: 확인한 삭제 수만큼 사전 확인 뒤 지우고, 지운 파일의 휴지통 여부를 기록한다",
        async () => {
            const c = f_Case("sync-delete");
            writeFile(join(c.src, "keep.txt"), "keep");
            writeFile(join(c.src, "gone.txt"), "gone");
            const seed = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "copy",
            });
            expect((await runPlan(seed, WAIT_MS)).record.status).toBe("success");
            rmSync(join(c.src, "gone.txt"));
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "sync",
            });
            const { cmp, record } = await runPlan(env, WAIT_MS, 1);
            expect(cmp.summary.deleteFiles).toBe(1);
            expect(record.status).toBe("success");
            expect(record.preflight?.deletes).toBe(1);
            expect(record.stats?.deletes).toBe(1);
            expect(remoteFiles(conf, c.dst)).toEqual(["keep.txt:4"]);
            f_LogTrash("sync 삭제", c.dst);
        },
        CASE_MS,
    );

    it(
        "백업 폴더: 서버 쪽 Move로 지운 파일을 백업 하위 폴더로 옮긴다(FR-36)",
        async () => {
            const c = f_Case("backup");
            writeFile(join(c.src, "keep.txt"), "keep");
            writeFile(join(c.src, "gone.txt"), "gone");
            const seed = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "copy",
            });
            expect((await runPlan(seed, WAIT_MS)).record.status).toBe("success");
            rmSync(join(c.src, "gone.txt"));
            // 앱은 remote 루트로 조회한다(job-context assertBackupMovable)
            expect(featureFlag(remoteFeatures(conf, `${remote}:`).features, "Move")).toBe(true);
            const bk = `${base}/backup-bk`;
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "sync",
                backupDir: bk,
                options: { ignoreErrors: true },
            });
            const cmp = await env.compare.run(env.job.id);
            const { runId } = await env.runs.start({
                jobId: env.job.id,
                dryRun: false,
                planToken: cmp.planToken,
                confirmedDeletes: 1,
                confirmLargeDeletes: true,
            });
            const { record } = await env.waitFinished(runId, WAIT_MS);
            expect(record.status).toBe("success");
            expect(env.history.list()).toHaveLength(1);
            expect(remoteFiles(conf, c.dst)).toEqual(["keep.txt:4"]);
            expect(remoteFiles(conf, bk).some((p) => p.endsWith("/gone.txt:4"))).toBe(true);
            // 서버 쪽 이동이면 휴지통에 가지 않는다(0 기대 — 기록만)
            f_LogTrash("백업 폴더 sync", c.dst);
        },
        CASE_MS,
    );

    it(
        "중지: 올리는 중 중지하면 canceled이고 일부만 올라간다",
        async () => {
            const c = f_Case("cancel");
            const COUNT = 40;
            const body = Buffer.alloc(64 * 1024, 7);
            for (let i = 0; i < COUNT; i += 1) {
                writeFile(join(c.src, `f${String(i).padStart(3, "0")}.bin`), body);
            }
            let canceled = false;
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "copy",
                options: { transfers: 1, checkers: 1 },
                wrapRun: (run, runs) => (bin, args, opts) =>
                    run(bin, args, {
                        ...opts,
                        onStderrLine: (line) => {
                            opts.onStderrLine?.(line);
                            if (!canceled && line.includes("Copied")) {
                                canceled = true;
                                const a = runs().getActive();
                                if (a) runs().cancel(a.runId);
                            }
                        },
                    }),
            });
            const { record } = await runPlan(env, WAIT_MS);
            expect(canceled).toBe(true);
            expect(record.status).toBe("canceled");
            expect(record.error?.code).toBe("CANCELED");
            expect(existsSync(env.activeRunFile)).toBe(false);
            const files = remoteFiles(conf, c.dst);
            const partial = files.filter((f) => f.includes(".partial"));
            console.info(
                `[test:int] Drive 중지: 원격 파일 ${files.length}/${COUNT}개, .partial ${partial.length}개`,
            );
            expect(files.length).toBeLessThan(COUNT);
        },
        CASE_MS,
    );

    it(
        "전체 범위 copy: 빈 폴더가 대상에 생기고 다시 비교하면 차이가 없다",
        async () => {
            const c = f_Case("scope-copy");
            writeFile(join(c.src, "a.txt"), "alpha");
            mkdirSync(join(c.src, "empty"), { recursive: true });
            mkdirSync(join(c.src, "nest", "x"), { recursive: true });
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "copy",
                scope: "all",
            });
            const { record } = await runPlan(env, WAIT_MS);
            expect(record.status).toBe("success");
            expect(remoteFiles(conf, c.dst)).toEqual(["a.txt:5"]);
            const dirs = remoteDirs(conf, c.dst);
            console.info(`[test:int] Drive 빈 폴더: 원격 폴더 ${dirs.length}개`);
            expect(dirs).toEqual(["empty", "nest", "nest/x"]);
            const again = await env.compare.run(env.job.id);
            expect(again.summary.createDirs).toBe(0);
        },
        CASE_MS,
    );

    it(
        "AC-13: 비교 결과 빈 폴더 가능 여부가 true이고 자동 실행이 빈 폴더를 만든다",
        async () => {
            const c = f_Case("empty-dirs");
            mkdirSync(join(c.src, "empty"), { recursive: true });
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "copy",
                scope: "all",
            });
            const cmp = await env.compare.run(env.job.id);
            // 앱은 remote 루트로 조회한다(compare-service f_DestEmptyDirs)
            const canEmpty = featureFlag(
                remoteFeatures(conf, `${remote}:`).features,
                "CanHaveEmptyDirectories",
            );
            expect(cmp.destCanHaveEmptyDirs).toBe(true);
            expect(cmp.destCanHaveEmptyDirs).toBe(canEmpty);
            expect(cmp.summary.createDirs).toBe(1);
            const o = await (await env.runs.startAuto(env.job.id)).done;
            expect(o.status).toBe("success");
            expect(remoteDirs(conf, c.dst)).toContain("empty");
        },
        CASE_MS,
    );

    it(
        "전체 범위 sync: 대상에만 있는 폴더와 파일을 지운다",
        async () => {
            const c = f_Case("scope-sync");
            writeFile(join(c.src, "a.txt"), "alpha");
            writeFile(join(c.src, "old", "x.txt"), "old");
            const seed = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "copy",
            });
            expect((await runPlan(seed, WAIT_MS)).record.status).toBe("success");
            rmSync(join(c.src, "old"), { recursive: true, force: true });
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "sync",
                scope: "all",
            });
            const { cmp, record } = await runPlan(env, WAIT_MS, 1, 1);
            expect(cmp.summary).toMatchObject({ deleteFiles: 1, deleteDirs: 1 });
            // 실패 시 앱 오류 메시지에는 경로가 섞일 수 있어 code만 비교한다
            expect({ status: record.status, code: record.error?.code ?? null }).toEqual({
                status: "success",
                code: null,
            });
            expect(remoteFiles(conf, c.dst)).toEqual(["a.txt:5"]);
            expect(remoteDirs(conf, c.dst)).not.toContain("old");
            f_LogTrash("전체 범위 sync(폴더 삭제)", c.dst);
        },
        CASE_MS,
    );
});
