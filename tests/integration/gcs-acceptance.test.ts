/**
 * GCS 수용 테스트(INT-002 T-10). 테스트 전용 버킷·remote·rclone.conf가 환경 변수로 주어질 때만 실제 GCS에 돈다.
 * - RCLONEGUI_TEST_GCS_CONFIG: 저장소 밖 테스트 전용 rclone.conf 절대 경로
 * - RCLONEGUI_TEST_GCS_REMOTE: remote 이름(rclonegui-test- 접두사)
 * - RCLONEGUI_TEST_GCS_BUCKET: 버킷 이름(rclonegui-test- 접두사)
 * 셋 중 하나라도 없으면 이유를 출력하고 건너뛴다. 접두사·conf 위치가 틀리면 rclone을 부르기 전에 실패한다.
 * 실행마다 버킷 아래 고유 경로(rclonegui-it-<시각>-<난수>)만 쓰고 끝나면 지운다. 버킷 루트는 지우지 않는다.
 * 출력·테스트 이름에는 remote·버킷·conf 경로를 남기지 않는다(<GCS>로 쓴다).
 * INT-003 T-04: `backend features`의 CanHaveEmptyDirectories를 directory_markers 꺼짐(기본)·켜짐(연결 문자열)으로 비교해 출력한다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { HAS_RCLONE, makeEnv, NEWER, RCLONE, writeFile } from "./run-harness";

type typGcsTarget =
    | { kind: "skip"; reason: string }
    | { kind: "reject"; reason: string }
    | { kind: "ok"; conf: string; remote: string; bucket: string };

const REMOTE_RE = /^rclonegui-test-[A-Za-z0-9_-]+$/;
const BUCKET_RE = /^rclonegui-test-[a-z0-9][a-z0-9._-]*$/;
const BUCKET_MAX = 63;
const CASE_MS = 180_000;
const WAIT_MS = 170_000;

/** 환경 변수로 받은 GCS 대상을 검사한다. 값 자체는 이유 문구에 넣지 않는다 */
function f_ResolveGcsTarget(
    env: Record<string, string | undefined>,
    repoRoot: string,
    appData: string | undefined,
): typGcsTarget {
    const conf = env.RCLONEGUI_TEST_GCS_CONFIG ?? "";
    const remote = env.RCLONEGUI_TEST_GCS_REMOTE ?? "";
    const bucket = env.RCLONEGUI_TEST_GCS_BUCKET ?? "";
    if (!conf || !remote || !bucket) {
        return {
            kind: "skip",
            reason: "RCLONEGUI_TEST_GCS_CONFIG·_REMOTE·_BUCKET 중 비어 있는 값이 있습니다",
        };
    }
    if (!REMOTE_RE.test(remote)) {
        return { kind: "reject", reason: "remote 이름이 rclonegui-test-로 시작하지 않습니다" };
    }
    if (!BUCKET_RE.test(bucket) || bucket.length > BUCKET_MAX) {
        return {
            kind: "reject",
            reason: "버킷 이름이 rclonegui-test-로 시작하지 않거나 형식이 틀립니다",
        };
    }
    if (!isAbsolute(conf))
        return { kind: "reject", reason: "rclone.conf 경로가 절대 경로가 아닙니다" };
    const rel = relative(resolve(repoRoot), resolve(conf));
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
        return { kind: "reject", reason: "rclone.conf가 저장소 안에 있습니다" };
    }
    if (appData) {
        const def = resolve(appData, "rclone", "rclone.conf").toLowerCase();
        if (resolve(conf).toLowerCase() === def) {
            return {
                kind: "reject",
                reason: "기본 rclone.conf는 쓸 수 없습니다(테스트 전용 conf 필요)",
            };
        }
    }
    if (!existsSync(conf)) return { kind: "reject", reason: "rclone.conf 파일이 없습니다" };
    return { kind: "ok", conf, remote, bucket };
}

describe("GCS 대상 검사", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rclonegui-gcs-check-"));
    const outsideConf = join(tmp, "test.conf");
    writeFileSync(outsideConf, "");
    const repo = resolve(tmp, "repo");
    const appData = resolve(tmp, "appdata");
    const ok = {
        RCLONEGUI_TEST_GCS_CONFIG: outsideConf,
        RCLONEGUI_TEST_GCS_REMOTE: "rclonegui-test-remote",
        RCLONEGUI_TEST_GCS_BUCKET: "rclonegui-test-bucket",
    };
    afterAll(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    it("값이 하나라도 없으면 skip", () => {
        expect(f_ResolveGcsTarget({}, repo, appData).kind).toBe("skip");
        expect(
            f_ResolveGcsTarget({ ...ok, RCLONEGUI_TEST_GCS_BUCKET: "" }, repo, appData).kind,
        ).toBe("skip");
    });

    it("remote·버킷 접두사가 다르면 거부", () => {
        expect(
            f_ResolveGcsTarget({ ...ok, RCLONEGUI_TEST_GCS_REMOTE: "prod" }, repo, appData).kind,
        ).toBe("reject");
        expect(
            f_ResolveGcsTarget({ ...ok, RCLONEGUI_TEST_GCS_BUCKET: "prod-data" }, repo, appData)
                .kind,
        ).toBe("reject");
        expect(
            f_ResolveGcsTarget(
                { ...ok, RCLONEGUI_TEST_GCS_BUCKET: `rclonegui-test-${"a".repeat(60)}` },
                repo,
                appData,
            ).kind,
        ).toBe("reject");
    });

    it("conf가 상대 경로·저장소 안·기본 위치·없는 파일이면 거부", () => {
        const f = (conf: string) =>
            f_ResolveGcsTarget({ ...ok, RCLONEGUI_TEST_GCS_CONFIG: conf }, repo, appData).kind;
        expect(f("test.conf")).toBe("reject");
        expect(f(join(repo, "secret", "rclone.conf"))).toBe("reject");
        expect(f(join(appData, "rclone", "rclone.conf"))).toBe("reject");
        expect(f(join(tmp, "missing.conf"))).toBe("reject");
    });

    it("모두 맞으면 ok", () => {
        expect(f_ResolveGcsTarget(ok, repo, appData)).toEqual({
            kind: "ok",
            conf: outsideConf,
            remote: "rclonegui-test-remote",
            bucket: "rclonegui-test-bucket",
        });
    });
});

const TARGET = f_ResolveGcsTarget(process.env, process.cwd(), process.env.APPDATA);
if (TARGET.kind === "skip") {
    console.warn(`[test:int] GCS 수용 테스트를 건너뜁니다: ${TARGET.reason}`);
}

/** remote 경로 아래 파일 목록(상대 경로·크기, 정렬). 없으면 빈 목록 */
function f_RemoteFiles(conf: string, path: string): string[] {
    const r = spawnSync(
        RCLONE,
        ["lsjson", "-R", "--files-only", "--no-mimetype", "--config", conf, "--", path],
        { shell: false, windowsHide: true, encoding: "utf8" },
    );
    if (r.status === 3) return [];
    if (r.status !== 0) throw new Error(`원격 목록 실패(exit ${r.status})`);
    const items = JSON.parse(r.stdout) as Array<{ Path: string; Size: number }>;
    return items.map((i) => `${i.Path}:${i.Size}`).toSorted();
}

/** remote 경로 아래 폴더 목록(정렬). 없으면 빈 목록 */
function f_RemoteDirs(conf: string, path: string): string[] {
    const r = spawnSync(
        RCLONE,
        ["lsjson", "-R", "--dirs-only", "--no-mimetype", "--config", conf, "--", path],
        { shell: false, windowsHide: true, encoding: "utf8" },
    );
    if (r.status === 3) return [];
    if (r.status !== 0) throw new Error(`원격 폴더 목록 실패(exit ${r.status})`);
    return (JSON.parse(r.stdout) as Array<{ Path: string }>).map((i) => i.Path).toSorted();
}

/** `backend features`의 CanHaveEmptyDirectories. 출력에 버킷 이름이 들어가므로 값만 돌려준다 */
function f_CanHaveEmptyDirs(conf: string, target: string): boolean {
    const r = spawnSync(
        RCLONE,
        ["backend", "features", "--ask-password=false", "--config", conf, target],
        { shell: false, windowsHide: true, encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(`backend features 실패(exit ${r.status})`);
    const v: unknown = (JSON.parse(r.stdout) as { Features?: Record<string, unknown> }).Features
        ?.CanHaveEmptyDirectories;
    if (typeof v !== "boolean") throw new Error("CanHaveEmptyDirectories 값이 없습니다");
    return v;
}

/** 로컬 폴더 아래 파일 목록(상대 경로·크기, 정렬) — 원격 목록과 비교용 */
function f_LocalFiles(files: Record<string, string>): string[] {
    return Object.entries(files)
        .map(([p, t]) => `${p}:${Buffer.byteLength(t)}`)
        .toSorted();
}

/** 비교 → 확인 수를 넣어 실제 실행 → 끝날 때까지 기다린다 */
async function f_RunPlan(
    env: Awaited<ReturnType<typeof makeEnv>>,
    expectDeletes = 0,
    expectDeleteDirs = 0,
) {
    const cmp = await env.compare.run(env.job.id);
    const { runId } = await env.runs.start({
        jobId: env.job.id,
        dryRun: false,
        planToken: cmp.planToken,
        confirmedDeletes: expectDeletes,
        confirmedDeleteDirs: expectDeleteDirs,
    });
    return { cmp, ...(await env.waitFinished(runId, WAIT_MS)) };
}

describe.skipIf(TARGET.kind === "skip" || !HAS_RCLONE)("GCS 수용 (<GCS>)", () => {
    const stamp = new Date().toISOString().replaceAll(/[-:T]/g, "").slice(0, 14);
    const ok = TARGET.kind === "ok" ? TARGET : null;
    const base = ok
        ? `${ok.remote}:${ok.bucket}/rclonegui-it-${stamp}-${randomUUID().slice(0, 8)}`
        : "";
    const conf = ok?.conf ?? "";
    // 건너뛸 때도 describe 본문은 수집되므로 임시 폴더는 beforeAll에서 만든다
    let local = "";

    beforeAll(() => {
        if (TARGET.kind === "reject") throw new Error(`GCS 수용 테스트 거부: ${TARGET.reason}`);
        local = mkdtempSync(join(tmpdir(), "rclonegui-gcs-"));
        const r = spawnSync(RCLONE, ["listremotes", "--long", "--config", conf], {
            shell: false,
            windowsHide: true,
            encoding: "utf8",
        });
        if (r.status !== 0) throw new Error("GCS 수용 테스트 거부: listremotes 실패");
        const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith(`${ok!.remote}:`));
        if (!line || !/google cloud storage/.test(line)) {
            throw new Error(
                "GCS 수용 테스트 거부: remote가 없거나 google cloud storage가 아닙니다",
            );
        }
    });

    afterAll(() => {
        try {
            if (ok) {
                const exact = new RegExp(
                    `^${ok.remote}:${ok.bucket.replaceAll(".", "\\.")}/rclonegui-it-[0-9]{14}-[0-9a-f]{8}$`,
                );
                if (!exact.test(base))
                    throw new Error("정리 경로가 형식과 다릅니다. 지우지 않습니다.");
                spawnSync(RCLONE, ["purge", "--config", conf, "--", base], {
                    shell: false,
                    windowsHide: true,
                    encoding: "utf8",
                });
                if (f_RemoteFiles(conf, base).length > 0) {
                    throw new Error("정리 뒤에도 원격 테스트 경로에 파일이 남았습니다");
                }
            }
        } finally {
            if (local) rmSync(local, { recursive: true, force: true });
        }
    });

    it("backend features: directory_markers 꺼짐·켜짐의 CanHaveEmptyDirectories를 기록한다", () => {
        const plain = f_CanHaveEmptyDirs(conf, `${ok!.remote}:${ok!.bucket}`);
        const markers = f_CanHaveEmptyDirs(
            conf,
            `${ok!.remote},directory_markers=true:${ok!.bucket}`,
        );
        console.info(
            `[test:int] GCS backend features CanHaveEmptyDirectories: 기본 ${plain}, directory_markers=true ${markers}`,
        );
        expect(typeof plain).toBe("boolean");
        expect(typeof markers).toBe("boolean");
    });

    /** 시나리오 하나의 로컬 원본·userData 폴더와 원격 대상 */
    function f_Case(name: string) {
        const root = join(local, name);
        const src = join(root, "src");
        mkdirSync(src, { recursive: true });
        return { root, src, dst: `${base}/${name}` };
    }

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
            expect(f_RemoteFiles(conf, c.dst)).toEqual(f_LocalFiles(files));
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
            expect((await f_RunPlan(seed)).record.status).toBe("success");

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
            const { cmp, record } = await f_RunPlan(env);
            expect(cmp.summary).toMatchObject({ updateFiles: 1, createFiles: 1, deleteFiles: 0 });
            expect(record.status).toBe("success");
            expect(f_RemoteFiles(conf, c.dst)).toEqual(f_LocalFiles(files));
        },
        CASE_MS,
    );

    it(
        "sync 삭제: 확인한 삭제 수만큼 사전 확인 뒤 지운다",
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
            expect((await f_RunPlan(seed)).record.status).toBe("success");
            rmSync(join(c.src, "gone.txt"));
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "sync",
            });
            const { cmp, record } = await f_RunPlan(env, 1);
            expect(cmp.summary.deleteFiles).toBe(1);
            expect(record.status).toBe("success");
            expect(record.preflight?.deletes).toBe(1);
            expect(record.stats?.deletes).toBe(1);
            expect(f_RemoteFiles(conf, c.dst)).toEqual(["keep.txt:4"]);
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
            const { record } = await f_RunPlan(env);
            expect(canceled).toBe(true);
            expect(record.status).toBe("canceled");
            expect(record.error?.code).toBe("CANCELED");
            expect(existsSync(env.activeRunFile)).toBe(false);
            const remote = f_RemoteFiles(conf, c.dst);
            const partial = remote.filter((f) => f.includes(".partial"));
            console.info(
                `[test:int] GCS 중지: 원격 파일 ${remote.length}/${COUNT}개, .partial ${partial.length}개`,
            );
            expect(remote.length).toBeLessThan(COUNT);
        },
        CASE_MS,
    );

    it(
        "전체 범위 copy: 실행은 성공하고, 빈 폴더는 directory_markers 설정에 따라 생기거나 차이로 남는다",
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
            const { record } = await f_RunPlan(env);
            expect(record.status).toBe("success");
            expect(f_RemoteFiles(conf, c.dst)).toEqual(["a.txt:5"]);
            const dirs = f_RemoteDirs(conf, c.dst);
            const again = await env.compare.run(env.job.id);
            const canEmpty = f_CanHaveEmptyDirs(conf, `${ok!.remote}:${ok!.bucket}`);
            console.info(
                `[test:int] GCS 빈 폴더: 원격 폴더 ${dirs.length}개, 다시 비교 createDirs ${again.summary.createDirs}개, CanHaveEmptyDirectories ${canEmpty}`,
            );
            // directory_markers 꺼짐(기본): 폴더가 생기지 않고 차이가 남는다. 켜짐: 폴더가 생기고 차이가 없다
            expect([
                { dirs: [], createDirs: 3 },
                { dirs: ["empty", "nest", "nest/x"], createDirs: 0 },
            ]).toContainEqual({ dirs, createDirs: again.summary.createDirs });
        },
        CASE_MS,
    );

    it(
        "전체 범위 sync: 성공하면 원격 파일이 원본과 같고, 막히면 원격이 그대로다",
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
            expect((await f_RunPlan(seed)).record.status).toBe("success");
            rmSync(join(c.src, "old"), { recursive: true, force: true });
            const before = f_RemoteFiles(conf, c.dst);
            const env = await makeEnv({
                root: c.root,
                conf,
                source: c.src,
                destination: c.dst,
                mode: "sync",
                scope: "all",
            });
            const cmp = await env.compare.run(env.job.id);
            const { runId } = await env.runs.start({
                jobId: env.job.id,
                dryRun: false,
                planToken: cmp.planToken,
                confirmedDeletes: cmp.summary.deleteFiles,
                confirmedDeleteDirs: cmp.summary.deleteDirs,
            });
            const { record } = await env.waitFinished(runId, WAIT_MS);
            console.info(
                `[test:int] GCS 전체 sync: deleteFiles ${cmp.summary.deleteFiles}, deleteDirs ${cmp.summary.deleteDirs}, 결과 ${record.status}${record.error ? `/${record.error.code}` : ""}`,
            );
            // 안전 불변식: 성공이면 원격 파일이 원본과 같고, 막혔으면(PLAN_DRIFT) 원격이 그대로다
            expect([
                { status: "success", code: null, files: ["a.txt:5"] },
                { status: "blocked", code: "PLAN_DRIFT", files: before },
            ]).toContainEqual({
                status: record.status,
                code: record.error?.code ?? null,
                files: f_RemoteFiles(conf, c.dst),
            });
        },
        CASE_MS,
    );
});
