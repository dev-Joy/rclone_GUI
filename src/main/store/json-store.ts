/**
 * 원자적 JSON 파일 저장소 (MVP_SPEC §5.6).
 *
 * 쓰기: tmp 기록 + fsync → 기존 파일을 .bak으로 복사 → rename(EPERM/EBUSY면 50ms 간격 3회 재시도).
 * 읽기: 본 파일 → .bak → 둘 다 실패하면 본 파일을 .corrupt-<시각>으로 옮기고 기본값으로 시작.
 * 버전이 다르면 지우지 않고 .unsupported-<시각>으로 복사해 둔 뒤 기본값으로 시작한다.
 * 모든 변경은 mutex로 직렬화하고, 디스크 기록이 성공한 뒤에만 메모리 값을 바꾼다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { clsMutex } from "@/main/lib/mutex";
import { fileStamp } from "@/main/lib/time";
import type { itfAppNotice } from "@/shared/ipc-contract";

export interface itfJsonStoreOptions<T> {
    file: string;
    /** 사용자에게 보일 파일 설명. 예: "작업 목록" */
    label: string;
    schema: z.ZodType<T>;
    createDefault: () => T;
    /** 검증 전 원본 데이터 보정(예: 새로 생긴 설정 항목을 기본값으로 채움) */
    prepare?: (data: unknown) => unknown;
    onNotice?: (notice: itfAppNotice) => void;
}

type typReadResult<T> =
    | { kind: "ok"; value: T }
    | { kind: "missing" }
    | { kind: "unsupported"; version: unknown }
    | { kind: "invalid"; reason: string };

const RENAME_RETRY = 3;
const RENAME_BACKOFF_MS = 50;
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);

function f_Sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function f_ErrCode(e: unknown): string | undefined {
    return typeof e === "object" && e !== null && "code" in e
        ? String((e as { code: unknown }).code)
        : undefined;
}

/** tmp → fsync → .bak 복사 → rename. 실패하면 tmp를 지우고 STORE_ERROR */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    const data = `${JSON.stringify(value, null, 2)}\n`;
    try {
        await mkdir(dirname(file), { recursive: true });
        const fh = await open(tmp, "w");
        try {
            await fh.writeFile(data, "utf8");
            await fh.sync();
        } finally {
            await fh.close();
        }
        // .bak은 best-effort. 첫 저장(본 파일 없음)이나 복사 실패여도 본 파일 쓰기는 계속한다
        await copyFile(file, `${file}.bak`).catch(() => undefined);
        for (let attempt = 0; ; attempt += 1) {
            try {
                await rename(tmp, file);
                return;
            } catch (e) {
                if (attempt >= RENAME_RETRY - 1 || !RETRYABLE.has(f_ErrCode(e) ?? "")) throw e;
                await f_Sleep(RENAME_BACKOFF_MS * (attempt + 1));
            }
        }
    } catch (e) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw new clsAppError("STORE_ERROR", undefined, e instanceof Error ? e.message : String(e));
    }
}

export class clsJsonStore<T> {
    private value: T;
    private readonly mutex = new clsMutex();
    private readonly opts: itfJsonStoreOptions<T>;

    constructor(opts: itfJsonStoreOptions<T>) {
        this.opts = opts;
        this.value = opts.createDefault();
    }

    get(): T {
        return this.value;
    }

    /** 파일을 읽어 메모리에 올린다. 손상돼도 예외 없이 기본값으로 시작한다 */
    load(): Promise<T> {
        return this.mutex.runExclusive(async () => {
            const { file, label } = this.opts;
            const main = await this.read(file);
            if (main.kind === "ok") {
                this.value = main.value;
                return this.value;
            }
            if (main.kind === "unsupported") {
                const keep = `${file}.unsupported-${fileStamp()}`;
                await copyFile(file, keep).catch(() => undefined);
                this.notice(
                    "error",
                    `${label} 파일 버전(${String(main.version)})을 지원하지 않아 기본값으로 시작합니다. 원본은 ${keep} 에 보관했습니다.`,
                );
                this.value = this.opts.createDefault();
                return this.value;
            }

            const bak = await this.read(`${file}.bak`);
            if (bak.kind === "ok") {
                this.value = bak.value;
                if (main.kind === "invalid") await this.quarantine(file);
                await writeJsonAtomic(file, this.value).catch(() => undefined);
                this.notice(
                    "warning",
                    `${label} 파일이 손상되어 직전 백업(.bak)으로 복구했습니다.`,
                );
                return this.value;
            }

            this.value = this.opts.createDefault();
            if (main.kind === "invalid") {
                const moved = await this.quarantine(file);
                this.notice(
                    "error",
                    `${label} 파일과 백업이 모두 손상되어 기본값으로 시작합니다. 손상된 파일: ${moved}`,
                );
            }
            return this.value;
        });
    }

    /** 변경 함수를 직렬로 실행하고 결과를 저장한다. 저장에 실패하면 메모리 값은 그대로다 */
    update(mutate: (current: T) => T | Promise<T>): Promise<T> {
        return this.mutex.runExclusive(async () => {
            const next = this.opts.schema.parse(await mutate(this.value));
            await writeJsonAtomic(this.opts.file, next);
            this.value = next;
            return next;
        });
    }

    private async read(path: string): Promise<typReadResult<T>> {
        let text: string;
        try {
            text = await readFile(path, "utf8");
        } catch (e) {
            if (f_ErrCode(e) === "ENOENT") return { kind: "missing" };
            return { kind: "invalid", reason: String(e) };
        }
        let data: unknown;
        try {
            data = JSON.parse(text.replace(/^﻿/, ""));
        } catch {
            return { kind: "invalid", reason: "JSON 파싱 실패" };
        }
        if (
            typeof data === "object" &&
            data !== null &&
            "version" in data &&
            (data as { version: unknown }).version !== 1
        ) {
            return { kind: "unsupported", version: (data as { version: unknown }).version };
        }
        const prepared = this.opts.prepare ? this.opts.prepare(data) : data;
        const parsed = this.opts.schema.safeParse(prepared);
        return parsed.success
            ? { kind: "ok", value: parsed.data }
            : { kind: "invalid", reason: "스키마 불일치" };
    }

    private async quarantine(file: string): Promise<string> {
        const target = `${file}.corrupt-${fileStamp()}`;
        await rename(file, target).catch(() => undefined);
        return target;
    }

    private notice(level: itfAppNotice["level"], message: string): void {
        this.opts.onNotice?.({ level, message });
    }
}
