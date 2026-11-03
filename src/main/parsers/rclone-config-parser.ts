/**
 * remote 설정 출력 파서 (INT-006 T-02·T-05).
 * - rcd 시작 줄에서 포트를 읽는다.
 * - rc `config/create`·`update` 응답의 State·Option·Error를 읽는다(질문 흐름, FR-15a).
 * - `config redacted` 출력(INI)에서 종류와 비밀 아닌 값 후보를 읽는다(FR-17).
 *   비밀 판정·`XXX` 제거는 서비스가 providers 정의로 한 번 더 한다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { z } from "zod";

/** rcd 시작 줄에서 포트. 없으면 null */
export function parseRcdStartLine(line: string): number | null {
    const m = /Serving remote control on http:\/\/127\.0\.0\.1:(\d+)\//.exec(line);
    if (!m) return null;
    const port = Number(m[1]);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

const zRcResponse = z
    .object({
        State: z.string().optional(),
        Option: z.unknown().optional(),
        Error: z.string().optional(),
        Result: z.string().optional(),
    })
    .loose();

export interface itfRcConfigResponse {
    state: string;
    /** 질문 Option 원문(파서가 화면 정의로 바꾼다) */
    option: unknown;
    error: string;
}

/** rc 설정 응답. 형식이 다르면 빈 응답으로 본다(성공 응답은 `{}`다) */
export function parseRcConfigResponse(raw: unknown): itfRcConfigResponse {
    const r = zRcResponse.safeParse(raw);
    if (!r.success) return { state: "", option: null, error: "" };
    return {
        state: r.data.State ?? "",
        option: r.data.Option ?? null,
        error: r.data.Error ?? "",
    };
}

export interface itfRedactedConfig {
    type: string | null;
    /** 비밀 여부를 모르는 상태의 key=value. 값이 `XXX`면 rclone이 가린 것이다 */
    entries: Record<string, string>;
}

/** `rclone config redacted <name>` 출력(INI) 파서. 주석·섹션 줄은 건너뛴다 */
export function parseRedactedConfig(text: string): itfRedactedConfig {
    const entries: Record<string, string> = {};
    let type: string | null = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
        if (line.startsWith("[") && line.endsWith("]")) continue;
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (key === "") continue;
        if (key === "type") {
            type = value;
            continue;
        }
        entries[key] = value;
    }
    return { type, entries };
}

/** rclone이 가린 값인지(notes #43) */
export function isRedactedValue(value: string): boolean {
    return value === "XXX" || value === "*** ENCRYPTED ***";
}
