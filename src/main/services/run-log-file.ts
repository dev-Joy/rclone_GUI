/**
 * 실행 로그 파일 (logs/run-YYYYMMDD-HHmmss-<job8>-<run8>.log, MVP_SPEC §5.6).
 *
 * - 머리말에 실행 id·모드·인자를 적는다. 인자의 원본·대상 경로는 <원본>/<대상>, 설정 파일 경로는
 *   <설정 파일>로 가린다(maskArgsForLog). rclone.conf 내용은 앱이 읽지 않으므로 쓰지 않는다.
 * - rclone stderr 줄은 원문 그대로 쓰되 모든 줄에 redactSecrets를 거친다.
 * - 쓰기 실패(디스크 가득 참 등)는 삼키고 실행은 계속한다(failed로만 표시).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";

// ========== Internal imports ==========
import { redactSecrets } from "@/main/lib/logger";
import { fileStamp } from "@/main/lib/time";

export const MASK_SOURCE = "<원본>";
export const MASK_DEST = "<대상>";
export const MASK_CONFIG = "<설정 파일>";

/** 실행 로그 파일 이름. 예: run-20261028-173500-1a2b3c4d-5e6f7a8b.log */
export function runLogFileName(at: Date, jobId: string, runId: string): string {
    return `run-${fileStamp(at)}-${jobId.slice(0, 8)}-${runId.slice(0, 8)}.log`;
}

/**
 * 로그 머리말용 인자. "--" 뒤의 원본·대상과 --config 값을 가린다.
 * 제외 패턴·옵션 값은 그대로 둔다.
 */
export function maskArgsForLog(
    args: readonly string[],
    paths: { source: string; destination: string; configPath: string | null },
): string[] {
    const end = args.indexOf("--");
    return args.map((a, i) => {
        if (end !== -1 && i > end) {
            if (a === paths.source) return MASK_SOURCE;
            if (a === paths.destination) return MASK_DEST;
            return a;
        }
        if (i > 0 && args[i - 1] === "--config") return MASK_CONFIG;
        if (a.startsWith("--config=")) return `--config=${MASK_CONFIG}`;
        return a;
    });
}

export interface itfRunLogHeader {
    runId: string;
    jobId: string;
    mode: string;
    dryRun: boolean;
    /** 첫 단계 이름(예: 사전 확인). 있으면 인자 줄 앞에 쓴다 */
    stage?: string;
    /** maskArgsForLog를 거친 인자 */
    args: readonly string[];
}

export class clsRunLogFile {
    readonly fileName: string;
    private readonly logsDir: string;
    private stream: WriteStream | null = null;
    private failed = false;

    constructor(logsDir: string, fileName: string) {
        this.logsDir = logsDir;
        this.fileName = fileName;
    }

    /** 쓰기 중 오류가 있었는지 */
    get hasFailed(): boolean {
        return this.failed;
    }

    /** 파일을 열고 머리말을 쓴다. 실패하면 이후 쓰기를 모두 건너뛴다 */
    open(header: itfRunLogHeader): void {
        try {
            mkdirSync(this.logsDir, { recursive: true });
            const stream = createWriteStream(join(this.logsDir, this.fileName), {
                flags: "a",
                encoding: "utf8",
            });
            stream.on("error", () => {
                this.failed = true;
            });
            this.stream = stream;
        } catch {
            this.failed = true;
            return;
        }
        this.write(
            [
                `# rcloneGUI 실행 로그`,
                `# run=${header.runId} job=${header.jobId} mode=${header.mode} dryRun=${header.dryRun}`,
                ...(header.stage ? [`# 단계: ${header.stage}`] : []),
                `# args: ${header.args.join(" ")}`,
            ].join("\n"),
        );
    }

    /** 같은 실행의 다음 단계(예: 사전 확인 뒤 실제 실행)를 이어 쓴다. args는 maskArgsForLog를 거친 것 */
    section(stage: string, args: readonly string[]): void {
        this.write([`# 단계: ${stage}`, `# args: ${args.join(" ")}`].join("\n"));
    }

    /** 한 줄 쓰기(비밀값 가림). 줄바꿈은 붙여 준다 */
    write(line: string): void {
        if (this.failed || this.stream === null) return;
        try {
            this.stream.write(`${redactSecrets(line)}\n`);
        } catch {
            this.failed = true;
        }
    }

    /** 닫고 디스크에 쓰일 때까지 기다린다(실패해도 resolve) */
    close(): Promise<void> {
        const stream = this.stream;
        this.stream = null;
        if (stream === null) return Promise.resolve();
        return new Promise((resolve) => {
            stream.once("error", () => resolve());
            stream.end(() => resolve());
        });
    }
}
