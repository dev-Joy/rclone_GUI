/**
 * `rclone lsjson` stdout 파서 (MVP_SPEC §7.2). 순수 함수.
 * 비정형 항목이 하나라도 있으면 전체를 실패로 처리한다(잘못된 계획 생성 방지).
 * exit code가 0이 아닐 때는 호출하지 않는다(없는 경로에서 stdout이 "[" 만 나옴).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import type { itfFileMeta } from "@/shared/types/compare";

export class clsLsjsonParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "clsLsjsonParseError";
    }
}

const zLsjsonItem = z.object({
    Path: z.string().min(1),
    Size: z.number(),
    ModTime: z.string().optional(),
    IsDir: z.boolean(),
    Hashes: z.record(z.string(), z.string()).optional(),
});

/** 항목 하나를 검증해 비교용 값으로 바꾼다. 폴더면 null */
function f_ToMeta(raw: unknown, index: number): itfFileMeta | null {
    const parsed = zLsjsonItem.safeParse(raw);
    if (!parsed.success) {
        throw new clsLsjsonParseError(`lsjson ${index}번째 항목 형식이 올바르지 않습니다.`);
    }
    const item = parsed.data;
    if (item.IsDir) return null;
    const ms = item.ModTime ? Date.parse(item.ModTime) : Number.NaN;
    let hashes: Record<string, string> | null = null;
    if (item.Hashes) {
        hashes = {};
        for (const [algo, value] of Object.entries(item.Hashes)) {
            if (value) hashes[algo.toLowerCase()] = value;
        }
    }
    return {
        path: item.Path,
        size: item.Size,
        modTimeMs: Number.isNaN(ms) ? null : ms,
        hashes,
    };
}

export function parseLsjsonOutput(stdout: string): itfFileMeta[] {
    let data: unknown;
    try {
        data = JSON.parse(stdout);
    } catch {
        throw new clsLsjsonParseError("lsjson 출력이 올바른 JSON이 아닙니다.");
    }
    if (!Array.isArray(data)) throw new clsLsjsonParseError("lsjson 출력이 배열이 아닙니다.");

    const files: itfFileMeta[] = [];
    for (const [index, raw] of data.entries()) {
        const meta = f_ToMeta(raw, index);
        if (meta) files.push(meta);
    }
    return files;
}

/** lsjson stdout을 줄 단위로 읽는 파서(전체 출력을 모으지 않는다) */
export interface itfLsjsonLineParser {
    /** 한 줄("[", "{...},", "{...}", "]")을 넣는다. 형식이 틀리면 clsLsjsonParseError */
    push(line: string): void;
    /** "]"까지 받았는지 확인하고 파일 목록을 돌려준다. 폴더(IsDir) 항목은 버린다 */
    finish(): itfFileMeta[];
    /** 지금까지 받은 파일 수(진행 표시용) */
    readonly count: number;
}

/**
 * rclone lsjson은 "[" 다음 한 줄에 항목 하나("{...},")를 쓰고 "]"로 끝낸다
 * (JSON 문자열 안 줄바꿈은 \n으로 이스케이프되므로 한 항목 = 한 줄).
 * 공백 줄은 무시한다. "[" 전·"]" 뒤 내용, "]" 없음은 오류다.
 * exit code가 0이 아니면 finish()를 부르지 않는다(없는 경로에서 "["만 나옴).
 */
export function createLsjsonLineParser(): itfLsjsonLineParser {
    let state: "before" | "items" | "done" = "before";
    let index = 0;
    const files: itfFileMeta[] = [];
    return {
        push(line: string): void {
            const text = line.trim();
            if (text === "") return;
            if (state === "before") {
                if (text === "[]") {
                    state = "done";
                    return;
                }
                if (text !== "[") throw new clsLsjsonParseError("lsjson 출력이 배열이 아닙니다.");
                state = "items";
                return;
            }
            if (state === "done") {
                throw new clsLsjsonParseError("lsjson 출력의 배열 뒤에 내용이 있습니다.");
            }
            if (text === "]") {
                state = "done";
                return;
            }
            const body = text.endsWith(",") ? text.slice(0, -1) : text;
            let raw: unknown;
            try {
                raw = JSON.parse(body);
            } catch {
                throw new clsLsjsonParseError(`lsjson ${index}번째 항목이 올바른 JSON이 아닙니다.`);
            }
            const meta = f_ToMeta(raw, index);
            index += 1;
            if (meta) files.push(meta);
        },
        finish(): itfFileMeta[] {
            if (state !== "done") throw new clsLsjsonParseError("lsjson 출력이 끝나지 않았습니다.");
            return files;
        },
        get count(): number {
            return files.length;
        },
    };
}

/** probe용 항목(폴더 포함) */
export interface itfLsjsonEntry {
    path: string;
    name: string;
    isDir: boolean;
    size: number;
}

const zLsjsonEntry = zLsjsonItem.extend({ Name: z.string().min(1) });

/** `lsjson --max-depth 1` 결과. 폴더도 돌려준다(경로 확인용). exit 0일 때만 호출한다 */
export function parseLsjsonEntries(stdout: string): itfLsjsonEntry[] {
    let data: unknown;
    try {
        data = JSON.parse(stdout);
    } catch {
        throw new clsLsjsonParseError("lsjson 출력이 올바른 JSON이 아닙니다.");
    }
    if (!Array.isArray(data)) throw new clsLsjsonParseError("lsjson 출력이 배열이 아닙니다.");
    return data.map((raw, index) => {
        const parsed = zLsjsonEntry.safeParse(raw);
        if (!parsed.success) {
            throw new clsLsjsonParseError(`lsjson ${index}번째 항목 형식이 올바르지 않습니다.`);
        }
        const item = parsed.data;
        return { path: item.Path, name: item.Name, isDir: item.IsDir, size: item.Size };
    });
}
