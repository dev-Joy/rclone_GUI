// ========== External imports ==========
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import type { itfProcessResult } from "@/main/rclone/process";
import { clsRemoteService } from "@/main/services/remote-service";
import { migrateSchema } from "@/main/store/db-schema";
import { clsRemoteStore } from "@/main/store/remote-store";
import { clsSqliteDb } from "@/main/store/sqlite-db";
import type { itfPathProbe } from "@/shared/ipc-contract";
import { LIST_DIR_MAX } from "@/shared/option-limits";
import type { typTestPathInput } from "@/shared/schemas/rclone";

const BIN = "C:\\fake\\rclone.exe";
const CONF = "C:\\fake\\rclone.conf";

let dir = "";
let db: clsSqliteDb;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-remote-svc-"));
    db = clsSqliteDb.open({ file: join(dir, "store.sqlite") });
    migrateSchema(db, () => undefined);
});

afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
});

function f_Store(): clsRemoteStore {
    const store = new clsRemoteStore({ db });
    store.load();
    return store;
}

function f_Res(over: Partial<itfProcessResult> = {}): itfProcessResult {
    return {
        exitCode: 0,
        signal: null,
        stdout: "[]",
        stdoutBytes: Buffer.alloc(0),
        stdoutTruncated: false,
        stderrTail: "",
        timedOut: false,
        canceled: false,
        durationMs: 1,
        closed: true,
        ...over,
    };
}

const PROBE: itfPathProbe = {
    kind: "remote",
    displayPath: "test-remote:base",
    normalizedPath: "test-remote:base",
    exists: true,
    isDirectory: true,
    readable: null,
    isRoot: false,
    message: "폴더가 있습니다.",
    warnings: [],
};

interface itfOptions {
    configPath?: string | null;
    remotes?: string[];
    result?: Partial<itfProcessResult>;
    probe?: itfPathProbe;
}

function f_Make(o: itfOptions = {}) {
    const runs: Array<{ args: string[]; timeoutMs: number | null }> = [];
    const probes: typTestPathInput[] = [];
    const opsCalls: string[][] = [];
    const service = new clsRemoteService({
        store: f_Store(),
        rcloneEnv: {
            require: async () => ({ binaryPath: BIN, configPath: CONF }),
            resolveConfigFor: async (override) => {
                if (override !== undefined && override !== null) return override;
                return o.configPath !== undefined ? o.configPath : CONF;
            },
            listRemotes: async () => o.remotes ?? ["test-remote"],
        },
        pathService: {
            probe: async (input) => {
                probes.push(input);
                return o.probe ?? PROBE;
            },
        },
        remoteOps: {
            run: async (remotes, task) => {
                opsCalls.push([...remotes]);
                return task();
            },
        },
        run: async (_bin, args, opts) => {
            runs.push({ args: [...args], timeoutMs: opts.timeoutMs });
            return f_Res(o.result);
        },
    });
    return { service, runs, probes, opsCalls };
}

describe("clsRemoteService 북마크", () => {
    it("설정 파일이 없으면 CONFIG_REQUIRED", async () => {
        const { service } = f_Make({ configPath: null });
        await expect(
            service.create({ alias: "a", remoteName: "test-remote", basePath: "" }),
        ).rejects.toMatchObject({ code: "CONFIG_REQUIRED" });
    });

    it("rclone.conf에 없는 리모트는 VALIDATION", async () => {
        const { service } = f_Make({ remotes: ["other"] });
        await expect(
            service.create({ alias: "a", remoteName: "test-remote", basePath: "" }),
        ).rejects.toMatchObject({ code: "VALIDATION" });
        expect(service.list()).toEqual([]);
    });

    it("create·update·list·remove", async () => {
        const { service } = f_Make();
        const b = await service.create({
            alias: "테스트",
            remoteName: "test-remote",
            basePath: "base",
        });
        expect(b.path).toBe("test-remote:base");
        expect(service.list()).toEqual([b]);
        const u = await service.update({
            id: b.id,
            alias: "바뀜",
            remoteName: "test-remote",
            basePath: "",
        });
        expect(u).toMatchObject({ alias: "바뀜", path: "test-remote:" });
        service.remove(b.id);
        expect(service.list()).toEqual([]);
        await expect(
            service.update({
                id: b.id,
                alias: "x",
                remoteName: "test-remote",
                basePath: "",
            }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("연결 테스트는 저장된 경로를 probe하고 탐색 락을 잡는다", async () => {
        const { service, probes, opsCalls } = f_Make();
        const b = await service.create({
            alias: "테스트",
            remoteName: "test-remote",
            basePath: "base/a",
        });
        await expect(service.test(b.id)).resolves.toEqual(PROBE);
        expect(probes).toEqual([{ path: "test-remote:base/a", configPath: null }]);
        expect(opsCalls).toEqual([["test-remote"]]);
        await expect(service.test("00000000-0000-4000-8000-0000000000ff")).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
    });
});

describe("clsRemoteService.probePath", () => {
    it("로컬·UNC는 탐색 큐를 거치지 않는다", async () => {
        const { service, probes, opsCalls } = f_Make();
        await service.probePath({ path: "C:\\tmp\\src", configPath: null });
        expect(opsCalls).toEqual([]);
        await service.probePath({ path: "\\\\server\\share\\a", configPath: null });
        expect(opsCalls).toEqual([]);
        expect(probes.map((p) => p.path)).toEqual(["C:\\tmp\\src", "\\\\server\\share\\a"]);
    });

    it("리모트는 이름으로 탐색 큐를 잡는다", async () => {
        const { service, opsCalls } = f_Make();
        await service.probePath({ path: "r:a/b", configPath: null });
        expect(opsCalls).toEqual([["r"]]);
    });

    it("잘못된 경로는 parsePath 오류 그대로", async () => {
        const { service } = f_Make();
        await expect(service.probePath({ path: "../x", configPath: null })).rejects.toMatchObject({
            code: "PATH_INVALID",
        });
    });
});

describe("clsRemoteService.listDir", () => {
    it("리모트 경로가 아니면 PATH_INVALID", async () => {
        const { service } = f_Make();
        await expect(service.listDir({ path: "C:\\tmp", configPath: null })).rejects.toMatchObject({
            code: "PATH_INVALID",
        });
    });

    it("설정 파일이 없으면 CONFIG_REQUIRED", async () => {
        const { service } = f_Make({ configPath: null });
        await expect(
            service.listDir({ path: "test-remote:", configPath: null }),
        ).rejects.toMatchObject({ code: "CONFIG_REQUIRED" });
    });

    it("lsjson --max-depth 1 --dirs-only로 폴더만 이름 순으로 돌려준다", async () => {
        const stdout = JSON.stringify([
            { Path: "base/b", Name: "b", Size: -1, IsDir: true },
            { Path: "base/file.txt", Name: "file.txt", Size: 3, IsDir: false },
            { Path: "base/a", Name: "a", Size: -1, IsDir: true },
        ]);
        const { service, runs, opsCalls } = f_Make({ result: { stdout } });
        const r = await service.listDir({ path: "test-remote:base", configPath: null });
        expect(r).toEqual({
            path: "test-remote:base",
            entries: [
                { name: "a", path: "test-remote:base/a" },
                { name: "b", path: "test-remote:base/b" },
            ],
            total: 2,
            truncated: false,
        });
        expect(opsCalls).toEqual([["test-remote"]]);
        expect(runs[0]!.args).toEqual([
            "lsjson",
            "--max-depth",
            "1",
            "--dirs-only",
            "--no-mimetype",
            "--no-modtime",
            "--ask-password=false",
            "--config",
            CONF,
            "--",
            "test-remote:base",
        ]);
        expect(runs[0]!.timeoutMs).toBe(60_000);
    });

    it("작업의 rclone.conf를 넘기면 그 파일로 읽는다", async () => {
        const conf = "D:\\jobs\\other.conf";
        const { service, runs } = f_Make();
        await service.listDir({ path: "test-remote:", configPath: conf });
        expect(runs[0]!.args).toContain(conf);
    });

    it("선두 / 기준 경로도 보존한다", async () => {
        const stdout = JSON.stringify([{ Path: "/base/a", Name: "a", IsDir: true }]);
        const { service } = f_Make({ result: { stdout } });
        const r = await service.listDir({ path: "test-remote:/base", configPath: null });
        expect(r.path).toBe("test-remote:/base");
        expect(r.entries).toEqual([{ name: "a", path: "test-remote:/base/a" }]);
    });

    it("없는 폴더(exit 3)는 PATH_NOT_FOUND, 그 밖의 실패는 RCLONE_FAILED", async () => {
        const missing = f_Make({ result: { exitCode: 3 } });
        await expect(
            missing.service.listDir({ path: "test-remote:base", configPath: null }),
        ).rejects.toMatchObject({ code: "PATH_NOT_FOUND" });

        const failed = f_Make({
            result: { exitCode: 1, stderrTail: "ERROR : directory not found" },
        });
        await expect(
            failed.service.listDir({ path: "test-remote:base", configPath: null }),
        ).rejects.toMatchObject({ code: "RCLONE_FAILED" });

        const timedOut = f_Make({ result: { timedOut: true } });
        await expect(
            timedOut.service.listDir({ path: "test-remote:base", configPath: null }),
        ).rejects.toMatchObject({ code: "RCLONE_FAILED" });
    });

    it("출력이 잘리면 RCLONE_FAILED, 상한을 넘으면 truncated", async () => {
        const cut = f_Make({ result: { stdoutTruncated: true } });
        await expect(
            cut.service.listDir({ path: "test-remote:base", configPath: null }),
        ).rejects.toMatchObject({ code: "RCLONE_FAILED" });

        const many = Array.from({ length: LIST_DIR_MAX + 1 }, (_, i) => ({
            Path: `base/d${i}`,
            Name: `d${i}`,
            IsDir: true,
        }));
        const { service } = f_Make({ result: { stdout: JSON.stringify(many) } });
        const r = await service.listDir({ path: "test-remote:base", configPath: null });
        expect(r.entries).toHaveLength(LIST_DIR_MAX);
        expect(r.total).toBe(LIST_DIR_MAX + 1);
        expect(r.truncated).toBe(true);
    });

    it("JSON이 깨졌으면 RCLONE_PARSE_ERROR", async () => {
        const { service } = f_Make({ result: { stdout: "not json" } });
        await expect(
            service.listDir({ path: "test-remote:base", configPath: null }),
        ).rejects.toMatchObject({ code: "RCLONE_PARSE_ERROR" });
    });
});
