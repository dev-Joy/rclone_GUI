// ========== External imports ==========
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import {
    cleanupExcludeFiles,
    isExcludeFileName,
    writeExcludeFile,
} from "@/main/services/exclude-file";

const uuid = vi.hoisted(() => ({ next: null as string | null }));

vi.mock("node:crypto", async (importOriginal) => {
    const m = await importOriginal<typeof import("node:crypto")>();
    return { ...m, randomUUID: () => uuid.next ?? m.randomUUID() };
});

let dir = "";

beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "rclonegui-exclfile-")), "exclude-files");
});

afterEach(() => {
    uuid.next = null;
    rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("writeExcludeFile", () => {
    it("폴더를 만들고 BOM 없는 UTF-8·LF로 쓰며, dispose는 여러 번 불러도 된다", async () => {
        const content = "a/**\n한글 폴더/**\n";
        const h = await writeExcludeFile(dir, content, "run");
        expect(isExcludeFileName(basename(h.path))).toBe(true);
        expect(basename(h.path)).toMatch(/^excl-run-/);
        const bytes = readFileSync(h.path);
        expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
        expect(bytes.toString("utf8")).toBe(content);
        expect(bytes.includes(0x0d)).toBe(false);
        await h.dispose();
        await h.dispose();
        expect(existsSync(h.path)).toBe(false);
    });

    it("호출마다 다른 파일(wx: 같은 이름이면 덮어쓰지 않고 실패)", async () => {
        const a = await writeExcludeFile(dir, "a\n", "cmp");
        const b = await writeExcludeFile(dir, "b\n", "cmp");
        expect(a.path).not.toBe(b.path);
        // 같은 이름이 이미 있으면 STORE_ERROR, 기존 파일은 그대로
        const fixed = "00000000-0000-4000-8000-000000000001";
        uuid.next = fixed;
        await writeExcludeFile(dir, "first\n", "cmp");
        await expect(writeExcludeFile(dir, "second\n", "cmp")).rejects.toMatchObject({
            code: "STORE_ERROR",
        });
        expect(readFileSync(join(dir, `excl-cmp-${fixed}.txt`), "utf8")).toBe("first\n");
    });

    it("내용에 BOM이 있으면(다시 읽기 확인) 지우고 STORE_ERROR", async () => {
        await expect(writeExcludeFile(dir, "\uFEFFa\n", "run")).rejects.toMatchObject({
            code: "STORE_ERROR",
        });
        expect(readdirSync(dir)).toEqual([]);
    });
});

describe("cleanupExcludeFiles", () => {
    it("excl-*.txt만 지우고 다른 파일은 둔다, 폴더가 없으면 0", async () => {
        expect(await cleanupExcludeFiles(dir)).toBe(0);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "excl-run-x.txt"), "a");
        writeFileSync(join(dir, "excl-cmp-y.txt"), "a");
        writeFileSync(join(dir, "keep.txt"), "a");
        expect(await cleanupExcludeFiles(dir)).toBe(2);
        expect(readdirSync(dir)).toEqual(["keep.txt"]);
    });
});
