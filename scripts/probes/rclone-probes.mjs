/**
 * rclone 동작 확인 실험. 임시 폴더만 사용해 실제 rclone 출력을 tests/fixtures/rclone/ 에 저장한다.
 *
 * - 실제 사용자 경로와 사용자 rclone.conf는 쓰지 않는다. 임시 폴더 안의 빈 rclone.conf를 --config로 넘긴다.
 * - 출력 속 임시 폴더 경로는 <TMP> 로 바꿔 저장한다(fixture에 사용자 이름·경로가 남지 않도록).
 * - rclone을 올릴 때마다 다시 실행하고, 달라진 동작은 docs/knowhow/rclone-notes.md에 기록한다.
 *
 * 실행: node scripts/probes/rclone-probes.mjs [rclone.exe 경로] [--only=이름,이름]   (Windows node)
 *       --only를 주면 그 이름의 실험만 실행·저장한다(다른 fixture는 그대로 둔다).
 *       묶음 이름(copy-cancel-large, excl, scope, features, backup, filter)을 주면 그 묶음의 뒤따르는 실험도 함께 실행한다.
 *       backup-s3는 rclone serve s3를 띄우므로 --only=backup-s3로 줄 때만 실행한다.
 *       RCLONEGUI_PROBE_OTHER_DRIVE(예: D:\\)가 있으면 backup 묶음이 그 드라이브에 임시 폴더를 만들어 다른 드라이브 백업도 확인한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { execFile, spawn, spawnSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliArgs = process.argv.slice(2);
const rclone = cliArgs.find((a) => !a.startsWith("--")) ?? "rclone";
const onlyArg = cliArgs.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null;
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

/** 출력에서 가릴 폴더: [경로, 대체 문자열]. 다른 드라이브 임시 폴더(backup 묶음)는 <TMP2> */
const maskDirs = [[work, "<TMP>"]];
/** 출력에서 가릴 값: [값, 대체 문자열] (backup-s3 묶음의 포트·키) */
const maskValues = [];
// providers 기본값에는 현재 OS 사용자·컴퓨터 이름이 들어 있다(sftp user 등). fixture에 남기지 않는다
{
    const user = process.env.USERNAME;
    const machine = process.env.COMPUTERNAME;
    const candidates = [
        process.env.USERPROFILE,
        machine && user ? `${machine}\\${user}` : undefined,
        machine,
        user ? `\\${user}` : undefined,
        user ? `/${user}` : undefined,
    ];
    for (const v of candidates) {
        if (!v || v.length < 2) continue;
        maskValues.push([v, "<USER>"], [v.replaceAll("\\", "\\\\"), "<USER>"]);
    }
}

function f_MaskDir(text, dir, label) {
    const fwd = dir.replaceAll("\\", "/");
    const variants = [`//?/${fwd}`, `\\\\?\\${dir}`, dir.replaceAll("\\", "\\\\"), dir, fwd];
    let out = text;
    for (const v of variants.toSorted((a, b) => b.length - a.length))
        out = out.replaceAll(v, label);
    return out;
}

function f_Sanitize(text) {
    let out = text;
    for (const [dir, label] of maskDirs) out = f_MaskDir(out, dir, label);
    for (const [value, label] of maskValues) out = out.replaceAll(value, label);
    return out;
}

function f_Selected(name, group) {
    return !only || only.has(name) || (group !== undefined && only.has(group));
}

function f_Save(name, stdout, stderr, status) {
    writeFileSync(join(outDir, `${name}.stdout.txt`), f_Sanitize(stdout));
    writeFileSync(join(outDir, `${name}.stderr.txt`), f_Sanitize(stderr));
    writeFileSync(join(outDir, `${name}.exit.txt`), `${status}\n`);
}

function f_Probe(name, args, group) {
    if (!f_Selected(name, group)) return null;
    const r = spawnSync(rclone, args, {
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) throw r.error;
    f_Save(name, r.stdout ?? "", r.stderr ?? "", r.status);
    console.log(`[${name}] exit=${r.status}  rclone ${f_Sanitize(args.join(" "))}`);
    return r;
}

/** lsjson stdout의 Path 목록(정렬). 해석할 수 없으면 null */
function f_LsPaths(stdout) {
    try {
        return JSON.parse(stdout)
            .map((e) => e.Path)
            .toSorted();
    } catch {
        return null;
    }
}

/** sync dry-run stderr(json 로그)의 건너뛴 동작 목록(정렬): "skipped:object" */
function f_SkippedOps(stderr) {
    return stderr
        .split("\n")
        .map((line) => {
            try {
                const j = JSON.parse(line);
                return j.skipped ? `${j.skipped}:${j.object ?? ""}` : null;
            } catch {
                return null;
            }
        })
        .filter((x) => x !== null)
        .toSorted();
}

/**
 * 실행 중 취소 실험: rclone을 띄우고 stats 줄의 bytes가 0보다 커지면(전송 시작) 앱과 같은 방식
 * (taskkill /PID <pid> /T /F)으로 프로세스 트리를 끝낸다. exit에는 종료 코드 또는 신호를 적는다.
 */
async function f_ProbeKillOnTransfer(name, args) {
    const child = spawn(rclone, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const f_Kill = () => {
        if (killed) return;
        killed = true;
        const root = process.env.SystemRoot ?? "C:\\Windows";
        execFile(
            `${root}\\System32\\taskkill.exe`,
            ["/PID", String(child.pid), "/T", "/F"],
            { shell: false, windowsHide: true },
            () => undefined,
        );
    };
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => {
        stderr += d;
        for (const line of d.split("\n")) {
            try {
                if ((JSON.parse(line).stats?.bytes ?? 0) > 0) f_Kill();
            } catch {
                // 줄이 잘려 들어오면 다음 조각에서 다시 본다
            }
        }
    });
    const timer = setTimeout(f_Kill, 60_000); // 전송이 시작되지 않아도 끝낸다
    const [code, signal] = await new Promise((r) => child.once("exit", (c, sg) => r([c, sg])));
    clearTimeout(timer);
    f_Save(name, stdout, stderr, code ?? signal);
    console.log(`[${name}] exit=${code ?? signal}  rclone ${f_Sanitize(args.join(" "))}`);
}

/** 폴더 안 파일 이름(하위 폴더 포함, / 구분) */
function f_ListFiles(dir) {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) =>
            join(d.parentPath, d.name)
                .slice(dir.length + 1)
                .replaceAll("\\", "/"),
        )
        .toSorted();
}

/** 폴더 안 하위 폴더 이름(/ 구분) */
function f_ListDirs(dir) {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) =>
            join(d.parentPath, d.name)
                .slice(dir.length + 1)
                .replaceAll("\\", "/"),
        )
        .toSorted();
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

    // Phase 3: 환경 감지·경로 확인 (rclone.conf는 임시 폴더 안의 것만 쓴다)
    const remotesConf = join(work, "remotes.conf");
    writeFileSync(
        remotesConf,
        `[probe-b]\ntype = alias\nremote = ${src}\n\n[probe-alias]\ntype = alias\nremote = ${src}\n`,
    );
    const ask = "--ask-password=false";
    f_Probe("config-file", ["config", "file", ask, ...common]);
    f_Probe("config-file-missing", ["config", "file", ask, "--config", join(work, "none.conf")]);
    f_Probe("listremotes", ["listremotes", ask, "--config", remotesConf]);
    f_Probe("listremotes-missing-conf", ["listremotes", ask, "--config", join(work, "none.conf")]);
    const probeLs = ["lsjson", "--max-depth", "1", "--no-mimetype", "--no-modtime", ask];
    f_Probe("lsjson-probe-parent", [...probeLs, ...common, "--", src]);
    f_Probe("lsjson-probe-missing-parent", [
        ...probeLs,
        ...common,
        "--",
        join(work, "missing", "deep"),
    ]);

    // Phase 5: 비교 목록 (해시 종류 제한, 암호 입력 대기 금지)
    f_Probe("lsjson-src-hashtype", [
        ...ls,
        ask,
        "--hash",
        "--hash-type",
        "md5",
        "--hash-type",
        "sha1",
        "--skip-links",
        ...common,
        "--",
        src,
    ]);

    // Phase 6: 실제 copy 출력(로그 줄 형식), 진행 중 stats 줄
    f_MakeDest(dst);
    f_Probe("copy-real", [
        "copy",
        ask,
        ...common,
        "--exclude",
        "*.tmp",
        ...tx,
        ...mw,
        ...log,
        "--",
        src,
        dst,
    ]);
    // 약 3 MiB를 1 MiB/s로 제한해 중간 stats 줄(1초 간격)을 받는다. --bwlimit은 이 실험에서만 쓴다
    const big = join(work, "big");
    const bigDst = join(work, "big-dst");
    for (let i = 0; i < 3; i += 1) {
        mkdirSync(big, { recursive: true });
        writeFileSync(join(big, `part${i}.bin`), Buffer.alloc(1024 * 1024, i + 1));
    }
    f_Probe("copy-progress", [
        "copy",
        ask,
        ...common,
        "--transfers",
        "1",
        "--bwlimit",
        "1M",
        ...log,
        "--",
        big,
        bigDst,
    ]);

    // Phase 7: 삭제 대상 2개(extra.txt, gone/old.txt)에 한도 1 → exit 7 전에 몇 개를 지우는지
    f_MakeDest(dst);
    f_Probe("sync-maxdelete1", [
        "sync",
        ask,
        ...common,
        ...tx,
        ...mw,
        "--max-delete",
        "1",
        ...log,
        "--",
        src,
        dst,
    ]);
    f_Probe("lsjson-dst-after-maxdelete1", [...ls, ...common, "--", dst]);

    // Phase 6 보완: 큰 파일(32 MiB)을 4 MiB/s로 복사하다 전송이 시작되면 taskkill /T /F로 취소
    // → 대상에 임시 파일(.partial)이나 대상 파일이 남는지, 다음 비교·sync가 그것을 어떻게 보는지
    if (f_Selected("copy-cancel-large")) {
        const large = join(work, "large");
        const largeDst = join(work, "large-dst");
        mkdirSync(large, { recursive: true });
        mkdirSync(largeDst, { recursive: true });
        writeFileSync(join(large, "big.bin"), Buffer.alloc(32 * 1024 * 1024, 7));
        await f_ProbeKillOnTransfer("copy-cancel-large", [
            "copy",
            ask,
            ...common,
            ...tx,
            ...mw,
            "--bwlimit",
            "4M",
            ...log,
            "--",
            large,
            largeDst,
        ]);
        await new Promise((r) => setTimeout(r, 500)); // 파일 핸들 정리 대기
        console.log(`  대상 파일(취소 직후): ${f_ListFiles(largeDst).join(", ") || "(없음)"}`);
        const g = "copy-cancel-large";
        f_Probe("lsjson-dst-after-cancel", [...ls, ...common, "--", largeDst], g);
        f_Probe(
            "sync-dryrun-after-cancel",
            ["sync", ask, ...common, ...tx, ...mw, "--dry-run", ...log, "--", large, largeDst],
            g,
        );
        f_Probe(
            "copy-after-cancel",
            ["copy", ask, ...common, ...tx, ...mw, ...log, "--", large, largeDst],
            g,
        );
        console.log(`  대상 파일(다시 복사 뒤): ${f_ListFiles(largeDst).join(", ") || "(없음)"}`);
    }

    // INT-002 Phase 2: --exclude-from 파일 해석(주석·이스케이프·BOM·CRLF·공백·빈 줄)과 인자 방식 비교
    if (f_Selected("excl")) {
        const g = "excl";
        const ex = join(work, "excl-src");
        const exDst = join(work, "excl-dst");
        mkdirSync(exDst, { recursive: true });
        // 앞뒤 공백 이름은 Windows가 뒤 공백을 지우므로 실제로 생긴 이름을 출력한다
        for (const n of ["#a", ";a", "a", " b ", "c", "한글.txt", "{p,q}", "x\\y"]) {
            f_SetFile(join(ex, n), n, OLD);
        }
        console.log(`  excl 원본 파일: ${JSON.stringify(f_ListFiles(ex))}`);
        const exLs = (name, extra) =>
            f_Probe(
                name,
                [
                    "lsjson",
                    "--recursive",
                    "--files-only",
                    "--no-mimetype",
                    ask,
                    ...common,
                    ...extra,
                    "--",
                    ex,
                ],
                g,
            );
        const f_ExFile = (name, content) => {
            const f = join(work, `${name}.txt`);
            writeFileSync(f, content);
            return f;
        };
        const show = (label, r) =>
            r &&
            console.log(
                `  ${label}: exit=${r.status} 남은 항목=${JSON.stringify(f_LsPaths(r.stdout))}`,
            );

        // P1: 파일의 #·; 줄은 주석인가, 인자 --exclude "#a"는 적용되는가
        show(
            "P1 파일 #a ;a",
            exLs("excl-comment-file", ["--exclude-from", f_ExFile("p1", "#a\n;a\n")]),
        );
        show("P1 인자 #a ;a", exLs("excl-comment-arg", ["--exclude", "#a", "--exclude", ";a"]));
        // P2: 파일의 \#a 이스케이프
        show(
            "P2 파일 \\#a",
            exLs("excl-escape-file", ["--exclude-from", f_ExFile("p2", "\\#a\n")]),
        );
        // P3: 인자 + 파일 동시
        show(
            "P3 인자 a + 파일 c",
            exLs("excl-arg-and-file", ["--exclude", "a", "--exclude-from", f_ExFile("p3", "c\n")]),
        );
        // P4: BOM, CRLF
        show("P4 BOM a,c", exLs("excl-bom", ["--exclude-from", f_ExFile("p4b", "\uFEFFa\nc\n")]));
        show("P4 CRLF a,c", exLs("excl-crlf", ["--exclude-from", f_ExFile("p4c", "a\r\nc\r\n")]));
        // P5: 앞뒤 공백 줄
        show("P5 공백 '  a  '", exLs("excl-spaces", ["--exclude-from", f_ExFile("p5", "  a  \n")]));
        // P7: 없는 파일
        show("P7 없는 파일", exLs("excl-missing-file", ["--exclude-from", join(work, "none.txt")]));
        // P8: 빈 줄
        show(
            "P8 빈 줄",
            exLs("excl-blank-lines", ["--exclude-from", f_ExFile("p8", "\n\na\n\n\nc\n\n")]),
        );

        // P6: 200개 패턴 — 인자 방식과 파일 방식의 lsjson·sync dry-run 결과가 같은가
        const many = join(work, "excl-many");
        for (let i = 0; i < 300; i += 1) {
            const n = String(i).padStart(3, "0");
            f_SetFile(join(many, i % 2 === 0 ? `d${n % 7}` : "", `n${n}.dat`), n, OLD);
        }
        f_SetFile(join(many, "keep", "한글 이름.txt"), "k", OLD);
        const patterns = [];
        for (let i = 0; i < 196; i += 1) patterns.push(`n${String(i).padStart(3, "0")}.dat`);
        patterns.push("d3/**", "*.tmp", "{n290,n291}.dat", "/n299.dat");
        const manyArgs = patterns.flatMap((p) => ["--exclude", p]);
        const manyFile = f_ExFile("p6", `${patterns.join("\n")}\n`);
        const lsMany = ["lsjson", "--recursive", "--files-only", "--no-mimetype", ask, ...common];
        const la = f_Probe("excl-many-args-lsjson", [...lsMany, ...manyArgs, "--", many], g);
        const lf = f_Probe(
            "excl-many-file-lsjson",
            [...lsMany, "--exclude-from", manyFile, "--", many],
            g,
        );
        const syncMany = ["sync", ask, ...common, ...tx, ...mw, "--dry-run", ...log];
        const sa = f_Probe("excl-many-args-sync", [...syncMany, ...manyArgs, "--", many, exDst], g);
        const sf = f_Probe(
            "excl-many-file-sync",
            [...syncMany, "--exclude-from", manyFile, "--", many, exDst],
            g,
        );
        if (la && lf && sa && sf) {
            const lsSame =
                JSON.stringify(f_LsPaths(la.stdout)) === JSON.stringify(f_LsPaths(lf.stdout));
            const syncSame =
                JSON.stringify(f_SkippedOps(sa.stderr)) === JSON.stringify(f_SkippedOps(sf.stderr));
            console.log(
                `  P6 200개: lsjson ${lsSame ? "같음" : "다름"}(${f_LsPaths(lf.stdout)?.length}개), sync dry-run ${syncSame ? "같음" : "다름"}(${f_SkippedOps(sf.stderr).length}건), 인자 명령 길이 ${manyArgs.join(" ").length}자`,
            );
        }
    }
    // INT-002 Phase 4: 동기화 범위(--create-empty-src-dirs, 폴더 포함 목록, 빈 폴더 삭제와 --max-delete)
    if (f_Selected("scope")) {
        const g = "scope";
        const sSrc = join(work, "scope-src");
        const sDst = join(work, "scope-dst");
        f_SetFile(join(sSrc, "file.txt"), "file", OLD);
        f_SetFile(join(sSrc, "keep", "a.txt"), "a", OLD);
        f_SetFile(join(sSrc, "newdir", "sub", "n.txt"), "n", OLD); // 파일이 든 원본 전용 폴더
        for (const d of ["empty-src", "nest/a/b", "both-empty", "skip"]) {
            mkdirSync(join(sSrc, d), { recursive: true });
        }
        const f_MakeScopeDest = (withFileDelete) => {
            rmSync(sDst, { recursive: true, force: true });
            f_SetFile(join(sDst, "file.txt"), "file", OLD);
            f_SetFile(join(sDst, "keep", "a.txt"), "a", OLD);
            f_SetFile(join(sDst, "skip", "keep.txt"), "excluded", OLD); // 제외된 폴더
            for (const d of ["both-empty", "dst-only-empty", "dst-only-nest/x"]) {
                mkdirSync(join(sDst, d), { recursive: true });
            }
            if (withFileDelete) f_SetFile(join(sDst, "gone", "old.txt"), "old", OLD);
        };
        const excl = ["--exclude", "skip/**"];
        const cesd = "--create-empty-src-dirs";
        const lsAll = ["lsjson", "--recursive", "--no-mimetype", ask, ...common, ...excl];
        const f_Run = (name, cmd, extra) =>
            f_Probe(
                name,
                [cmd, ask, ...common, ...excl, ...tx, ...mw, ...extra, ...log, "--", sSrc, sDst],
                g,
            );
        const f_After = (name) => {
            console.log(`  ${name} 대상 폴더: ${JSON.stringify(f_ListDirs(sDst))}`);
            f_Probe(`scope-lsjson-dst-after-${name}`, [...lsAll, "--", sDst], g);
        };
        const f_Show = (r) =>
            r && console.log(`  건너뛴 동작: ${JSON.stringify(f_SkippedOps(r.stderr))}`);
        f_MakeScopeDest(true);
        f_Probe("scope-lsjson-src-all", [...lsAll, "--", sSrc], g);
        f_Probe("scope-lsjson-dst-all", [...lsAll, "--", sDst], g);
        f_Show(f_Run("scope-copy-files-dryrun", "copy", ["--dry-run"]));
        f_Show(f_Run("scope-copy-all-dryrun", "copy", [cesd, "--dry-run"]));
        f_Show(f_Run("scope-sync-files-dryrun", "sync", ["--dry-run"]));
        f_Show(f_Run("scope-sync-all-dryrun", "sync", [cesd, "--dry-run"]));
        f_MakeScopeDest(true);
        f_Run("scope-copy-files-real", "copy", []);
        f_After("copy-files");
        f_MakeScopeDest(true);
        f_Run("scope-copy-all-real", "copy", [cesd]);
        f_After("copy-all");
        f_MakeScopeDest(true);
        f_Run("scope-sync-files-real", "sync", ["--max-delete", "1"]);
        f_After("sync-files");
        f_MakeScopeDest(true);
        f_Run("scope-sync-all-real", "sync", [cesd, "--max-delete", "1"]);
        f_After("sync-all");
        f_MakeScopeDest(true);
        f_Run("scope-sync-all-maxdelete0", "sync", [cesd, "--max-delete", "0"]);
        f_After("maxdelete0");
        f_MakeScopeDest(false);
        f_Show(f_Run("scope-sync-all-dirsonly-dryrun", "sync", [cesd, "--dry-run"]));
        f_MakeScopeDest(false);
        f_Run("scope-sync-all-dirsonly-maxdelete0", "sync", [cesd, "--max-delete", "0"]);
        f_After("dirsonly-maxdelete0");
    }
    // INT-003 T-04: backend features의 CanHaveEmptyDirectories(로컬·메모리·alias로 감싼 로컬·없는 remote)
    if (f_Selected("features")) {
        const g = "features";
        const fDir = join(work, "features-local");
        mkdirSync(fDir, { recursive: true });
        const f_Features = (name, target) => {
            const r = f_Probe(name, ["backend", "features", ask, ...common, target], g);
            if (!r) return;
            let value = "해석 실패";
            try {
                value = String(JSON.parse(r.stdout).Features.CanHaveEmptyDirectories);
            } catch {
                // 실패 출력은 fixture로만 남긴다
            }
            console.log(`  CanHaveEmptyDirectories: ${value}`);
        };
        f_Features("features-local", fDir);
        f_Features("features-memory", ":memory:");
        f_Features("features-alias-local", `:alias,remote='${fDir}':`);
        f_Features("features-missing-remote", "rclonegui-probe-missing:");
    }
    // INT-003 T-03: --backup-dir (삭제만·덮어쓰기만·둘 다·한도·폴더·겹침·하위 폴더 충돌·다른 드라이브)
    // 앱과 같은 인자 순서: ... --modify-window [--create-empty-src-dirs] --backup-dir X [--dry-run | --max-delete N] -v ...
    if (f_Selected("backup")) {
        const g = "backup";
        const bSrc = join(work, "backup-src");
        const bDst = join(work, "backup-dst");
        const bBk = join(work, "backup-bk");
        const bRun = join(bBk, "run1");
        // 원본: same, touch(시간만 다름), changed·changed2(덮어쓰기), sub/new(새 파일)
        f_SetFile(join(bSrc, "same.txt"), "same", OLD);
        f_SetFile(join(bSrc, "touch.txt"), "touch", NEWER);
        f_SetFile(join(bSrc, "changed.txt"), "changed-longer", NEWER);
        f_SetFile(join(bSrc, "changed2.txt"), "changed2-longer", NEWER);
        f_SetFile(join(bSrc, "sub", "new.txt"), "new", OLD);
        /** 대상 준비. del: 지울 파일 2개(extra.txt, gone/old.txt), over: 덮어쓸 파일 2개. 백업 폴더는 비운다 */
        const f_MakeBackupDest = (target, { del, over }) => {
            rmSync(target, { recursive: true, force: true });
            rmSync(bBk, { recursive: true, force: true });
            f_SetFile(join(target, "same.txt"), "same", OLD);
            f_SetFile(join(target, "touch.txt"), "touch", OLD);
            f_SetFile(
                join(target, "changed.txt"),
                over ? "changed" : "changed-longer",
                over ? OLD : NEWER,
            );
            f_SetFile(
                join(target, "changed2.txt"),
                over ? "changed2" : "changed2-longer",
                over ? OLD : NEWER,
            );
            if (del) {
                f_SetFile(join(target, "extra.txt"), "extra", OLD);
                f_SetFile(join(target, "gone", "old.txt"), "old", OLD);
            }
        };
        const f_Files = (dir) => {
            try {
                return JSON.stringify(f_ListFiles(dir));
            } catch {
                return "(없음)";
            }
        };
        const f_Sync = (name, extra, target = bDst) =>
            f_Probe(
                name,
                ["sync", ask, ...common, ...tx, ...mw, ...extra, ...log, "--", bSrc, target],
                g,
            );
        const f_After = (r, target = bDst, bk = bBk) =>
            r && console.log(`  대상: ${f_Files(target)}  백업: ${f_Files(bk)}`);
        const f_Show = (r) =>
            r && console.log(`  건너뛴 동작: ${JSON.stringify(f_SkippedOps(r.stderr))}`);
        const bd = ["--backup-dir", bRun];
        for (const [n, o, maxDel] of [
            ["delonly", { del: true, over: false }, "2"],
            ["overonly", { del: false, over: true }, "0"],
            ["both", { del: true, over: true }, "2"],
        ]) {
            f_MakeBackupDest(bDst, o);
            f_Show(f_Sync(`backup-${n}-dryrun`, [...bd, "--dry-run"]));
            f_After(true);
            f_MakeBackupDest(bDst, o);
            f_After(f_Sync(`backup-${n}-real`, [...bd, "--max-delete", maxDel]));
        }
        // 한도가 계획 삭제 수(2)보다 작으면 exit 7 전에 몇 개를 옮기는지
        for (const md of ["1", "0"]) {
            f_MakeBackupDest(bDst, { del: true, over: true });
            f_After(f_Sync(`backup-both-maxdelete${md}`, [...bd, "--max-delete", md]));
        }
        // 전체 범위: 폴더 삭제는 백업하지 않는다
        f_MakeBackupDest(bDst, { del: true, over: false });
        mkdirSync(join(bDst, "emptydir"), { recursive: true });
        f_Show(f_Sync("backup-dirs-dryrun", ["--create-empty-src-dirs", ...bd, "--dry-run"]));
        // 겹침: 백업이 대상 안 / 원본 안 → rclone이 dry-run에서도 거부
        f_MakeBackupDest(bDst, { del: true, over: true });
        f_Sync("backup-overlap-dest", ["--backup-dir", join(bDst, "bk"), "--dry-run"]);
        f_Sync("backup-overlap-src", ["--backup-dir", join(bSrc, "bk"), "--dry-run"]);
        // 하위 폴더에 같은 이름 파일(예전 백업)이 이미 있음 → 예전 백업을 지우고 덮어쓰는지, 한도에 드는지
        f_MakeBackupDest(bDst, { del: true, over: true });
        f_SetFile(join(bRun, "extra.txt"), "previous-extra", OLD);
        f_SetFile(join(bRun, "changed.txt"), "previous-changed", OLD);
        f_After(f_Sync("backup-collision-real", [...bd, "--max-delete", "2"]));
        // 다른 드라이브: RCLONEGUI_PROBE_OTHER_DRIVE(예: D:\)가 있을 때만
        const other = process.env.RCLONEGUI_PROBE_OTHER_DRIVE;
        if (other) {
            const work2 = mkdtempSync(join(other, "rclonegui-probe-"));
            maskDirs.push([work2, "<TMP2>"]);
            try {
                const bk2 = join(work2, "backup-bk");
                const od = ["--backup-dir", join(bk2, "run1")];
                f_MakeBackupDest(bDst, { del: true, over: true });
                f_Show(f_Sync("backup-other-drive-dryrun", [...od, "--dry-run"]));
                f_MakeBackupDest(bDst, { del: true, over: true });
                f_After(f_Sync("backup-other-drive-real", [...od, "--max-delete", "2"]), bDst, bk2);
            } finally {
                rmSync(work2, { recursive: true, force: true });
            }
        } else {
            console.log("  다른 드라이브 실험 생략: RCLONEGUI_PROBE_OTHER_DRIVE가 없음");
        }
    }
    // INT-003 T-03: Move가 없는 저장소 — rclone serve s3(127.0.0.1, 임의 포트·임의 키) 위에서 같은 조합
    // 서버를 띄우므로 --only=backup-s3로만 실행한다
    if (only?.has("backup-s3")) {
        const g = "backup-s3";
        const port = 53000 + randomInt(1000);
        const ak = `ak${randomBytes(6).toString("hex")}`;
        const sk = `sk${randomBytes(12).toString("hex")}`;
        maskValues.push([sk, "<SK>"], [ak, "<AK>"], [`127.0.0.1:${port}`, "127.0.0.1:<PORT>"]);
        const store = join(work, "s3-store");
        mkdirSync(join(store, "bkt"), { recursive: true });
        // stdio를 ignore하지 않으면 spawnSync 중 서버 출력 파이프가 차서 멈춘다
        const srv = spawn(
            rclone,
            [
                "serve",
                "s3",
                ...common,
                "--auth-key",
                `${ak},${sk}`,
                "--addr",
                `127.0.0.1:${port}`,
                store,
            ],
            { shell: false, windowsHide: true, stdio: "ignore" },
        );
        const R = `:s3,provider=Rclone,endpoint='http://127.0.0.1:${port}',access_key_id=${ak},secret_access_key=${sk},force_path_style=true:`;
        const f_Rc = (args) =>
            spawnSync(rclone, [ask, ...common, ...args], {
                shell: false,
                windowsHide: true,
                encoding: "utf8",
                timeout: 60_000,
            });
        try {
            let ready = false;
            for (let i = 0; i < 20 && !ready; i += 1) {
                await new Promise((r) => setTimeout(r, 500));
                ready = f_Rc(["lsjson", `${R}bkt`]).status === 0;
            }
            if (!ready) {
                console.log("  backup-s3 생략: rclone serve s3가 시작되지 않음");
            } else {
                const fr = f_Probe(
                    "backup-s3-features",
                    ["backend", "features", ask, ...common, "--", `${R}bkt`],
                    g,
                );
                if (fr) {
                    try {
                        const j = JSON.parse(fr.stdout);
                        console.log(
                            `  Features.Move: ${j.Features.Move}, Copy: ${j.Features.Copy}`,
                        );
                    } catch {
                        console.log("  features 해석 실패(fixture 확인)");
                    }
                }
                const sSrc = join(work, "backup-src");
                const seed = join(work, "s3-seed");
                f_SetFile(join(seed, "same.txt"), "same", OLD);
                f_SetFile(join(seed, "touch.txt"), "touch", OLD);
                f_SetFile(join(seed, "changed.txt"), "changed", OLD);
                f_SetFile(join(seed, "changed2.txt"), "changed2", OLD);
                f_SetFile(join(seed, "extra.txt"), "extra", OLD);
                f_SetFile(join(seed, "gone", "old.txt"), "old", OLD);
                if (!f_Selected("backup")) {
                    // backup 묶음 없이 돌 때도 원본을 만든다
                    f_SetFile(join(sSrc, "same.txt"), "same", OLD);
                    f_SetFile(join(sSrc, "touch.txt"), "touch", NEWER);
                    f_SetFile(join(sSrc, "changed.txt"), "changed-longer", NEWER);
                    f_SetFile(join(sSrc, "changed2.txt"), "changed2-longer", NEWER);
                    f_SetFile(join(sSrc, "sub", "new.txt"), "new", OLD);
                }
                const f_Seed = () => {
                    f_Rc(["purge", `${R}bkt/dst`]);
                    f_Rc(["purge", `${R}bkt/bk`]);
                    const r = f_Rc(["copy", ...mw, seed, `${R}bkt/dst`]);
                    if (r.status !== 0) console.log(`  seed 실패 exit=${r.status}`);
                };
                const f_Ls = (p) =>
                    f_Rc(["lsf", "-R", "--files-only", `${R}bkt/${p}`])
                        .stdout.trim()
                        .split("\n")
                        .filter(Boolean)
                        .join(",");
                const f_S3Sync = (name, extra) => {
                    const r = f_Probe(
                        name,
                        [
                            "sync",
                            ask,
                            ...common,
                            ...tx,
                            ...mw,
                            "--backup-dir",
                            `${R}bkt/bk/run1`,
                            ...extra,
                            ...log,
                            "--",
                            sSrc,
                            `${R}bkt/dst`,
                        ],
                        g,
                    );
                    if (r) console.log(`  대상: ${f_Ls("dst")}  백업: ${f_Ls("bk")}`);
                };
                f_Seed();
                f_S3Sync("backup-s3-dryrun", ["--dry-run"]);
                f_Seed();
                f_S3Sync("backup-s3-real-maxdelete2", ["--max-delete", "2"]);
                f_Seed();
                f_S3Sync("backup-s3-real-maxdelete4", ["--max-delete", "4"]);
            }
        } finally {
            srv.kill();
            await new Promise((r) => setTimeout(r, 500)); // 서버가 저장소 파일을 놓을 때까지 대기
        }
    }

    // INT-006: remote 설정 쓰기 — providers·rcd(config/create·update·core/quit)·redacted·delete·이름 규칙
    {
        const g = "config";
        const cconf = join(work, "config-remote.conf");
        writeFileSync(cconf, "");
        const cfg = ["--config", cconf];

        f_Probe("config-providers", ["config", "providers"], g);
        f_Probe("config-delete-missing", ["config", "delete", "no-such-remote", ask, ...cfg], g);

        // 이름 규칙(notes #44 재현). 실패 출력만 남긴다
        for (const [label, name] of [
            ["space-start", " ab"],
            ["space-end", "ab "],
            ["dash-end", "ab-"],
            ["colon", "a:b"],
            ["slash", "a/b"],
            ["one-char", "x"],
            ["hangul", "한글"],
        ]) {
            f_Probe(`config-name-${label}`, ["config", "create", name, "memory", ask, ...cfg], g);
        }

        // rcd 묶음은 f_Probe가 아니라 직접 띄우므로 --only=config일 때만 실행한다
        if (!only || only.has("config") || only.has("config-rcd-requests")) {
            const rcdUser = `probe-${randomBytes(6).toString("hex")}`;
            const rcdPass = randomBytes(12).toString("hex");
            maskValues.push(
                ["demo-secret-pass", "<SECRET>"],
                [rcdUser, "<RC_USER>"],
                [rcdPass, "<RC_PASS>"],
            );
            const rcdChild = spawn(rclone, ["rcd", "--rc-addr", "127.0.0.1:0", ask, ...cfg], {
                shell: false,
                windowsHide: true,
                env: { ...process.env, RCLONE_RC_USER: rcdUser, RCLONE_RC_PASS: rcdPass },
            });
            let rcdOut = "";
            let rcdErr = "";
            rcdChild.stdout.setEncoding("utf8").on("data", (d) => (rcdOut += d));
            rcdChild.stderr.setEncoding("utf8").on("data", (d) => (rcdErr += d));
            const rcdClosed = new Promise((r) => rcdChild.once("close", r));
            const f_StartLine = () => {
                const m = rcdErr.match(/Serving remote control on (http:\/\/127\.0\.0\.1:\d+\/)/);
                return m ? m[1] : null;
            };
            let base = null;
            for (let i = 0; i < 40 && base === null; i += 1) {
                await new Promise((r) => setTimeout(r, 250));
                base = f_StartLine();
            }
            const f_Rc = async (path, body) => {
                const res = await fetch(new URL(path, base), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization:
                            "Basic " + Buffer.from(`${rcdUser}:${rcdPass}`).toString("base64"),
                    },
                    body: JSON.stringify(body),
                });
                return { status: res.status, text: await res.text() };
            };
            try {
                if (base === null) {
                    console.log("  config rcd 생략: 시작 줄을 찾지 못함");
                } else {
                    const noAuth = await fetch(new URL("/config/providers", base), {
                        method: "POST",
                    });
                    const create = await f_Rc("/config/create", {
                        name: "it-sftp",
                        type: "sftp",
                        parameters: {
                            host: "example.invalid",
                            user: "demo-user",
                            pass: "demo-secret-pass",
                        },
                        opt: { nonInteractive: true, obscure: true },
                    });
                    const update = await f_Rc("/config/update", {
                        name: "it-sftp",
                        parameters: { host: "example2.invalid" },
                        opt: { nonInteractive: true, obscure: true },
                    });
                    // Drive: 첫 질문(client_id_warning)과 false 답 뒤 질문(client_id_set). 브라우저는 열지 않는다
                    const drive1 = await f_Rc("/config/create", {
                        name: "it-drive",
                        type: "drive",
                        parameters: {},
                        opt: { nonInteractive: true },
                    });
                    let drive2 = { status: 0, text: "" };
                    try {
                        const q = JSON.parse(drive1.text);
                        if (q.State === "client_id_warning") {
                            drive2 = await f_Rc("/config/create", {
                                name: "it-drive",
                                type: "drive",
                                parameters: {},
                                opt: {
                                    nonInteractive: true,
                                    continue: true,
                                    state: q.State,
                                    result: "false",
                                },
                            });
                        }
                    } catch {
                        // 형식이 다르면 fixture만 남긴다
                    }
                    const quit = await f_Rc("/core/quit", {});
                    f_Save(
                        "config-rcd-requests",
                        [noAuth.status, create, update, drive1, drive2, quit]
                            .map((x) =>
                                typeof x === "number"
                                    ? `no-auth status: ${x}`
                                    : `${x.status} ${x.text}`,
                            )
                            .join("\n"),
                        "",
                        0,
                    );
                    console.log(`  config rcd: ${f_Sanitize(base)}`);
                    await Promise.race([rcdClosed, new Promise((r) => setTimeout(r, 5000))]);
                }
            } finally {
                if (rcdChild.exitCode === null) rcdChild.kill();
            }
        }

        f_Probe("config-listremotes-after-rcd", ["listremotes", "--long", ask, ...cfg], g);
        f_Probe("config-redacted", ["config", "redacted", "it-sftp", ask, ...cfg], g);
        f_Probe("config-delete", ["config", "delete", "it-sftp", ask, ...cfg], g);
        f_Probe("config-delete-drive", ["config", "delete", "it-drive", ask, ...cfg], g);
        f_Probe("config-listremotes-after-delete", ["listremotes", ask, ...cfg], g);
    }

    // INT-007 T-01: --filter-from("- " 접두사) 해석, 뒤 공백, BOM, 접두사 없는 줄, 인자 파일(@file)
    // 필터 해석 결과는 --dump filters로 본다(probe 전용, 앱은 --dump*를 쓰지 않는다)
    if (f_Selected("filter")) {
        const g = "filter";
        const fSrc = join(work, "filter-src");
        for (const n of ["#a", ";a", " lead", "!a", "a", "c"]) f_SetFile(join(fSrc, n), n, OLD);
        console.log(`  filter 원본 파일: ${JSON.stringify(f_ListFiles(fSrc))}`);
        const f_FilterFile = (name, content) => {
            const f = join(work, `${name}.txt`);
            writeFileSync(f, content);
            return f;
        };
        const lsBase = ["lsjson", "--recursive", "--files-only", "--no-mimetype", ask, ...common];
        const fLs = (name, extra) => f_Probe(name, [...lsBase, ...extra, "--", fSrc], g);
        const fDump = (name, extra) =>
            f_Probe(name, ["lsf", ask, ...common, ...extra, "--dump", "filters", "--", fSrc], g);
        const show = (label, r) =>
            r &&
            console.log(
                `  ${label}: exit=${r.status} 남은 항목=${JSON.stringify(f_LsPaths(r.stdout))}`,
            );

        // F1: "- " 접두사면 #·;·앞 공백·! 로 시작하는 패턴도 제외 규칙인가
        const f1 = f_FilterFile("f1", "- #a\n- ;a\n-  lead\n- !a\n");
        show("F1 - #a ;a  lead !a", fLs("filter-from-prefixed", ["--filter-from", f1]));
        fDump("filter-from-prefixed-dump", ["--filter-from", f1]);
        // F2: 뒤 공백은 파일·인자 모두에서 지워지는가, [ ]로 남길 수 있는가
        fDump("filter-trailing-space-file-dump", [
            "--filter-from",
            f_FilterFile("f2", "- trail \n- trail[ ]\n- two[ ][ ]\n"),
        ]);
        fDump("filter-trailing-space-arg-dump", ["--exclude", "trail "]);
        fDump("filter-leading-space-arg-dump", ["--exclude", " lead"]);
        // F3: 접두사 없는 줄은 오류인가
        fLs("filter-from-no-prefix", ["--filter-from", f_FilterFile("f3", "a\n")]);
        // F4: BOM, CRLF
        show(
            "F4 BOM - a,- c",
            fLs("filter-from-bom", ["--filter-from", f_FilterFile("f4b", "\uFEFF- a\n- c\n")]),
        );
        show(
            "F4 CRLF - a,- c",
            fLs("filter-from-crlf", ["--filter-from", f_FilterFile("f4c", "- a\r\n- c\r\n")]),
        );
        // F5: --exclude 인자와 --filter-from을 함께 주면 합쳐지는가
        show(
            "F5 인자 a + 파일 - c",
            fLs("filter-from-and-exclude-arg", [
                "--exclude",
                "a",
                "--filter-from",
                f_FilterFile("f5", "- c\n"),
            ]),
        );
        // F6: 인자 파일(@file)을 지원하는가
        f_Probe("argfile-at", [`@${f_FilterFile("f6", "lsf\n")}`], g);
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}
