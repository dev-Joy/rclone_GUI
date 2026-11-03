/**
 * rc 시작 줄·응답·redacted 출력 파서 테스트 (INT-006 T-02·T-05).
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    isRedactedValue,
    parseRcConfigResponse,
    parseRcdStartLine,
    parseRedactedConfig,
} from "@/main/parsers/rclone-config-parser";
import { collectSecretValues, redactSecrets, redactedStderrTail } from "@/main/lib/secret-redact";
import { readFixture } from "./fixtures";

describe("parseRcdStartLine", () => {
    it("127.0.0.1의 실제 포트를 읽는다", () => {
        expect(parseRcdStartLine("NOTICE: Serving remote control on http://127.0.0.1:53216/")).toBe(
            53216,
        );
    });

    it("다른 주소·형식은 null", () => {
        expect(parseRcdStartLine("Serving remote control on http://0.0.0.0:5572/")).toBeNull();
        expect(parseRcdStartLine("hello")).toBeNull();
    });
});

describe("parseRcConfigResponse", () => {
    it("질문 응답의 State·Option·Error를 읽는다", () => {
        const text = readFixture("config-rcd-requests", "stdout");
        const objects = [...text.matchAll(/\{[\s\S]*?\n\}/g)].map(
            (m) => JSON.parse(m[0]) as unknown,
        );
        const q = objects.map(parseRcConfigResponse).find((r) => r.state === "client_id_warning")!;
        expect(q.error).toBe("");
        expect(q.option).not.toBeNull();
    });

    it("빈 성공 응답은 빈 값", () => {
        expect(parseRcConfigResponse({})).toEqual({ state: "", option: null, error: "" });
        expect(parseRcConfigResponse(null)).toEqual({ state: "", option: null, error: "" });
    });
});

describe("parseRedactedConfig (실제 rclone 1.75.1 config redacted)", () => {
    it("종류를 읽고 가린 값은 XXX로 남긴다", () => {
        const r = parseRedactedConfig(readFixture("config-redacted", "stdout"));
        expect(r.type).toBe("sftp");
        expect(r.entries).toEqual({ host: "XXX", pass: "XXX", user: "XXX" });
        expect(isRedactedValue(r.entries.host!)).toBe(true);
    });

    it("주석·섹션 줄은 건너뛴다", () => {
        const r = parseRedactedConfig(
            ["[r1]", "type = local", "nounc = true", "### Double check", "# comment"].join("\r\n"),
        );
        expect(r).toEqual({ type: "local", entries: { nounc: "true" } });
    });
});

describe("비밀 값 가림(FR-16)", () => {
    it("3자 이상 값을 ***로 바꾸고 짧은 값은 그대로 둔다", () => {
        expect(redactSecrets("pass=secret-pass host=x", ["secret-pass", "x"])).toBe(
            "pass=*** host=x",
        );
    });

    it("값 목록을 중복 없이 모은다", () => {
        expect(collectSecretValues({ a: "one", b: "" }, { c: "two", d: "one" })).toEqual([
            "one",
            "two",
        ]);
    });

    it("stderr 끝부분만 남긴다", () => {
        const text = "a".repeat(100) + " secret-pass";
        const out = redactedStderrTail(text, ["secret-pass"], 20);
        expect(out).not.toContain("secret-pass");
        expect(out.length).toBeLessThanOrEqual(20);
    });
});
