// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { PATH_MAX_INPUT } from "@/shared/option-limits";
import {
    composeRemotePath,
    isRemoteSegmentName,
    joinRemotePath,
    normalizeRemoteBasePath,
} from "@/shared/remote-path";

function f_Base(name: string, raw: string): string {
    const r = normalizeRemoteBasePath(name, raw);
    if (!r.ok) throw new Error(r.message);
    return r.basePath;
}

describe("normalizeRemoteBasePath", () => {
    it("빈 값은 리모트 루트, 끝 / 와 중복 구분자를 정리한다", () => {
        expect(f_Base("test-remote", "")).toBe("");
        expect(f_Base("test-remote", "   ")).toBe("");
        expect(f_Base("test-remote", "base")).toBe("base");
        expect(f_Base("test-remote", " base/ ")).toBe("base");
        expect(f_Base("test-remote", "a//b")).toBe("a/b");
        expect(f_Base("test-remote", "/base/")).toBe("/base");
        expect(f_Base("test-remote", "/")).toBe("/");
        expect(f_Base("test-remote", "한글 폴더")).toBe("한글 폴더");
    });

    it(".·..·제어문자·잘못된 리모트 이름은 거부한다", () => {
        for (const raw of [".", "..", "a/../b", "a\nb", "a\u0000b"]) {
            expect(normalizeRemoteBasePath("test-remote", raw).ok).toBe(false);
        }
        expect(normalizeRemoteBasePath("", "base")).toMatchObject({ ok: false });
        expect(normalizeRemoteBasePath("a:b", "")).toMatchObject({ ok: false });
        expect(normalizeRemoteBasePath("test-remote", "x".repeat(PATH_MAX_INPUT))).toMatchObject({
            ok: false,
        });
    });

    it("조합 길이가 한도 이하면 통과한다", () => {
        const raw = "x".repeat(PATH_MAX_INPUT - "test-remote:".length);
        expect(normalizeRemoteBasePath("test-remote", raw)).toEqual({ ok: true, basePath: raw });
    });
});

describe("composeRemotePath / joinRemotePath", () => {
    it("기준 경로를 그대로 붙이고, 조각 하나를 / 로 잇는다", () => {
        expect(composeRemotePath("test-remote", "")).toBe("test-remote:");
        expect(composeRemotePath("test-remote", "/base")).toBe("test-remote:/base");
        expect(joinRemotePath("test-remote", "", "a")).toBe("test-remote:a");
        expect(joinRemotePath("test-remote", "base", "a")).toBe("test-remote:base/a");
        expect(joinRemotePath("test-remote", "base/", "a")).toBe("test-remote:base/a");
        expect(joinRemotePath("test-remote", "/", "a")).toBe("test-remote:/a");
        expect(joinRemotePath("test-remote", "/base", "a")).toBe("test-remote:/base/a");
    });
});

describe("isRemoteSegmentName", () => {
    it("폴더 이름 하나로 쓸 수 있는 값만 통과한다", () => {
        expect(isRemoteSegmentName("a")).toBe(true);
        expect(isRemoteSegmentName("한글 폴더")).toBe(true);
        expect(isRemoteSegmentName("a.b-c_d")).toBe(true);
        for (const bad of ["", " a", "a ", ".", "..", "a/b", "a\\b", "a\tb", "a\u0000b"]) {
            expect(isRemoteSegmentName(bad)).toBe(false);
        }
        expect(isRemoteSegmentName("x".repeat(256))).toBe(false);
    });
});
