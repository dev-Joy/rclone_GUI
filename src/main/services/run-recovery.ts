/**
 * 실행 중 앱이 비정상 종료됐을 때 남은 rclone 정리 (MVP_SPEC §8.5 고아 프로세스 복구).
 *
 * - clsActiveRunStore: 실행이 시작되면 userData/active-run.json에 runId·jobId·pid·이미지 이름을 원자적으로 쓰고,
 *   프로세스 종료를 확인하면 지운다. 쓰기·지우기는 순서대로 처리한다(지우기가 쓰기를 앞지르지 않게).
 * - recoverActiveRun: 앱 시작 때 파일이 남아 있으면 tasklist.exe로 그 PID를 확인하고,
 *   이미지 이름이 같을 때만 프로세스 트리를 종료한다. 확인하지 못하면 종료하지 않고 안내만 한다(PID 재사용 보호).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

// ========== Internal imports ==========
import type { clsLogger } from "@/main/lib/logger";
import { clsMutex } from "@/main/lib/mutex";
import { parseTasklistCsv } from "@/main/parsers/run-output";
import { killProcessTree } from "@/main/rclone/process";
import { writeJsonAtomic } from "@/main/store/json-store";
import type { itfAppNotice } from "@/shared/ipc-contract";
import { zActiveRunFile, type typActiveRunFile } from "@/shared/schemas/run";

export const ACTIVE_RUN_FILE = "active-run.json";
const TASKLIST_TIMEOUT_MS = 10_000;

export class clsActiveRunStore {
    private readonly file: string;
    private readonly mutex = new clsMutex();

    constructor(userDataDir: string) {
        this.file = join(userDataDir, ACTIVE_RUN_FILE);
    }

    write(rec: typActiveRunFile): Promise<void> {
        const value = zActiveRunFile.parse(rec);
        return this.mutex.runExclusive(() => writeJsonAtomic(this.file, value));
    }

    /** 없거나 형식이 맞지 않으면 null */
    read(): Promise<typActiveRunFile | null> {
        return this.mutex.runExclusive(async () => {
            let text: string;
            try {
                text = await readFile(this.file, "utf8");
            } catch {
                return null;
            }
            try {
                const r = zActiveRunFile.safeParse(JSON.parse(text));
                return r.success ? r.data : null;
            } catch {
                return null;
            }
        });
    }

    /** 파일과 백업(.bak)을 지운다 */
    clear(): Promise<void> {
        return this.mutex.runExclusive(async () => {
            await rm(this.file, { force: true });
            await rm(`${this.file}.bak`, { force: true });
        });
    }
}

/** tasklist 출력(stdout). 실행하지 못하면 null */
export type typQueryTasks = (pid: number) => Promise<string | null>;

/** Windows tasklist.exe로 PID 하나를 조회한다(shell 없이) */
export const queryTasklist: typQueryTasks = (pid) => {
    if (process.platform !== "win32") return Promise.resolve(null);
    const root = process.env.SystemRoot ?? "C:\\Windows";
    return new Promise((resolve) => {
        execFile(
            `${root}\\System32\\tasklist.exe`,
            ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
            { shell: false, windowsHide: true, timeout: TASKLIST_TIMEOUT_MS, encoding: "utf8" },
            (err, stdout) => resolve(err ? null : stdout),
        );
    });
};

export interface itfRecoverDeps {
    store: Pick<clsActiveRunStore, "read" | "clear">;
    logger: Pick<clsLogger, "info" | "warn">;
    queryTasks?: typQueryTasks;
    kill?: (pid: number) => Promise<void>;
}

export type typRecoverResult =
    | { kind: "none" }
    /** 프로세스가 이미 없음 */
    | { kind: "gone"; pid: number }
    | { kind: "killed"; pid: number; notice: itfAppNotice }
    /** 같은 PID를 다른 프로그램이 쓰고 있음(종료하지 않음) */
    | { kind: "reused"; pid: number }
    /** 확인하지 못함(종료하지 않음) */
    | { kind: "unknown"; pid: number; notice: itfAppNotice };

/** 앱 시작 때 한 번. 결과와 관계없이 active-run.json은 지운다(이력은 markInterrupted가 정리) */
export async function recoverActiveRun(deps: itfRecoverDeps): Promise<typRecoverResult> {
    const rec = await deps.store.read();
    if (rec === null) {
        await deps.store.clear().catch(() => undefined);
        return { kind: "none" };
    }
    const { pid } = rec;
    const query = deps.queryTasks ?? queryTasklist;
    const kill = deps.kill ?? killProcessTree;
    let result: typRecoverResult;
    const out = await query(pid).catch(() => null);
    if (out === null) {
        result = {
            kind: "unknown",
            pid,
            notice: {
                level: "warning",
                message: `지난번 실행의 rclone 프로세스(PID ${pid})가 남아 있는지 확인하지 못했습니다. 작업 관리자에서 ${rec.imageName}(PID ${pid})를 확인하세요.`,
            },
        };
    } else {
        const row = parseTasklistCsv(out).find((r) => r.pid === pid);
        if (!row) {
            result = { kind: "gone", pid };
        } else if (row.imageName.toLowerCase() !== rec.imageName.toLowerCase()) {
            result = { kind: "reused", pid };
        } else {
            await kill(pid).catch(() => undefined);
            result = {
                kind: "killed",
                pid,
                notice: {
                    level: "warning",
                    message: `지난번 앱 종료 때 남아 있던 rclone 프로세스(PID ${pid})를 종료했습니다.`,
                },
            };
        }
    }
    deps.logger.info(`active-run 복구: run=${rec.runId} pid=${pid} 결과=${result.kind}`);
    await deps.store.clear().catch((e: unknown) => {
        deps.logger.warn(`active-run 삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    });
    return result;
}
