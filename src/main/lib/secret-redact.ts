/**
 * 비밀 값 가림(INT-006 FR-16, NFR-3).
 * rclone 인자에는 옵션 값이 들어가지 않지만, stderr·오류 문구·안내에 값이 섞일 수 있어
 * 한 함수로 지운다. 짧은 값은 다른 글자와 우연히 겹칠 수 있으므로 3자 이상만 지운다.
 *
 * @author dev-Joy 2026-11-03
 */

/** 값을 모아 가림 목록을 만든다(빈 값 제외) */
export function collectSecretValues(...maps: ReadonlyArray<Record<string, string>>): string[] {
    const out = new Set<string>();
    for (const map of maps) {
        for (const value of Object.values(map)) {
            if (value.trim() !== "") out.add(value);
        }
    }
    return [...out];
}

/** text에서 비밀 값을 `***`로 바꾼다 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
    let out = text;
    for (const secret of secrets) {
        if (secret.length < 3) continue;
        out = out.replaceAll(secret, "***");
    }
    return out;
}

/** 오류 detail·안내 문구에 쓸 stderr 요약. 비밀 값을 지운 뒤 끝부분만 남긴다 */
export function redactedStderrTail(
    text: string,
    secrets: readonly string[],
    maxLength = 600,
): string {
    const redacted = redactSecrets(text, secrets).trim();
    return redacted.length > maxLength ? redacted.slice(redacted.length - maxLength) : redacted;
}
