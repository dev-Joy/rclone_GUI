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
        const parsed = zLsjsonItem.safeParse(raw);
        if (!parsed.success) {
            throw new clsLsjsonParseError(`lsjson ${index}번째 항목 형식이 올바르지 않습니다.`);
        }
        const item = parsed.data;
        if (item.IsDir) continue;
        const ms = item.ModTime ? Date.parse(item.ModTime) : Number.NaN;
        let hashes: Record<string, string> | null = null;
        if (item.Hashes) {
            hashes = {};
            for (const [algo, value] of Object.entries(item.Hashes)) {
                if (value) hashes[algo.toLowerCase()] = value;
            }
        }
        files.push({
            path: item.Path,
            size: item.Size,
            modTimeMs: Number.isNaN(ms) ? null : ms,
            hashes,
        });
    }
    return files;
}
