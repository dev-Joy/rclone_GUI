/**
 * 실행(copy·sync) 출력 해석. 순수 함수 (tests/fixtures의 실제 rclone 출력으로 테스트).
 *
 * - createDryRunCollector: dry-run 로그의 skipped 동작을 세고 샘플을 모은다.
 * - decideRunOutcome: 종료 결과 → 이력 상태·오류 (MVP_SPEC §8.6, 취소가 최우선).
 * - parseTasklistCsv: `tasklist /FO CSV /NH` 출력 → 이미지 이름·PID (고아 rclone 확인용).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { itfParsedLogLine } from "@/main/parsers/log-parser";
import type { typAppErrorPayload, typRunStatus } from "@/shared/schemas/common";
import type { typRunStats } from "@/shared/schemas/run";
import { DRY_RUN_SAMPLE_LIMIT, type itfDryRunSummary } from "@/shared/types/run";

export interface itfDryRunCollector {
    push(line: itfParsedLogLine): void;
    /** 지금까지 센 결과(복사본) */
    summary(): itfDryRunSummary;
}

function f_Sample(list: string[], object: string | null, limit: number): void {
    if (object !== null && list.length < limit) list.push(object);
}

/**
 * dry-run 로그 수집기. "update modification time"(파일)과 "set directory modification time"(폴더)은
 * 파서에서 둘 다 touch이므로 size 유무로 나눈다(폴더 줄에는 size가 없다, rclone-notes #6).
 */
export function createDryRunCollector(sampleLimit = DRY_RUN_SAMPLE_LIMIT): itfDryRunCollector {
    const s: itfDryRunSummary = {
        copyFiles: 0,
        copyBytes: 0,
        deleteFiles: 0,
        deleteBytes: 0,
        touchFiles: 0,
        removeDirs: 0,
        copySamples: [],
        deleteSamples: [],
        touchSamples: [],
    };
    return {
        push: (line) => {
            switch (line.skipped) {
                case "copy":
                    s.copyFiles += 1;
                    s.copyBytes += Math.max(0, line.size ?? 0);
                    f_Sample(s.copySamples, line.object, sampleLimit);
                    break;
                case "delete":
                    s.deleteFiles += 1;
                    s.deleteBytes += Math.max(0, line.size ?? 0);
                    f_Sample(s.deleteSamples, line.object, sampleLimit);
                    break;
                case "touch":
                    if (line.size === null) break;
                    s.touchFiles += 1;
                    f_Sample(s.touchSamples, line.object, sampleLimit);
                    break;
                case "removeDir":
                    s.removeDirs += 1;
                    break;
                default:
                    break;
            }
        },
        summary: () => ({
            ...s,
            copySamples: [...s.copySamples],
            deleteSamples: [...s.deleteSamples],
            touchSamples: [...s.touchSamples],
        }),
    };
}

export interface itfRunOutcomeInput {
    /** 사용자가 취소했거나 프로세스가 취소로 끝남 */
    canceled: boolean;
    exitCode: number | null;
    /** 마지막 stats (없으면 null) */
    stats: typRunStats | null;
    /** 마지막 오류 줄 몇 개(비밀값 가림). 오류 detail로 쓴다 */
    errorLines: readonly string[];
    /** 자주 나는 오류 안내(hintForRcloneError) */
    hint: string | null;
}

export interface itfRunOutcome {
    status: typRunStatus;
    error: typAppErrorPayload | null;
}

function f_Error(
    code: typAppErrorPayload["code"],
    message: string,
    lines: readonly string[],
): typAppErrorPayload {
    return lines.length > 0 ? { code, message, detail: lines.join("\n") } : { code, message };
}

/** 종료 결과 → 상태. 취소 > exit 3 > exit 7 > exit 0(오류 수로 success/partial) > 그 밖의 실패 */
export function decideRunOutcome(input: itfRunOutcomeInput): itfRunOutcome {
    const { exitCode, stats, errorLines } = input;
    if (input.canceled) {
        return {
            status: "canceled",
            error: {
                code: "CANCELED",
                message: "실행을 취소했습니다. 이미 복사된 파일은 대상에 남습니다.",
            },
        };
    }
    if (exitCode === 3) {
        return {
            status: "failed",
            error: f_Error(
                "PATH_NOT_FOUND",
                "원본 또는 대상 폴더를 찾지 못했습니다. 경로를 확인하세요.",
                errorLines,
            ),
        };
    }
    if (exitCode === 7) {
        return {
            status: "failed",
            error: f_Error(
                "MAX_DELETE_EXCEEDED",
                "삭제 안전 한도를 넘어 중단했습니다. 일부 파일은 이미 반영되었을 수 있습니다.",
                errorLines,
            ),
        };
    }
    if (exitCode === 0) {
        const errors = stats?.errors ?? 0;
        if (errors > 0) {
            return {
                status: "partial",
                error: f_Error(
                    "RCLONE_FAILED",
                    `오류 ${errors}건이 있었습니다. 로그를 확인하세요.`,
                    errorLines,
                ),
            };
        }
        return { status: "success", error: null };
    }
    const code = exitCode === null ? "알 수 없음" : String(exitCode);
    return {
        status: "failed",
        error: f_Error(
            "RCLONE_FAILED",
            `rclone이 오류로 끝났습니다(exit ${code}).${input.hint ? ` ${input.hint}` : ""}`,
            errorLines,
        ),
    };
}

export interface itfTasklistRow {
    imageName: string;
    pid: number;
}

/** CSV 한 줄의 따옴표 필드들 */
function f_CsvFields(line: string): string[] {
    const fields: string[] = [];
    const re = /"((?:[^"]|"")*)"/g;
    for (const m of line.matchAll(re)) fields.push(m[1]!.replaceAll('""', '"'));
    return fields;
}

/**
 * `tasklist /FI "PID eq N" /FO CSV /NH` 출력 해석. 예: "rclone.exe","1234","Console","1","12,345 K"
 * 일치하는 프로세스가 없을 때의 안내("INFO: …", 한국어 "정보: …")와 형식이 다른 줄은 무시한다.
 */
export function parseTasklistCsv(stdout: string): itfTasklistRow[] {
    const rows: itfTasklistRow[] = [];
    for (const raw of stdout.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line.startsWith('"')) continue;
        const fields = f_CsvFields(line);
        const image = fields[0];
        const pidText = fields[1];
        if (!image || !pidText || !/^\d+$/.test(pidText)) continue;
        rows.push({ imageName: image, pid: Number(pidText) });
    }
    return rows;
}
