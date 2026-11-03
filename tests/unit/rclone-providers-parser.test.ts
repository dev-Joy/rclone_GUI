/**
 * providers JSON·rc 질문·redacted 출력 파서 테스트 (INT-006 T-02·T-05).
 * 실제 rclone v1.75.1 출력 fixture를 쓴다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    parseProviderOption,
    parseProvidersJson,
    parseQuestionOption,
} from "@/main/parsers/rclone-providers-parser";
import { readFixture } from "./fixtures";

const providers = parseProvidersJson(readFixture("config-providers", "stdout"));

describe("parseProvidersJson (실제 rclone 1.75.1 config providers)", () => {
    it("69종을 읽고 이름순으로 돌려준다", () => {
        expect(providers).toHaveLength(69);
        expect(providers.map((p) => p.type)).toEqual(providers.map((p) => p.type).toSorted());
    });

    it("drive는 OAuth이고 client_id·token은 비밀 옵션이다", () => {
        const drive = providers.find((p) => p.type === "drive")!;
        expect(drive.oauth).toBe(true);
        const token = drive.options.find((o) => o.name === "token")!;
        expect(token.secret).toBe(true);
        expect(token.advanced).toBe(true);
        expect(drive.options.find((o) => o.name === "client_id")!.secret).toBe(true);
    });

    it("sftp는 pass(IsPassword)·host(Sensitive)를 비밀로 본다", () => {
        const sftp = providers.find((p) => p.type === "sftp")!;
        expect(sftp.oauth).toBe(false);
        expect(sftp.options.find((o) => o.name === "pass")!.secret).toBe(true);
        expect(sftp.options.find((o) => o.name === "host")!.secret).toBe(true);
        expect(sftp.options.find((o) => o.name === "port")!.secret).toBe(false);
    });

    it("alias의 remote는 필수다", () => {
        const alias = providers.find((p) => p.type === "alias")!;
        const remote = alias.options.find((o) => o.name === "remote")!;
        expect(remote.required).toBe(true);
        expect(remote.kind).toBe("string");
    });

    it("Exclusive 선택지는 enum과 선택지로 만든다(azureblob delete_snapshots)", () => {
        const azure = providers.find((p) => p.type === "azureblob")!;
        const snap = azure.options.find((o) => o.name === "delete_snapshots")!;
        expect(snap.kind).toBe("enum");
        expect(snap.exclusive).toBe(true);
        expect(snap.choices.map((c) => c.value)).toEqual(["", "include", "only"]);
    });

    it("숨김(Hide != 0) 옵션은 폼에 넣지 않는다", () => {
        // config providers fixture에서 Hide가 0이 아닌 옵션이 있는 종류를 직접 확인한다
        const raw = JSON.parse(readFixture("config-providers", "stdout")) as Array<{
            Prefix?: string;
            Options?: Array<{ Hide?: number; Name: string }>;
        }>;
        let hiddenCount = 0;
        for (const p of raw) {
            const hidden = new Set(
                (p.Options ?? []).filter((o) => (o.Hide ?? 0) !== 0).map((o) => o.Name),
            );
            hiddenCount += hidden.size;
            const parsed = providers.find((x) => x.type === p.Prefix);
            if (!parsed || hidden.size === 0) continue;
            expect(parsed.options.some((o) => hidden.has(o.name))).toBe(false);
        }
        expect(hiddenCount).toBeGreaterThan(0);
    });

    it("필수 필드가 없는 종류는 그 종류만 뺀다", () => {
        const out = parseProvidersJson(
            JSON.stringify([
                { Prefix: "ok", Name: "OK", Options: [] },
                { Name: "no-prefix", Options: [] },
                { Prefix: "no-name", Options: [] },
            ]),
        );
        expect(out.map((p) => p.type)).toEqual(["ok"]);
    });

    it("형식이 다르면 RCLONE_PARSE_ERROR", () => {
        expect(() => parseProvidersJson("not json")).toThrow(/해석/);
        expect(() => parseProvidersJson("{}")).toThrow(/형식/);
    });
});

describe("rc 질문 Option 파서", () => {
    it("Drive 첫 질문(bool)을 화면 정의로 바꾼다", () => {
        const text = readFixture("config-rcd-requests", "stdout");
        const objects = [...text.matchAll(/\{[\s\S]*?\n\}/g)].map(
            (m) => JSON.parse(m[0]) as { State?: string; Option?: unknown },
        );
        const raw = objects.find((o) => o.State === "client_id_warning")!;
        const o = parseQuestionOption(raw.Option)!;
        expect(o.name).toBe("config_shared_client_id");
        expect(o.kind).toBe("bool");
        expect(o.defaultText).toBe("false");
        expect(o.exclusive).toBe(true);
        expect(o.help).toContain("shared Google Drive client_id");
    });

    it("알 수 없는 Option은 null", () => {
        expect(parseProviderOption({ Hide: 2, Name: "hidden" })).toBeNull();
        expect(parseQuestionOption({ Name: "" })).toBeNull();
    });
});
