// ========== External imports ==========
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

function f_Files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory()
            ? f_Files(join(dir, d.name))
            : /\.tsx?$/.test(d.name)
              ? [join(dir, d.name)]
              : [],
    );
}

function f_Imports(file: string): string[] {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

const NODE_BUILTINS =
    /^(node:|electron$|electron\/|fs$|fs\/|path$|os$|child_process$|crypto$|stream$|url$|util$)/;

describe("프로세스 경계", () => {
    it("src/shared 는 Node·Electron·프로세스별 코드를 import 하지 않는다", () => {
        const bad = f_Files(join(ROOT, "src", "shared")).flatMap((f) =>
            f_Imports(f)
                .filter((s) => NODE_BUILTINS.test(s) || /^@\/(main|preload|renderer)\//.test(s))
                .map((s) => `${relative(ROOT, f)} → ${s}`),
        );
        expect(bad).toEqual([]);
    });

    it("src/shared 는 Node 전역(process, Buffer, require)을 쓰지 않는다", () => {
        const bad = f_Files(join(ROOT, "src", "shared")).filter((f) =>
            /\b(process\.|Buffer\.|require\()/.test(readFileSync(f, "utf8")),
        );
        expect(bad.map((f) => relative(ROOT, f))).toEqual([]);
    });

    it("ipc-contract 는 런타임 import 없이 타입만 import 한다 (sandbox preload 번들 보호)", () => {
        const text = readFileSync(join(ROOT, "src", "shared", "ipc-contract.ts"), "utf8");
        const runtime = [...text.matchAll(/^import\s+(?!type\b)/gm)];
        expect(runtime).toEqual([]);
    });
});
