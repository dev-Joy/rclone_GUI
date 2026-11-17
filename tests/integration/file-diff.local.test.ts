/**
 * 파일 내용 비교(INT-009 AC-9)를 실제 rclone으로 확인한다.
 * 임시 폴더와 임시 rclone.conf(alias remote)만 쓰고 텍스트·바이너리·0바이트·비교 뒤 사라진 파일을 읽는다.
 * rclone이 없으면 이유를 출력하고 건너뛴다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsFileDiffService } from "@/main/services/file-diff-service";
import { HAS_RCLONE, makeRoot, makeEnv, writeFile } from "./run-harness";

const ROOT = makeRoot("rclonegui-diff-int-");
afterAll(() => {
    rmSync(ROOT.root, { recursive: true, force: true });
});

/** 비교 결과에 들어갈 파일들을 만들고, 그 결과로 diff 서비스를 돌려준다 */
async function f_Setup(files: {
    source: Record<string, string | Buffer>;
    dest: Record<string, string | Buffer>;
}) {
    const base = join(ROOT.root, `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const src = join(base, "src");
    const dst = join(base, "dst");
    mkdirSync(src, { recursive: true });
    mkdirSync(dst, { recursive: true });
    const h = await makeEnv({
        root: ROOT.root,
        conf: ROOT.conf,
        source: src,
        destination: dst,
        mode: "copy",
    });
    for (const [rel, content] of Object.entries(files.source)) writeFile(join(src, rel), content);
    for (const [rel, content] of Object.entries(files.dest)) writeFile(join(dst, rel), content);
    const result = await h.compare.run(h.job.id);
    const svc = new clsFileDiffService({
        jobs: h.jobs,
        settings: { get: () => h.settings },
        rcloneEnv: h.rcloneEnv,
        excludes: h.excludeStore,
        compare: h.compare,
    });
    return { svc, result, src, dst };
}

describe.skipIf(!HAS_RCLONE)("파일 내용 비교 (실제 rclone, 임시 폴더)", () => {
    it("텍스트는 양쪽 내용을, 바이너리는 binary, 0바이트는 빈 텍스트로 읽는다 (AC-9)", async () => {
        const { svc, result } = await f_Setup({
            source: {
                "text.txt": "가나다\n라마바\n",
                "bin.dat": Buffer.from([0x41, 0x00, 0x42]),
                "empty.txt": "",
            },
            dest: {
                "text.txt": "가나다\n라마바\n사\n",
                "bin.dat": Buffer.from([0x41, 0x00, 0x43, 0x44]),
            },
        });
        const byPath = Object.fromEntries(result.entries.map((e) => [e.path, e.status]));
        expect(byPath).toMatchObject({
            "text.txt": "modified",
            "bin.dat": "modified",
            "empty.txt": "onlySource",
        });

        const text = await svc.diff(result.jobId, "text.txt");
        expect(text.source).toMatchObject({ kind: "text", encoding: "utf-8", bom: false });
        expect(text.dest).toMatchObject({ kind: "text", encoding: "utf-8", bom: false });
        if (text.source.kind !== "text" || text.dest.kind !== "text") throw new Error("text 아님");
        expect(text.source.text).toBe("가나다\n라마바\n");
        expect(text.dest.text).toBe("가나다\n라마바\n사\n");

        const bin = await svc.diff(result.jobId, "bin.dat");
        expect(bin.source).toMatchObject({ kind: "binary" });
        expect(bin.dest).toMatchObject({ kind: "binary" });

        const empty = await svc.diff(result.jobId, "empty.txt");
        expect(empty.source).toMatchObject({ kind: "text", text: "" });
        expect(empty.dest).toEqual({ kind: "absent" });
    });

    it("비교 뒤 사라진 파일은 그 쪽 error로 담는다 (예외표)", async () => {
        const { svc, result, src } = await f_Setup({
            source: { "gone.txt": "내용" },
            dest: { "gone.txt": "다른 내용" },
        });
        expect(result.entries.find((e) => e.path === "gone.txt")?.status).toBe("modified");
        rmSync(join(src, "gone.txt"));
        const data = await svc.diff(result.jobId, "gone.txt");
        expect(data.source).toMatchObject({ kind: "error" });
        expect(data.dest).toMatchObject({ kind: "text", text: "다른 내용" });
    });
});
