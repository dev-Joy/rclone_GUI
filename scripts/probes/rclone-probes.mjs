/**
 * rclone 동작 확인 실험. 임시 폴더만 사용해 실제 rclone 출력을 tests/fixtures/rclone/ 에 저장한다.
 *
 * - 실제 사용자 경로와 사용자 rclone.conf는 쓰지 않는다. 임시 폴더 안의 빈 rclone.conf를 --config로 넘긴다.
 * - 출력 속 임시 폴더 경로는 <TMP> 로 바꿔 저장한다(fixture에 사용자 이름·경로가 남지 않도록).
 * - rclone을 올릴 때마다 다시 실행하고, 달라진 동작은 docs/knowhow/rclone-notes.md에 기록한다.
 *
 * 실행: node scripts/probes/rclone-probes.mjs [rclone.exe 경로] [--only=이름,이름]   (Windows node)
 *       --only를 주면 그 이름의 실험만 실행·저장한다(다른 fixture는 그대로 둔다).
 *       묶음 이름(copy-cancel-large, excl)을 주면 그 묶음의 뒤따르는 실험도 함께 실행한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { execFile, spawn, spawnSync } from "node:child_process";
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

function f_Sanitize(text) {
    const fwd = work.replaceAll("\\", "/");
    const variants = [`//?/${fwd}`, `\\\\?\\${work}`, work.replaceAll("\\", "\\\\"), work, fwd];
    let out = text;
    for (const v of variants.toSorted((a, b) => b.length - a.length))
        out = out.replaceAll(v, "<TMP>");
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
    const r = spawnSync(rclone, args, { shell: false, windowsHide: true, encoding: "utf8" });
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
} finally {
    rmSync(work, { recursive: true, force: true });
}
