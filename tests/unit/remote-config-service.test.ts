/**
 * remote 설정 서비스 테스트 (INT-006 T-03·T-05).
 * 가짜 rclone 실행·rcd 세션으로 인자·본문·삭제 순서를 확인한다(실제 conf는 건드리지 않는다).
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    clsRemoteConfigService,
    mergeRemoteParameters,
} from "@/main/services/remote-config-service";
import type { typRunRclone } from "@/main/rclone/process";
import { createDefaultSettings } from "@/shared/defaults";
import type { itfRcloneEnvironment } from "@/shared/ipc-contract";
import type { typJob } from "@/shared/schemas/job";
import type { itfRemoteProvider } from "@/shared/types/remote-config";
import type { itfRemoteBookmark } from "@/shared/types/remotes";
import { readFixture } from "./fixtures";

const BIN = "C:\\fake\\rclone.exe";
const CONF = "C:\\fake\\rclone.conf";
const NOW = "2026-11-03T00:00:00.000Z";

function f_Result(stdout: string, exitCode = 0) {
    return {
        exitCode,
        signal: null,
        stdout,
        stdoutBytes: Buffer.from(stdout),
        stdoutTruncated: false,
        stderrTail: "",
        timedOut: false,
        canceled: false,
        durationMs: 1,
        closed: true,
    };
}

function f_Job(over: Partial<typJob>): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: "00000000-0000-4000-8000-000000000001",
        name: "작업",
        notes: "",
        source: "C:\\fake\\src",
        destination: "C:\\fake\\dst",
        mode: "copy",
        scope: "files",
        excludes: [...excludes],
        excludePatternIds: [],
        options,
        configPathOverride: null,
        backupDir: null,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            kind: "interval",
            timeOfDay: "09:00",
            weekdays: 127,
            backend: "app",
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 0,
        createdAt: NOW,
        updatedAt: NOW,
        lastRun: null,
        ...over,
    };
}

function f_Env(over: Partial<itfRcloneEnvironment> = {}): itfRcloneEnvironment {
    return {
        binaryPath: BIN,
        binarySource: "manual",
        version: "1.75.1",
        versionText: "v1.75.1",
        os: "windows",
        arch: "amd64",
        configPath: CONF,
        configExists: true,
        configSource: "manual",
        remotes: ["r1", "ab"],
        remoteTypes: { r1: "sftp" },
        problem: null,
        warnings: [],
        detectedAt: NOW,
        ...over,
    };
}

interface itfHarnessOptions {
    jobs?: typJob[];
    bookmarks?: itfRemoteBookmark[];
    osTasks?: Array<{ jobId: string; registered: boolean }>;
    sessionPost?: (path: string, body: unknown) => unknown;
    deleteExit?: number;
}

function f_Harness(o: itfHarnessOptions = {}) {
    const jobs = o.jobs ?? [];
    const bookmarks = o.bookmarks ?? [];
    const updates: Array<{ id: string; patch: unknown }> = [];
    const runCalls: string[][] = [];
    const posts: Array<{ path: string; body: unknown }> = [];
    const detectCalls: boolean[] = [];
    let idleCount = 0;
    let deleted: string | null = null;

    const run: typRunRclone = async (_binary, args) => {
        runCalls.push([...args]);
        if (args[0] === "config" && args[1] === "providers") {
            return f_Result(readFixture("config-providers", "stdout"));
        }
        if (args[0] === "config" && args[1] === "redacted") {
            return f_Result(readFixture("config-redacted", "stdout"));
        }
        if (args[0] === "config" && args[1] === "delete") {
            deleted = args[2] ?? null;
            return f_Result("", o.deleteExit ?? 0);
        }
        return f_Result("", 1);
    };

    const session = {
        post: async (path: string, body: unknown) => {
            posts.push({ path, body });
            return o.sessionPost ? o.sessionPost(path, body) : {};
        },
        quit: async () => undefined,
    };

    const service = new clsRemoteConfigService({
        rcloneEnv: {
            require: async () => ({ binaryPath: BIN, configPath: CONF }),
            listRemotes: async () => ["r1", "ab"],
            detect: async (force) => {
                detectCalls.push(force === true);
                return f_Env();
            },
            resolveConfigFor: async () => CONF,
        },
        remoteOps: { run: async (_names, task) => task() },
        jobs: {
            list: () => jobs,
            get: (id) => {
                const j = jobs.find((x) => x.id === id);
                if (!j) throw new Error("no job");
                return j;
            },
            update: async (id, patch) => {
                updates.push({ id, patch });
                return jobs.find((x) => x.id === id)!;
            },
        },
        bookmarks: { list: () => bookmarks },
        osScheduler: {
            idle: async () => {
                idleCount += 1;
            },
            status: () => ({
                available: true,
                reason: null,
                tasks: (o.osTasks ?? []).map((t) => ({
                    jobId: t.jobId,
                    registered: t.registered,
                    exeMatches: true,
                    error: null,
                })),
            }),
        },
        logger: { info: () => undefined, warn: () => undefined },
        emit: () => undefined,
        run,
        startRcSession: async () => session,
    });

    return {
        service,
        jobs,
        updates,
        runCalls,
        posts,
        detectCalls,
        idle: () => idleCount,
        deleted: () => deleted,
    };
}

describe("mergeRemoteParameters", () => {
    const provider: itfRemoteProvider = {
        type: "sftp",
        description: "SFTP",
        oauth: false,
        options: [
            {
                name: "host",
                help: "",
                defaultText: "",
                required: true,
                advanced: false,
                secret: false,
                kind: "string",
                choices: [],
                exclusive: false,
            },
            {
                name: "pass",
                help: "",
                defaultText: "",
                required: false,
                advanced: false,
                secret: true,
                kind: "string",
                choices: [],
                exclusive: false,
            },
            {
                name: "port",
                help: "",
                defaultText: "22",
                required: false,
                advanced: false,
                secret: false,
                kind: "int",
                choices: [],
                exclusive: false,
            },
            {
                name: "mode",
                help: "",
                defaultText: "",
                required: false,
                advanced: true,
                secret: false,
                kind: "enum",
                choices: [{ value: "a", help: "" }],
                exclusive: true,
            },
        ],
    };

    it("비밀·비밀 아닌 값을 합치고 필수를 확인한다", () => {
        expect(
            mergeRemoteParameters(provider, { host: "h", port: "2222" }, { pass: "p" }, true),
        ).toEqual({ host: "h", port: "2222", pass: "p" });
        expect(() => mergeRemoteParameters(provider, {}, {}, true)).toThrow(/host/);
    });

    it("모르는 옵션·비밀 칸 혼동·숫자·목록 밖 값을 거부한다", () => {
        expect(() => mergeRemoteParameters(provider, { nope: "x" }, {}, false)).toThrow(/옵션/);
        expect(() => mergeRemoteParameters(provider, { pass: "p" }, {}, false)).toThrow(/비밀/);
        expect(() => mergeRemoteParameters(provider, { port: "x" }, {}, false)).toThrow(/숫자/);
        expect(() => mergeRemoteParameters(provider, { mode: "z" }, {}, false)).toThrow(/목록/);
    });
});

describe("clsRemoteConfigService", () => {
    it("create: 값은 rcd 본문으로만 가고 명령줄·인자에 비밀이 없다 (AC-3)", async () => {
        const h = f_Harness();
        const r = await h.service.create({
            name: "new1",
            type: "sftp",
            values: {},
            secrets: { host: "example.invalid", pass: "secret-pass" },
        });
        expect(r).toEqual({ name: "new1", oauth: false });
        expect(h.posts[0]!.path).toBe("/config/create");
        expect(h.posts[0]!.body).toMatchObject({
            name: "new1",
            type: "sftp",
            parameters: { host: "example.invalid", pass: "secret-pass" },
            opt: { nonInteractive: true, obscure: true },
        });
        for (const args of h.runCalls) expect(args.join(" ")).not.toContain("secret-pass");
        expect(h.detectCalls).toContain(true);
    });

    it("create: 기존 이름(대소문자 무시)·모르는 옵션은 저장 전에 막는다 (AC-2)", async () => {
        const h = f_Harness();
        await expect(
            h.service.create({ name: "AB", type: "sftp", values: { host: "h" }, secrets: {} }),
        ).rejects.toThrow(/이미 있습니다/);
        await expect(
            h.service.create({ name: "new1", type: "sftp", values: { nope: "h" }, secrets: {} }),
        ).rejects.toThrow(/옵션/);
        expect(h.posts).toEqual([]);
    });

    it("update: 바뀐 칸만 config/update로 보낸다 (AC-5)", async () => {
        const h = f_Harness();
        const r = await h.service.update({
            name: "r1",
            values: { port: "2222" },
            secrets: {},
        });
        expect(r).toEqual({ name: "r1", reauthSuggested: false });
        expect(h.posts[0]!.path).toBe("/config/update");
        expect(h.posts[0]!.body).toMatchObject({ name: "r1", parameters: { port: "2222" } });
    });

    it("update: 바꿀 값이 없으면 막는다", async () => {
        const h = f_Harness();
        await expect(h.service.update({ name: "r1", values: {}, secrets: {} })).rejects.toThrow(
            /바꿀 값/,
        );
    });

    it("get: 비밀 아닌 값만 채우고 비밀은 이름만 알린다 (AC-4)", async () => {
        const h = f_Harness();
        const view = await h.service.get("r1");
        expect(view.type).toBe("sftp");
        expect(view.values).toEqual({});
        expect(view.secretsSet).toEqual(["host", "pass", "user"]);
        expect(view.redactedUnavailable).toBe(false);
        expect(JSON.stringify(view)).not.toContain("XXX");
    });

    it("usage: 기본 conf 작업만 세고 작업별 conf는 otherConfigJobs로 센다", async () => {
        const jobs = [
            f_Job({ id: "00000000-0000-4000-8000-000000000001", name: "a", source: "r1:x" }),
            f_Job({
                id: "00000000-0000-4000-8000-000000000002",
                name: "b",
                destination: "R1:y",
                autoSync: {
                    ...f_Job({}).autoSync,
                    enabled: true,
                    backend: "os",
                },
            }),
            f_Job({
                id: "00000000-0000-4000-8000-000000000003",
                name: "c",
                source: "r1:z",
                configPathOverride: "C:\\other.conf",
            }),
        ];
        const h = f_Harness({
            jobs,
            bookmarks: [
                {
                    id: "00000000-0000-4000-8000-000000000010",
                    alias: "b1",
                    remoteName: "r1",
                    basePath: "",
                    path: "r1:",
                    createdAt: NOW,
                    updatedAt: NOW,
                },
            ],
        });
        const usage = await h.service.usage("r1");
        expect(usage.jobs.map((j) => [j.name, j.autoSync])).toEqual([
            ["a", "off"],
            ["b", "os"],
        ]);
        expect(usage.bookmarks.map((b) => b.alias)).toEqual(["b1"]);
        expect(usage.otherConfigJobs).toBe(1);
    });

    it("remove: 예약 켜진 작업이 있으면 확인 없이는 지우지 않는다 (AC-8)", async () => {
        const jobs = [
            f_Job({
                id: "00000000-0000-4000-8000-000000000001",
                source: "r1:x",
                autoSync: { ...f_Job({}).autoSync, enabled: true },
            }),
        ];
        const h = f_Harness({ jobs });
        await expect(h.service.remove({ name: "r1" })).rejects.toThrow(/자동 실행/);
        expect(h.deleted()).toBeNull();
        expect(h.updates).toEqual([]);
    });

    it("remove: 자동 실행을 끄고 OS 예약이 사라진 뒤 지운다 (AC-9)", async () => {
        const jobs = [
            f_Job({
                id: "00000000-0000-4000-8000-000000000001",
                source: "r1:x",
                autoSync: { ...f_Job({}).autoSync, enabled: true, backend: "app" },
            }),
            f_Job({
                id: "00000000-0000-4000-8000-000000000002",
                destination: "r1:y",
                autoSync: { ...f_Job({}).autoSync, enabled: true, backend: "os" },
            }),
        ];
        const h = f_Harness({ jobs });
        const r = await h.service.remove({ name: "r1", disableSchedules: true });
        expect(r.disabledJobIds).toEqual([
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
        ]);
        expect(h.updates).toHaveLength(2);
        expect(h.updates[0]!.patch).toMatchObject({ autoSync: { enabled: false } });
        expect(h.idle()).toBe(1);
        expect(h.deleted()).toBe("r1");
        expect(h.detectCalls).toContain(true);
    });

    it("remove: OS 예약 삭제가 실패하면 remote를 지우지 않는다 (AC-10)", async () => {
        const jobs = [
            f_Job({
                id: "00000000-0000-4000-8000-000000000002",
                source: "r1:x",
                autoSync: { ...f_Job({}).autoSync, enabled: true, backend: "os" },
            }),
        ];
        const h = f_Harness({
            jobs,
            osTasks: [{ jobId: "00000000-0000-4000-8000-000000000002", registered: true }],
        });
        await expect(h.service.remove({ name: "r1", disableSchedules: true })).rejects.toThrow(
            /예약을 지우지 못해/,
        );
        expect(h.deleted()).toBeNull();
    });

    it("remove: 없는 remote는 REMOTE_NOT_FOUND", async () => {
        const h = f_Harness();
        await expect(h.service.remove({ name: "gone" })).rejects.toThrow(/없습니다/);
    });
});
