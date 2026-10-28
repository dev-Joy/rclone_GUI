// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { decodeWslOutput, parseWslDistroList } from "@/main/parsers/wsl-parser";
import { clsProcessSpawnError, type itfProcessResult } from "@/main/rclone/process";
import { clsWslService } from "@/main/services/wsl";

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
        ...over,
    };
}

describe("decodeWslOutput", () => {
    it("BOM 있는 UTF-16LE", () => {
        const bytes = Buffer.from("\uFEFFUbuntu\r\nDebian 12\r\n", "utf16le");
        expect(parseWslDistroList(decodeWslOutput(bytes))).toEqual(["Ubuntu", "Debian 12"]);
    });

    it("BOM 없는 UTF-16LE, 홀수 길이는 UTF-16으로 보지 않는다", () => {
        const bytes = Buffer.from("Ubuntu-22.04\r\n", "utf16le");
        expect(decodeWslOutput(bytes)).toBe("Ubuntu-22.04\r\n");
        const odd = Buffer.concat([bytes, Buffer.from([0x41])]);
        expect(decodeWslOutput(odd)).toContain("\u0000");
    });

    it("BOM 없는 한글 UTF-16LE 오류 출력(끝이 0A 00)", () => {
        const msg = "Linux용 Windows 하위 시스템에 설치된 배포판이 없습니다.\r\n";
        expect(decodeWslOutput(Buffer.from(msg, "utf16le"))).toBe(msg);
        // 한글만 있어 홀수 위치 0바이트 비율이 낮아도 끝의 0A 00 으로 UTF-16LE로 판정한다
        expect(decodeWslOutput(Buffer.from("배포판 없음\n", "utf16le"))).toBe("배포판 없음\n");
    });

    it("UTF-8 (WSL_UTF8=1)", () => {
        expect(decodeWslOutput(Buffer.from("Ubuntu\nMy Distro\n", "utf8"))).toBe(
            "Ubuntu\nMy Distro\n",
        );
        expect(decodeWslOutput(new Uint8Array())).toBe("");
        // UTF-8 한글은 끝이 0A 00 이 아니므로 UTF-8로 읽는다
        expect(decodeWslOutput(Buffer.from("우분투\n", "utf8"))).toBe("우분투\n");
    });
});

describe("parseWslDistroList", () => {
    it("NUL·BOM·빈 줄·중복 제거, 공백·하이픈 이름 그대로, 입력 순서 유지", () => {
        expect(parseWslDistroList("\uFEFFb-1\u0000\r\n\r\n  My Distro \r\nb-1\na\n")).toEqual([
            "b-1",
            "My Distro",
            "a",
        ]);
        expect(parseWslDistroList("")).toEqual([]);
    });
});

describe("clsWslService", () => {
    it("정상: wsl.exe -l -q 를 System32에서 실행", async () => {
        const calls: Array<{ file: string; args: readonly string[] }> = [];
        const svc = new clsWslService({
            env: { SystemRoot: "C:\\FakeWin" },
            run: async (file, args) => {
                calls.push({ file, args });
                return f_Res({ stdoutBytes: Buffer.from("\uFEFFUbuntu\r\n", "utf16le") });
            },
        });
        expect(await svc.listDistros()).toEqual({ distros: ["Ubuntu"] });
        expect(calls).toEqual([{ file: "C:\\FakeWin\\System32\\wsl.exe", args: ["-l", "-q"] }]);
    });

    it("wsl.exe 없음(ENOENT) → WSL_NOT_AVAILABLE", async () => {
        const svc = new clsWslService({
            env: {},
            run: async () => {
                throw new clsProcessSpawnError("ENOENT", "없음");
            },
        });
        await expect(svc.listDistros()).rejects.toMatchObject({ code: "WSL_NOT_AVAILABLE" });
    });

    it("exit≠0 → WSL_NOT_AVAILABLE, 원문은 detail로", async () => {
        const svc = new clsWslService({
            env: {},
            run: async () =>
                f_Res({ exitCode: 1, stdoutBytes: Buffer.from("no distro\r\n", "utf16le") }),
        });
        await expect(svc.listDistros()).rejects.toMatchObject({
            code: "WSL_NOT_AVAILABLE",
            detail: "no distro",
        });
    });
});
