/**
 * 설치 파일(dist/rcloneGUI-Setup-<버전>.exe) 스모크 확인. 임시 폴더에 설치 → 확인 → 제거까지 한 번에 한다.
 *
 * 1. 사전 확인: Windows인지, 이미 설치된 rcloneGUI(HKCU Uninstall)·실행 중인 rcloneGUI.exe·로그인 항목 값이 없는지
 *    (하나라도 있으면 사용자 환경을 건드리지 않도록 중단)
 * 2. 임시 폴더에 사용자 단위 무인 설치(/S /currentuser /D=<임시>) → exe·제거 프로그램·바로가기·Uninstall 키 확인
 * 3. app.asar 목록(out/·package.json·node_modules/zod만), 언어 팩(ko·en-US만)
 * 4. 임시 userData로 한 번 띄워 데이터 폴더 생성 → drive-app --exe(임시 userData·임시 rclone.conf)
 * 5. (--login-item일 때만) drive-app이 로그인 시 시작을 켜고, HKCU Run 값이 설치 exe + --hidden인지 확인
 * 6. 무인 제거 → 설치 폴더·바로가기·Uninstall 키·로그인 항목 값 없음, 임시 userData는 남음 확인
 * 7. 실제 %APPDATA%\rcloneGUI는 존재 여부·수정 시각만 전후 비교(내용은 읽지 않는다) → 임시 폴더 삭제
 *
 * 출력에는 실제 사용자 경로를 쓰지 않는다(<TMP>·<APPDATA> 등으로 바꾼다).
 * 실행: pnpm run dist 후 pnpm run smoke:installer [-- --login-item]   (Windows node)
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const PRODUCT = "rcloneGUI";
/** src/main/index.ts APP_USER_MODEL_ID = electron-builder.yml appId = 로그인 항목 값 이름 */
const APP_ID = "com.rclonegui.app";
const INSTALLER = join(repoRoot, "dist", `${PRODUCT}-Setup-${pkg.version}.exe`);
const LOGIN_ITEM = process.argv.includes("--login-item");
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED_KEY =
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const INSTALL_TIMEOUT_MS = 180_000;
const UNINSTALL_WAIT_MS = 60_000;

function f_Sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** 출력용: 실제 사용자 경로를 자리표시자로 바꾼다(긴 경로부터) */
function f_Mask(text) {
    const pairs = [
        [repoRoot, "<REPO>"],
        [tmpdir(), "<TMP>"],
        [process.env.LOCALAPPDATA, "<LOCALAPPDATA>"],
        [process.env.APPDATA, "<APPDATA>"],
        [process.env.USERPROFILE, "<HOME>"],
    ]
        .filter(([p]) => typeof p === "string" && p.length > 3)
        .toSorted((x, y) => y[0].length - x[0].length);
    let out = String(text);
    for (const [p, tag] of pairs) {
        out = out.split(p).join(tag).split(p.replaceAll("\\", "\\\\")).join(tag);
    }
    return out;
}

/** execFile(shell 없음). 종료 코드와 출력을 돌려준다 */
function f_Exec(cmd, args, opts = {}) {
    return new Promise((done) => {
        execFile(
            cmd,
            args,
            { shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...opts },
            (err, stdout, stderr) =>
                done({
                    code: err ? (typeof err.code === "number" ? err.code : -1) : 0,
                    stdout: String(stdout),
                    stderr: String(stderr),
                }),
        );
    });
}

/** PowerShell 스크립트(상수만 넣는다. 경로는 환경 변수로 넘긴다) */
async function f_Ps(script, env = {}) {
    const r = await f_Exec(
        "powershell.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`,
        ],
        { env: { ...process.env, ...env } },
    );
    return r.stdout.trim();
}

/** HKCU Uninstall 아래 DisplayName이 rcloneGUI로 시작하는 항목 */
async function f_UninstallEntries() {
    const out = await f_Ps(
        `$l = @(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-ItemProperty $_.PSPath; if ("$($p.DisplayName)" -like '${PRODUCT}*') { [pscustomobject]@{ key = $_.PSChildName; name = "$($p.DisplayName)"; uninstall = "$($p.UninstallString)" } } }); ConvertTo-Json -InputObject $l -Compress`,
    );
    try {
        const v = JSON.parse(out || "[]");
        return Array.isArray(v) ? v : [v];
    } catch {
        return [];
    }
}

async function f_RcloneGuiRunning() {
    const r = await f_Exec("tasklist", ["/FI", `IMAGENAME eq ${PRODUCT}.exe`, "/NH", "/FO", "CSV"]);
    return r.stdout.toLowerCase().includes(`"${PRODUCT.toLowerCase()}.exe"`);
}

/** reg query 값(없으면 null) */
async function f_RegValue(key, name) {
    const r = await f_Exec("reg", ["query", key, "/v", name]);
    return r.code === 0 ? r.stdout : null;
}

async function f_ShellFolders() {
    const out = await f_Ps(
        `ConvertTo-Json -Compress @{ desktop = [Environment]::GetFolderPath('Desktop'); programs = [Environment]::GetFolderPath('Programs') }`,
    );
    return JSON.parse(out);
}

/** asar 헤더(JSON)의 파일 목록. 형식: UInt32(4) · UInt32(헤더 크기) · [UInt32 · UInt32 길이 · JSON] */
function f_AsarFiles(asarPath) {
    const buf = readFileSync(asarPath);
    const headerSize = buf.readUInt32LE(4);
    const header = buf.subarray(8, 8 + headerSize);
    const json = JSON.parse(header.subarray(8, 8 + header.readUInt32LE(4)).toString("utf8"));
    const files = [];
    const walk = (node, prefix) => {
        for (const [name, child] of Object.entries(node.files ?? {})) {
            const p = prefix ? `${prefix}/${name}` : name;
            if (child.files) walk(child, p);
            else files.push(p);
        }
    };
    walk(json, "");
    return files;
}

function f_Spawn(cmd, args, opts = {}) {
    return spawn(cmd, args, { stdio: "ignore", shell: false, windowsHide: true, ...opts });
}

function f_WaitExit(child, timeoutMs) {
    return Promise.race([
        new Promise((r) => child.once("exit", (code) => r(code))),
        f_Sleep(timeoutMs).then(() => "timeout"),
    ]);
}

const results = [];
function f_Check(name, cond, detail = "") {
    results.push({ name, ok: Boolean(cond), detail: f_Mask(detail) });
}

function f_Abort(message) {
    console.error(`중단: ${f_Mask(message)}`);
    process.exit(2);
}

// ========== 1. 사전 확인 ==========
if (process.platform !== "win32") f_Abort("Windows에서만 실행합니다.");
if (!existsSync(INSTALLER)) {
    f_Abort(`설치 파일이 없습니다(${INSTALLER}). 먼저 pnpm run dist를 실행하세요.`);
}
const existing = await f_UninstallEntries();
if (existing.length > 0) {
    f_Abort(
        `이미 설치된 ${PRODUCT}가 있습니다(${existing.map((e) => e.name).join(", ")}). 제거한 뒤 다시 실행하세요.`,
    );
}
if (await f_RcloneGuiRunning())
    f_Abort(`실행 중인 ${PRODUCT}.exe가 있습니다. 끝낸 뒤 다시 실행하세요.`);
if ((await f_RegValue(RUN_KEY, APP_ID)) !== null) {
    f_Abort(`로그인 항목(${APP_ID})이 이미 있습니다. 기존 설치를 정리한 뒤 다시 실행하세요.`);
}

const realAppData = join(process.env.APPDATA ?? "", PRODUCT);
const f_AppDataStamp = () =>
    existsSync(realAppData) ? `있음 mtime=${statSync(realAppData).mtimeMs}` : "없음";
const appDataBefore = f_AppDataStamp();
const installerSize = statSync(INSTALLER).size;

const root = mkdtempSync(join(tmpdir(), "rclonegui-inst-"));
const instDir = join(root, "app");
const userData = join(root, "userdata");
const exe = join(instDir, `${PRODUCT}.exe`);
const uninstaller = join(instDir, `Uninstall ${PRODUCT}.exe`);
let installed = false;
let uninstalled = false;

async function f_Uninstall() {
    const code = await f_WaitExit(f_Spawn(uninstaller, ["/S", "/currentuser"]), 60_000);
    // 제거 프로그램은 임시 폴더로 자신을 복사해 다시 실행하므로 설치 폴더가 사라질 때까지 기다린다
    const started = Date.now();
    while (existsSync(instDir) && Date.now() - started < UNINSTALL_WAIT_MS) await f_Sleep(500);
    for (let i = 0; i < 20 && (await f_UninstallEntries()).length > 0; i += 1) await f_Sleep(500);
    uninstalled = !existsSync(instDir);
    return code;
}

try {
    // ========== 2. 설치 ==========
    // NSIS /D=는 마지막 인자여야 하고 따옴표를 쓸 수 없다 → 이 호출만 인자를 그대로 넘긴다(shell은 쓰지 않음)
    const setup = f_Spawn(INSTALLER, ["/S", "/currentuser", `/D=${instDir}`], {
        argv0: `"${INSTALLER}"`,
        windowsVerbatimArguments: true,
    });
    const setupCode = await f_WaitExit(setup, INSTALL_TIMEOUT_MS);
    installed = existsSync(instDir);
    f_Check("무인 설치(사용자 단위, 임시 폴더) 종료 코드 0", setupCode === 0, `code=${setupCode}`);
    f_Check(
        "설치 폴더에 rcloneGUI.exe·제거 프로그램·app.asar",
        existsSync(exe) &&
            existsSync(uninstaller) &&
            existsSync(join(instDir, "resources", "app.asar")),
    );
    const entries = await f_UninstallEntries();
    f_Check(
        "HKCU Uninstall 키 1개(DisplayName rcloneGUI, 임시 설치 폴더의 제거 프로그램)",
        entries.length === 1 &&
            entries[0].name === PRODUCT &&
            entries[0].uninstall.toLowerCase().includes(instDir.toLowerCase()),
        JSON.stringify(entries),
    );
    const folders = await f_ShellFolders();
    const desktopLnk = join(folders.desktop, `${PRODUCT}.lnk`);
    const startLnk = join(folders.programs, `${PRODUCT}.lnk`);
    f_Check(
        "바탕화면·시작 메뉴 바로가기",
        existsSync(desktopLnk) && existsSync(startLnk),
        `desktop=${existsSync(desktopLnk)} start=${existsSync(startLnk)}`,
    );

    // ========== 3. 설치본 구성 ==========
    const asarFiles = f_AsarFiles(join(instDir, "resources", "app.asar"));
    const extra = asarFiles.filter(
        (f) => !f.startsWith("out/") && f !== "package.json" && !f.startsWith("node_modules/zod/"),
    );
    f_Check(
        "app.asar: out/·package.json·node_modules/zod만",
        extra.length === 0 &&
            asarFiles.includes("out/main/index.js") &&
            asarFiles.includes("out/renderer/index.html") &&
            asarFiles.includes("node_modules/zod/package.json"),
        extra.slice(0, 10).join(", "),
    );
    f_Check(
        "app.asar: 트레이 아이콘(out/main/**/tray-*.png) 포함",
        asarFiles.some((f) => /^out\/main\/.*tray-[^/]*\.png$/.test(f)),
    );
    const locales = readdirSync(join(instDir, "locales")).toSorted();
    f_Check("언어 팩: en-US·ko만", locales.join(",") === "en-US.pak,ko.pak", locales.join(","));

    // ========== 4. 실행 ==========
    // 임시 userData로 한 번 띄워(창 없이) 데이터 폴더를 만든다 → 제거 뒤 남는지 본다
    const confDir = join(root, "conf");
    const first = f_Spawn(exe, ["--hidden"], {
        cwd: instDir,
        env: {
            ...process.env,
            RCLONEGUI_USER_DATA: userData,
            RCLONE_CONFIG: join(confDir, "rclone.conf"),
        },
    });
    let userDataMade = false;
    for (let i = 0; i < 60 && !userDataMade; i += 1) {
        await f_Sleep(250);
        userDataMade = existsSync(join(userData, "logs"));
    }
    await f_Sleep(1500);
    await f_Exec("taskkill", ["/PID", String(first.pid), "/T", "/F"]);
    await f_WaitExit(first, 10_000);
    f_Check("설치본 실행 → 임시 userData 생성", userDataMade);

    const driveArgs = [join(repoRoot, "scripts", "dev", "drive-app.mjs"), "--exe", exe];
    if (LOGIN_ITEM) driveArgs.push("--login-item");
    const drive = await f_Exec(process.execPath, driveArgs, { cwd: repoRoot, timeout: 600_000 });
    console.log(f_Mask(drive.stdout.trim()));
    if (drive.stderr.trim()) console.log(f_Mask(drive.stderr.trim()));
    f_Check("drive-app --exe 통과", drive.code === 0, `code=${drive.code}`);

    // ========== 5. 로그인 항목(명시할 때만) ==========
    if (LOGIN_ITEM) {
        const runValue = await f_RegValue(RUN_KEY, APP_ID);
        f_Check(
            "로그인 항목(HKCU Run): 설치 exe + --hidden",
            runValue !== null &&
                runValue.toLowerCase().includes(exe.toLowerCase()) &&
                runValue.includes("--hidden"),
            runValue ?? "없음",
        );
    }

    // ========== 6. 제거 ==========
    const unCode = await f_Uninstall();
    f_Check("무인 제거 종료 코드 0·설치 폴더 삭제", unCode === 0 && uninstalled, `code=${unCode}`);
    f_Check(
        "제거 뒤 Uninstall 키·바로가기 없음",
        (await f_UninstallEntries()).length === 0 &&
            !existsSync(desktopLnk) &&
            !existsSync(startLnk),
    );
    f_Check(
        "제거 뒤 로그인 항목 값(Run·StartupApproved) 없음",
        (await f_RegValue(RUN_KEY, APP_ID)) === null &&
            (await f_RegValue(APPROVED_KEY, APP_ID)) === null,
    );
    f_Check("제거 뒤 사용자 데이터 보존(임시 userData 남음)", existsSync(join(userData, "logs")));
} finally {
    if (installed && !uninstalled) {
        // 중간에 실패해도 설치본을 남기지 않는다(사전 확인으로 다른 rcloneGUI.exe는 없었다)
        await f_Exec("taskkill", ["/IM", `${PRODUCT}.exe`, "/T", "/F"]);
        await f_Sleep(1000);
        if (existsSync(uninstaller)) await f_Uninstall();
    }
    // ========== 7. 실제 데이터 폴더 불변 확인 ==========
    const appDataAfter = f_AppDataStamp();
    f_Check(
        "실제 %APPDATA%\\rcloneGUI 존재 여부·수정 시각 불변(내용은 읽지 않음)",
        appDataBefore === appDataAfter,
        `before=${appDataBefore} after=${appDataAfter}`,
    );
    rmSync(root, { recursive: true, force: true });
}

console.log(`\n설치 파일: ${PRODUCT}-Setup-${pkg.version}.exe ${installerSize} bytes`);
for (const r of results)
    console.log(
        `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.ok ? `  — ${r.detail}` : ""}`,
    );
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed}건 실패` : `\n전체 ${results.length}건 통과`);
process.exit(failed ? 1 : 0);
