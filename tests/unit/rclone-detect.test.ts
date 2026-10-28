// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { assertAllowedCommand } from "@/main/rclone/command-builder";
import { candidateBinaries, clsRcloneEnv } from "@/main/rclone/detect";
import {
    clsProcessSpawnError,
    type itfProcessResult,
    type typRunRclone,
} from "@/main/rclone/process";
import { readFixture } from "./fixtures";

const PATH_BIN = "C:\\fake\\bin\\rclone.exe";
const OLD_BIN = "C:\\fake\\old\\rclone.exe";
const MANUAL_BIN = "C:\\fake\\manual\\rclone.exe";
const CONF = "C:\\fake\\cfg\\rclone.conf";
const LOCAL = "C:\\fake\\local";
const PKGS = `${LOCAL}\\Microsoft\\WinGet\\Packages`;
const WINGET_BIN = `${PKGS}\\Rclone.Rclone_src\\rclone-v1.75.1-windows-amd64\\rclone.exe`;

function f_Res(over: Partial<itfProcessResult> = {}): itfProcessResult {
    return {
        exitCode: 0,
        signal: null,
        stdout: "",
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

function f_Ver(v: string): string {
    return `rclone v${v}\n- os/type: windows\n- os/arch: amd64\n`;
}

interface itfFake {
    files?: string[];
    dirs?: Record<string, string[]>;
    bins?: Record<string, string | Error>;
    configFile?: string;
    remotes?: Partial<itfProcessResult>;
    env?: Record<string, string>;
    rclonePath?: string | null;
    configPath?: string | null;
}

function f_Make(o: itfFake = {}) {
    const calls: Array<{ bin: string; args: string[] }> = [];
    const settings = { rclonePath: o.rclonePath ?? null, configPath: o.configPath ?? null };
    const files = new Set(o.files ?? []);
    const run: typRunRclone = async (bin, args) => {
        calls.push({ bin, args: [...args] });
        assertAllowedCommand(args);
        await new Promise((r) => setTimeout(r, 1));
        if (args[0] === "version") {
            const b = o.bins?.[bin];
            if (b === undefined) throw new clsProcessSpawnError("ENOENT", "없음");
            if (b instanceof Error) throw b;
            return f_Res({ stdout: b });
        }
        if (args[0] === "config") {
            return o.configFile === undefined
                ? f_Res({ exitCode: 1 })
                : f_Res({ stdout: o.configFile });
        }
        if (args[0] === "listremotes") return f_Res(o.remotes ?? { stdout: "" });
        throw new Error(`예상하지 않은 호출: ${args.join(" ")}`);
    };
    const env = new clsRcloneEnv({
        getSettings: () => settings,
        logger: { info: () => undefined, warn: () => undefined },
        run,
        isFile: async (p) => files.has(p),
        readDir: async (p) => o.dirs?.[p] ?? [],
        env: o.env ?? { Path: "C:\\fake\\bin" },
        now: () => new Date("2026-10-28T00:00:00.000Z"),
    });
    return { env, calls, settings, files };
}

const versionCalls = (calls: Array<{ bin: string; args: string[] }>) =>
    calls.filter((c) => c.args[0] === "version").map((c) => c.bin);

describe("바이너리 감지", () => {
    it("PATH의 첫 후보를 쓰고 버전·OS를 채운다", async () => {
        const { env } = f_Make({
            files: [PATH_BIN],
            bins: { [PATH_BIN]: readFixture("version", "stdout") },
        });
        const r = await env.detect();
        expect(r).toMatchObject({
            binaryPath: PATH_BIN,
            binarySource: "path",
            version: "1.75.1",
            versionText: "v1.75.1",
            os: "windows",
            arch: "amd64",
            problem: null,
            detectedAt: "2026-10-28T00:00:00.000Z",
        });
    });

    it("수동 경로: 정상 / 없으면 NOT_FOUND이고 다른 후보를 시도하지 않는다", async () => {
        const ok = f_Make({
            rclonePath: MANUAL_BIN,
            files: [MANUAL_BIN, PATH_BIN],
            bins: { [MANUAL_BIN]: f_Ver("1.70.0"), [PATH_BIN]: f_Ver("1.75.1") },
        });
        expect(await ok.env.detect()).toMatchObject({
            binaryPath: MANUAL_BIN,
            binarySource: "manual",
            version: "1.70.0",
        });

        const missing = f_Make({
            rclonePath: MANUAL_BIN,
            files: [PATH_BIN],
            bins: { [PATH_BIN]: f_Ver("1.75.1") },
        });
        const r = await missing.env.detect();
        expect(r.problem?.code).toBe("RCLONE_NOT_FOUND");
        expect(r.binaryPath).toBeNull();
        expect(missing.calls).toEqual([]);

        const relative = f_Make({ rclonePath: "rclone.exe", files: ["rclone.exe"] });
        expect((await relative.env.detect()).problem?.code).toBe("RCLONE_NOT_FOUND");
    });

    it("수동 경로 버전이 낮으면 UNSUPPORTED", async () => {
        const { env } = f_Make({
            rclonePath: MANUAL_BIN,
            files: [MANUAL_BIN],
            bins: { [MANUAL_BIN]: f_Ver("1.64.9") },
        });
        const r = await env.detect();
        expect(r.problem?.code).toBe("RCLONE_VERSION_UNSUPPORTED");
        expect(r.problem?.message).toContain("v1.64.9");
    });

    it("PATH에 없으면 WinGet Packages를 찾는다(최신 이름 먼저)", async () => {
        const { env } = f_Make({
            env: { Path: "", LOCALAPPDATA: LOCAL },
            files: [WINGET_BIN],
            dirs: {
                [PKGS]: ["Other.App_x", "Rclone.Rclone_src"],
                [`${PKGS}\\Rclone.Rclone_src`]: ["rclone-v1.75.1-windows-amd64", "readme.txt"],
            },
            bins: { [WINGET_BIN]: f_Ver("1.75.1") },
        });
        expect(await env.detect()).toMatchObject({
            binaryPath: WINGET_BIN,
            binarySource: "common",
        });
    });

    it("PATH의 rclone 버전이 낮으면 다음 후보를 쓴다", async () => {
        const { env, calls } = f_Make({
            env: { Path: "C:\\fake\\old;C:\\fake\\bin" },
            files: [OLD_BIN, PATH_BIN],
            bins: { [OLD_BIN]: f_Ver("1.60.0"), [PATH_BIN]: f_Ver("1.75.1") },
        });
        expect((await env.detect()).binaryPath).toBe(PATH_BIN);
        expect(versionCalls(calls)).toEqual([OLD_BIN, PATH_BIN]);
    });

    it("모두 실패하면 가장 구체적인 문제(UNSUPPORTED > NOT_EXECUTABLE > NOT_FOUND)", async () => {
        const a = f_Make({
            env: { Path: "C:\\fake\\old;C:\\fake\\bin" },
            files: [OLD_BIN, PATH_BIN],
            bins: { [OLD_BIN]: new clsProcessSpawnError("EACCES", "권한"), [PATH_BIN]: "쓰레기" },
        });
        expect((await a.env.detect()).problem?.code).toBe("RCLONE_NOT_EXECUTABLE");

        const b = f_Make({
            env: { Path: "C:\\fake\\old;C:\\fake\\bin" },
            files: [OLD_BIN, PATH_BIN],
            bins: {
                [OLD_BIN]: f_Ver("1.10.0"),
                [PATH_BIN]: new clsProcessSpawnError("EPERM", "x"),
            },
        });
        expect((await b.env.detect()).problem?.code).toBe("RCLONE_VERSION_UNSUPPORTED");

        const c = f_Make({ env: { Path: "" } });
        const r = await c.env.detect();
        expect(r.problem?.code).toBe("RCLONE_NOT_FOUND");
        expect(r.problem?.message).toContain("winget install Rclone.Rclone");
    });

    it("1.75.1보다 높은 버전은 허용하고 경고한다", async () => {
        const { env } = f_Make({ files: [PATH_BIN], bins: { [PATH_BIN]: f_Ver("1.76.0") } });
        const r = await env.detect();
        expect(r.problem).toBeNull();
        expect(r.warnings.some((w) => w.includes("검증하지 않은"))).toBe(true);
    });

    it("RCLONE_* 환경 변수는 이름만 경고한다(값은 넣지 않음)", async () => {
        const { env } = f_Make({
            env: { Path: "C:\\fake\\bin", RCLONE_DELETE_EXCLUDED: "secret-value" },
            files: [PATH_BIN],
            bins: { [PATH_BIN]: f_Ver("1.75.1") },
        });
        const text = (await env.detect()).warnings.join("\n");
        expect(text).toContain("RCLONE_DELETE_EXCLUDED");
        expect(text).not.toContain("secret-value");
    });

    it("candidateBinaries: 중복·상대 경로를 거르고 Links·Program Files·scoop 순", async () => {
        const files = new Set([
            PATH_BIN,
            `${LOCAL}\\Microsoft\\WinGet\\Links\\rclone.exe`,
            "C:\\fake\\pf\\rclone\\rclone.exe",
            "C:\\fake\\home\\scoop\\shims\\rclone.exe",
        ]);
        const list = await candidateBinaries(
            {
                Path: 'C:\\fake\\bin;"C:\\fake\\bin";relative;',
                LOCALAPPDATA: LOCAL,
                ProgramFiles: "C:\\fake\\pf",
                USERPROFILE: "C:\\fake\\home",
            },
            { isFile: async (p) => files.has(p), readDir: async () => [] },
        );
        expect(list.map((c) => c.path)).toEqual([...files]);
        expect(list.map((c) => c.source)).toEqual(["path", "common", "common", "common"]);
    });
});

function f_Base() {
    return f_Make({
        files: [PATH_BIN, MANUAL_BIN],
        bins: { [PATH_BIN]: f_Ver("1.75.1"), [MANUAL_BIN]: f_Ver("1.70.0") },
    });
}

describe("캐시", () => {
    it("두 번째 detect는 rclone을 다시 부르지 않고, force면 다시 감지한다", async () => {
        const { env, calls } = f_Base();
        await env.detect();
        const n = calls.length;
        await env.detect();
        expect(calls.length).toBe(n);
        await env.detect(true);
        expect(calls.length).toBeGreaterThan(n);
    });

    it("settings.rclonePath가 바뀌면 다시 감지한다", async () => {
        const { env, settings } = f_Base();
        expect((await env.detect()).binaryPath).toBe(PATH_BIN);
        settings.rclonePath = MANUAL_BIN;
        expect((await env.detect()).binaryPath).toBe(MANUAL_BIN);
    });

    it("동시 두 번 호출은 한 번만 감지한다", async () => {
        const { env, calls } = f_Base();
        const [a, b] = await Promise.all([env.detect(), env.detect(true)]);
        expect(a).toBe(b);
        expect(versionCalls(calls)).toHaveLength(1);
    });
});

describe("설정 파일 결정", () => {
    const bins = { [PATH_BIN]: f_Ver("1.75.1") };

    it("수동 지정: 있으면 manual, 없으면 CONFIG_NOT_FOUND(다른 위치로 넘어가지 않음)", async () => {
        const ok = f_Make({ configPath: CONF, files: [PATH_BIN, CONF], bins });
        expect(await ok.env.detect()).toMatchObject({
            configPath: CONF,
            configExists: true,
            configSource: "manual",
            problem: null,
        });
        const missing = f_Make({
            configPath: CONF,
            files: [PATH_BIN],
            bins,
            configFile: readFixture("config-file", "stdout"),
        });
        const r = await missing.env.detect();
        expect(r).toMatchObject({ configPath: null, configSource: "manual" });
        expect(r.problem?.code).toBe("CONFIG_NOT_FOUND");
        expect(missing.calls.some((c) => c.args[0] === "config")).toBe(false);
        await expect(missing.env.require()).rejects.toMatchObject({ code: "CONFIG_NOT_FOUND" });
    });

    it("RCLONE_CONFIG가 있으면 env", async () => {
        const { env } = f_Make({
            env: { Path: "C:\\fake\\bin", RCLONE_CONFIG: CONF },
            files: [PATH_BIN, CONF],
            bins,
        });
        expect(await env.detect()).toMatchObject({ configPath: CONF, configSource: "env" });
    });

    it("config file: 있으면 auto, 없다고 하면 configPath null + 경고", async () => {
        const auto = f_Make({
            files: [PATH_BIN, CONF],
            bins,
            configFile: `Configuration file is stored at:\n${CONF}\n`,
        });
        expect(await auto.env.detect()).toMatchObject({ configPath: CONF, configSource: "auto" });

        const none = f_Make({
            files: [PATH_BIN],
            bins,
            configFile: readFixture("config-file-missing", "stdout"),
        });
        const r = await none.env.detect();
        expect(r).toMatchObject({ configPath: null, configExists: false, configSource: "none" });
        expect(r.problem).toBeNull();
        expect(r.warnings.some((w) => w.includes("로컬·UNC"))).toBe(true);
        expect(none.calls.some((c) => c.args[0] === "listremotes")).toBe(false);
    });

    it("config file이 실패하면 %APPDATA%\\rclone\\rclone.conf, 그것도 없으면 none", async () => {
        const appConf = "C:\\fake\\appdata\\rclone\\rclone.conf";
        const a = f_Make({
            env: { Path: "C:\\fake\\bin", APPDATA: "C:\\fake\\appdata" },
            files: [PATH_BIN, appConf],
            bins,
        });
        expect(await a.env.detect()).toMatchObject({ configPath: appConf, configSource: "auto" });

        const b = f_Make({ files: [PATH_BIN], bins });
        expect(await b.env.detect()).toMatchObject({ configPath: null, configSource: "none" });
    });

    it("remotes: 정렬된 목록 / 실패하면 경고와 빈 목록(problem 없음)", async () => {
        const ok = f_Make({
            configPath: CONF,
            files: [PATH_BIN, CONF],
            bins,
            remotes: { stdout: readFixture("listremotes", "stdout") },
        });
        expect((await ok.env.detect()).remotes).toEqual(["probe-alias", "probe-b"]);

        const bad = f_Make({
            configPath: CONF,
            files: [PATH_BIN, CONF],
            bins,
            remotes: { exitCode: 1, stderrTail: "ERROR : unable to decrypt configuration" },
        });
        const r = await bad.env.detect();
        expect(r.remotes).toEqual([]);
        expect(r.problem).toBeNull();
        expect(r.warnings.join("\n")).toContain("RCLONE_CONFIG_PASS");
    });

    it("rclone에 넘긴 인자는 모두 허용 명령이고 설정 경로는 --config로 명시된다", async () => {
        const { env, calls } = f_Make({ configPath: CONF, files: [PATH_BIN, CONF], bins });
        await env.detect();
        const lr = calls.find((c) => c.args[0] === "listremotes")!;
        expect(lr.args.slice(-2)).toEqual(["--config", CONF]);
        for (const c of calls) expect(() => assertAllowedCommand(c.args)).not.toThrow();
    });
});

describe("require / resolveConfigFor / listRemotes", () => {
    it("문제가 있으면 require가 그 코드로 던진다", async () => {
        const { env } = f_Make({ env: { Path: "" } });
        await expect(env.require()).rejects.toMatchObject({ code: "RCLONE_NOT_FOUND" });
    });

    it("override가 있으면 확인 후 그 경로, 없으면 감지된 경로", async () => {
        const other = "C:\\fake\\other.conf";
        const { env } = f_Make({
            configPath: CONF,
            files: [PATH_BIN, CONF, other],
            bins: { [PATH_BIN]: f_Ver("1.75.1") },
        });
        expect(await env.resolveConfigFor(other)).toBe(other);
        expect(await env.resolveConfigFor(null)).toBe(CONF);
        await expect(env.resolveConfigFor("C:\\fake\\none.conf")).rejects.toMatchObject({
            code: "CONFIG_NOT_FOUND",
        });
    });

    it("listremotes 출력이 잘리면 RCLONE_FAILED(목록이 너무 큼)", async () => {
        const { env } = f_Make({
            configPath: CONF,
            files: [PATH_BIN, CONF],
            bins: { [PATH_BIN]: f_Ver("1.75.1") },
            remotes: { stdout: "a:\n", stdoutTruncated: true },
        });
        await expect(env.listRemotes()).rejects.toMatchObject({
            code: "RCLONE_FAILED",
            message: "remote 목록이 너무 커서 읽지 못했습니다.",
        });
    });

    it("listRemotes는 override 설정으로 조회한다", async () => {
        const other = "C:\\fake\\other.conf";
        const { env, calls } = f_Make({
            files: [PATH_BIN, other],
            bins: { [PATH_BIN]: f_Ver("1.75.1") },
            remotes: { stdout: "b:\na:\n" },
        });
        expect(await env.listRemotes(other)).toEqual(["a", "b"]);
        expect(calls.at(-1)!.args.slice(-2)).toEqual(["--config", other]);
        expect(await env.listRemotes()).toEqual([]);
    });
});
