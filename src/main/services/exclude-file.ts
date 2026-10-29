/**
 * --exclude-from 임시 파일 (INT-002 T-09). userData/exclude-files/ 안에만 만든다.
 *
 * - 이름은 excl-<cmp|run>-<UUID>.txt, flag "wx"로 새로 만든다(있던 파일을 덮어쓰지 않음).
 * - 쓴 뒤 다시 읽어 바이트가 같고 BOM(EF BB BF)이 없는지 확인한다(rclone-notes #19: BOM이면 첫 패턴이 깨짐).
 * - 비교·실행이 끝나면 dispose로 지운다(여러 번 불러도 됨). 앱 시작 때 남은 excl-*.txt를 정리한다.
 * - 파일 내용(패턴)은 로그에 남기지 않는다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";

export const EXCLUDE_FILE_DIR = "exclude-files";

const FILE_RE = /^excl-(?:cmp|run)-[0-9a-f-]{36}\.txt$/;
const CLEANUP_RE = /^excl-.*\.txt$/;

export interface itfExcludeFileHandle {
    path: string;
    /** 파일을 지운다(없어도 됨, 여러 번 불러도 됨) */
    dispose(): Promise<void>;
}

function f_Message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** 제외 파일을 만들고 확인한다. 실패하면 지우고 STORE_ERROR */
export async function writeExcludeFile(
    dir: string,
    content: string,
    kind: "cmp" | "run",
): Promise<itfExcludeFileHandle> {
    const path = join(dir, `excl-${kind}-${randomUUID()}.txt`);
    const expected = Buffer.from(content, "utf8");
    // 이 호출이 만든 파일만 지운다(wx 충돌이면 남의 파일이므로 건드리지 않음)
    let created = false;
    let disposed = false;
    const dispose = async (): Promise<void> => {
        if (disposed || !created) return;
        disposed = true;
        await rm(path, { force: true }).catch(() => undefined);
    };
    try {
        await mkdir(dir, { recursive: true });
        await writeFile(path, expected, { flag: "wx" });
        created = true;
        const back = await readFile(path);
        const bom = back.length >= 3 && back[0] === 0xef && back[1] === 0xbb && back[2] === 0xbf;
        if (bom || !back.equals(expected)) {
            throw new Error(bom ? "BOM이 있음" : "다시 읽은 내용이 다름");
        }
    } catch (e) {
        await dispose();
        throw new clsAppError("STORE_ERROR", "제외 패턴 파일을 만들지 못했습니다.", f_Message(e));
    }
    return { path, dispose };
}

/** 시작 때 남은 제외 파일(excl-*.txt)만 지운다. 지운 수 */
export async function cleanupExcludeFiles(dir: string): Promise<number> {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch {
        return 0;
    }
    let removed = 0;
    for (const n of names.filter((x) => CLEANUP_RE.test(x))) {
        try {
            await rm(join(dir, n), { force: true });
            removed += 1;
        } catch {
            // 다음 시작에서 다시 지운다
        }
    }
    return removed;
}

/** 앱이 만든 제외 파일 이름인지(테스트·로그 확인용) */
export function isExcludeFileName(name: string): boolean {
    return FILE_RE.test(name);
}
