/**
 * rclone `-v --use-json-log --stats 1s` stderr 한 줄 파서 (MVP_SPEC §8.3). 순수 함수.
 * 어떤 입력에도 예외를 던지지 않는다. JSON이 아니면 raw 로그로 돌려준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import type { typRunStats } from "@/shared/schemas/run";

export type typLogLevel = "debug" | "info" | "notice" | "warning" | "error";

/**
 * dry-run에서 건너뛴 동작.
 * copy/delete는 계획 수에 들어가고, touch(수정시간만 갱신)·dir 동작은 들어가지 않는다.
 */
export type typSkipKind = "copy" | "delete" | "touch" | "removeDir" | "other";

export interface itfParsedLogLine {
    raw: boolean;
    level: typLogLevel;
    message: string;
    at: string | null;
    object: string | null;
    size: number | null;
    skipped: typSkipKind | null;
    stats: typRunStats | null;
}

/** UI 이벤트용 메시지 최대 길이. 원문은 로그 파일에 그대로 남긴다 */
export const MAX_MESSAGE_LENGTH = 8 * 1024;

const LEVELS: ReadonlySet<string> = new Set(["debug", "info", "notice", "warning", "error"]);
const ERROR_LEVELS: ReadonlySet<string> = new Set(["critical", "alert", "emergency", "fatal"]);

function f_Level(value: unknown): typLogLevel {
    if (typeof value !== "string") return "info";
    const v = value.toLowerCase();
    if (LEVELS.has(v)) return v as typLogLevel;
    if (v === "warn") return "warning";
    if (ERROR_LEVELS.has(v)) return "error";
    return "info";
}

function f_Truncate(text: string): string {
    return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}

function f_Skip(value: unknown): typSkipKind | null {
    if (typeof value !== "string") return null;
    switch (value) {
        case "copy":
            return "copy";
        case "delete":
            return "delete";
        case "update modification time":
        case "set directory modification time":
            return "touch";
        case "remove directory":
            return "removeDir";
        default:
            return "other";
    }
}

const zNum = z.number().finite();
const zCount = z
    .number()
    .finite()
    .transform((n) => Math.max(0, Math.trunc(n)));

const zRawStats = z.object({
    bytes: zCount.default(0),
    totalBytes: zCount.default(0),
    transfers: zCount.default(0),
    totalTransfers: zCount.default(0),
    deletes: zCount.default(0),
    deletedDirs: zCount.default(0),
    checks: zCount.default(0),
    totalChecks: zCount.default(0),
    listed: zCount.default(0),
    errors: zCount.default(0),
    speed: zNum.nullable().optional(),
    eta: zNum.nullable().optional(),
    elapsedTime: zNum.default(0),
    fatalError: z.boolean().default(false),
    lastError: z.string().nullable().optional(),
});

/** rclone stats 객체를 앱의 RunStats로 바꾼다. 형식이 맞지 않으면 null */
export function normalizeStats(raw: unknown): typRunStats | null {
    const r = zRawStats.safeParse(raw);
    if (!r.success) return null;
    const s = r.data;
    return {
        bytes: s.bytes,
        totalBytes: s.totalBytes,
        transfers: s.transfers,
        totalTransfers: s.totalTransfers,
        deletes: s.deletes,
        deletedDirs: s.deletedDirs,
        checks: s.checks,
        totalChecks: s.totalChecks,
        listed: s.listed,
        errors: s.errors,
        speedBps: s.speed == null ? null : Math.max(0, s.speed),
        etaSeconds: s.eta == null ? null : Math.max(0, s.eta),
        elapsedMs: Math.max(0, Math.round(s.elapsedTime * 1000)),
        fatalError: s.fatalError,
        lastError: s.lastError ? s.lastError : null,
    };
}

function f_RawLine(line: string): itfParsedLogLine {
    return {
        raw: true,
        level: /\bERROR\b/.test(line) ? "error" : "info",
        message: f_Truncate(line),
        at: null,
        object: null,
        size: null,
        skipped: null,
        stats: null,
    };
}

export function parseLogLine(input: string): itfParsedLogLine {
    const line = input.replace(/\r$/, "");
    if (!line.trimStart().startsWith("{")) return f_RawLine(line);
    let obj: unknown;
    try {
        obj = JSON.parse(line);
    } catch {
        return f_RawLine(line);
    }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return f_RawLine(line);
    const o = obj as Record<string, unknown>;
    const msg = typeof o.msg === "string" ? o.msg : "";
    return {
        raw: false,
        level: f_Level(o.level),
        message: f_Truncate(msg.trim()),
        at: typeof o.time === "string" ? o.time : null,
        object: typeof o.object === "string" ? o.object : null,
        size: typeof o.size === "number" && Number.isFinite(o.size) ? o.size : null,
        skipped: f_Skip(o.skipped),
        stats: "stats" in o ? normalizeStats(o.stats) : null,
    };
}
