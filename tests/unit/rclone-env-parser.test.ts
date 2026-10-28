// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    compareVersions,
    hintForRcloneError,
    MIN_RCLONE_VERSION,
    parseConfigFileOutput,
    parseListRemotes,
    parseRcloneVersion,
    summarizeStderr,
    VERIFIED_RCLONE_VERSION,
} from "@/main/parsers/rclone-env-parser";
import { readFixture } from "./fixtures";

describe("parseRcloneVersion", () => {
    it("실제 rclone 1.75.1 출력에서 버전·OS·아키텍처를 읽는다", () => {
        expect(parseRcloneVersion(readFixture("version", "stdout"))).toEqual({
            major: 1,
            minor: 75,
            patch: 1,
            text: "v1.75.1",
            os: "windows",
            arch: "amd64",
        });
    });

    it("접미사(beta) 원문을 남기고 숫자만 비교에 쓴다", () => {
        const v = parseRcloneVersion("rclone v1.66.0-beta.7\r\n- os/type: windows\r\n");
        expect(v).toMatchObject({ major: 1, minor: 66, patch: 0, text: "v1.66.0-beta.7" });
        expect(v?.arch).toBeNull();
    });

    it.each(["", "garbage", "rclone version 1.2", "Rclone v1.75.1"])("%j 는 null", (s) => {
        expect(parseRcloneVersion(s)).toBeNull();
    });
});

describe("compareVersions", () => {
    it("1.64.9 < 1.65.0 ≤ 1.75.1 < 1.76.0", () => {
        expect(compareVersions("1.64.9", MIN_RCLONE_VERSION)).toBeLessThan(0);
        expect(compareVersions("v1.65.0", MIN_RCLONE_VERSION)).toBe(0);
        expect(compareVersions("1.75.1", MIN_RCLONE_VERSION)).toBeGreaterThan(0);
        expect(compareVersions("1.76.0", VERIFIED_RCLONE_VERSION)).toBeGreaterThan(0);
        expect(compareVersions("1.75.10", "1.75.9")).toBeGreaterThan(0);
    });

    it("객체 입력과 해석 불가 값", () => {
        const v = parseRcloneVersion(readFixture("version", "stdout"))!;
        expect(compareVersions(v, VERIFIED_RCLONE_VERSION)).toBe(0);
        expect(compareVersions("x", "0.0.0")).toBeLessThan(0);
    });
});

describe("parseConfigFileOutput (실제 출력)", () => {
    it("있는 파일: stored at → exists true", () => {
        expect(parseConfigFileOutput(readFixture("config-file", "stdout"))).toEqual({
            path: "<TMP>\\rclone.conf",
            exists: true,
        });
    });

    it("없는 파일: doesn't exist, but rclone will use this path → exists false", () => {
        expect(parseConfigFileOutput(readFixture("config-file-missing", "stdout"))).toEqual({
            path: "<TMP>\\none.conf",
            exists: false,
        });
    });

    it("CRLF 허용, 형식이 다르면 null", () => {
        expect(parseConfigFileOutput("Configuration file is stored at:\r\nC:\\x.conf\r\n")).toEqual(
            { path: "C:\\x.conf", exists: true },
        );
        expect(parseConfigFileOutput("")).toBeNull();
        expect(parseConfigFileOutput("Something else:\nC:\\x")).toBeNull();
        expect(parseConfigFileOutput("Configuration file is stored at:\n")).toBeNull();
    });
});

describe("parseListRemotes (실제 출력)", () => {
    it("설정 순서와 상관없이 정렬하고 끝의 ':'를 뗀다", () => {
        expect(parseListRemotes(readFixture("listremotes", "stdout"))).toEqual([
            "probe-alias",
            "probe-b",
        ]);
    });

    it("없는 설정 파일: stdout 비어 있음, stderr NOTICE, exit 0", () => {
        expect(readFixture("listremotes-missing-conf", "exit").trim()).toBe("0");
        expect(readFixture("listremotes-missing-conf", "stderr")).toContain("not found");
        expect(parseListRemotes(readFixture("listremotes-missing-conf", "stdout"))).toEqual([]);
    });

    it("빈 줄·공백·중복 제거", () => {
        expect(parseListRemotes("b:\r\n\r\n  a:  \nb:\n")).toEqual(["a", "b"]);
    });
});

describe("summarizeStderr", () => {
    it("날짜 접두어를 떼고 마지막 줄만 남긴다", () => {
        const out = summarizeStderr(readFixture("lsjson-probe-missing-parent", "stderr"));
        expect(out.split("\n")).toEqual([
            "ERROR : error listing: directory not found",
            "NOTICE: Failed to lsjson with 2 errors: last error was: error in ListJSON: directory not found",
        ]);
    });

    it("기본 5줄, 토큰 값은 가린다", () => {
        const lines = Array.from({ length: 8 }, (_v, i) => `2026/10/28 18:00:00 ERROR : line${i}`);
        lines.push('2026/10/28 18:00:00 ERROR : token = {"access_token":"ya29.secret"}');
        const out = summarizeStderr(lines.join("\r\n"));
        expect(out.split("\n")).toHaveLength(5);
        expect(out).not.toContain("ya29");
        expect(out.startsWith("ERROR : line4")).toBe(true);
        expect(summarizeStderr("a\nb\nc", 2)).toBe("b\nc");
    });
});

describe("hintForRcloneError", () => {
    it("토큰 만료 → reconnect 안내(remote 이름 포함)", () => {
        expect(
            hintForRcloneError("Failed to create file system: couldn't fetch token", "test-remote"),
        ).toContain("rclone config reconnect test-remote:");
        expect(hintForRcloneError("oauth2: invalid_grant", null)).toContain("<remote>:");
    });

    it("없는 섹션 / 암호화 설정 / 해당 없음", () => {
        expect(hintForRcloneError('didn\'t find section in config file ("x")', "x")).toContain(
            "remote가 없습니다",
        );
        expect(hintForRcloneError("unable to decrypt configuration", null)).toContain(
            "RCLONE_CONFIG_PASS",
        );
        expect(hintForRcloneError("directory not found", null)).toBeNull();
    });
});
