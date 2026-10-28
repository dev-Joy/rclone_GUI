/**
 * 앱 로그(logs/app.log). 5MB를 넘으면 app.1.log로 돌린다.
 * rclone.conf 내용·토큰·비밀번호는 기록하지 않는다. 혹시 섞여 들어와도 값 부분을 가린다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export type typAppLogLevel = "info" | "warn" | "error";

export const APP_LOG_MAX_BYTES = 5 * 1024 * 1024;

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
    /("?(?:access_token|refresh_token|token|password|pass|secret|client_secret)"?\s*[:=]\s*)("[^"]*"|\S+)/gi,
];

export function redactSecrets(text: string): string {
    let out = text;
    for (const re of SECRET_PATTERNS) out = out.replace(re, "$1***");
    return out;
}

export class clsLogger {
    private readonly file: string;
    private readonly rotated: string;

    constructor(logsDir: string) {
        mkdirSync(logsDir, { recursive: true });
        this.file = join(logsDir, "app.log");
        this.rotated = join(logsDir, "app.1.log");
    }

    info(message: string, extra?: unknown): void {
        this.write("info", message, extra);
    }

    warn(message: string, extra?: unknown): void {
        this.write("warn", message, extra);
    }

    error(message: string, extra?: unknown): void {
        this.write("error", message, extra);
    }

    private write(level: typAppLogLevel, message: string, extra?: unknown): void {
        let line = `${new Date().toISOString()} [${level}] ${message}`;
        if (extra !== undefined) line += ` ${f_Describe(extra)}`;
        try {
            this.rotateIfNeeded();
            appendFileSync(this.file, `${redactSecrets(line)}\n`, "utf8");
        } catch {
            // 로그 실패로 앱을 멈추지 않는다
        }
    }

    private rotateIfNeeded(): void {
        let size = 0;
        try {
            size = statSync(this.file).size;
        } catch {
            return;
        }
        if (size < APP_LOG_MAX_BYTES) return;
        rmSync(this.rotated, { force: true });
        renameSync(this.file, this.rotated);
    }
}

function f_Describe(extra: unknown): string {
    if (extra instanceof Error)
        return `${extra.name}: ${extra.message}${extra.stack ? `\n${extra.stack}` : ""}`;
    try {
        return JSON.stringify(extra);
    } catch {
        return String(extra);
    }
}
