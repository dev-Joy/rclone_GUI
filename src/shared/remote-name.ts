/**
 * remote 이름 판정과 새 이름 검사(INT-006 FR-5).
 * Windows의 rclone은 `x:경로`를 드라이브 문자로 해석하므로 영문 한 글자 이름의 remote는 쓸 수 없다.
 * 한 글자 경고는 화면에만 쓰며 저장은 막지 않고, 새로 만드는 이름만 validateNewRemoteName이 막는다.
 * Node·DOM 의존 없음.
 *
 * @author dev-Joy 2026-10-28
 */

const DRIVE_LETTER_NAME = /^[A-Za-z]$/;
/** 한 글자 + ":" 뒤에 \ 또는 / 가 아닌 글자가 오는 형태 (예: x:folder) */
const DRIVE_LETTER_REMOTE_PATH = /^[A-Za-z]:(?![\\/])./;

/** Windows에서 rclone이 드라이브 문자로 해석하는 remote 이름(영문 한 글자)인지 */
export function isDriveLetterRemoteName(name: string): boolean {
    return DRIVE_LETTER_NAME.test(name);
}

/** 목록 중 한 글자 이름만 원래 순서대로 */
export function findDriveLetterRemotes(remotes: readonly string[]): string[] {
    return remotes.filter(isDriveLetterRemoteName);
}

/** 경고 문구. 빈 배열이면 null */
export function driveLetterRemoteWarning(names: readonly string[]): string | null {
    if (names.length === 0) return null;
    const list = names.map((n) => `‘${n}:’`).join(", ");
    return `${list} 리모트는 Windows에서 드라이브 문자로 해석되어 사용할 수 없습니다. rclone config에서 두 글자 이상 이름으로 바꾸세요.`;
}

/**
 * 입력 경로가 "x:..." (한 글자 + ":" 뒤가 \ 또는 / 가 아님) 형태인지.
 * parsePath는 remote로 분류하지만 Windows의 rclone은 드라이브로 해석한다.
 */
export function looksLikeDriveLetterRemotePath(raw: string): boolean {
    return DRIVE_LETTER_REMOTE_PATH.test(raw.trim());
}

/** 새 remote 이름에 쓸 수 있는 글자(한글 포함) — rclone 규칙의 부분집합(공백 제외) */
const NEW_NAME_CHARS = /^[\p{L}\p{N}_.+@-]+$/u;
/** 이름의 첫·끝 글자(하이픈 불가) */
const NEW_NAME_EDGE = /^[\p{L}\p{N}_.+@]$/u;

/**
 * 앱에서 새로 만드는 remote 이름을 검사한다(INT-006 FR-5). 문제가 없으면 null, 있으면 이유.
 * - 두 글자 이상(Windows 드라이브 문자와 겹치지 않게)
 * - 공백·`:`·`/`·`\` 등 rclone이 거부하는 글자 금지
 * - `-`로 시작·끝 금지(`-`로 시작하면 rclone이 플래그로 해석한다)
 * - existing에 같은 이름이 있으면(대소문자 무시) 거부
 * 이미 있는 공백 이름은 읽기 쪽에서 계속 쓸 수 있다(이 함수는 새 이름에만 쓴다).
 */
export function validateNewRemoteName(
    name: string,
    existing: readonly string[] = [],
): string | null {
    if (name.trim() !== name) return "이름 앞뒤에 공백을 넣을 수 없습니다.";
    if (name.length < 2) return "이름은 두 글자 이상이어야 합니다.";
    if (name.length > 128) return "이름은 128자 이내로 입력하세요.";
    if (name.includes(" ")) return "이름에 공백을 넣을 수 없습니다.";
    if (!NEW_NAME_CHARS.test(name)) {
        return "이름에는 글자·숫자·_ - . + @만 쓸 수 있습니다.";
    }
    if (name.startsWith("-") || name.endsWith("-")) {
        return "이름은 -로 시작하거나 끝날 수 없습니다.";
    }
    if (!NEW_NAME_EDGE.test(name[0] ?? "") || !NEW_NAME_EDGE.test(name.at(-1) ?? "")) {
        return "이름의 첫·끝 글자를 확인하세요.";
    }
    const key = name.toLowerCase();
    if (existing.some((n) => n.toLowerCase() === key)) {
        return `‘${name}’ 리모트가 이미 있습니다. 다른 이름을 쓰세요.`;
    }
    return null;
}
