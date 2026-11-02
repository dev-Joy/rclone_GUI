// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    checkBackupDir,
    checkPathPair,
    checkRunPaths,
    isRemoteAbsolute,
    joinBackupPath,
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

    it("리모트 루트는 segments가 비어 있다", () => {
        expect(f_Ok("remote:").segments).toEqual([]);
        expect(f_Ok("remote:/").segments).toEqual([]);
    });

    it.each([
        ["sftp:/abs", "sftp:/abs"],
        ["sftp://a//b/", "sftp:/a/b"],
        ["rr:\\a", "rr:/a"],
        ["rr:/", "rr:/"],
    ])("리모트 맨 앞 / 보존: %s → %s", (raw, normalized) => {
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

    it("리모트는 설정에 따라 대소문자를 구분한다", () => {
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

    it("S4a 리모트의 . / .. 세그먼트", () => {
        expect(codes("F:\\x", "remote:a/../b")).toEqual(["VALIDATION"]);
    });

    it("리모트 절대·상대는 같은 위치로 보고 보수적으로 막는다", () => {
        expect(codes("sftp:/x", "sftp:x/y")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("sftp:/x", "sftp:x")).toEqual(["SAFETY_BLOCKED"]);
        expect(codes("F:\\x", "remote:/")).toEqual(["SAFETY_BLOCKED"]);
    });

    it("다른 리모트끼리는 같은 경로여도 허용", () => {
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

    it("X:\\folder 와 두 글자 이상 리모트는 통과", () => {
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

describe("checkBackupDir (INT-003 FR-24, AC-11·AC-17)", () => {
    const SRC = "D:\\work\\src";
    const DST = "D:\\work\\dst";
    const f_Check = (bk: string, src = SRC, dst = DST, ci = false) =>
        checkBackupDir(bk, src, dst, ci);

    it.each([
        ["대상과 같음", "D:\\work\\dst", "대상 폴더와 겹칩니다"],
        ["대상 안", "D:\\work\\dst\\bk", "대상 폴더와 겹칩니다"],
        ["대상의 상위", "D:\\work", "대상 폴더와 겹칩니다"],
        ["원본 안", "D:\\work\\src\\bk", "원본 폴더와 겹칩니다"],
        ["다른 로컬 드라이브(AC-17)", "E:\\bk", "같은 드라이브"],
        ["루트", "D:\\", "루트 전체"],
        ["드라이브 상대", "x:folder", "현재 폴더 기준"],
        ["형식 오류", "relative\\bk", "상대 경로"],
    ])("거부: %s", (_label, bk, text) => {
        const r = f_Check(bk);
        expect(r?.message).toContain(text);
        expect(r?.message.startsWith("백업 폴더: ")).toBe(true);
    });

    it("원본의 상위는 대상의 상위이기도 해 대상 겹침으로 거부", () => {
        expect(f_Check("D:\\work\\src\\..")?.code).toBe("SAFETY_BLOCKED");
    });

    it.each([
        ["다른 UNC 공유", "\\\\srv\\other\\bk", "\\\\srv\\share\\dst"],
        ["UNC와 로컬", "D:\\bk", "\\\\srv\\share\\dst"],
        ["다른 remote", "gd2:bk", "gd:dst"],
        ["local과 remote", "D:\\bk", "gd:dst"],
        ["공유 루트", "\\\\srv\\share", "\\\\srv\\share\\dst"],
        ["remote 루트", "gd:", "gd:dst"],
    ])("거부: %s", (_label, bk, dst) => {
        expect(f_Check(bk, "C:\\src", dst)?.code).toBe("SAFETY_BLOCKED");
    });

    it("WSL /mnt 표기와 드라이브 문자가 섞이면 거부", () => {
        expect(f_Check("\\\\wsl.localhost\\U\\mnt\\d\\bk")?.message).toContain("같은 표기");
    });

    it.each([
        ["같은 드라이브 형제", "D:\\work\\bk", SRC, DST],
        ["이름 접두사만 같은 형제", "D:\\work\\dst2", SRC, DST],
        ["같은 UNC 공유", "\\\\srv\\share\\bk", "C:\\src", "\\\\srv\\share\\dst"],
        ["같은 remote 다른 폴더", "gd:bk", "C:\\src", "gd:dst"],
        [
            "WSL 배포판 경로끼리",
            "\\\\wsl.localhost\\U\\home\\a\\bk",
            "C:\\src",
            "\\\\wsl.localhost\\U\\home\\a\\dst",
        ],
        [
            "WSL /mnt 표기끼리",
            "\\\\wsl.localhost\\U\\mnt\\d\\bk",
            "C:\\src",
            "\\\\wsl.localhost\\U\\mnt\\d\\dst",
        ],
    ])("허용: %s", (_label, bk, src, dst) => {
        expect(f_Check(bk, src, dst)).toBeNull();
    });

    it("대소문자: remote는 설정을 따르고, 로컬은 항상 무시", () => {
        expect(f_Check("gd:Dst/bk", "C:\\src", "gd:dst", false)).toBeNull();
        expect(f_Check("gd:Dst/bk", "C:\\src", "gd:dst", true)?.code).toBe("SAFETY_BLOCKED");
        expect(f_Check("d:\\WORK\\DST\\bk")?.code).toBe("SAFETY_BLOCKED");
    });

    it("joinBackupPath: 로컬·UNC는 \\, remote는 /", () => {
        const sub = "2026-11-02_103000_1a2b3c4d";
        expect(joinBackupPath(f_Ok("D:\\bk\\"), sub)).toBe(`D:\\bk\\${sub}`);
        expect(joinBackupPath(f_Ok("\\\\srv\\share\\bk"), sub)).toBe(`\\\\srv\\share\\bk\\${sub}`);
        expect(joinBackupPath(f_Ok("gd:bk"), sub)).toBe(`gd:bk/${sub}`);
        expect(joinBackupPath(f_Ok("sftp:/abs/bk"), sub)).toBe(`sftp:/abs/bk/${sub}`);
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

    it("/mnt/x 변환: 대소문자·끝 슬래시·.. 처리, 형식이 다르면 null (INT-002 FR-25)", () => {
        expect(mntPathToWindows("/mnt/X/a")).toBe("X:\\a");
        expect(mntPathToWindows("/mnt/x/a/")).toBe("X:\\a");
        expect(mntPathToWindows("/mnt/x/a/../b")).toBe("X:\\b");
        expect(mntPathToWindows("/mnt/x/..")).toBeNull();
        expect(mntPathToWindows("/mnt/xy/a")).toBeNull();
        expect(mntPathToWindows("/mnt/")).toBeNull();
        expect(mntPathToWindows("/mnt")).toBeNull();
    });

    it("변환 결과는 local 경로로 그대로 실행하고, 변환 전 /mnt/x는 거부한다", () => {
        const win = mntPathToWindows("/mnt/x/a/b");
        expect(win).toBe("X:\\a\\b");
        const p = f_Ok(win!);
        expect(p.kind).toBe("local");
        expect(p.normalized).toBe("X:\\a\\b");
        expect(parsePath("/mnt/x/a")).toMatchObject({
            ok: false,
            issue: { code: "PATH_INVALID" },
        });
    });

    it("WSL UNC의 /mnt/x는 같은 위치로 경고만 하고 rclone에는 UNC 그대로 넘긴다", () => {
        const unc = "\\\\wsl.localhost\\TestDistro\\mnt\\x\\a";
        const r = checkRunPaths(unc, "F:\\b", true);
        expect(r.errors).toEqual([]);
        expect(r.warnings).toHaveLength(1);
        const p = f_Ok(unc);
        expect(p.kind).toBe("unc");
        expect(p.normalized.startsWith("\\\\wsl.localhost\\TestDistro\\mnt\\x")).toBe(true);
    });
});
