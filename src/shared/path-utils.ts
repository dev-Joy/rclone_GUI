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
import { looksLikeDriveLetterRemotePath } from "@/shared/remote-name";

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
            "rclone 리모트 이름 형식이 올바르지 않습니다. 예: remote:폴더",
        );
    }
    const rest = display.slice(colon + 1);
    const parts = rest.split(/[\\/]+/).filter((p) => p !== "");
    if (parts.some((p) => p === "." || p === "..")) {
        return f_Issue("VALIDATION", "리모트 경로에는 . 또는 .. 를 쓸 수 없습니다.");
    }
    const root = `${name}:`;
    // sftp·ftp·smb 등에서 "name:/abs"(절대)와 "name:rel"(홈 기준)은 다른 위치라 맨 앞 / 를 보존한다
    const absolute = /^[\\/]/.test(rest);
    return {
        ok: true,
        path: {
            kind: "remote",
            display,
            normalized: root + (absolute ? "/" : "") + parts.join("/"),
            root,
            segments: parts,
        },
    };
}

/** remote 경로가 맨 앞 / 로 시작하는지(절대 경로). local·UNC는 false */
export function isRemoteAbsolute(p: itfParsedPath): boolean {
    return p.kind === "remote" && p.normalized.startsWith(`${p.root}/`);
}

/**
 * remote 경로의 부모와 이름. 맨 앞 / 는 보존한다.
 * "rr:a/b" → { parent: "rr:a", name: "b" }, "rr:/a" → { parent: "rr:/", name: "a" }, "rr:" → null
 */
export function remoteParentOf(p: itfParsedPath): { parent: string; name: string } | null {
    if (p.kind !== "remote" || p.segments.length === 0) return null;
    return {
        parent: p.root + (isRemoteAbsolute(p) ? "/" : "") + p.segments.slice(0, -1).join("/"),
        name: p.segments.at(-1)!,
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
 * remote의 절대(`name:/a`)·상대(`name:a`)는 구분하지 않는다. Drive·S3 등에서는 같은 위치이므로
 * 보수적으로 같게 보고 동일·중첩을 막는다(sftp에서는 다른 폴더여도 막힐 수 있음 — 안전 쪽 오탐).
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
                message: `${label}: 드라이브·공유·리모트 루트 전체는 지정할 수 없습니다. 하위 폴더를 고르세요.`,
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

/**
 * 비교·실행 시작 전 검사. checkPathPair(S1~S4a)에 더해 드라이브 상대 경로(`x:folder`, `C:foo`)를 거부한다.
 * Windows의 rclone은 이 형태를 드라이브의 현재 폴더 기준 경로로 해석해 위치가 정해지지 않는다.
 * 저장(job-store)은 checkPathPair만 써서 경고로 남기고, 비교(compare-service)·실행(Phase 6 run-service)은
 * 이 함수를 쓴다. 드라이브 상대 오류를 먼저 둔다.
 */
export function checkRunPaths(
    sourceRaw: string,
    destRaw: string,
    caseInsensitive: boolean,
): itfPathPairCheck {
    const pair = checkPathPair(sourceRaw, destRaw, caseInsensitive);
    const driveErrors: itfPathIssue[] = [];
    for (const [label, raw] of [
        ["원본", sourceRaw],
        ["대상", destRaw],
    ] as const) {
        if (!looksLikeDriveLetterRemotePath(raw)) continue;
        const shown = raw.trim();
        const letter = shown.charAt(0).toUpperCase();
        const fixed = `${letter}:\\${shown.slice(2)}`;
        driveErrors.push({
            code: "PATH_INVALID",
            message: `${label}: ‘${shown}’는 Windows에서 ${letter} 드라이브의 현재 폴더 기준 경로로 해석되어 위치가 정해지지 않습니다. ${fixed}처럼 ‘:’ 뒤에 \\를 넣으세요. rclone 리모트라면 이름을 두 글자 이상으로 바꾸세요.`,
        });
    }
    return { errors: [...driveErrors, ...pair.errors], warnings: pair.warnings };
}

/** 백업 폴더 오류 문구 접두사(편집기 필드 매핑용, INT-003 T-03) */
export const BACKUP_DIR_LABEL = "백업 폴더";

/** "백업 폴더: …" 문구의 검사 결과 */
function f_BackupIssue(code: typErrorCode, text: string): itfPathIssue {
    return { code, message: `${BACKUP_DIR_LABEL}: ${text}` };
}

/** a와 b의 관계: 같은 폴더, a가 b 안, b가 a 안, 겹치지 않음(루트가 다르면 null) */
function f_Overlap(
    a: { root: string; keys: string[] },
    b: { root: string; keys: string[] },
): "same" | "aInB" | "bInA" | null {
    if (a.root !== b.root) return null;
    if (a.keys.length === b.keys.length && a.keys.every((k, i) => b.keys[i] === k)) return "same";
    if (f_IsPrefix(b.keys, a.keys)) return "aInB";
    if (f_IsPrefix(a.keys, b.keys)) return "bInA";
    return null;
}

/**
 * 백업 폴더 검사(INT-003 FR-24, E-8·E-9). 통과하면 null. 문구는 "백업 폴더: …".
 * 순서: 형식 → 루트 금지 → 드라이브 상대(`x:folder`) → 대상과 같은 위치(같은 드라이브·UNC 공유·remote,
 * WSL /mnt 표기도 같아야 함) → 대상과 겹침 → 원본과 겹침.
 * 다른 위치면 rclone이 옮기지 못하고 복사+삭제를 해 덮어쓰기까지 삭제 한도를 쓴다(rclone-notes #30).
 * 원본·대상이 해석되지 않으면 그 비교는 건너뛴다(checkPathPair가 따로 알린다).
 */
export function checkBackupDir(
    backupRaw: string,
    sourceRaw: string,
    destRaw: string,
    caseInsensitive: boolean,
): itfPathIssue | null {
    const r = parsePath(backupRaw);
    if (!r.ok) return f_BackupIssue(r.issue.code, r.issue.message);
    const bk = canonicalLocation(r.path, caseInsensitive);
    if (bk.keys.length === 0) {
        return f_BackupIssue(
            "SAFETY_BLOCKED",
            "드라이브·공유·리모트 루트 전체는 지정할 수 없습니다. 하위 폴더를 고르세요.",
        );
    }
    if (looksLikeDriveLetterRemotePath(backupRaw)) {
        const shown = backupRaw.trim();
        const letter = shown.charAt(0).toUpperCase();
        return f_BackupIssue(
            "PATH_INVALID",
            `‘${shown}’는 ${letter} 드라이브의 현재 폴더 기준 경로라 위치가 정해지지 않습니다. ${letter}:\\${shown.slice(2)}처럼 ‘:’ 뒤에 \\를 넣으세요.`,
        );
    }
    const d = parsePath(destRaw);
    if (d.ok) {
        const dst = canonicalLocation(d.path, caseInsensitive);
        const remoteMixed = (r.path.kind === "remote") !== (d.path.kind === "remote");
        if (bk.root !== dst.root || remoteMixed) {
            return f_BackupIssue(
                "SAFETY_BLOCKED",
                "대상과 같은 드라이브(네트워크 공유·리모트도 같은 곳)에 있어야 합니다. 다른 곳이면 파일을 옮기지 못하고 복사한 뒤 지우게 되어, 삭제 한도에 걸려 실행이 멈춥니다.",
            );
        }
        if (bk.wslMntAlias !== dst.wslMntAlias) {
            return f_BackupIssue(
                "SAFETY_BLOCKED",
                "대상과 같은 표기(…\\mnt\\… 또는 드라이브 문자)로 쓰세요.",
            );
        }
        if (f_Overlap(bk, dst) !== null) {
            return f_BackupIssue(
                "SAFETY_BLOCKED",
                "대상 폴더와 겹칩니다(같은 폴더이거나 한쪽이 다른 쪽 안에 있음). 대상 밖의 폴더를 고르세요.",
            );
        }
    }
    const s = parsePath(sourceRaw);
    if (s.ok && f_Overlap(bk, canonicalLocation(s.path, caseInsensitive)) !== null) {
        return f_BackupIssue("SAFETY_BLOCKED", "원본 폴더와 겹칩니다. 원본 밖의 폴더를 고르세요.");
    }
    return null;
}

/** 백업 기준 경로 + 실행별 하위 폴더 이름 → rclone에 넘길 경로. 로컬·UNC는 "\\", remote는 "/" */
export function joinBackupPath(base: itfParsedPath, subdir: string): string {
    return base.kind === "remote"
        ? `${base.normalized}/${subdir}`
        : `${base.normalized}\\${subdir}`;
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
