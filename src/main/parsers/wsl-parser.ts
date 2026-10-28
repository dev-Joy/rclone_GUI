/**
 * `wsl.exe -l -q` 출력 파서. 순수 함수.
 * wsl.exe는 기본으로 UTF-16LE(BOM 있거나 없음)를 내고, WSL_UTF8=1이면 UTF-8을 낸다.
 * 출력 언어는 OS 언어를 따르므로 내용(문구)은 매칭하지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

/**
 * 바이트를 문자열로 바꾼다.
 * - BOM(FF FE) → utf-16le
 * - BOM 없음: 짝수 길이이고 (끝이 0A 00 이거나 홀수 위치 0바이트 비율 ≥ 0.3) → utf-16le
 *   (한글 오류 문구는 홀수 위치가 0이 아니므로 끝의 줄바꿈 0A 00 으로 판정한다)
 * - 그 외 utf-8
 */
export function decodeWslOutput(bytes: Uint8Array): string {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes.length % 2 === 0) {
        const endsWithLf = bytes.at(-2) === 0x0a && bytes.at(-1) === 0x00;
        let zeros = 0;
        for (let i = 1; i < bytes.length; i += 2) {
            if (bytes[i] === 0) zeros += 1;
        }
        if (endsWithLf || zeros / (bytes.length / 2) >= 0.3) {
            return new TextDecoder("utf-16le").decode(bytes);
        }
    }
    return new TextDecoder("utf-8").decode(bytes);
}

/** 배포판 이름 목록. 빈 줄·NUL·BOM 제거, 중복 제거(입력 순서 유지) */
export function parseWslDistroList(text: string): string[] {
    const out: string[] = [];
    // oxlint-disable-next-line no-control-regex -- wsl.exe 출력에 섞인 NUL을 지우기 위한 정규식
    const cleaned = text.replace(/[\u0000﻿]/g, "");
    for (const raw of cleaned.split(/\r?\n/)) {
        const name = raw.replaceAll("\r", "").trim();
        if (name !== "" && !out.includes(name)) out.push(name);
    }
    return out;
}
