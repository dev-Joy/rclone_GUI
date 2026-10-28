/**
 * WSL 배포판 목록 (`wsl.exe -l -q`). 배포판을 시작하지 않는다(-l -q는 목록만 읽음).
 * 출력 문구는 OS 언어를 따르므로 내용으로 판단하지 않고 종료 코드만 본다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { summarizeStderr } from "@/main/parsers/rclone-env-parser";
import { decodeWslOutput, parseWslDistroList } from "@/main/parsers/wsl-parser";
import { clsProcessSpawnError, runProcess, type typRunProcess } from "@/main/rclone/process";
import type { itfWslDistros } from "@/shared/ipc-contract";

export interface itfWslDeps {
    run: typRunProcess;
    env: Readonly<Record<string, string | undefined>>;
}

const WSL_TIMEOUT_MS = 10_000;

export class clsWslService {
    private readonly deps: itfWslDeps;

    constructor(init: Partial<itfWslDeps> = {}) {
        this.deps = { run: runProcess, env: process.env, ...init };
    }

    async listDistros(): Promise<itfWslDistros> {
        const file = `${this.deps.env.SystemRoot ?? "C:\\Windows"}\\System32\\wsl.exe`;
        let r;
        try {
            r = await this.deps.run(file, ["-l", "-q"], { timeoutMs: WSL_TIMEOUT_MS });
        } catch (e) {
            if (e instanceof clsProcessSpawnError) {
                throw new clsAppError("WSL_NOT_AVAILABLE", undefined, `wsl.exe: ${e.errno}`);
            }
            throw e;
        }
        if (r.timedOut) {
            throw new clsAppError("WSL_NOT_AVAILABLE", "wsl.exe가 응답하지 않습니다.");
        }
        const text = decodeWslOutput(r.stdoutBytes);
        if (r.exitCode !== 0) {
            throw new clsAppError(
                "WSL_NOT_AVAILABLE",
                undefined,
                summarizeStderr(`${text}\n${r.stderrTail}`),
            );
        }
        return { distros: parseWslDistroList(text) };
    }
}
