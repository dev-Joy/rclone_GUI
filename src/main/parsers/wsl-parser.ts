/**
 * `wsl.exe -l -q` 출력 파서. 순수 함수.
 * wsl.exe는 기본으로 UTF-16LE(BOM 있거나 없음)를 내고, WSL_UTF8=1이면 UTF-8을 낸다.
 * 출력 언어는 OS 언어를 따르므로 내용(문구)은 매칭하지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { utf16Offset } from "./console-output";

/**
 * 바이트를 문자열로 바꾼다. UTF-16LE 판정은 console-output의 utf16Offset과 같고,
 * 그 외에는 utf-8(잘못된 바이트는 대체 문자)로 읽는다.
 */
export function decodeWslOutput(bytes: Uint8Array): string {
    const off = utf16Offset(bytes);
    if (off !== null) return new TextDecoder("utf-16le").decode(bytes.subarray(off));
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
