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
import { parseLogLine, type itfParsedLogLine } from "@/main/parsers/log-parser";
import { classifyAbnormalExit, formatExitCode, toInt32ExitCode } from "@/shared/exit-code";
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
 * dry-run 로그 수집기. 폴더 수정시간("set directory modification time")은 파서가 dirTime으로 나누므로
 * 세지 않는다(rclone-notes #26). touch는 size가 있는 줄만 센다(rclone-notes #6).
 * backupMove(--backup-dir의 덮어쓰기 이동)는 copy 줄이 따로 나오므로 세지 않는다(rclone-notes #28).
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
    /** 원값(부호 없는 DWORD) 또는 정규화 값 모두 허용(내부에서 정규화) */
    exitCode: number | null;
    /** 마지막 stats (없으면 null) */
    stats: typRunStats | null;
    /** 마지막 오류 줄 몇 개(비밀값 가림). 오류 detail로 쓴다 */
    errorLines: readonly string[];
    /** 자주 나는 오류 안내(hintForRcloneError) */
    hint: string | null;
    /** rclone stderr 끝부분(process.ts의 stderrTail). Go 충돌·신호 표지 확인용 */
    stderrTail: string;
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

function f_WithHint(message: string, hint: string | null): string {
    return hint ? `${message} ${hint}` : message;
}

/** stderr 끝부분의 JSON이 아닌 줄이 Go 충돌 표지(`panic: `·`fatal error: `·`Exception 0x`)로 시작하는지 (FR-5) */
function f_HasGoCrashMarker(stderrTail: string): boolean {
    for (const line of stderrTail.split(/\r?\n/)) {
        const p = parseLogLine(line);
        if (!p.raw) continue;
        if (
            line.startsWith("panic: ") ||
            line.startsWith("fatal error: ") ||
            line.startsWith("Exception 0x")
        ) {
            return true;
        }
    }
    return false;
}

/** stderr 끝부분의 JSON 로그 msg가 `Signal received: `로 시작하는지 (FR-5a) */
function f_HasSignalMarker(stderrTail: string): boolean {
    for (const line of stderrTail.split(/\r?\n/)) {
        const p = parseLogLine(line);
        if (p.raw) continue;
        if (p.message.startsWith("Signal received: ")) return true;
    }
    return false;
}

/** 외부 종료(코드) 문구 (FR-8) */
function f_KilledMessage(code: string, hint: string | null): string {
    return f_WithHint(
        `rclone이 외부에서 종료된 것으로 보입니다(종료 코드 ${code}, 오류 기록 없음). 다시 비교한 뒤 실행하면 아직 반영되지 않은 것만 처리합니다. 계속 반복되면 백신이나 다른 프로그램이 rclone을 끝내는지 확인하세요.`,
        hint,
    );
}

/** 중단 신호 종료 문구 (FR-8) */
function f_SignalMessage(code: string, hint: string | null): string {
    return f_WithHint(
        `rclone이 중단 신호를 받고 종료했습니다(종료 코드 ${code}). 다시 비교한 뒤 실행하면 아직 반영되지 않은 것만 처리합니다. 계속 반복되면 다른 프로그램이 rclone에 중단 신호를 보내는지 확인하세요.`,
        hint,
    );
}

/** 충돌 문구 (FR-8) */
function f_CrashedMessage(code: string, hint: string | null): string {
    return f_WithHint(
        `rclone이 비정상 종료했습니다(종료 코드 ${code}). 충돌일 수 있습니다. 다시 실행해도 반복되면 rclone 버전을 바꿔 보세요.`,
        hint,
    );
}

/**
 * 종료 결과 → 상태. 취소 > exit 3 > exit 7 > exit 0(오류 수로 success/partial) > Go 충돌 표지 >
 * exit 1 + 신호 표지 > 외부 종료 집합 > NTSTATUS 충돌 > 그 밖의 실패 (INT-005 FR-7, §6.4)
 */
export function decideRunOutcome(input: itfRunOutcomeInput): itfRunOutcome {
    const { stats, errorLines, hint } = input;
    const exitCode = toInt32ExitCode(input.exitCode);
    if (input.canceled) {
        return {
            status: "canceled",
            error: {
                code: "CANCELED",
                message: "실행을 중지했습니다. 이미 복사된 파일은 대상에 남습니다.",
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
    const shown = formatExitCode(exitCode);
    // Go 충돌 표지는 종료 코드와 상관없이 충돌로 본다(주로 exit 2)
    if (f_HasGoCrashMarker(input.stderrTail)) {
        return {
            status: "failed",
            error: f_Error("RCLONE_CRASHED", f_CrashedMessage(shown, hint), errorLines),
        };
    }
    // 중단 신호는 rclone이 직접 남긴 기록이므로 오류 줄과 상관없이 외부 종료로 본다(FR-3a)
    if (exitCode === 1 && f_HasSignalMarker(input.stderrTail)) {
        return {
            status: "failed",
            error: f_Error("RCLONE_KILLED", f_SignalMessage(shown, hint), errorLines),
        };
    }
    const abnormal = classifyAbnormalExit(exitCode);
    // 오류 줄이 있으면 원인을 단정하지 않고 일반 실패로 둔다(FR-6)
    if (abnormal === "killed" && errorLines.length === 0) {
        return {
            status: "failed",
            error: f_Error("RCLONE_KILLED", f_KilledMessage(shown, hint), errorLines),
        };
    }
    if (abnormal === "crash") {
        return {
            status: "failed",
            error: f_Error("RCLONE_CRASHED", f_CrashedMessage(shown, hint), errorLines),
        };
    }
    return {
        status: "failed",
        error: f_Error(
            "RCLONE_FAILED",
            `rclone이 오류로 끝났습니다(exit ${shown}).${hint ? ` ${hint}` : ""}`,
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
