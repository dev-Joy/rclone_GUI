/**
 * rclone 동작 확인 실험. 임시 폴더만 사용해 실제 rclone 출력을 tests/fixtures/rclone/ 에 저장한다.
 *
 * - 실제 사용자 경로와 사용자 rclone.conf는 쓰지 않는다. 임시 폴더 안의 빈 rclone.conf를 --config로 넘긴다.
 * - 출력 속 임시 폴더 경로는 <TMP> 로 바꿔 저장한다(fixture에 사용자 이름·경로가 남지 않도록).
 * - rclone을 올릴 때마다 다시 실행하고, 달라진 동작은 docs/knowhow/rclone-notes.md에 기록한다.
 *
 * 실행: node scripts/probes/rclone-probes.mjs [rclone.exe 경로]   (Windows node)
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rclone = process.argv[2] ?? "rclone";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(repoRoot, "tests", "fixtures", "rclone");
mkdirSync(outDir, { recursive: true });

const work = mkdtempSync(join(tmpdir(), "rclonegui-probe-"));
const conf = join(work, "rclone.conf");
writeFileSync(conf, "");

const OLD = new Date("2026-01-01T00:00:00Z");
const NEWER = new Date(OLD.getTime() + 10 * 60_000);

function f_SetFile(path, text, mtime) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
    utimesSync(path, mtime, mtime);
}

function f_Sanitize(text) {
    const fwd = work.replaceAll("\\", "/");
    const variants = [`//?/${fwd}`, `\\\\?\\${work}`, work.replaceAll("\\", "\\\\"), work, fwd];
    let out = text;
    for (const v of variants.toSorted((a, b) => b.length - a.length))
        out = out.replaceAll(v, "<TMP>");
    return out;
}

function f_Probe(name, args) {
    const r = spawnSync(rclone, args, { shell: false, windowsHide: true, encoding: "utf8" });
    if (r.error) throw r.error;
    writeFileSync(join(outDir, `${name}.stdout.txt`), f_Sanitize(r.stdout ?? ""));
    writeFileSync(join(outDir, `${name}.stderr.txt`), f_Sanitize(r.stderr ?? ""));
    writeFileSync(join(outDir, `${name}.exit.txt`), `${r.status}\n`);
    console.log(`[${name}] exit=${r.status}  rclone ${f_Sanitize(args.join(" "))}`);
}

function f_MakeDest(dst) {
    rmSync(dst, { recursive: true, force: true });
    f_SetFile(join(dst, "same.txt"), "same", OLD);
    f_SetFile(join(dst, "touch.txt"), "touch", OLD);
    f_SetFile(join(dst, "changed.txt"), "changed", OLD);
    f_SetFile(join(dst, "extra.txt"), "extra", OLD);
    f_SetFile(join(dst, "gone", "old.txt"), "old", OLD);
}

try {
    const src = join(work, "src");
    const dst = join(work, "dst");
    // 원본: same(동일), touch(내용 같고 시간만 다름), changed(크기 다름), sub/new(원본만), 한글 파일
    f_SetFile(join(src, "same.txt"), "same", OLD);
    f_SetFile(join(src, "touch.txt"), "touch", NEWER);
    f_SetFile(join(src, "changed.txt"), "changed-longer", NEWER);
    f_SetFile(join(src, "sub", "new.txt"), "new", OLD);
    f_SetFile(join(src, "한글 파일.txt"), "unicode", OLD);
    // 대상: extra, gone/old (대상만 → sync 시 삭제)
    f_MakeDest(dst);

    const common = ["--config", conf];
    const log = ["-v", "--use-json-log", "--stats", "1s"];
    const tx = ["--checkers", "8", "--transfers", "4", "--fast-list", "--skip-links"];
    const mw = ["--modify-window", "2000ms"];
    const ls = ["lsjson", "--recursive", "--files-only", "--no-mimetype"];

    f_Probe("version", ["version"]);
    f_Probe("lsjson-src", [...ls, "--skip-links", ...common, "--", src]);
    f_Probe("lsjson-src-hash", [...ls, "--hash", "--skip-links", ...common, "--", src]);
    f_Probe("lsjson-missing", [...ls, ...common, "--", join(work, "missing")]);
    f_Probe("copy-dryrun", [
        "copy",
        ...common,
        "--exclude",
        "*.tmp",
        ...tx,
        ...mw,
        "--dry-run",
        ...log,
        "--",
        src,
        dst,
    ]);
    f_Probe("sync-dryrun", [
        "sync",
        ...common,
        "--exclude",
        "*.tmp",
        ...tx,
        ...mw,
        "--dry-run",
        ...log,
        "--",
        src,
        dst,
    ]);
    f_Probe("sync-maxdelete0", [
        "sync",
        ...common,
        ...tx,
        ...mw,
        "--max-delete",
        "0",
        ...log,
        "--",
        src,
        dst,
    ]);
    f_MakeDest(dst);
    f_Probe("sync-real", [
        "sync",
        ...common,
        ...tx,
        ...mw,
        "--max-delete",
        "2",
        ...log,
        "--",
        src,
        dst,
    ]);
    f_Probe("lsjson-dst-after-sync", [...ls, ...common, "--", dst]);
} finally {
    rmSync(work, { recursive: true, force: true });
}
