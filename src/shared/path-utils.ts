/**
 * Node API 없이 동작하는 경로 분류·정규화·안전 검사 (MVP_SPEC §6).
 * 화면(배지·미리보기)과 main(저장 전 검증)이 같이 쓴다.
 *
 * - 표시는 원문, 비교·안전 검사는 정규화 키를 쓴다.
 * - 접근 가능 여부(존재·폴더 여부)는 여기서 보지 않는다. main의 probe가 담당한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typErrorCode } from "@/shared/errors";

export type typPathKind = "local" | "unc" | "remote";

export interface itfParsedPath {
    kind: typPathKind;
    /** 사용자가 입력한 원문(앞뒤 공백 제거) */
    display: string;
    /** rclone에 넘길 정규화 경로 */
    normalized: string;
    /** local: "E:", unc: "\\server\share", remote: "name:" */
    root: string;
    /** 루트 아래 경로 조각. 비어 있으면 루트 자체 */
    segments: string[];
}

export interface itfPathIssue {
    code: typErrorCode;
    message: string;
}

export type typParseResult = { ok: true; path: itfParsedPath } | { ok: false; issue: itfPathIssue };

export interface itfPathPairCheck {
    errors: itfPathIssue[];
    warnings: string[];
}

export const LONG_PATH_WARN_LENGTH = 240;

// oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const DRIVE_ONLY = /^[A-Za-z]:$/;
const REMOTE_NAME = /^[\w.+@][\w.+@ -]*$/;

function f_Issue(code: typErrorCode, message: string): typParseResult {
    return { ok: false, issue: { code, message } };
}

/** "." 제거, ".." 처리. 루트 위로 올라가면 null */
function f_ResolveDots(parts: string[]): string[] | null {
    const out: string[] = [];
    for (const part of parts) {
        if (part === "" || part === ".") continue;
        if (part === "..") {
            if (out.length === 0) return null;
            out.pop();
            continue;
        }
        out.push(part);
    }
    return out;
}

function f_ParseLocal(display: string): typParseResult {
    const drive = display.slice(0, 2).toUpperCase();
    const segments = f_ResolveDots(display.slice(3).split(/[\\/]+/));
    if (segments === null)
        return f_Issue("PATH_INVALID", "드라이브 루트 위로 올라가는 경로입니다.");
    return {
        ok: true,
        path: {
            kind: "local",
            display,
            normalized: segments.length ? `${drive}\\${segments.join("\\")}` : `${drive}\\`,
            root: drive,
            segments,
        },
    };
}

function f_ParseUnc(display: string): typParseResult {
    if (/^[\\/]{2}[?.][\\/]/.test(display)) {
        return f_Issue(
            "PATH_INVALID",
            "\\\\?\\ 또는 \\\\.\\ 형태의 확장 경로는 지원하지 않습니다.",
        );
    }
    const parts = display.slice(2).split(/[\\/]+/);
    const [host, share, ...rest] = parts;
    if (!host || !share)
        return f_Issue("PATH_INVALID", "UNC 경로는 \\\\서버\\공유 형식이어야 합니다.");
    const segments = f_ResolveDots(rest);
    if (segments === null) return f_Issue("PATH_INVALID", "공유 루트 위로 올라가는 경로입니다.");
    const root = `\\\\${host}\\${share}`;
    return {
        ok: true,
        path: {
            kind: "unc",
            display,
            normalized: segments.length ? `${root}\\${segments.join("\\")}` : root,
            root,
            segments,
        },
    };
}

function f_ParseRemote(display: string, colon: number): typParseResult {
    const name = display.slice(0, colon);
    if (!REMOTE_NAME.test(name)) {
        return f_Issue(
            "PATH_INVALID",
            "rclone remote 이름 형식이 올바르지 않습니다. 예: remote:폴더",
        );
    }
    const parts = display
        .slice(colon + 1)
        .split(/[\\/]+/)
        .filter((p) => p !== "");
    if (parts.some((p) => p === "." || p === "..")) {
        return f_Issue("VALIDATION", "remote 경로에는 . 또는 .. 를 쓸 수 없습니다.");
    }
    const root = `${name}:`;
    return {
        ok: true,
        path: {
            kind: "remote",
            display,
            normalized: root + parts.join("/"),
            root,
            segments: parts,
        },
    };
}

/** 경로 원문을 분류하고 정규화한다. 지원하지 않는 형태는 이유와 함께 거부한다. */
export function parsePath(raw: string): typParseResult {
    const display = raw.trim();
    if (display === "") return f_Issue("VALIDATION", "경로를 입력하세요.");
    if (CONTROL_CHARS.test(display)) return f_Issue("PATH_INVALID", "경로에 제어문자가 있습니다.");
    if (DRIVE_PATH.test(display)) return f_ParseLocal(display);
    if (DRIVE_ONLY.test(display))
        return f_Issue("PATH_INVALID", "드라이브 뒤에 \\ 를 붙여 폴더를 지정하세요.");
    if (/^[\\/]{2}/.test(display)) return f_ParseUnc(display);
    if (display.startsWith("/")) {
        return f_Issue(
            "PATH_INVALID",
            "WSL 리눅스 경로는 \\\\wsl.localhost\\<배포판>\\... 형식으로 바꿔 입력하세요.",
        );
    }
    const colon = display.indexOf(":");
    if (colon > 0) return f_ParseRemote(display, colon);
    return f_Issue("PATH_INVALID", "상대 경로는 쓸 수 없습니다. 전체 경로를 입력하세요.");
}

function f_KeyPart(part: string, caseInsensitive: boolean): string {
    const nfc = part.normalize("NFC");
    return caseInsensitive ? nfc.toLowerCase() : nfc;
}

/**
 * 같은 위치를 가리키는 다른 표기를 하나로 모은다.
 * - UNC host `wsl$` → `wsl.localhost`
 * - `\\wsl.localhost\<distro>\mnt\<letter>\...` → `<letter>:\...` (WSL automount 가정)
 * 드라이브 문자·host·share는 항상 대소문자를 무시한다(Windows 규칙).
 */
export function canonicalLocation(
    p: itfParsedPath,
    caseInsensitive: boolean,
): { root: string; keys: string[]; wslMntAlias: boolean } {
    let root = p.root.toLowerCase();
    let segments = p.segments;
    let wslMntAlias = false;
    if (p.kind === "unc") {
        root = root.replace(/^\\\\wsl\$\\/, "\\\\wsl.localhost\\");
        const [mnt, letter, ...rest] = segments;
        if (
            root.startsWith("\\\\wsl.localhost\\") &&
            mnt?.toLowerCase() === "mnt" &&
            letter !== undefined &&
            /^[a-z]$/i.test(letter)
        ) {
            root = `${letter.toLowerCase()}:`;
            segments = rest;
            wslMntAlias = true;
        }
    }
    if (p.kind === "remote") root = p.root;
    const keys = segments.map((s) => f_KeyPart(s, caseInsensitive || p.kind !== "remote"));
    return { root, keys, wslMntAlias };
}

/** 비교·중복 검사용 키 */
export function pathKey(p: itfParsedPath, caseInsensitive: boolean): string {
    const c = canonicalLocation(p, caseInsensitive);
    return `${c.root}|${c.keys.join("/")}`;
}

function f_IsPrefix(shorter: string[], longer: string[]): boolean {
    return shorter.length < longer.length && shorter.every((k, i) => longer[i] === k);
}

/**
 * 원본·대상 한 쌍의 형식·안전 규칙(S1~S4a)을 검사한다.
 * 로컬·UNC는 Windows 규칙에 따라 항상 대소문자를 무시하고,
 * remote는 caseInsensitive 설정을 따른다.
 */
export function checkPathPair(
    sourceRaw: string,
    destRaw: string,
    caseInsensitive: boolean,
): itfPathPairCheck {
    const errors: itfPathIssue[] = [];
    const warnings: string[] = [];
    const parsed: Array<itfParsedPath | null> = [];

    for (const [label, raw] of [
        ["원본", sourceRaw],
        ["대상", destRaw],
    ] as const) {
        const r = parsePath(raw);
        if (!r.ok) {
            errors.push({ code: r.issue.code, message: `${label}: ${r.issue.message}` });
            parsed.push(null);
            continue;
        }
        parsed.push(r.path);
        const c = canonicalLocation(r.path, caseInsensitive);
        if (c.keys.length === 0) {
            errors.push({
                code: "SAFETY_BLOCKED",
                message: `${label}: 드라이브·공유·remote 루트 전체는 지정할 수 없습니다. 하위 폴더를 고르세요.`,
            });
        }
        if (c.wslMntAlias) {
            warnings.push(
                `${label}: WSL /mnt 경로입니다. 같은 폴더를 Windows 경로(${c.root.toUpperCase()}\\...)로 쓰면 더 빠릅니다.`,
            );
        }
        if (r.path.normalized.length > LONG_PATH_WARN_LENGTH) {
            warnings.push(
                `${label}: 경로가 ${LONG_PATH_WARN_LENGTH}자를 넘습니다. 일부 파일이 실패할 수 있습니다.`,
            );
        }
    }

    const [src, dst] = parsed;
    if (src && dst) {
        const a = canonicalLocation(src, caseInsensitive);
        const b = canonicalLocation(dst, caseInsensitive);
        if (a.root === b.root) {
            if (a.keys.length === b.keys.length && a.keys.every((k, i) => b.keys[i] === k)) {
                errors.push({ code: "SAFETY_BLOCKED", message: "원본과 대상이 같은 폴더입니다." });
            } else if (f_IsPrefix(a.keys, b.keys)) {
                errors.push({ code: "SAFETY_BLOCKED", message: "대상이 원본 폴더 안에 있습니다." });
            } else if (f_IsPrefix(b.keys, a.keys)) {
                errors.push({ code: "SAFETY_BLOCKED", message: "원본이 대상 폴더 안에 있습니다." });
            }
        }
    }
    return { errors, warnings };
}

/** WSL 리눅스 절대 경로를 UNC로 바꾼다. 예: ("Distro", "/home/a") → \\wsl.localhost\Distro\home\a */
export function linuxPathToWslUnc(distro: string, linuxPath: string): string | null {
    const name = distro.trim();
    if (!name || /[\\/]/.test(name) || !linuxPath.startsWith("/")) return null;
    const segments = f_ResolveDots(linuxPath.split("/"));
    if (segments === null) return null;
    const base = `\\\\wsl.localhost\\${name}`;
    return segments.length ? `${base}\\${segments.join("\\")}` : base;
}

/** `/mnt/<drive>/...` 를 Windows 경로로 바꾼다. 해당하지 않으면 null */
export function mntPathToWindows(linuxPath: string): string | null {
    const m = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(linuxPath);
    if (!m) return null;
    const segments = f_ResolveDots((m[2] ?? "").split("/"));
    if (segments === null) return null;
    return `${m[1]!.toUpperCase()}:\\${segments.join("\\")}`;
}
