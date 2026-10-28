// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    checkPathPair,
    checkRunPaths,
    isRemoteAbsolute,
    linuxPathToWslUnc,
    mntPathToWindows,
    parsePath,
    pathKey,
} from "@/shared/path-utils";

function f_Ok(raw: string) {
    const r = parsePath(raw);
    if (!r.ok) throw new Error(`parse 실패: ${raw} → ${r.issue.message}`);
    return r.path;
}

describe("parsePath 분류·정규화", () => {
    it.each([
        ["C:\\work\\proj", "local", "C:\\work\\proj"],
        ["c:/work//proj/", "local", "C:\\work\\proj"],
        ["D:\\a\\.\\b\\..\\c", "local", "D:\\a\\c"],
        [
            "\\\\wsl.localhost\\TestDistro\\home\\user",
            "unc",
            "\\\\wsl.localhost\\TestDistro\\home\\user",
        ],
        ["//server/share/x/", "unc", "\\\\server\\share\\x"],
        ["remote:sample dir", "remote", "remote:sample dir"],
        ["my-remote:a\\b//c/", "remote", "my-remote:a/b/c"],
        ["  test-remote:dir  ", "remote", "test-remote:dir"],
    ])("%s → %s", (raw, kind, normalized) => {
        const p = f_Ok(raw);
        expect(p.kind).toBe(kind);
        expect(p.normalized).toBe(normalized);
    });

    it.each([
        ["", "VALIDATION"],
        ["   ", "VALIDATION"],
        ["/home/user/work", "PATH_INVALID"],
        ["work\\src", "PATH_INVALID"],
        ["E:", "PATH_INVALID"],
        ["\\\\?\\C:\\x", "PATH_INVALID"],
        ["\\\\.\\pipe\\x", "PATH_INVALID"],
        ["\\\\server", "PATH_INVALID"],
        ["C:\\..\\x", "PATH_INVALID"],
        ["a\nb:c", "PATH_INVALID"],
        [":local:x", "PATH_INVALID"],
        ["remote:a/../b", "VALIDATION"],
        ["remote:./a", "VALIDATION"],
    ])("거부: %j → %s", (raw, code) => {
        expect(parsePath(raw)).toMatchObject({ ok: false, issue: { code } });
    });

    it("remote 루트는 segments가 비어 있다", () => {
        expect(f_Ok("remote:").segments).toEqual([]);
        expect(f_Ok("remote:/").segments).toEqual([]);
    });

    it.each([
        ["sftp:/abs", "sftp:/abs"],
        ["sftp://a//b/", "sftp:/a/b"],
        ["rr:\\a", "rr:/a"],
        ["rr:/", "rr:/"],
    ])("remote 맨 앞 / 보존: %s → %s", (raw, normalized) => {
        const p = f_Ok(raw);
        expect(p.normalized).toBe(normalized);
        expect(isRemoteAbsolute(p)).toBe(true);
    });

    it("isRemoteAbsolute: 상대 remote·local·UNC는 false", () => {
        expect(isRemoteAbsolute(f_Ok("sftp:abs"))).toBe(false);
        expect(isRemoteAbsolute(f_Ok("sftp:"))).toBe(false);
        expect(isRemoteAbsolute(f_Ok("C:\\a"))).toBe(false);
        expect(isRemoteAbsolute(f_Ok("\\\\srv\\sh\\a"))).toBe(false);
    });
});

describe("pathKey", () => {
    it("로컬은 대소문자를 무시하고 NFC로 맞춘다", () => {
        const nfd = "X:\\한글".normalize("NFD");
        expect(pathKey(f_Ok("x:\\My\\Dir"), false)).toBe(pathKey(f_Ok("X:\\my\\dir"), false));
        expect(pathKey(f_Ok(nfd), true)).toBe(pathKey(f_Ok("X:\\한글"), true));
    });

    it("remote는 설정에 따라 대소문자를 구분한다", () => {
        expect(pathKey(f_Ok("r:Dir"), true)).toBe(pathKey(f_Ok("r:dir"), true));
        expect(pathKey(f_Ok("r:Dir"), false)).not.toBe(pathKey(f_Ok("r:dir"), false));
    });

    it("wsl$ 와 wsl.localhost, /mnt/<드라이브> 별칭을 같은 위치로 본다", () => {
        expect(pathKey(f_Ok("\\\\wsl$\\TestDistro\\home\\a"), true)).toBe(
            pathKey(f_Ok("\\\\wsl.localhost\\TestDistro\\home\\a"), true),
        );
        expect(pathKey(f_Ok("\\\\wsl.localhost\\TestDistro\\mnt\\x\\Proj"), true)).toBe(
            pathKey(f_Ok("X:\\proj"), true),
        );
    });
});

function codes(s: string, d: string, ci = true) {
    return checkPathPair(s, d, ci).errors.map((e) => e.code);
}

describe("checkPathPair 안전 규칙", () => {
    it("정상 쌍은 오류가 없다", () => {
        expect(codes("\\\\wsl.localhost\\TestDistro\\home\\a\\work", "X:\\Projects\\work")).toEqual(
            [],
        );
        expect(codes("X:\\Projects", "remote:Projects")).toEqual([]);
        expect(codes("X:\\a", "X:\\ab")).toEqual([]);
    });

    it("S1 빈 경로", () => {
        expect(codes("", "X:\\x")).toEqual(["VALIDATION"]);
    });

    it("S2 같은 경로 (대소문자·구분자·별칭 무시)", () => {
        expect(codes("X:\\Proj", "x:/proj/")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("\\\\wsl$\\TestDistro\\mnt\\x\\Proj", "X:\\Proj")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("r:a/b", "r:a\\b")).toEqual(["SAFETY_BLOCKED"]);
    });

    it("S3 중첩 경로 (양방향)", () => {
        expect(codes("X:\\a", "X:\\a\\b")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("X:\\a\\b", "x:\\A")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("r:a", "r:a/b")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("\\\\srv\\sh\\a", "\\\\SRV\\sh\\a\\b")).toEqual(["SAFETY_BLOCKED"]);
    });

    it("S4 루트 차단 (드라이브·공유·WSL 배포판·remote)", () => {
        expect(codes("X:\\", "F:\\x")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("\\\\srv\\share", "F:\\x")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("\\\\wsl.localhost\\TestDistro", "F:\\x")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("\\\\wsl.localhost\\TestDistro\\mnt\\x", "F:\\x")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("F:\\x", "remote:")).toEqual(["SAFETY_BLOCKED"]);
    });

    it("S4a remote의 . / .. 세그먼트", () => {
        expect(codes("F:\\x", "remote:a/../b")).toEqual(["VALIDATION"]);
    });

    it("remote 절대·상대는 같은 위치로 보고 보수적으로 막는다", () => {
        expect(codes("sftp:/x", "sftp:x/y")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("sftp:/x", "sftp:x")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("F:\\x", "remote:/")).toEqual(["SAFETY_BLOCKED"]);
    });

    it("다른 remote끼리는 같은 경로여도 허용", () => {
        expect(codes("r1:a", "r2:a")).toEqual([]);
    });

    it("WSL /mnt 별칭과 긴 경로는 경고만 한다", () => {
        const long = `X:\\${"a".repeat(250)}`;
        const r = checkPathPair("\\\\wsl.localhost\\TestDistro\\mnt\\x\\x", long, true);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toHaveLength(2);
    });
});

describe("checkRunPaths (비교·실행 시작 전)", () => {
    it.each([
        ["x:folder", "F:\\dst", "원본: ‘x:folder’", "X:\\folder처럼"],
        ["F:\\src", "C:foo", "대상: ‘C:foo’", "C:\\foo처럼"],
    ])("드라이브 상대 경로 %s / %s → PATH_INVALID", (s, d, prefix, fixed) => {
        const r = checkRunPaths(s, d, true);
        expect(r.errors[0]?.code).toBe("PATH_INVALID");
        expect(r.errors[0]?.message.startsWith(prefix)).toBe(true);
        expect(r.errors[0]?.message).toContain(fixed);
    });

    it("X:\\folder 와 두 글자 이상 remote는 통과", () => {
        expect(checkRunPaths("X:\\folder", "remote:a", true).errors).toEqual([]);
    });

    it("checkPathPair 오류(S1~S4)와 경고를 그대로 포함한다", () => {
        expect(checkRunPaths("X:\\a", "X:\\a\\b", true).errors.map((e) => e.code)).toEqual([
            "SAFETY_BLOCKED",
        ]);
        expect(checkRunPaths("", "x:y", true).errors.map((e) => e.code)).toEqual([
            "PATH_INVALID",
            "VALIDATION",
        ]);
        expect(
            checkRunPaths("\\\\wsl.localhost\\D\\mnt\\x\\a", "F:\\b", true).warnings,
        ).toHaveLength(1);
    });

    it("저장용 checkPathPair는 드라이브 상대 경로를 막지 않는다(경고만, Phase 4 동작 유지)", () => {
        expect(checkPathPair("x:folder", "F:\\dst", true).errors).toEqual([]);
    });
});

describe("WSL 변환", () => {
    it("리눅스 경로 → UNC", () => {
        expect(linuxPathToWslUnc("Test-Distro 1", "/home/user/work/")).toBe(
            "\\\\wsl.localhost\\Test-Distro 1\\home\\user\\work",
        );
        expect(linuxPathToWslUnc("TestDistro", "relative")).toBeNull();
        expect(linuxPathToWslUnc("bad\\name", "/x")).toBeNull();
    });

    it("/mnt/<드라이브> → Windows 경로", () => {
        expect(mntPathToWindows("/mnt/x/sample dir/a")).toBe("X:\\sample dir\\a");
        expect(mntPathToWindows("/mnt/c")).toBe("C:\\");
        expect(mntPathToWindows("/home/x")).toBeNull();
    });
});
