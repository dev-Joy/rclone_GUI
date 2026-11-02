/**
 * 실제 rclone으로 remote 북마크·폴더 탐색(clsRemoteService)을 확인한다.
 * 임시 폴더와 임시 rclone.conf(alias remote)만 쓰고, 실제 사용자 설정·경로는 읽지 않는다.
 * rclone이 없으면 이유를 출력하고 건너뛴다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsRcloneEnv } from "@/main/rclone/detect";
import { runRclone } from "@/main/rclone/process";
import { clsActivityLock } from "@/main/services/activity-lock";
import { clsPathService } from "@/main/services/path-service";
import { clsRemoteOps } from "@/main/services/remote-ops";
import { clsRemoteService } from "@/main/services/remote-service";
import { migrateSchema } from "@/main/store/db-schema";
import { clsRemoteStore } from "@/main/store/remote-store";
import { clsSqliteDb } from "@/main/store/sqlite-db";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import type { typJob } from "@/shared/schemas/job";

const RCLONE = process.env.RCLONEGUI_TEST_RCLONE ?? "rclone";
const probe = spawnSync(RCLONE, ["version"], { shell: false, windowsHide: true, encoding: "utf8" });
const HAS_RCLONE = probe.status === 0;
if (!HAS_RCLONE) {
    console.warn(
        `[test:int] rclone을 실행할 수 없어 건너뜁니다 (${RCLONE}): ${probe.error?.message ?? probe.stderr}`,
    );
}

const AT = "2026-10-30T00:00:00.000Z";
const LOGGER = { info: () => undefined, warn: () => undefined };
const MANUAL_BIN = process.env.RCLONEGUI_TEST_RCLONE ?? null;

const root = mkdtempSync(join(tmpdir(), "rclonegui-remotes-int-"));
const data = join(root, "data");
const conf = join(root, "rclone.conf");
// 테스트 준비용 설정 파일. 앱 코드는 이 파일을 읽지 않고 경로만 --config로 넘긴다
mkdirSync(join(data, "base", "a", "b"), { recursive: true });
writeFileSync(conf, `[it-run]\ntype = alias\nremote = ${data}\n`);

let db: clsSqliteDb;
let service: clsRemoteService;
let activity: clsActivityLock;
const calls: string[][] = [];

function f_Env(): clsRcloneEnv {
    return new clsRcloneEnv({
        getSettings: () => ({ rclonePath: MANUAL_BIN, configPath: conf }),
        logger: LOGGER,
    });
}

function f_Job(source: string, destination: string): typJob {
    return {
        ...createJobDraft(createDefaultSettings()),
        id: "00000000-0000-4000-8000-0000000000e1",
        name: "탐색 중 작업",
        source,
        destination,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            kind: "interval",
            timeOfDay: "09:00",
            weekdays: 62,
            backend: "app",
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 0,
        createdAt: AT,
        updatedAt: AT,
        lastRun: null,
    };
}

beforeAll(() => {
    db = clsSqliteDb.open({ file: join(root, "store.sqlite") });
    migrateSchema(db, () => undefined);
    const store = new clsRemoteStore({ db });
    store.load();
    const env = f_Env();
    const job = f_Job("it-run:base", "C:\\tmp\\dst");
    activity = new clsActivityLock();
    const ops = new clsRemoteOps({
        activity,
        jobs: {
            get: (id) => {
                if (id !== job.id) throw new Error("없는 작업");
                return job;
            },
        },
    });
    service = new clsRemoteService({
        store,
        rcloneEnv: env,
        pathService: new clsPathService({ rcloneEnv: env }),
        remoteOps: ops,
        run: async (binary, args, opts) => {
            calls.push([...args]);
            return runRclone(binary, args, opts);
        },
    });
});

afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!HAS_RCLONE)("리모트 북마크·폴더 탐색 (실제 rclone, 임시 설정)", () => {
    it("북마크를 만들고 기준 경로를 probe로 확인한다", async () => {
        const b = await service.create({
            alias: "통합",
            remoteName: "it-run",
            basePath: "base/a",
        });
        expect(b.path).toBe("it-run:base/a");
        const p = await service.test(b.id);
        expect(p).toMatchObject({
            kind: "remote",
            normalizedPath: "it-run:base/a",
            exists: true,
            isDirectory: true,
        });
    });

    it("한 단계씩 폴더만 나열하고 없는 폴더는 PATH_NOT_FOUND", async () => {
        const base = await service.listDir({ path: "it-run:base", configPath: null });
        expect(base).toMatchObject({
            path: "it-run:base",
            entries: [{ name: "a", path: "it-run:base/a" }],
            total: 1,
            truncated: false,
        });
        const a = await service.listDir({ path: "it-run:base/a", configPath: null });
        expect(a.entries).toEqual([{ name: "b", path: "it-run:base/a/b" }]);
        const b = await service.listDir({ path: "it-run:base/a/b", configPath: null });
        expect(b).toMatchObject({ entries: [], total: 0, truncated: false });
        await expect(
            service.listDir({ path: "it-run:base/missing", configPath: null }),
        ).rejects.toMatchObject({ code: "PATH_NOT_FOUND" });
    });

    it("lsjson --max-depth 1 --dirs-only --ask-password=false로 실행한다", () => {
        const dir = calls.find((a) => a[0] === "lsjson");
        expect(dir).toBeDefined();
        expect(dir).toContain("--max-depth");
        expect(dir![dir!.indexOf("--max-depth") + 1]).toBe("1");
        expect(dir).toContain("--dirs-only");
        expect(dir).toContain("--ask-password=false");
        expect(dir).toContain("--config");
        expect(dir![dir!.indexOf("--config") + 1]).toBe(conf);
        expect(dir!.at(-2)).toBe("--");
    });

    it("같은 리모트를 비교 중이면 BUSY, 끝나면 다시 탐색한다", async () => {
        const release = activity.acquire(
            { kind: "compare", jobId: "00000000-0000-4000-8000-0000000000e1", startedAt: AT },
            () => "비교 중",
        );
        try {
            await expect(
                service.listDir({ path: "it-run:base", configPath: null }),
            ).rejects.toMatchObject({ code: "BUSY" });
        } finally {
            release();
        }
        const r = await service.listDir({ path: "it-run:base", configPath: null });
        expect(r.entries).toEqual([{ name: "a", path: "it-run:base/a" }]);
    });
});
