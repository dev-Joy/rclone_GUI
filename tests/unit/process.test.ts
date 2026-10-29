// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsCommandBlockedError } from "@/main/rclone/command-builder";
import { buildRcloneEnv, clsProcessSpawnError, runProcess, runRclone } from "@/main/rclone/process";

const NODE = process.execPath;

function f_Node(script: string, extra: Partial<Parameters<typeof runProcess>[2]> = {}) {
    return runProcess(NODE, ["-e", script], { timeoutMs: 10_000, ...extra });
}

function f_Alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe("runProcess", () => {
    it("종료 코드를 그대로 돌려주고 reject 하지 않는다", async () => {
        expect((await f_Node("process.exit(0)")).exitCode).toBe(0);
        const r = await f_Node("process.stderr.write('bad'); process.exit(3)");
        expect(r).toMatchObject({ exitCode: 3, timedOut: false, canceled: false });
        expect(r.stderrTail).toBe("bad");
    });

    it("청크 경계·CRLF·마지막 줄 개행 없음도 줄 단위로 넘긴다", async () => {
        const lines: string[] = [];
        const script = [
            "const w = (s) => new Promise((r) => process.stdout.write(s, r));",
            "(async () => { await w('ab'); await new Promise((r) => setTimeout(r, 30));",
            "await w('c\\r\\nd\\n\\ne'); })();",
        ].join("\n");
        const r = await f_Node(script, { onStdoutLine: (l) => lines.push(l) });
        expect(lines).toEqual(["abc", "d", "", "e"]);
        expect(r.stdout).toBe("abc\r\nd\n\ne");
    });

    it("UTF-8 멀티바이트가 청크 사이에서 잘려도 깨지지 않는다", async () => {
        const lines: string[] = [];
        const script = [
            "const b = Buffer.from('한글 줄\\n', 'utf8');",
            "process.stdout.write(b.subarray(0, 2));",
            "setTimeout(() => process.stdout.write(b.subarray(2)), 30);",
        ].join("\n");
        await f_Node(script, { onStdoutLine: (l) => lines.push(l) });
        expect(lines).toEqual(["한글 줄"]);
    });

    it("collectStdout:false → 줄 콜백은 모두 오고 stdout은 모으지 않는다", async () => {
        const lines: string[] = [];
        const r = await f_Node(
            "for (let i = 0; i < 3000; i++) process.stdout.write('line' + i + '\\n')",
            {
                collectStdout: false,
                maxStdoutBytes: 100,
                onStdoutLine: (l) => lines.push(l),
            },
        );
        expect(lines).toHaveLength(3000);
        expect(lines.at(-1)).toBe("line2999");
        expect(r).toMatchObject({ stdout: "", stdoutTruncated: false, exitCode: 0 });
        expect(r.stdoutBytes).toHaveLength(0);
    });

    it("stderr는 뒤쪽만 남기고, stdout 상한을 넘으면 truncated", async () => {
        const r = await f_Node(
            "process.stderr.write('x'.repeat(30000) + 'END'); process.stdout.write('y'.repeat(5000))",
            { stderrTailBytes: 100, maxStdoutBytes: 1000 },
        );
        expect(r.stderrTail).toHaveLength(100);
        expect(r.stderrTail.endsWith("END")).toBe(true);
        expect(r.stdoutTruncated).toBe(true);
        expect(r.stdoutBytes).toHaveLength(1000);
    });

    it("시간 초과 시 자식 프로세스 트리까지 종료한다", async () => {
        const script = [
            "const { spawn } = require('node:child_process');",
            "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', shell: false });",
            "console.log(c.pid); setInterval(() => {}, 1000);",
        ].join("\n");
        let grandchild = 0;
        const r = await f_Node(script, {
            timeoutMs: 1500,
            onStdoutLine: (l) => {
                grandchild = Number(l);
            },
        });
        expect(r.timedOut).toBe(true);
        expect(grandchild).toBeGreaterThan(0);
        // 트리 종료는 Windows(taskkill /T)에서만 보장한다
        await new Promise((res) => setTimeout(res, 300));
        expect(process.platform === "win32" && f_Alive(grandchild)).toBe(false);
    });

    it("AbortSignal로 취소한다", async () => {
        const ac = new AbortController();
        const pending = f_Node("setInterval(() => {}, 1000)", { signal: ac.signal });
        setTimeout(() => ac.abort(), 300);
        const r = await pending;
        expect(r).toMatchObject({ canceled: true, timedOut: false });
    });

    it("이미 취소된 signal이면 실행하지 않는다(closed: true, onSpawn 없음)", async () => {
        const ac = new AbortController();
        ac.abort();
        let spawned = 0;
        const r = await f_Node("process.exit(0)", {
            signal: ac.signal,
            onSpawn: () => {
                spawned += 1;
            },
        });
        expect(r).toMatchObject({ canceled: true, exitCode: null, closed: true });
        expect(spawned).toBe(0);
    });

    it("timeoutMs null이면 시간 제한 없이 끝날 때까지 기다린다(Infinity 즉시 실행 방지)", async () => {
        const r = await f_Node("setTimeout(() => process.exit(0), 300)", { timeoutMs: null });
        expect(r).toMatchObject({ exitCode: 0, timedOut: false, closed: true });
        expect(r.durationMs).toBeGreaterThanOrEqual(250);
        const inf = await f_Node("setTimeout(() => process.exit(0), 100)", {
            timeoutMs: Number.POSITIVE_INFINITY,
        });
        expect(inf).toMatchObject({ exitCode: 0, timedOut: false });
    });

    it("onSpawn은 pid와 함께 한 번 부르고, 정상 종료는 closed: true", async () => {
        const pids: number[] = [];
        const r = await f_Node("console.log(process.pid)", {
            onSpawn: (pid) => pids.push(pid),
            onStdoutLine: () => undefined,
        });
        expect(pids).toHaveLength(1);
        expect(r.stdout.trim()).toBe(String(pids[0]));
        expect(r.closed).toBe(true);
        const ac = new AbortController();
        const pending = f_Node("setInterval(() => {}, 1000)", {
            signal: ac.signal,
            timeoutMs: null,
        });
        setTimeout(() => ac.abort(), 300);
        expect((await pending).closed).toBe(true);
    });

    it("없는 실행 파일 → clsProcessSpawnError(ENOENT)", async () => {
        await expect(
            runProcess("C:\\fake\\no-such-rclone.exe", ["version"], { timeoutMs: 5000 }),
        ).rejects.toMatchObject({ name: "clsProcessSpawnError", errno: "ENOENT" });
        await expect(
            runProcess("C:\\fake\\no-such-rclone.exe", [], { timeoutMs: 5000 }),
        ).rejects.toBeInstanceOf(clsProcessSpawnError);
    });
});

describe("buildRcloneEnv", () => {
    it("RCLONE_* 는 지우고 CONFIG_PASS·PASSWORD_COMMAND만 남긴다", () => {
        const { env, removed } = buildRcloneEnv({
            PATH: "C:\\fake",
            RCLONE_DELETE_EXCLUDED: "true",
            rclone_dump: "headers",
            RCLONE_CONFIG: "C:\\fake\\rclone.conf",
            RCLONE_CONFIG_PASS: "x",
            Rclone_Password_Command: "y",
        });
        expect(env).toEqual({
            PATH: "C:\\fake",
            RCLONE_CONFIG_PASS: "x",
            Rclone_Password_Command: "y",
        });
        expect(removed).toEqual(["RCLONE_CONFIG", "RCLONE_DELETE_EXCLUDED", "rclone_dump"]);
    });
});

describe("runRclone", () => {
    it("허용하지 않은 명령·차단 옵션은 실행 전에 거부한다", async () => {
        await expect(
            runRclone(NODE, ["config", "show"], { timeoutMs: 1000 }),
        ).rejects.toBeInstanceOf(clsCommandBlockedError);
        await expect(
            runRclone(NODE, ["sync", "--delete-excluded", "--", "a", "b"], { timeoutMs: 1000 }),
        ).rejects.toBeInstanceOf(clsCommandBlockedError);
    });

    it("명령줄이 Windows 한도를 넘으면 실행 전에 VALIDATION", async () => {
        const args = [
            "lsjson",
            ...Array.from({ length: 700 }, () => ["--exclude", "x".repeat(40)]).flat(),
            "--",
            "a",
        ];
        await expect(runRclone(NODE, args, { timeoutMs: 1000 })).rejects.toMatchObject({
            code: "VALIDATION",
        });
    });
});
