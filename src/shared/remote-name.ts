/**
 * 한 글자 remote 이름 판정. Windows의 rclone은 `x:경로`를 드라이브 문자로 해석하므로
 * 영문 한 글자 이름의 remote는 쓸 수 없다. 화면 경고에만 쓰며 저장은 막지 않는다.
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
    return `${list} remote는 Windows에서 드라이브 문자로 해석되어 사용할 수 없습니다. rclone config에서 두 글자 이상 이름으로 바꾸세요.`;
}

/**
 * 입력 경로가 "x:..." (한 글자 + ":" 뒤가 \ 또는 / 가 아님) 형태인지.
 * parsePath는 remote로 분류하지만 Windows의 rclone은 드라이브로 해석한다.
 */
export function looksLikeDriveLetterRemotePath(raw: string): boolean {
    return DRIVE_LETTER_REMOTE_PATH.test(raw.trim());
}
