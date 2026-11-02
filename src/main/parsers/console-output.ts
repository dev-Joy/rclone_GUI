/**
 * Windows 콘솔 프로그램(wsl.exe·schtasks.exe 등) 출력 바이트 해독. 순수 함수.
 *
 * - UTF-16LE(BOM 있거나 없음)는 확실히 해독한다.
 * - 그 밖에는 UTF-8로 엄격하게 시도하고, 맞지 않으면 코드페이지 출력(CP949 등)으로 보고
 *   바이트를 latin1로 보존한다(reliable: false — 비ASCII 문자는 원래 글자가 아니다).
 * - schtasks는 파이프로 받으면 UTF-16이 아니라 콘솔 코드페이지로 낸다(windows-task-scheduler-notes #1).
 *
 * @author dev-Joy 2026-11-02
 */

export type typConsoleEncoding = "utf16le" | "utf8" | "codepage";

export interface itfConsoleText {
    text: string;
    /** 비ASCII 글자까지 원래대로 해독했다고 믿을 수 있는지 */
    reliable: boolean;
    encoding: typConsoleEncoding;
}

/**
 * UTF-16LE로 보이면 본문 시작 위치(BOM 2 또는 0), 아니면 null.
 * - BOM(FF FE) → utf-16le
 * - BOM 없음: 짝수 길이이고 (끝이 0A 00 이거나 홀수 위치 0바이트 비율 ≥ 0.3) → utf-16le
 *   (한글 오류 문구는 홀수 위치가 0이 아니므로 끝의 줄바꿈 0A 00 으로 판정한다)
 */
export function utf16Offset(bytes: Uint8Array): number | null {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 2;
    if (bytes.length >= 2 && bytes.length % 2 === 0) {
        const endsWithLf = bytes.at(-2) === 0x0a && bytes.at(-1) === 0x00;
        let zeros = 0;
        for (let i = 1; i < bytes.length; i += 2) {
            if (bytes[i] === 0) zeros += 1;
        }
        if (endsWithLf || zeros / (bytes.length / 2) >= 0.3) return 0;
    }
    return null;
}

/** 바이트 하나를 글자 하나로(latin1). 코드페이지 출력의 ASCII 부분은 그대로 읽힌다 */
function f_Latin1(bytes: Uint8Array): string {
    let out = "";
    for (let i = 0; i < bytes.length; i += 4096) {
        out += String.fromCharCode(...bytes.subarray(i, i + 4096));
    }
    return out;
}

/** 출력 바이트를 문자열로. UTF-16LE → UTF-8(엄격) → 코드페이지(latin1, reliable false) */
export function decodeConsoleOutput(bytes: Uint8Array): itfConsoleText {
    const off = utf16Offset(bytes);
    if (off !== null) {
        return {
            text: new TextDecoder("utf-16le").decode(bytes.subarray(off)),
            reliable: true,
            encoding: "utf16le",
        };
    }
    try {
        return {
            text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            reliable: true,
            encoding: "utf8",
        };
    } catch {
        return { text: f_Latin1(bytes), reliable: false, encoding: "codepage" };
    }
}
