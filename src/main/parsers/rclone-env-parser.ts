/**
 * rclone 환경 감지용 출력 파서 (MVP_SPEC §4.1). 순수 함수.
 * - `rclone version` 첫 줄과 os/type·os/arch
 * - `rclone config file` 의 두 가지 형태("stored at:" / "doesn't exist, but rclone will use this path:")
 * - `rclone listremotes` 줄 목록
 * - stderr 요약과 사용자 안내(토큰 만료·없는 remote·암호화 설정)
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { redactSecrets } from "@/main/lib/logger";

export interface itfRcloneVersion {
    major: number;
    minor: number;
    patch: number;
    /** 첫 줄의 버전 원문. 예: "v1.75.1", "v1.66.0-beta.7" */
    text: string;
    os: string | null;
    arch: string | null;
}

export interface itfConfigFileInfo {
    path: string;
    exists: boolean;
}

/** 지원하는 가장 낮은 버전 */
export const MIN_RCLONE_VERSION = "1.65.0";
/** 실측으로 확인한 버전. 이보다 높으면 경고만 한다 */
export const VERIFIED_RCLONE_VERSION = "1.75.1";

const VERSION_LINE = /^rclone (v(\d+)\.(\d+)\.(\d+)\S*)/m;
const LOG_PREFIX = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?\s+/;

function f_Lines(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== "");
}

function f_Triple(v: itfRcloneVersion | string): [number, number, number] | null {
    if (typeof v !== "string") return [v.major, v.minor, v.patch];
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** `rclone version` stdout을 읽는다. 형식이 다르면 null */
export function parseRcloneVersion(stdout: string): itfRcloneVersion | null {
    const m = VERSION_LINE.exec(stdout);
    if (!m) return null;
    const os = /^- os\/type:\s*(\S+)/m.exec(stdout);
    const arch = /^- os\/arch:\s*(\S+)/m.exec(stdout);
    return {
        major: Number(m[2]),
        minor: Number(m[3]),
        patch: Number(m[4]),
        text: m[1]!,
        os: os ? os[1]! : null,
        arch: arch ? arch[1]! : null,
    };
}

/** a < b 이면 음수, 같으면 0, 크면 양수. 해석할 수 없는 값은 가장 낮은 버전으로 본다 */
export function compareVersions(a: itfRcloneVersion | string, b: string): number {
    const x = f_Triple(a) ?? [-1, -1, -1];
    const y = f_Triple(b) ?? [-1, -1, -1];
    for (let i = 0; i < 3; i += 1) {
        if (x[i]! !== y[i]!) return x[i]! - y[i]!;
    }
    return 0;
}

/** `rclone config file` stdout. 경로만 읽고 파일 내용은 보지 않는다 */
export function parseConfigFileOutput(stdout: string): itfConfigFileInfo | null {
    const lines = f_Lines(stdout);
    const [head, path] = lines;
    if (!head || !path) return null;
    if (/stored at:$/i.test(head)) return { path, exists: true };
    if (/doesn't exist/i.test(head)) return { path, exists: false };
    return null;
}

/** `rclone listremotes` stdout → 이름 목록(끝의 ":" 제거, 중복 제거, 정렬) */
export function parseListRemotes(stdout: string): string[] {
    const names = new Set<string>();
    for (const line of f_Lines(stdout)) {
        const name = line.endsWith(":") ? line.slice(0, -1) : line;
        if (name !== "") names.add(name);
    }
    return [...names].toSorted((a, b) => a.localeCompare(b));
}

/** stderr 마지막 몇 줄을 날짜 접두어 없이, 비밀값을 가려서 돌려준다 */
export function summarizeStderr(stderr: string, maxLines = 5): string {
    return f_Lines(stderr)
        .slice(-maxLines)
        .map((l) => redactSecrets(l.replace(LOG_PREFIX, "")))
        .join("\n");
}

/** 자주 나는 rclone 오류에 대한 안내 문구. 해당 없으면 null */
export function hintForRcloneError(stderr: string, remoteName: string | null): string | null {
    const text = stderr.toLowerCase();
    if (
        text.includes("couldn't fetch token") ||
        text.includes("invalid_grant") ||
        text.includes("oauth2") ||
        text.includes("token expired")
    ) {
        const target = remoteName ? `${remoteName}:` : "<remote>:";
        return `인증이 만료되었습니다. PowerShell에서 rclone config reconnect ${target} 를 실행하세요.`;
    }
    if (text.includes("didn't find section in config file")) {
        return "설정 파일에 그 remote가 없습니다. remote 이름과 rclone.conf를 확인하세요.";
    }
    if (text.includes("unable to decrypt configuration") || text.includes("password")) {
        return "암호화된 설정입니다. RCLONE_CONFIG_PASS 환경 변수를 확인하세요.";
    }
    return null;
}
