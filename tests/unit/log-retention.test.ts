// ========== External imports ==========
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    deleteRunLogs,
    pruneRunLogs,
    readRunLogTail,
    runLogPath,
} from "@/main/services/log-retention";
import { fixtureLines } from "./fixtures";

const NAME_A = "run-20261001-101010-1a2b3c4d-5e6f7a8b.log";
const NAME_B = "run-20261028-101010-1a2b3c4d-00000001.log";
const NAME_KEEP = "run-20261001-101010-1a2b3c4d-0000000f.log";
const NOW = new Date("2026-10-29T00:00:00.000Z");
const DAY = 86_400_000;

let dir = "";

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-logret-"));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function f_Write(name: string, text: string, ageDays: number): void {
    const p = join(dir, name);
    writeFileSync(p, text);
    const t = new Date(NOW.getTime() - ageDays * DAY);
    utimesSync(p, t, t);
}

describe("runLogPath", () => {
    it("실행 로그 이름만, logs 폴더 안만 허용(경로 탈출·다른 파일 거부)", () => {
        expect(runLogPath(dir, NAME_A)).toBe(join(dir, NAME_A));
        for (const bad of [
            "app.log",
            `../${NAME_A}`,
            `..\\${NAME_A}`,
            `sub/${NAME_A}`,
            `${NAME_A}.txt`,
            "run-20261001-101010-1A2B3C4D-5e6f7a8b.log",
            "",
        ]) {
            expect(runLogPath(dir, bad)).toBeNull();
        }
    });
});

describe("pruneRunLogs / deleteRunLogs", () => {
    it("보관 일수가 지난 실행 로그만 지우고 keep·다른 파일은 남긴다", async () => {
        f_Write(NAME_A, "old", 40);
        f_Write(NAME_B, "new", 1);
        f_Write(NAME_KEEP, "running", 40);
        f_Write("app.log", "app", 400);
        expect(await pruneRunLogs(dir, 30, NOW, new Set([NAME_KEEP]))).toBe(1);
        expect(existsSync(join(dir, NAME_A))).toBe(false);
        expect(existsSync(join(dir, NAME_B))).toBe(true);
        expect(existsSync(join(dir, NAME_KEEP))).toBe(true);
        expect(existsSync(join(dir, "app.log"))).toBe(true);
    });

    it("폴더가 없으면 0", async () => {
        expect(await pruneRunLogs(join(dir, "none"), 30, NOW, new Set())).toBe(0);
    });

    it("deleteRunLogs: 이름이 맞는 것만 지운다", async () => {
        f_Write(NAME_A, "a", 0);
        f_Write("app.log", "app", 0);
        expect(await deleteRunLogs(dir, [NAME_A, "app.log", "../x", NAME_B])).toBe(1);
        expect(existsSync(join(dir, "app.log"))).toBe(true);
    });
});

describe("readRunLogTail", () => {
    it("전체를 읽어 줄마다 해석한다(머리말·rclone JSON 줄)", async () => {
        const lines = [
            "# rcloneGUI 실행 로그",
            "# args: copy <원본> <대상>",
            ...fixtureLines("copy-real"),
        ];
        f_Write(NAME_A, `${lines.join("\n")}\n`, 0);
        const v = await readRunLogTail(dir, NAME_A, 1024 * 1024);
        expect(v).toMatchObject({ fileName: NAME_A, exists: true, truncated: false });
        expect(v.lines).toHaveLength(lines.length);
        expect(v.lines[0]!.message).toBe("# rcloneGUI 실행 로그");
        expect(v.lines.some((l) => l.at !== "")).toBe(true);
    });

    it("끝부분만 읽으면 잘린 첫 줄을 버린다", async () => {
        const text = Array.from(
            { length: 100 },
            (_, i) => `# line ${String(i).padStart(3, "0")}`,
        ).join("\n");
        f_Write(NAME_A, text, 0);
        const v = await readRunLogTail(dir, NAME_A, 50);
        expect(v.truncated).toBe(true);
        expect(v.sizeBytes).toBe(Buffer.byteLength(text));
        expect(v.lines.at(-1)!.message).toBe("# line 099");
        for (const l of v.lines) expect(l.message).toMatch(/^# line \d{3}$/);
    });

    it("없는 파일·잘못된 이름은 exists:false", async () => {
        expect((await readRunLogTail(dir, NAME_B, 100)).exists).toBe(false);
        expect((await readRunLogTail(dir, "../secret.log", 100)).exists).toBe(false);
    });

    it("비밀값은 가린다", async () => {
        f_Write(NAME_A, "token = abc123\n", 0);
        const v = await readRunLogTail(dir, NAME_A, 100);
        expect(v.lines[0]!.message).not.toContain("abc123");
    });
});
