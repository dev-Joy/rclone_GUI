/**
 * 실제 rclone으로 명령 빌더·파서·diff 엔진을 확인한다. 임시 폴더와 빈 rclone.conf만 쓴다.
 * rclone이 없으면 이유를 출력하고 건너뛴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { parseLogLine } from "@/main/parsers/log-parser";
import { parseLsjsonOutput } from "@/main/parsers/lsjson-parser";
import { buildLsjsonArgs, buildTransferArgs } from "@/main/rclone/command-builder";
import { createDefaultSettings } from "@/shared/defaults";
import { diffFileLists } from "@/shared/diff-engine";

const RCLONE = process.env.RCLONEGUI_TEST_RCLONE ?? "rclone";
const probe = spawnSync(RCLONE, ["version"], { shell: false, windowsHide: true, encoding: "utf8" });
const HAS_RCLONE = probe.status === 0;
if (!HAS_RCLONE) {
    console.warn(
        `[test:int] rclone을 실행할 수 없어 건너뜁니다 (${RCLONE}): ${probe.error?.message ?? probe.stderr}`,
    );
}

const { excludes: _ex, ...OPTIONS } = createDefaultSettings().defaults;
const OLD = new Date("2026-01-01T00:00:00Z");
const NEWER = new Date(OLD.getTime() + 10 * 60_000);
const root = mkdtempSync(join(tmpdir(), "rclonegui-int-"));
const conf = join(root, "rclone.conf");
writeFileSync(conf, "");
let src = "";
let dst = "";
let caseNo = 0;

function f_File(path: string, text: string, mtime = OLD): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    utimesSync(path, mtime, mtime);
}

function f_Run(args: string[]) {
    const r = spawnSync(RCLONE, args, { shell: false, windowsHide: true, encoding: "utf8" });
    return {
        exit: r.status,
        stdout: r.stdout,
        lines: r.stderr.split(/\r?\n/).filter(Boolean).map(parseLogLine),
    };
}

function f_List(path: string) {
    const r = f_Run(
        buildLsjsonArgs({
            path,
            configPath: conf,
            excludes: { patterns: ["*.tmp"], fromFile: null },
            withHash: false,
            hashTypes: [],
            skipLinks: true,
            fastList: false,
        }),
    );
    expect(r.exit).toBe(0);
    return parseLsjsonOutput(r.stdout);
}

function f_Transfer(mode: "copy" | "sync", dryRun: boolean, maxDelete: number | null = null) {
    return f_Run(
        buildTransferArgs({
            mode,
            source: src,
            destination: dst,
            configPath: conf,
            excludes: { patterns: ["*.tmp"], fromFile: null },
            options: { ...OPTIONS },
            dryRun,
            maxDelete,
        }),
    );
}

beforeEach(() => {
    caseNo += 1;
    src = join(root, `c${caseNo}`, "src");
    dst = join(root, `c${caseNo}`, "dst");
    f_File(join(src, "same.txt"), "same");
    f_File(join(src, "changed.txt"), "changed-longer", NEWER);
    f_File(join(src, "sub", "new.txt"), "new");
    f_File(join(src, "한글 파일.txt"), "unicode");
    f_File(join(src, "skip.tmp"), "excluded");
    f_File(join(dst, "same.txt"), "same");
    f_File(join(dst, "changed.txt"), "changed");
    f_File(join(dst, "extra.txt"), "extra");
    f_File(join(dst, "gone", "old.txt"), "old");
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!HAS_RCLONE)("rclone 실제 동작 (임시 폴더)", () => {
    it("diff 계획 수가 sync dry-run의 복사·삭제 수·전송 바이트와 같다", () => {
        const diff = diffFileLists(f_List(src), f_List(dst), {
            caseInsensitive: true,
            checkHashes: false,
            modtimeToleranceMs: OPTIONS.modtimeToleranceMs,
        });
        if (!diff.ok) throw new Error("diff 실패");
        expect(diff.summary).toMatchObject({
            createFiles: 2,
            updateFiles: 1,
            deleteFiles: 2,
            sameFiles: 1,
        });

        const r = f_Transfer("sync", true);
        expect(r.exit).toBe(0);
        const copies = r.lines.filter((l) => l.skipped === "copy").length;
        const deletes = r.lines.filter((l) => l.skipped === "delete").length;
        const stats = r.lines.filter((l) => l.stats).at(-1)!.stats!;
        expect(copies).toBe(diff.summary.createFiles + diff.summary.updateFiles);
        expect(deletes).toBe(diff.summary.deleteFiles);
        expect(stats.transfers).toBe(diff.summary.createFiles + diff.summary.updateFiles);
        expect(stats.deletes).toBe(diff.summary.deleteFiles);
        expect(stats.bytes).toBe(diff.summary.transferBytes);
        // dry-run은 아무것도 바꾸지 않는다
        expect(readdirSync(dst).toSorted()).toEqual([
            "changed.txt",
            "extra.txt",
            "gone",
            "same.txt",
        ]);
    });

    it("제외 패턴(*.tmp)은 목록과 복사 모두에서 빠진다", () => {
        expect(f_List(src).some((f) => f.path.endsWith(".tmp"))).toBe(false);
        const r = f_Transfer("copy", true);
        expect(r.lines.some((l) => l.object === "skip.tmp")).toBe(false);
    });

    it("실제 sync에 --max-delete 0 이면 파일을 하나도 지우지 않고 exit 7", () => {
        const r = f_Transfer("sync", false, 0);
        expect(r.exit).toBe(7);
        expect(r.lines.filter((l) => l.stats).at(-1)!.stats).toMatchObject({
            deletes: 0,
            fatalError: true,
        });
        expect(readdirSync(dst)).toContain("extra.txt");
    });

    it("실제 sync에 계획 삭제 수를 주면 완료되고 결과가 원본과 같아진다", () => {
        const r = f_Transfer("sync", false, 2);
        expect(r.exit).toBe(0);
        expect(r.lines.filter((l) => l.stats).at(-1)!.stats).toMatchObject({
            deletes: 2,
            errors: 0,
        });
        const after = diffFileLists(f_List(src), f_List(dst), {
            caseInsensitive: true,
            checkHashes: false,
            modtimeToleranceMs: 2000,
        });
        expect(after.ok && after.summary.sameFiles).toBe(4);
    });

    it("내용이 같고 수정시간만 다르면 rclone은 복사하지 않고 시간만 갱신한다 (diff는 '변경'으로 셈)", () => {
        f_File(join(src, "touch.txt"), "touch", NEWER);
        f_File(join(dst, "touch.txt"), "touch", OLD);
        const diff = diffFileLists(f_List(src), f_List(dst), {
            caseInsensitive: true,
            checkHashes: false,
            modtimeToleranceMs: 2000,
        });
        expect(diff.ok && diff.summary.updateFiles).toBe(2);
        const r = f_Transfer("sync", true);
        const touched = r.lines.filter((l) => l.skipped === "touch" && l.object === "touch.txt");
        expect(touched).toHaveLength(1);
        // Phase 7 preflight: transfers(3)는 create+update(4)와 다르다 → 비교식에 touch 수를 고려해야 한다
        expect(r.lines.filter((l) => l.stats).at(-1)!.stats!.transfers).toBe(3);
    });

    it("없는 경로는 exit 3이고 stdout을 파싱하지 않는다", () => {
        const r = f_Run(
            buildLsjsonArgs({
                path: join(root, "missing"),
                configPath: conf,
                excludes: { patterns: [], fromFile: null },
                withHash: false,
                hashTypes: [],
                skipLinks: true,
                fastList: false,
            }),
        );
        expect(r.exit).toBe(3);
    });
});
