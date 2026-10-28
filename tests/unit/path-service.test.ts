// ========== External imports ==========
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { assertAllowedCommand } from "@/main/rclone/command-builder";
import type { itfProcessResult, typRunRclone } from "@/main/rclone/process";
import {
    clsFsGate,
    clsPathService,
    FS_TIMEOUT,
    remoteParentOf,
} from "@/main/services/path-service";
import { parsePath } from "@/shared/path-utils";
import { readFixture } from "./fixtures";

const root = mkdtempSync(join(tmpdir(), "rclonegui-probe-unit-"));
mkdirSync(join(root, "folder"));
writeFileSync(join(root, "file.txt"), "x");

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

const BIN = "C:\\fake\\rclone.exe";
const CONF = "C:\\fake\\rclone.conf";

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
        ...over,
    };
}

function f_Remote(result: Partial<itfProcessResult>, requireError?: clsAppError) {
    const calls: string[][] = [];
    const overrides: Array<string | null | undefined> = [];
    const run: typRunRclone = async (_bin, args) => {
        assertAllowedCommand(args);
        calls.push([...args]);
        return f_Res(result);
    };
    const svc = new clsPathService({
        rcloneEnv: {
            require: async () => {
                if (requireError) throw requireError;
                return { binaryPath: BIN, configPath: CONF };
            },
            resolveConfigFor: async (o) => {
                overrides.push(o);
                return o ?? CONF;
            },
        },
        run,
    });
    return { svc, calls, overrides };
}

const local = () =>
    new clsPathService({
        rcloneEnv: {
            require: async () => {
                throw new clsAppError("RCLONE_NOT_FOUND");
            },
            resolveConfigFor: async () => null,
        },
    });

describe("로컬 probe (임시 폴더)", () => {
    it("폴더 → exists·isDirectory·readable", async () => {
        expect(await local().probe({ path: join(root, "folder") })).toMatchObject({
            kind: "local",
            exists: true,
            isDirectory: true,
            readable: true,
            isRoot: false,
            message: "폴더가 있습니다.",
        });
    });

    it("파일 → isDirectory false, 없음 → exists false", async () => {
        expect(await local().probe({ path: join(root, "file.txt") })).toMatchObject({
            exists: true,
            isDirectory: false,
            message: "파일입니다. 폴더를 지정하세요.",
        });
        expect(await local().probe({ path: join(root, "missing", "deep") })).toMatchObject({
            exists: false,
            message: "경로가 없습니다.",
        });
    });

    it("rclone이 없어도 로컬 probe는 된다", async () => {
        expect((await local().probe({ path: root })).exists).toBe(true);
    });

    it("드라이브 루트는 확인하되 isRoot + 경고", async () => {
        const drive = parse(root).root;
        const r = await local().probe({ path: drive });
        expect(r).toMatchObject({ exists: true, isDirectory: true, isRoot: true });
        expect(r.warnings.join("\n")).toContain("루트 전체");
    });

    it.each([
        ["상대 경로", "folder", "PATH_INVALID"],
        ["리눅스 경로", "/home/x", "PATH_INVALID"],
        ["빈 값", "  ", "VALIDATION"],
    ])("%s → %s", async (_label, path, code) => {
        await expect(local().probe({ path })).rejects.toMatchObject({ code });
    });

    it("응답이 없으면 시간 제한 메시지", async () => {
        const svc = new clsPathService({
            rcloneEnv: {
                require: async () => ({ binaryPath: BIN, configPath: null }),
                resolveConfigFor: async () => null,
            },
            stat: () => new Promise(() => undefined),
            localTimeoutMs: 50,
        });
        const r = await svc.probe({ path: "\\\\wsl.localhost\\Distro\\home\\x" });
        expect(r).toMatchObject({ kind: "unc", exists: false });
        expect(r.message).toContain("응답이 없습니다");
    });

    it("권한 없음(EACCES) → exists true, readable false", async () => {
        const svc = new clsPathService({
            rcloneEnv: {
                require: async () => ({ binaryPath: BIN, configPath: null }),
                resolveConfigFor: async () => null,
            },
            stat: async () => {
                throw Object.assign(new Error("denied"), { code: "EACCES" });
            },
        });
        expect(await svc.probe({ path: "C:\\fake\\secret" })).toMatchObject({
            exists: true,
            readable: false,
        });
    });

    it("WSL /mnt UNC는 Windows 경로 권장 경고", async () => {
        const svc = new clsPathService({
            rcloneEnv: {
                require: async () => ({ binaryPath: BIN, configPath: null }),
                resolveConfigFor: async () => null,
            },
            stat: async () => ({ isDirectory: () => true }),
            openDir: async () => ({ close: async () => undefined }),
        });
        const r = await svc.probe({ path: "\\\\wsl.localhost\\Distro\\mnt\\d\\data" });
        expect(r.exists).toBe(true);
        expect(r.warnings.join("\n")).toContain("D:\\...");
    });
});

describe("remote probe (가짜 rclone)", () => {
    const parent = { stdout: readFixture("lsjson-probe-parent", "stdout") };

    it("부모 목록에서 폴더·파일·없음·대소문자 차이를 구분한다", async () => {
        const { svc, calls } = f_Remote(parent);
        expect(await svc.probe({ path: "test-remote:base/sub" })).toMatchObject({
            kind: "remote",
            exists: true,
            isDirectory: true,
            readable: null,
        });
        expect(calls[0]!.slice(-2)).toEqual(["--", "test-remote:base"]);
        expect(calls[0]).toContain("--max-depth");
        expect(await svc.probe({ path: "test-remote:base/same.txt" })).toMatchObject({
            exists: true,
            isDirectory: false,
        });
        expect((await svc.probe({ path: "test-remote:base/none" })).exists).toBe(false);
        const near = await svc.probe({ path: "test-remote:base/SUB" });
        expect(near.exists).toBe(false);
        expect(near.message).toContain("'sub'");
    });

    it("exit 3(부모 없음) → exists false", async () => {
        const { svc } = f_Remote({
            exitCode: 3,
            stdout: "[",
            stderrTail: readFixture("lsjson-probe-missing-parent", "stderr"),
        });
        expect(await svc.probe({ path: "test-remote:missing/deep" })).toMatchObject({
            exists: false,
            message: "경로가 없습니다.",
        });
    });

    it("exit 1 + 토큰 오류 → RCLONE_FAILED + reconnect 안내", async () => {
        const { svc } = f_Remote({
            exitCode: 1,
            stderrTail: "2026/10/28 18:00:00 ERROR : couldn't fetch token: invalid_grant",
        });
        const err = await svc.probe({ path: "test-remote:a" }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(clsAppError);
        expect(err).toMatchObject({ code: "RCLONE_FAILED" });
        expect((err as clsAppError).message).toContain("rclone config reconnect test-remote:");
        expect((err as clsAppError).detail).toContain("couldn't fetch token");
    });

    it("remote 루트는 그 자체를 나열하고 isRoot", async () => {
        const { svc, calls } = f_Remote({ stdout: "[]" });
        const r = await svc.probe({ path: "test-remote:" });
        expect(r).toMatchObject({ exists: true, isDirectory: true, isRoot: true });
        expect(calls[0]!.at(-1)).toBe("test-remote:");
    });

    it("맨 앞 / remote는 부모도 절대 경로(rr:/)로 나열한다", async () => {
        const { svc, calls } = f_Remote({ stdout: "[]" });
        await svc.probe({ path: "test-remote:/a" });
        expect(calls[0]!.slice(-2)).toEqual(["--", "test-remote:/"]);
    });

    it("configPath override를 그대로 넘긴다", async () => {
        const { svc, calls, overrides } = f_Remote(parent);
        await svc.probe({ path: "test-remote:base/sub", configPath: "C:\\fake\\other.conf" });
        expect(overrides).toEqual(["C:\\fake\\other.conf"]);
        expect(calls[0]).toContain("C:\\fake\\other.conf");
    });

    it("rclone 문제(require 실패)는 그 코드로 실패한다", async () => {
        const { svc } = f_Remote(parent, new clsAppError("RCLONE_NOT_FOUND"));
        await expect(svc.probe({ path: "test-remote:a" })).rejects.toMatchObject({
            code: "RCLONE_NOT_FOUND",
        });
    });

    it("부모 목록이 상한을 넘어 잘리면 RCLONE_FAILED(목록이 너무 큼)", async () => {
        const { svc } = f_Remote({ ...parent, stdoutTruncated: true });
        const err = await svc.probe({ path: "test-remote:base/sub" }).catch((e: unknown) => e);
        expect(err).toMatchObject({ code: "RCLONE_FAILED" });
        expect((err as clsAppError).message).toContain("너무 커서");
    });

    it("시간 초과 → RCLONE_FAILED", async () => {
        const { svc } = f_Remote({ timedOut: true, exitCode: null });
        await expect(svc.probe({ path: "test-remote:a" })).rejects.toMatchObject({
            code: "RCLONE_FAILED",
        });
    });
});

function f_P(s: string) {
    const r = parsePath(s);
    if (!r.ok) throw new Error(s);
    return r.path;
}

describe("remoteParentOf", () => {
    it("경계값", () => {
        expect(remoteParentOf(f_P("rr:a/b"))).toEqual({ parent: "rr:a", name: "b" });
        expect(remoteParentOf(f_P("rr:a"))).toEqual({ parent: "rr:", name: "a" });
        expect(remoteParentOf(f_P("rr:/a//b/"))).toEqual({ parent: "rr:/a", name: "b" });
        expect(remoteParentOf(f_P("rr:/a/b"))).toEqual({ parent: "rr:/a", name: "b" });
        expect(remoteParentOf(f_P("rr:/a"))).toEqual({ parent: "rr:/", name: "a" });
        expect(remoteParentOf(f_P("rr:"))).toBeNull();
        expect(remoteParentOf(f_P("C:\\a"))).toBeNull();
    });
});

function f_Never(): Promise<never> {
    return new Promise<never>(() => undefined);
}

describe("clsFsGate (응답 없는 fs 호출 제한)", () => {
    const never = f_Never;

    it("시간 초과 후 같은 root는 fs 호출 없이 거부, 다른 root는 통과", async () => {
        const gate = new clsFsGate();
        expect(await gate.run("e:", never, 10)).toBe(FS_TIMEOUT);
        let called = false;
        expect(
            gate.run(
                "e:",
                async () => {
                    called = true;
                    return 1;
                },
                10,
            ),
        ).toBeNull();
        expect(called).toBe(false);
        expect(await gate.run("f:", async () => 2, 10)).toBe(2);
        expect(gate.pendingCount).toBe(1);
    });

    it("끝나지 않은 호출이 maxPending(2)이면 세 번째는 거부", () => {
        const gate = new clsFsGate();
        void gate.run("a:", never, 60_000);
        void gate.run("b:", never, 60_000);
        expect(gate.run("c:", async () => 1, 10)).toBeNull();
        expect(gate.pendingCount).toBe(2);
    });

    it("늦게라도 끝나면 다시 허용, 늦은 오류는 버린다", async () => {
        const gate = new clsFsGate();
        const ctl: { fail?: (e: Error) => void } = {};
        const late = new Promise<number>((_r, j) => {
            ctl.fail = j;
        });
        expect(await gate.run("e:", () => late, 10)).toBe(FS_TIMEOUT);
        expect(gate.run("e:", async () => 1, 10)).toBeNull();
        ctl.fail?.(new Error("late"));
        await new Promise((r) => setTimeout(r, 0));
        expect(gate.pendingCount).toBe(0);
        expect(await gate.run("e:", async () => 3, 10)).toBe(3);
    });

    it("동기 예외도 오류로 돌려주고 수를 되돌린다", async () => {
        const gate = new clsFsGate();
        await expect(
            gate.run(
                "e:",
                () => {
                    throw new Error("sync");
                },
                10,
            ),
        ).rejects.toThrow("sync");
        expect(gate.pendingCount).toBe(0);
    });

    it("probe: 응답 없는 UNC를 다시 확인하면 stat을 부르지 않고 안내한다", async () => {
        let stats = 0;
        const svc = new clsPathService({
            rcloneEnv: {
                require: async () => ({ binaryPath: BIN, configPath: null }),
                resolveConfigFor: async () => null,
            },
            stat: () => {
                stats += 1;
                return never();
            },
            localTimeoutMs: 20,
        });
        const first = await svc.probe({ path: "\\\\wsl.localhost\\Distro\\home\\x" });
        expect(first.message).toContain("응답이 없습니다");
        const second = await svc.probe({ path: "\\\\wsl.localhost\\Distro\\home\\y" });
        expect(second.exists).toBe(false);
        expect(second.message).toContain("이전 확인이 아직 끝나지 않았습니다");
        expect(stats).toBe(1);
    });
});
