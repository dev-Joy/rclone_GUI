/**
 * 실제 rclone으로 비교 서비스(clsCompareService)를 확인한다. 임시 폴더와 임시 rclone.conf(alias remote)만 쓴다.
 * 상태별 수·바이트, 없는 경로(exit 3), 취소(CANCELED·결과 미보존)를 본다.
 * rclone이 없으면 이유를 출력하고 건너뛴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { clsRcloneEnv } from "@/main/rclone/detect";
import { runRclone, type typRunRclone } from "@/main/rclone/process";
import { clsActivityLock } from "@/main/services/activity-lock";
import { clsCompareService } from "@/main/services/compare-service";
import { clsPathService } from "@/main/services/path-service";
import { createDefaultSettings } from "@/shared/defaults";
import type { itfPathProbe } from "@/shared/ipc-contract";
import type { typJob } from "@/shared/schemas/job";

const RCLONE = process.env.RCLONEGUI_TEST_RCLONE ?? "rclone";
const probe = spawnSync(RCLONE, ["version"], { shell: false, windowsHide: true, encoding: "utf8" });
const HAS_RCLONE = probe.status === 0;
if (!HAS_RCLONE) {
    console.warn(
        `[test:int] rclone을 실행할 수 없어 건너뜁니다 (${RCLONE}): ${probe.error?.message ?? probe.stderr}`,
    );
}

const JOB_ID = "00000000-0000-4000-8000-0000000000c1";
const OLD = new Date("2026-01-01T00:00:00Z");
const NEWER = new Date(OLD.getTime() + 10 * 60_000);
const LOGGER = { info: () => undefined, warn: () => undefined };
const MANUAL_BIN = process.env.RCLONEGUI_TEST_RCLONE ?? null;

const root = mkdtempSync(join(tmpdir(), "rclonegui-cmp-int-"));
const conf = join(root, "rclone.conf");
// 테스트 준비용 설정 파일. 앱 코드는 이 파일을 읽지 않고 경로만 --config로 넘긴다
writeFileSync(conf, `[it-cmp]\ntype = alias\nremote = ${root}\n`);

let caseNo = 0;
let src = "";
let dst = "";

function f_File(path: string, text: string, mtime = OLD): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    utimesSync(path, mtime, mtime);
}

function f_Job(over: Partial<typJob> = {}): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: JOB_ID,
        name: "비교 통합",
        notes: "",
        source: src,
        destination: dst,
        mode: "sync",
        excludes: [...excludes, "*.tmp"],
        excludePatternIds: [],
        options,
        configPathOverride: null,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 0,
        createdAt: "2026-10-28T00:00:00.000Z",
        updatedAt: "2026-10-28T00:00:00.000Z",
        lastRun: null,
        ...over,
    };
}

interface itfHarnessOptions {
    job?: Partial<typJob>;
    /** 실제 probe 결과를 덮어쓴다(목록 직전에 폴더가 사라진 경우 재현) */
    probe?: (path: string) => itfPathProbe | null;
    run?: (svc: clsCompareService) => typRunRclone;
}

function f_Service(opts: itfHarnessOptions = {}) {
    const job = f_Job(opts.job);
    const settings = createDefaultSettings();
    const rcloneEnv = new clsRcloneEnv({
        getSettings: () => ({ rclonePath: MANUAL_BIN, configPath: conf }),
        logger: LOGGER,
        env: { ...process.env, RCLONE_CONFIG: undefined },
    });
    const real = new clsPathService({ rcloneEnv });
    const pathService = {
        probe: async (input: { path: string; configPath?: string | null }) =>
            opts.probe?.(input.path) ?? real.probe(input),
    };
    const holder: { svc: clsCompareService | null } = { svc: null };
    const svc = new clsCompareService({
        jobs: {
            get: (id: string) => {
                if (id !== job.id) throw new clsAppError("NOT_FOUND");
                return job;
            },
        },
        settings: { get: () => settings },
        rcloneEnv,
        pathService,
        activity: new clsActivityLock(),
        excludes: { patternsFor: () => [] },
        excludeFileDir: join(root, "exclude-files"),
        logger: LOGGER,
        run: (bin, args, o) =>
            (opts.run && holder.svc ? opts.run(holder.svc) : runRclone)(bin, args, o),
    });
    holder.svc = svc;
    return svc;
}

async function f_Code(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (e) {
        return e instanceof clsAppError ? e.code : "UNKNOWN";
    }
    return "OK";
}

beforeEach(() => {
    caseNo += 1;
    src = join(root, `c${caseNo}`, "src");
    dst = join(root, `c${caseNo}`, "dst");
    f_File(join(src, "same.txt"), "same");
    f_File(join(src, "changed.txt"), "changed-longer", NEWER);
    f_File(join(src, "sub", "new.txt"), "new");
    f_File(join(src, "한글 파일.txt"), "unicode");
    f_File(join(src, "skip.tmp"), "excluded");
    f_File(join(dst, "same.txt"), "same");
    f_File(join(dst, "changed.txt"), "changed");
    f_File(join(dst, "extra.txt"), "extra");
    f_File(join(dst, "gone", "old.txt"), "old");
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!HAS_RCLONE)("비교 서비스 (실제 rclone, 임시 폴더)", () => {
    it("신규·변경·동일·대상만 수와 바이트가 파일 구성과 같다", async () => {
        const svc = f_Service();
        const r = await svc.run(JOB_ID);
        expect(r.summary).toMatchObject({
            sourceFiles: 4,
            destFiles: 4,
            createFiles: 2,
            updateFiles: 1,
            deleteFiles: 2,
            sameFiles: 1,
            conflictFiles: 0,
            // "new"(3) + "unicode"(7) / "changed-longer"(14) / "extra"(5) + "old"(3)
            createBytes: 10,
            updateBytes: 14,
            deleteBytes: 8,
            transferBytes: 24,
        });
        const byPath = Object.fromEntries(r.entries.map((e) => [e.path, e.status]));
        expect(byPath).toEqual({
            "same.txt": "equal",
            "changed.txt": "modified",
            "sub/new.txt": "onlySource",
            "한글 파일.txt": "onlySource",
            "extra.txt": "onlyDest",
            "gone/old.txt": "onlyDest",
        });
        expect(r.destMissing).toBe(false);
        expect(r.planToken).toMatch(/\S/);
        expect(svc.get(JOB_ID)).toBe(r);
        expect(svc.getActive()).toBeNull();
    });

    it("해시 비교를 켜면 크기가 같은 파일도 해시로 확인한다", async () => {
        f_File(join(src, "hash.txt"), "aaaa");
        f_File(join(dst, "hash.txt"), "bbbb");
        const { excludes: _ex, ...options } = createDefaultSettings().defaults;
        const r = await f_Service({ job: { options: { ...options, checkHashes: true } } }).run(
            JOB_ID,
        );
        const hash = r.entries.find((e) => e.path === "hash.txt");
        expect(hash?.status).toBe("modified");
        expect(hash?.reasons).toContain("hash");
        expect(r.summary.hashComparedFiles).toBeGreaterThan(0);
    });

    it("대상을 alias remote 경로로 지정해도 로컬 비교와 같은 결과", async () => {
        const local = await f_Service().run(JOB_ID);
        const remote = await f_Service({ job: { destination: `it-cmp:c${caseNo}/dst` } }).run(
            JOB_ID,
        );
        expect(remote.summary).toEqual(local.summary);
        expect(remote.entries.map((e) => [e.path, e.status])).toEqual(
            local.entries.map((e) => [e.path, e.status]),
        );
    });

    it("대상 폴더가 없으면 모두 신규로 보고 경고한다", async () => {
        rmSync(dst, { recursive: true, force: true });
        const r = await f_Service().run(JOB_ID);
        expect(r.destMissing).toBe(true);
        expect(r.summary).toMatchObject({ createFiles: 4, deleteFiles: 0, destFiles: 0 });
        expect(r.warnings.some((w) => w.includes("대상 폴더가 없습니다"))).toBe(true);
    });

    it("원본이 없으면 PATH_NOT_FOUND이고 결과를 만들지 않는다", async () => {
        rmSync(src, { recursive: true, force: true });
        const svc = f_Service();
        expect(await f_Code(svc.run(JOB_ID))).toBe("PATH_NOT_FOUND");
        expect(svc.get(JOB_ID)).toBeNull();
    });

    it("목록 직전에 원본이 사라지면(lsjson exit 3) PATH_NOT_FOUND이고 이전 결과도 지운다", async () => {
        let vanish = false;
        const svc = f_Service({
            probe: (path) =>
                vanish && path === src
                    ? {
                          kind: "local",
                          displayPath: path,
                          normalizedPath: path,
                          exists: true,
                          isDirectory: true,
                          readable: true,
                          isRoot: false,
                          message: "폴더가 있습니다.",
                          warnings: [],
                      }
                    : null,
        });
        await svc.run(JOB_ID);
        expect(svc.get(JOB_ID)).not.toBeNull();
        vanish = true;
        rmSync(src, { recursive: true, force: true });
        let err: unknown = null;
        try {
            await svc.run(JOB_ID);
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(clsAppError);
        expect((err as clsAppError).code).toBe("PATH_NOT_FOUND");
        expect((err as clsAppError).message).toContain("원본");
        expect(svc.get(JOB_ID)).toBeNull();
    });

    it("목록 중 취소하면 CANCELED이고 이전 결과를 남기지 않는다", async () => {
        let cancelOnSpawn = false;
        const svc = f_Service({
            run: (s) => (bin, args, o) => {
                const p = runRclone(bin, args, o);
                if (cancelOnSpawn) setTimeout(() => s.cancel(JOB_ID), 0);
                return p;
            },
        });
        await svc.run(JOB_ID);
        expect(svc.get(JOB_ID)).not.toBeNull();
        cancelOnSpawn = true;
        expect(await f_Code(svc.run(JOB_ID))).toBe("CANCELED");
        expect(svc.get(JOB_ID)).toBeNull();
        expect(svc.getActive()).toBeNull();
        // 락이 풀려 다시 비교할 수 있다
        cancelOnSpawn = false;
        expect((await svc.run(JOB_ID)).summary.createFiles).toBe(2);
    });
});
