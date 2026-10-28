/**
 * 빌드본(out/) 스모크 확인. 임시 userData로 앱을 두 번 띄워 원격 디버깅(CDP)으로 화면을 조작한다.
 * 1회차: 창 표시, window.rclonegui 확인, 작업 저장, 차단 경로 거부, 설정 변경,
 *        rclone 감지·경로 확인·WSL 목록·외부 링크 거부(설정 파일은 임시 rclone.conf)
 * 2회차: 재시작 후 작업·설정 유지, 콘솔 오류 0건 확인
 * 실제 사용자 데이터는 건드리지 않는다(임시 폴더만 사용, 끝나면 삭제).
 *
 * 실행: pnpm run build 후 node scripts/dev/drive-app.mjs   (Windows node)
 *       개발 서버(HMR·개발 CSP)로 확인: node scripts/dev/drive-app.mjs --dev
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const electronExe = createRequire(join(repoRoot, "package.json"))("electron");
const PORT = 9333;
const DEV = process.argv.includes("--dev");

function f_Sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function f_WaitTarget() {
    for (let i = 0; i < 240; i += 1) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            const page = list.find(
                (t) =>
                    t.type === "page" &&
                    (DEV ? t.url.startsWith("http://localhost") : t.url.includes("index.html")),
            );
            if (page) return page;
        } catch {
            // 아직 뜨는 중
        }
        await f_Sleep(250);
    }
    throw new Error("앱 페이지를 찾지 못했습니다.");
}

async function f_Connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => {
        ws.addEventListener("open", r, { once: true });
        ws.addEventListener("error", j, { once: true });
    });
    let seq = 0;
    const pending = new Map();
    const consoleErrors = [];
    ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
            consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
        } else if (msg.method === "Runtime.exceptionThrown") {
            consoleErrors.push(msg.params.exceptionDetails.text);
        } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
            consoleErrors.push(msg.params.entry.text);
        }
    });
    const send = (method, params = {}) =>
        new Promise((r) => {
            seq += 1;
            pending.set(seq, r);
            ws.send(JSON.stringify({ id: seq, method, params }));
        });
    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
        return r.result.result.value;
    };
    await send("Runtime.enable");
    await send("Log.enable");
    return { ws, evaluate, consoleErrors };
}

async function f_Launch(userData) {
    const [cmd, args] = DEV
        ? [
              process.execPath,
              [
                  join(repoRoot, "node_modules", "electron-vite", "bin", "electron-vite.js"),
                  "dev",
                  "--remoteDebuggingPort",
                  String(PORT),
              ],
          ]
        : [electronExe, [repoRoot, `--remote-debugging-port=${PORT}`]];
    const child = spawn(cmd, args, {
        cwd: repoRoot,
        env: {
            ...process.env,
            RCLONEGUI_USER_DATA: userData,
            RCLONE_CONFIG: smokeConf,
            ELECTRON_RENDERER_URL: "",
        },
        stdio: "ignore",
        shell: false,
        windowsHide: false,
    });
    const target = await f_WaitTarget();
    const cdp = await f_Connect(target.webSocketDebuggerUrl);
    // React 첫 렌더 대기
    for (let i = 0; i < 40; i += 1) {
        if (await cdp.evaluate("document.querySelector('h1')?.textContent ?? ''")) break;
        await f_Sleep(250);
    }
    return { child, ...cdp };
}

async function f_Close(app) {
    app.ws.close();
    const exited = new Promise((r) => app.child.once("exit", r));
    // 개발 모드는 node → electron 자식까지 함께 종료해야 한다
    execFile(
        "taskkill",
        ["/PID", String(app.child.pid), "/T", "/F"],
        { shell: false },
        () => undefined,
    );
    await exited;
    await f_Sleep(500);
}

const results = [];
function f_Check(name, cond, detail = "") {
    results.push({ name, ok: Boolean(cond), detail });
}

const userData = mkdtempSync(join(tmpdir(), "rclonegui-smoke-"));
// 사용자 rclone.conf 대신 임시 폴더의 빈 설정 파일을 쓴다
const smokeRoot = mkdtempSync(join(tmpdir(), "rclonegui-smoke-conf-"));
const smokeConf = join(smokeRoot, "rclone.conf");
writeFileSync(smokeConf, "");
try {
    const a = await f_Launch(userData);
    f_Check(
        "제목 렌더링",
        (await a.evaluate("document.querySelector('h1').textContent")) === "rcloneGUI",
    );
    f_Check(
        "Node 미노출",
        (await a.evaluate("typeof require + '/' + typeof process")) === "undefined/undefined",
    );
    const keys = await a.evaluate("Object.keys(window.rclonegui).join(',')");
    f_Check(
        "window.rclonegui API",
        keys === "app,settings,jobs,rclone,wsl,dialog,system,events",
        keys,
    );
    const info = await a.evaluate("window.rclonegui.app.getInfo()");
    f_Check(
        "app:getInfo",
        info.ok && info.data.userDataPath === userData,
        JSON.stringify(info.data),
    );
    const draft = `({ ...{ name: "스모크", notes: "", source: "C:\\\\tmp\\\\src", destination: "test-remote:dst", mode: "copy",
        excludes: ["node_modules/**"], configPathOverride: null,
        autoSync: { enabled: false, intervalMinutes: 60, allowDeletes: false },
        options: { checkers: 8, transfers: 4, fastList: true, skipLinks: true, ignoreErrors: false,
            checkHashes: false, modtimeToleranceMs: 2000, preflightBeforeDestructive: true } } })`;
    const created = await a.evaluate(`window.rclonegui.jobs.create(${draft})`);
    f_Check(
        "jobs:create",
        created.ok && created.data.rev === 0,
        JSON.stringify(created).slice(0, 200),
    );
    const blocked = await a.evaluate(
        `window.rclonegui.jobs.create({ ...${draft}, source: "C:\\\\a", destination: "C:\\\\a\\\\b" })`,
    );
    f_Check(
        "중첩 경로 거부(SAFETY_BLOCKED)",
        !blocked.ok && blocked.error.code === "SAFETY_BLOCKED",
    );
    const invalid = await a.evaluate(`window.rclonegui.jobs.create({ ...${draft}, rev: 3 })`);
    f_Check("검증 실패는 envelope(VALIDATION)", !invalid.ok && invalid.error.code === "VALIDATION");
    const upd = await a.evaluate(`window.rclonegui.settings.update({ ui: { theme: "dark" } })`);
    f_Check("settings:update", upd.ok && upd.data.ui.theme === "dark");
    await f_Sleep(500);
    f_Check(
        "목록에 표시",
        (await a.evaluate("document.body.innerText")).includes("저장된 작업 1개"),
    );
    // Phase 3: rclone 환경·경로 확인 (설정 파일은 임시 폴더의 빈 rclone.conf, RCLONE_CONFIG로 지정)
    const env = await a.evaluate("window.rclonegui.rclone.detect(true)");
    f_Check(
        "rclone:detect envelope",
        env.ok && typeof env.data.detectedAt === "string",
        env.ok ? (env.data.problem?.code ?? "") : env.error.code,
    );
    f_Check(
        "rclone:detect 설정 파일은 RCLONE_CONFIG(임시)",
        env.ok && (env.data.problem !== null || env.data.configSource === "env"),
        env.ok ? env.data.configSource : "",
    );
    const probeDir = await a.evaluate(
        `window.rclonegui.rclone.testPath(${JSON.stringify(userData)})`,
    );
    f_Check(
        "rclone:testPath 임시 폴더",
        probeDir.ok && probeDir.data.exists && probeDir.data.isDirectory,
        probeDir.ok ? probeDir.data.message : probeDir.error.code,
    );
    const probeBad = await a.evaluate(`window.rclonegui.rclone.testPath("relative\\path")`);
    f_Check(
        "rclone:testPath 상대 경로 거부",
        !probeBad.ok && probeBad.error.code === "PATH_INVALID",
    );
    const ext = await a.evaluate(`window.rclonegui.system.openExternal("https://example.com/")`);
    f_Check("system:openExternal 허용 목록 밖 거부", !ext.ok && ext.error.code === "VALIDATION");
    const wsl = await a.evaluate("window.rclonegui.wsl.listDistros()");
    f_Check(
        "wsl:listDistros envelope",
        wsl.ok ? Array.isArray(wsl.data.distros) : wsl.error.code === "WSL_NOT_AVAILABLE",
    );
    // WSL 도우미: 배포판을 불러오면 미리보기 경로를 입력란에 넣는 버튼이 보인다
    await a.evaluate(
        `[...document.querySelectorAll("button")].find((b) => b.textContent === "WSL 배포판 불러오기")?.click()`,
    );
    await f_Sleep(1500);
    const helperText = await a.evaluate("document.body.innerText");
    f_Check(
        "WSL 도우미 버튼 문구(입력란에 넣기)",
        !wsl.ok ||
            wsl.data.distros.length === 0 ||
            helperText.includes("이 UNC 경로를 입력란에 넣기"),
    );
    const text = await a.evaluate("document.body.innerText");
    f_Check(
        "rclone 설정·경로 확인 패널 표시",
        text.includes("rclone 설정") && text.includes("경로 접근 확인"),
    );
    const errors1 = [...a.consoleErrors];
    await f_Close(a);

    const b = await f_Launch(userData);
    const jobs = await b.evaluate("window.rclonegui.jobs.list()");
    f_Check(
        "재시작 후 작업 유지",
        jobs.ok && jobs.data.length === 1 && jobs.data[0].name === "스모크",
    );
    const settings = await b.evaluate("window.rclonegui.settings.get()");
    f_Check("재시작 후 설정 유지", settings.ok && settings.data.ui.theme === "dark");
    f_Check(
        "저장된 테마(다크) 적용",
        (await b.evaluate("document.documentElement.dataset.theme")) === "dark",
    );
    await f_Sleep(300);
    const errors = [...errors1, ...b.consoleErrors];
    f_Check("콘솔 오류 0건", errors.length === 0, errors.join(" | "));
    await f_Close(b);
} finally {
    rmSync(userData, { recursive: true, force: true });
    rmSync(smokeRoot, { recursive: true, force: true });
}

for (const r of results)
    console.log(
        `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.ok ? `  — ${r.detail}` : ""}`,
    );
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed}건 실패` : `\n전체 ${results.length}건 통과`);
process.exit(failed ? 1 : 0);
