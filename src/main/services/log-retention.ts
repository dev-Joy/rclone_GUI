/**
 * 실행 로그 파일 보관·읽기 (MVP_SPEC §11.2, intent T-13).
 *
 * - 실행 로그 이름(run-YYYYMMDD-HHmmss-<job8>-<run8>.log)만 다룬다. app.log 등 다른 파일은 건드리지 않는다.
 * - 이름은 정규식·basename을 확인하고, 합친 경로가 logs 폴더 안인지 다시 확인한다(경로 탈출 방지).
 * - 보관 정리: 수정 시각이 보관 일수보다 오래된 실행 로그를 지운다. keep(실행 중 기록의 로그)은 남긴다.
 * - 끝부분 읽기: 끝에서 tailBytes만 읽고, 잘랐으면 첫 줄(중간에서 잘린 줄)을 버린 뒤 줄마다 parseLogLine으로 바꾼다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { open, readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

// ========== Internal imports ==========
import { redactSecrets } from "@/main/lib/logger";
import { parseLogLine } from "@/main/parsers/log-parser";
import type { itfRunLogView } from "@/shared/types/history";
import type { itfRunLogLine } from "@/shared/types/run";

/** 실행 로그 파일 이름 (run-log-file.ts runLogFileName과 같은 모양) */
export const RUN_LOG_NAME = /^run-\d{8}-\d{6}-[0-9a-f]{8}-[0-9a-f]{8}\.log$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/** logs 폴더 안의 실행 로그 경로. 이름이 실행 로그 모양이 아니거나 폴더 밖이면 null */
export function runLogPath(logsDir: string, fileName: string): string | null {
    if (!RUN_LOG_NAME.test(fileName) || basename(fileName) !== fileName) return null;
    const root = resolve(logsDir);
    const full = resolve(join(root, fileName));
    if (!full.startsWith(root + sep)) return null;
    return full;
}

/**
 * 보관 일수가 지난 실행 로그를 지운다. 지운 개수를 돌려준다(폴더가 없거나 지우지 못한 파일은 건너뜀).
 */
export async function pruneRunLogs(
    logsDir: string,
    retentionDays: number,
    now: Date,
    keep: ReadonlySet<string>,
): Promise<number> {
    let names: string[];
    try {
        names = await readdir(logsDir);
    } catch {
        return 0;
    }
    const limit = now.getTime() - retentionDays * DAY_MS;
    let removed = 0;
    for (const name of names) {
        if (keep.has(name)) continue;
        const full = runLogPath(logsDir, name);
        if (full === null) continue;
        try {
            const st = await stat(full);
            if (!st.isFile() || st.mtimeMs >= limit) continue;
            await rm(full, { force: true });
            removed += 1;
        } catch {
            // 다른 프로그램이 열고 있는 등: 다음 정리 때 다시 시도한다
        }
    }
    return removed;
}

/** 이름이 맞는 실행 로그만 지운다. 지운 개수 */
export async function deleteRunLogs(
    logsDir: string,
    fileNames: readonly string[],
): Promise<number> {
    let removed = 0;
    for (const name of fileNames) {
        const full = runLogPath(logsDir, name);
        if (full === null) continue;
        try {
            await stat(full);
            await rm(full, { force: true });
            removed += 1;
        } catch {
            // 없거나 지우지 못함
        }
    }
    return removed;
}

function f_ToLine(raw: string): itfRunLogLine {
    const p = parseLogLine(raw);
    const message = redactSecrets(
        p.stats ? `stats: 전송 ${p.stats.transfers}/${p.stats.totalTransfers}` : p.message,
    );
    return {
        at: p.at ?? "",
        level: p.level,
        message,
        ...(p.object === null ? {} : { object: p.object }),
    };
}

/**
 * 실행 로그 끝부분을 읽는다. 이름이 잘못되면 VALIDATION 대신 빈 결과(exists:false)를 돌려준다
 * (이력 레코드에서 온 이름만 넘어오므로 정상 경로에서는 일어나지 않는다).
 */
export async function readRunLogTail(
    logsDir: string,
    fileName: string,
    tailBytes: number,
): Promise<itfRunLogView> {
    const empty: itfRunLogView = {
        fileName,
        exists: false,
        sizeBytes: 0,
        truncated: false,
        lines: [],
    };
    const full = runLogPath(logsDir, fileName);
    if (full === null) return empty;
    let handle;
    try {
        handle = await open(full, "r");
    } catch {
        return empty;
    }
    try {
        const { size } = await handle.stat();
        const length = Math.min(size, Math.max(0, tailBytes));
        const buf = Buffer.alloc(length);
        if (length > 0) await handle.read(buf, 0, length, size - length);
        const truncated = length < size;
        let text = buf.toString("utf8");
        if (truncated) {
            const nl = text.indexOf("\n");
            text = nl === -1 ? "" : text.slice(nl + 1);
        }
        const lines = text
            .split(/\r?\n/)
            .filter((l) => l.trim() !== "")
            .map(f_ToLine);
        return { fileName, exists: true, sizeBytes: size, truncated, lines };
    } finally {
        await handle.close();
    }
}
