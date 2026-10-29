/**
 * 빌드본(out/) 스모크 확인. 임시 userData로 앱을 두 번 띄워 원격 디버깅(CDP)으로 화면을 조작한다.
 * 1회차: 창 표시, window.rclonegui 확인, 작업 저장, 차단 경로 거부, 설정 변경,
 *        rclone 감지·경로 확인·WSL 목록·외부 링크 거부(설정 파일은 임시 rclone.conf),
 *        작업 화면(새 작업·저장 차단·저장·변경 확인·복제·삭제·remote 선택·접근 확인)과 설정 화면,
 *        비교 화면(임시 원본·대상 비교 → 요약·행 표시, 상태 필터·동일 숨기기·경로 검색),
 *        실행 화면(미리보기 요약·대상 불변 → 복사 실행 확인 창 → 대상 반영),
 *        동기화(삭제 확인 모달·체크 전 비활성 → 비교 뒤 대상 변경 시 사전 확인 불일치 모달·대상 불변
 *        → 다른 작업을 고친 채 다시 비교(변경 버리기 확인 → 막힌 작업의 비교 탭) → 대상 반영),
 *        대상의 가짜 `x.bin.0123abcd.partial`을 비교 목록·삭제 확인 창에서 "취소로 남은 임시 파일"로 표시,
 *        이력 탭(목록·상세·로그 끝부분), 설정(트레이·로그인 시작 표시, 이력 비우기), 자동 실행 일시정지
 * 2회차: 재시작 후 작업·설정·lastRun·일시정지 유지, active-run 없음, 이름순 첫 작업 자동 선택,
 *        자동 실행 재개 → 1분 주기 자동 실행(copy 반영·삭제 허용 끈 sync는 blocked·대상 불변) → 일시정지,
 *        실행 중 창 닫기 → 트레이로 숨김(실행 계속) → 트레이 끄고 창 닫기 → 종료 확인(개발 실행 자동 응답 "종료")
 *        → 취소 뒤 종료·rclone 미잔존·active-run 없음·이력 canceled(전송 시작 기록)
 * 3회차: 중단됨 안내 없음·lastRun canceled·일시정지 유지·자동 실행 예약 유지(중복 실행 없음)·이력 상세 .partial 안내
 * 4회차: --hidden(로그인 시 시작)으로 띄우면 창이 보이지 않음, 콘솔 오류 0건 확인
 * 개발 실행 전용 환경 변수: RCLONEGUI_DEV_TICK_MS(스케줄러 tick 단축), RCLONEGUI_DEV_QUIT_CHOICE(종료 확인 창 자동 응답)
 * 실제 사용자 데이터는 건드리지 않는다(임시 폴더만 사용, 끝나면 삭제).
 *
 * 실행: pnpm run build 후 node scripts/dev/drive-app.mjs   (Windows node)
 *       개발 서버(HMR·개발 CSP)로 확인: node scripts/dev/drive-app.mjs --dev
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { execFile, spawn } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
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
    // 페이지가 사라지면 응답이 오지 않으므로 30초 뒤 실패로 돌려준다(스크립트가 멈추지 않게)
    const send = (method, params = {}) =>
        new Promise((r) => {
            seq += 1;
            const id = seq;
            const timer = setTimeout(() => {
                pending.delete(id);
                r({ result: { exceptionDetails: { text: `CDP 응답 없음: ${method}` } } });
            }, 30_000);
            pending.set(id, (msg) => {
                clearTimeout(timer);
                r(msg);
            });
            ws.send(JSON.stringify({ id, method, params }));
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

/** extra.env: 더할 환경 변수, extra.args: 앱 인자(예: --hidden) */
async function f_Launch(userData, extra = {}) {
    const appArgs = extra.args ?? [];
    const [cmd, args] = DEV
        ? [
              process.execPath,
              [
                  join(repoRoot, "node_modules", "electron-vite", "bin", "electron-vite.js"),
                  "dev",
                  "--remoteDebuggingPort",
                  String(PORT),
                  ...(appArgs.length > 0 ? ["--", ...appArgs] : []),
              ],
          ]
        : [electronExe, [repoRoot, `--remote-debugging-port=${PORT}`, ...appArgs]];
    const child = spawn(cmd, args, {
        cwd: repoRoot,
        env: {
            ...process.env,
            RCLONEGUI_USER_DATA: userData,
            RCLONE_CONFIG: smokeConf,
            ELECTRON_RENDERER_URL: "",
            ...extra.env,
        },
        stdio: "ignore",
        shell: false,
        windowsHide: false,
    });
    const target = await f_WaitTarget();
    const cdp = await f_Connect(target.webSocketDebuggerUrl);
    // React 첫 렌더 대기 (숨긴 창도 렌더링은 한다)
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

const js = (v) => JSON.stringify(v);

const QUIT_FILES = 3000;
/** main의 종료 대기(10초) + 여유 */
const QUIT_TIMEOUT_MS = 15_000;

/**
 * 창 X와 같은 닫기 요청(WM_CLOSE)을 보낸다: taskkill을 /F 없이 쓴다.
 * 화면의 window.close()는 페이지(webContents)를 바로 닫아 BrowserWindow close 흐름을 타지 않는다.
 */
function f_SendClose(pid) {
    return new Promise((done) => {
        execFile("taskkill", ["/PID", String(pid)], { shell: false, windowsHide: true }, () =>
            done(),
        );
    });
}

/**
 * 프로세스에 보이는 창이 있는지. .NET MainWindowHandle은 보이는 최상위 창만 돌려준다(숨긴 창이면 0).
 * (Chromium visibilityState는 한 번도 보인 적 없는 창을 "visible"로 알려 쓸 수 없다)
 */
function f_WindowShown(pid) {
    return new Promise((done) => {
        execFile(
            "powershell.exe",
            ["-NoProfile", "-Command", `(Get-Process -Id ${Number(pid)}).MainWindowHandle`],
            { shell: false, windowsHide: true },
            (err, out) => done(!err && out.trim() !== "" && out.trim() !== "0"),
        );
    });
}

/** 같은 userData로 앱을 한 번 더 띄운다(단일 인스턴스: 기존 앱이 창을 보이고 새 프로세스는 바로 끝난다) */
function f_SecondInstance(userData) {
    return new Promise((done) => {
        const child = spawn(electronExe, [repoRoot], {
            cwd: repoRoot,
            env: { ...process.env, RCLONEGUI_USER_DATA: userData, ELECTRON_RENDERER_URL: "" },
            stdio: "ignore",
            shell: false,
        });
        child.once("exit", (code) => done(code));
    });
}

/** tasklist로 PID가 살아 있는지 (Windows) */
function f_PidAlive(pid) {
    return new Promise((done) => {
        execFile(
            "tasklist",
            ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"],
            { shell: false, windowsHide: true },
            (err, out) => done(!err && out.includes(`"${pid}"`)),
        );
    });
}

/** 화면 조작 도우미 (React 제어 입력은 네이티브 setter + input/change 이벤트로 바꾼다) */
function f_Ui(app) {
    return {
        text: () => app.evaluate("document.body.innerText"),
        /** 글자가 정확히 같은 첫 버튼(비활성 포함 여부 선택) */
        click: (label, { inDialog = false } = {}) =>
            app.evaluate(`(() => {
                const root = ${inDialog} ? document.querySelector("dialog[open]") : document;
                const b = [...(root?.querySelectorAll("button") ?? [])]
                    .find((x) => x.textContent.trim() === ${js(label)} && !x.disabled);
                if (!b) return false;
                b.click();
                return true;
            })()`),
        disabled: (label) =>
            app.evaluate(`[...document.querySelectorAll("button")]
                .filter((x) => x.textContent.trim() === ${js(label)})
                .map((x) => x.disabled)`),
        /** 사이드바의 작업 항목(이름이 정확히 같은 것) 클릭 */
        clickJob: (name) =>
            app.evaluate(`(() => {
                const b = [...document.querySelectorAll("nav[aria-labelledby=jobs-title] li button")]
                    .find((x) => x.querySelector("span")?.textContent === ${js(name)});
                if (!b) return false;
                b.click();
                return true;
            })()`),
        fill: (selector, value) =>
            app.evaluate(`(() => {
                const el = document.querySelector(${js(selector)});
                if (!el) return false;
                const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                    : HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${js(value)});
                el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
                return true;
            })()`),
        value: (selector) => app.evaluate(`document.querySelector(${js(selector)})?.value ?? null`),
        dialogText: () => app.evaluate(`document.querySelector("dialog[open]")?.innerText ?? ""`),
        /** 조건식이 참이 될 때까지 기다린다 */
        until: async (expression, timeoutMs = 5000) => {
            for (let t = 0; t < timeoutMs; t += 100) {
                if (await app.evaluate(`Boolean(${expression})`)) return true;
                await f_Sleep(100);
            }
            return false;
        },
        /** Promise를 돌려주는 조건식이 참이 될 때까지 기다린다(간격 intervalMs) */
        untilAsync: async (expression, timeoutMs = 5000, intervalMs = 200) => {
            const started = Date.now();
            while (Date.now() - started < timeoutMs) {
                if (await app.evaluate(`(async () => Boolean(await (${expression})))()`)) {
                    return true;
                }
                await f_Sleep(intervalMs);
            }
            return false;
        },
    };
}

const results = [];
function f_Check(name, cond, detail = "") {
    results.push({ name, ok: Boolean(cond), detail });
}

const userData = mkdtempSync(join(tmpdir(), "rclonegui-smoke-"));
// 사용자 rclone.conf 대신 임시 폴더의 빈 설정 파일을 쓴다
const smokeRoot = mkdtempSync(join(tmpdir(), "rclonegui-smoke-conf-"));
const smokeConf = join(smokeRoot, "rclone.conf");
const smokeSrc = join(smokeRoot, "src");
const smokeDst = join(smokeRoot, "dst");
mkdirSync(smokeSrc);
mkdirSync(smokeDst);
// 비교 시나리오용 파일: 원본만 1, 변경 1(크기 다름), 동일 1, 대상만 1
const SMOKE_MTIME = new Date("2026-01-01T00:00:00Z");
for (const [dir, name, text] of [
    [smokeSrc, "new.txt", "new"],
    [smokeSrc, "changed.txt", "changed-longer"],
    [smokeSrc, "same.txt", "same"],
    [smokeDst, "changed.txt", "changed"],
    [smokeDst, "same.txt", "same"],
    [smokeDst, "extra.txt", "extra"],
]) {
    writeFileSync(join(dir, name), text);
    utimesSync(join(dir, name), SMOKE_MTIME, SMOKE_MTIME);
}
// alias remote 2개: 한 글자 이름(x, Windows에서 드라이브 문자로 해석됨)과 일반 이름. 둘 다 임시 폴더를 가리킨다
writeFileSync(
    smokeConf,
    `[x]\ntype = alias\nremote = ${smokeSrc}\n\n[smoke-alias]\ntype = alias\nremote = ${smokeDst}\n`,
);
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
        keys === "app,settings,jobs,compare,run,history,scheduler,rclone,wsl,dialog,system,events",
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
    // ===== Phase 4: 작업 화면 =====
    const ui = f_Ui(a);
    f_Check("사이드바에서 작업 열기", await ui.clickJob("스모크"));
    f_Check(
        "편집기에 저장된 값 표시",
        await ui.until(`document.querySelector("input[name=name]")?.value === "스모크"`),
    );
    const checkButtons = await a.evaluate(
        `[...document.querySelectorAll("button")].filter((b) => b.textContent === "접근 확인").length`,
    );
    f_Check("경로 필드마다 접근 확인 버튼(2개)", checkButtons === 2, String(checkButtons));
    // WSL 도우미: 원본 필드에서 열면 배포판을 불러오고 미리보기 경로를 입력란에 넣는 버튼이 보인다
    await ui.click("WSL 도우미");
    await f_Sleep(1500);
    const helperText = await ui.dialogText();
    f_Check(
        "WSL 도우미 버튼 문구(입력란에 넣기)",
        helperText.includes("WSL 배포판 불러오기") &&
            (!wsl.ok ||
                wsl.data.distros.length === 0 ||
                helperText.includes("이 UNC 경로를 입력란에 넣기")),
        helperText.slice(0, 200),
    );
    await ui.click("닫기", { inDialog: true });

    // 새 작업: 설정 기본값으로 초안
    await ui.click("새 작업");
    await ui.until(`document.querySelector("input[name=name]")?.value === ""`);
    f_Check(
        "새 작업 초안(이름 빈칸, 제외 규칙 = 설정 기본값)",
        (await ui.value("input[name=name]")) === "" &&
            (await ui.value("textarea[name=excludes]")) ===
                "node_modules/**\n_session/**\n_gsdata_/**\n.codegraph/daemon.sock",
    );
    await ui.fill("input[name=name]", "UI 작업");
    await ui.fill("input[name=source]", "/home/x");
    await ui.fill("input[name=destination]", smokeDst);
    await ui.click("저장");
    await f_Sleep(300);
    const countAfterBad = (await a.evaluate("window.rclonegui.jobs.list()")).data.length;
    f_Check(
        "잘못된 경로는 필드 오류로 저장 차단",
        (await ui.text()).includes("WSL 리눅스 경로는") && countAfterBad === 1,
        String(countAfterBad),
    );
    await ui.fill("input[name=source]", smokeSrc);
    await ui.fill("input[name=destination]", join(smokeSrc, "sub"));
    await ui.click("저장");
    await f_Sleep(300);
    f_Check(
        "중첩 경로 저장 차단(화면)",
        (await ui.text()).includes("대상이 원본 폴더 안에 있습니다.") &&
            (await a.evaluate("window.rclonegui.jobs.list()")).data.length === 1,
    );
    await ui.fill("input[name=destination]", smokeDst);
    await ui.click("저장");
    f_Check(
        "정상 저장 → 목록 2개·선택됨",
        (await ui.until(`document.body.innerText.includes("저장된 작업 2개")`)) &&
            (await a.evaluate(
                `document.querySelector("nav [aria-current=true]")?.textContent.includes("UI 작업")`,
            )),
    );
    const compareDisabled = await ui.disabled("비교");
    f_Check(
        "저장 후 비교(버튼·탭)·미리보기 활성, 복사 실행은 비교 전 비활성",
        compareDisabled.length === 2 &&
            compareDisabled.every((d) => !d) &&
            (await ui.disabled("미리보기")).every((d) => !d) &&
            (await ui.disabled("복사 실행")).every(Boolean) &&
            (await ui.text()).includes("먼저 비교하세요"),
        JSON.stringify(compareDisabled),
    );
    await ui.click("접근 확인");
    f_Check(
        "접근 확인(임시 원본 폴더) 성공",
        await ui.until(`document.querySelector("[data-state=ok]")`, 15000),
    );

    // 저장하지 않은 변경
    await ui.fill("input[name=name]", "UI 작업 수정");
    f_Check(
        "변경 중: 비교 버튼·실행·복제 비활성 + 안내(비교 탭은 저장된 결과 보기용)",
        (await a.evaluate(
            `[...document.querySelectorAll("header button")].filter((b) => b.textContent.trim() === "비교").map((b) => b.disabled).join()`,
        )) === "true" &&
            (await ui.disabled("복사 실행")).every(Boolean) &&
            (await ui.disabled("복제")).every(Boolean) &&
            (await ui.text()).includes("저장하지 않은 변경이 있습니다"),
    );
    await ui.clickJob("스모크");
    await f_Sleep(200);
    f_Check(
        "다른 작업 클릭 → 변경 버리기 확인",
        (await ui.dialogText()).includes("변경 버리고 이동"),
    );
    await ui.click("계속 편집", { inDialog: true });
    await f_Sleep(200);
    f_Check(
        "계속 편집 → 변경 유지",
        (await ui.value("input[name=name]")) === "UI 작업 수정" && (await ui.dialogText()) === "",
    );
    await ui.clickJob("스모크");
    await f_Sleep(200);
    await ui.click("변경 버리고 이동", { inDialog: true });
    f_Check(
        "변경 버리고 이동 → 다른 작업 열림",
        await ui.until(`document.querySelector("input[name=name]")?.value === "스모크"`),
    );

    // remote 선택(기본 rclone.conf = 임시 설정 파일)과 한 글자 remote
    await ui.until(`document.querySelector("#job-source-remote")`, 10000);
    const remoteOptions = await a.evaluate(
        `[...document.querySelectorAll("#job-source-remote option")].map((o) => o.value + ":" + o.disabled)`,
    );
    f_Check(
        "remote 목록: smoke-alias 선택 가능, x 비활성",
        remoteOptions.includes("smoke-alias:false") && remoteOptions.includes("x:true"),
        remoteOptions.join(","),
    );
    f_Check("한 글자 remote 경고(편집기)", (await ui.text()).includes("드라이브 문자로 해석"));
    await ui.fill("#job-source-remote", "smoke-alias");
    await f_Sleep(200);
    const sourceAfterPick = await ui.value("input[name=source]");
    const badgeText = await a.evaluate(
        `document.querySelector("input[name=source]")?.closest(".zbcField")?.querySelector(".zbcBadge")?.textContent ?? ""`,
    );
    f_Check(
        "remote 선택 → 입력값·배지",
        sourceAfterPick === "smoke-alias:" && badgeText === "remote",
        `${sourceAfterPick} / ${badgeText}`,
    );
    await ui.click("저장");
    await f_Sleep(300);
    const smokeJob = (await a.evaluate("window.rclonegui.jobs.list()")).data.find(
        (j) => j.name === "스모크",
    );
    f_Check(
        "remote 루트 저장 차단",
        (await ui.text()).includes("루트 전체는 지정할 수 없습니다") && smokeJob?.rev === 0,
    );
    await ui.click("되돌리기");
    await f_Sleep(200);

    // 복제·삭제
    await ui.click("복제");
    f_Check(
        "복제 → 사본 선택",
        (await ui.until(`document.body.innerText.includes("저장된 작업 3개")`)) &&
            (await ui.until(
                `document.querySelector("input[name=name]")?.value === "스모크 (복사)"`,
            )),
    );
    await ui.click("삭제");
    await f_Sleep(200);
    const deleteDialog = await ui.dialogText();
    await ui.click("작업 삭제", { inDialog: true });
    f_Check(
        "삭제 확인 → 목록 감소·다음 작업 선택",
        deleteDialog.includes("파일은 건드리지 않습니다") &&
            (await ui.until(`document.body.innerText.includes("저장된 작업 2개")`)) &&
            (await ui.until(`document.querySelector("input[name=name]")?.value === "UI 작업"`)),
        deleteDialog,
    );
    const remotesApi = await a.evaluate(
        `window.rclonegui.rclone.listRemotes(${JSON.stringify(smokeConf)})`,
    );
    f_Check(
        "rclone:listRemotes(지정 설정 파일)",
        remotesApi.ok && remotesApi.data.includes("smoke-alias") && remotesApi.data.includes("x"),
        JSON.stringify(remotesApi),
    );

    // ===== Phase 4: 설정 화면 =====
    await ui.click("설정");
    await ui.until(`document.querySelector("select[name=theme]")`);
    const settingsText = await ui.text();
    f_Check(
        "설정 화면: rclone 설정 + 한 글자 remote 경고",
        settingsText.includes("rclone 설정") && settingsText.includes("드라이브 문자로 해석"),
    );
    await ui.fill("select[name=theme]", "light");
    await ui.fill("input[name=defaults-checkers]", "12");
    await ui.click("설정 저장");
    await ui.until(`document.documentElement.dataset.theme === "light"`);
    const savedSettings = await a.evaluate("window.rclonegui.settings.get()");
    f_Check(
        "설정 저장(테마 라이트·기본 checkers 12)",
        (await a.evaluate("document.documentElement.dataset.theme")) === "light" &&
            savedSettings.data.defaults.checkers === 12,
    );
    await ui.fill("input[name=settings-logs-historyLimit]", "50");
    await ui.click("설정 저장");
    await f_Sleep(300);
    f_Check(
        "설정 범위 밖 값은 저장 차단",
        (await ui.text()).includes("100~5000 사이의 정수를 입력하세요.") &&
            (await a.evaluate("window.rclonegui.settings.get()")).data.logs.historyLimit === 500,
    );
    await ui.click("작업");
    await f_Sleep(200);
    const leaveText = await ui.dialogText();
    await ui.click("계속 편집", { inDialog: true });
    await f_Sleep(200);
    f_Check(
        "설정 미저장 변경 → 화면 이동 전 확인, 계속 편집 시 유지",
        leaveText.includes("설정 화면에서 고친 내용") &&
            (await ui.value("input[name=settings-logs-historyLimit]")) === "50",
        leaveText,
    );
    await ui.click("되돌리기");
    await ui.click("작업");
    await ui.click("새 작업");
    f_Check(
        "새 작업 초안에 바뀐 기본값(checkers 12)",
        await ui.until(`document.querySelector("input[name=job-checkers]")?.value === "12"`),
    );
    await ui.click("작성 취소");
    await f_Sleep(200);

    // ===== Phase 5: 비교 화면 (임시 원본·대상, 읽기 전용) =====
    await ui.clickJob("UI 작업");
    await ui.until(`document.querySelector("input[name=name]")?.value === "UI 작업"`);
    await ui.click("비교");
    const compared = await ui.until(`document.querySelector("ul[aria-label='비교 요약']")`, 20000);
    const summaryText = await a.evaluate(
        `document.querySelector("ul[aria-label='비교 요약']")?.innerText ?? ""`,
    );
    f_Check(
        "비교 실행 → 요약(복사 1·덮어씀 1·대상만 1·동일 1)",
        compared &&
            summaryText.includes("대상에 1개 복사") &&
            summaryText.includes("1개 덮어씀") &&
            summaryText.includes("1개 대상에만 있음(유지)") &&
            summaryText.includes("동일 1개"),
        compared ? summaryText.replace(/\s+/g, " ") : (await ui.text()).slice(0, 300),
    );
    const f_Rows = () =>
        a.evaluate(
            `[...document.querySelectorAll("tr[data-status]")].map((r) => r.dataset.status).toSorted().join(",")`,
        );
    const f_Count = () =>
        a.evaluate(`document.querySelector("output[aria-live]")?.textContent ?? ""`);
    f_Check(
        "기본(동일 숨기기) → 동일 행 제외 3행",
        (await f_Rows()) === "modified,onlyDest,onlySource" &&
            (await a.evaluate(`document.querySelector("#compare-hide-equal")?.checked`)) === true,
        await f_Rows(),
    );
    await a.evaluate(`document.querySelector("#compare-hide-equal").click()`);
    await f_Sleep(200);
    f_Check(
        "동일 숨기기 해제 → 4행",
        (await f_Rows()) === "equal,modified,onlyDest,onlySource",
        `${await f_Rows()} / ${await f_Count()}`,
    );
    await ui.fill("#compare-status", "modified");
    await f_Sleep(200);
    f_Check("상태 필터(변경) → 1행", (await f_Rows()) === "modified", await f_Rows());
    await ui.fill("#compare-status", "all");
    await ui.fill("#compare-query", "EXTRA");
    f_Check(
        "경로 검색(대소문자 무시) → 대상만 1행",
        await ui.until(
            `[...document.querySelectorAll("tr[data-status]")].map((r) => r.dataset.status).join(",") === "onlyDest"`,
        ),
        await f_Rows(),
    );
    await ui.fill("#compare-query", "");
    await ui.click("작업 설정");
    f_Check(
        "작업 설정 탭으로 돌아가기",
        await ui.until(`document.querySelector("input[name=name]")?.value === "UI 작업"`),
    );
    const dstAfter = readdirSync(smokeDst).toSorted().join(",");
    f_Check(
        "비교는 대상 파일을 바꾸지 않음",
        dstAfter === "changed.txt,extra.txt,same.txt",
        dstAfter,
    );

    // ===== Phase 6: 실행 화면 (미리보기 → 복사 실행) =====
    await ui.click("미리보기");
    const dryShown = await ui.until(
        `document.querySelector("section[aria-label='미리보기 결과']")`,
        20000,
    );
    const dryText = await a.evaluate(
        `document.querySelector("section[aria-label='미리보기 결과']")?.innerText ?? ""`,
    );
    f_Check(
        "미리보기 → 요약(대상에 2개 복사)·비교 결과와 일치",
        dryShown &&
            dryText.includes("실행하면 대상에 2개 복사") &&
            dryText.includes("비교 결과와 같은 일을 합니다"),
        dryShown ? dryText.replace(/\s+/g, " ") : (await ui.text()).slice(0, 300),
    );
    f_Check(
        "미리보기는 대상 파일을 바꾸지 않음",
        readdirSync(smokeDst).toSorted().join(",") === "changed.txt,extra.txt,same.txt" &&
            readFileSync(join(smokeDst, "changed.txt"), "utf8") === "changed",
    );
    f_Check(
        "미리보기 뒤에도 복사 실행 활성(비교 결과 유지)",
        (await ui.disabled("복사 실행")).every((d) => !d),
    );
    await ui.click("복사 실행");
    await f_Sleep(200);
    const confirmText = await ui.dialogText();
    f_Check(
        "복사 실행 확인 창(일어날 일·부분 반영 안내)",
        confirmText.includes("대상에 1개 복사, 1개 덮어씀") &&
            confirmText.includes("이미 복사된 파일은 대상에 남습니다"),
        confirmText,
    );
    await ui.click("복사 실행", { inDialog: true });
    const copied = await ui.until(`document.body.innerText.includes("복사 완료")`, 20000);
    f_Check(
        "복사 실행 → 완료, 대상에 파일 반영(대상에만 있던 파일 유지)",
        copied &&
            readdirSync(smokeDst).toSorted().join(",") ===
                "changed.txt,extra.txt,new.txt,same.txt" &&
            readFileSync(join(smokeDst, "changed.txt"), "utf8") === "changed-longer",
        readdirSync(smokeDst).toSorted().join(","),
    );
    f_Check(
        "실행 후 복사 실행 다시 비활성(비교 결과 버림)",
        (await ui.until(
            `[...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "복사 실행").every((b) => b.disabled)`,
        )) && (await ui.text()).includes("먼저 비교하세요"),
    );
    const uiJob = (await a.evaluate("window.rclonegui.jobs.list()")).data.find(
        (j) => j.name === "UI 작업",
    );
    f_Check(
        "실제 실행은 lastRun 갱신(rev 그대로)",
        uiJob?.lastRun?.status === "success" && uiJob.rev === 0,
        JSON.stringify(uiJob?.lastRun),
    );
    f_Check(
        "실행 끝나면 run:getActive null·active-run.json 없음",
        (await a.evaluate("window.rclonegui.run.getActive()")).data === null &&
            !existsSync(join(userData, "active-run.json")),
    );
    // ===== Phase 8: 이력 탭(목록·상세·로그 끝부분) =====
    await a.evaluate(`document.querySelector("#job-tabs-tab-history")?.click()`);
    const histRows = `document.querySelectorAll("table[aria-label='실행 이력'] tbody tr").length`;
    const histShown = await ui.until(`${histRows} >= 2`, 5000);
    const histText = await a.evaluate(
        `document.querySelector("table[aria-label='실행 이력']")?.innerText ?? ""`,
    );
    f_Check(
        "이력 탭: 미리보기·수동 복사 2건(최신순, 결과·요약)",
        histShown &&
            histText.includes("미리보기 완료") &&
            histText.includes("복사 완료") &&
            histText.includes("수동") &&
            histText.indexOf("복사 완료") < histText.indexOf("미리보기 완료"),
        histText.replace(/\s+/g, " "),
    );
    await ui.fill("#history-kind", "dryRun");
    f_Check("이력 종류 필터(미리보기) → 1건", await ui.until(`${histRows} === 1`));
    await ui.fill("#history-kind", "all");
    await a.evaluate(
        `document.querySelector("table[aria-label='실행 이력'] tbody tr button")?.click()`,
    );
    const detailShown = await ui.until(
        `document.querySelector("dialog[open]")?.innerText.includes("rcloneGUI 실행 로그")`,
        5000,
    );
    const detailText = await ui.dialogText();
    f_Check(
        "이력 상세: 결과·통계·로그 끝부분(경로는 가림)",
        detailShown &&
            detailText.includes("복사 완료") &&
            detailText.includes("<원본>") &&
            !detailText.includes(smokeSrc),
        detailText.replace(/\s+/g, " ").slice(0, 300),
    );
    await ui.click("닫기", { inDialog: true });
    await ui.until(`!document.querySelector("dialog[open]")`);
    // ===== Phase 7: 동기화(삭제 포함) 실제 실행 =====
    const syncDst = join(smokeRoot, "sync-dst");
    mkdirSync(syncDst);
    writeFileSync(join(syncDst, "keep.txt"), "keep");
    const syncJob = await a.evaluate(
        `window.rclonegui.jobs.create({ ...${draft}, name: "sync 스모크", mode: "sync", source: ${js(smokeSrc)}, destination: ${js(syncDst)} })`,
    );
    await ui.clickJob("sync 스모크");
    await ui.until(`document.querySelector("input[name=name]")?.value === "sync 스모크"`);
    const syncReady = `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "동기화 실행" && !b.disabled)`;
    await ui.click("비교");
    f_Check("sync 비교 → 동기화 실행 활성", await ui.until(syncReady, 20000));
    await ui.click("동기화 실행");
    await ui.until(`document.querySelector("dialog[open] #delete-confirm-ack")`);
    const delText = await ui.dialogText();
    f_Check(
        "삭제 확인 모달(삭제 수·샘플·대량 경고·빈 폴더 안내)",
        delText.includes("대상 파일 1개 중 1개 삭제") &&
            delText.includes("keep.txt") &&
            delText.includes("대량 삭제") &&
            delText.includes("빈 폴더"),
        delText.replace(/\s+/g, " "),
    );
    f_Check(
        "체크 전 실행 버튼 비활성, 체크 1개만으로도 비활성(대량)",
        (await ui.disabled("1개 삭제 포함 실행")).every(Boolean) &&
            (await a.evaluate(`(document.querySelector("#delete-confirm-ack").click(), true)`)) &&
            (await ui.disabled("1개 삭제 포함 실행")).every(Boolean),
    );
    await a.evaluate(`document.querySelector("#delete-confirm-large").click()`);
    f_Check(
        "두 체크 후 실행 버튼 활성",
        await ui.until(
            `[...document.querySelectorAll("dialog[open] button")].some((b) => b.textContent.trim() === "1개 삭제 포함 실행" && !b.disabled)`,
        ),
    );
    // 비교 뒤 대상에 파일을 더한다 → 사전 확인이 계획과 달라 실행하지 않아야 한다
    writeFileSync(join(syncDst, "late.txt"), "late");
    await ui.click("1개 삭제 포함 실행", { inDialog: true });
    const drifted = await ui.until(
        `document.querySelector("dialog[open]")?.innerText.includes("비교 뒤 바뀐 파일이 있습니다")`,
        20000,
    );
    const driftText = await ui.dialogText();
    f_Check(
        "사전 확인 불일치 → PLAN_DRIFT 모달(차이 표시), 대상 불변",
        drifted &&
            driftText.includes("삭제: 계획 1개") &&
            readdirSync(syncDst).toSorted().join(",") === "keep.txt,late.txt",
        driftText.replace(/\s+/g, " "),
    );
    // 안내가 떠 있는 동안 다른 작업으로 옮겨 고친다 → 다시 비교는 변경 버리기 확인 뒤 막힌 작업의 비교 탭으로 옮겨 비교한다
    await ui.clickJob("UI 작업");
    await a.evaluate(`document.querySelector("#job-tabs-tab-edit")?.click()`);
    await ui.until(`document.querySelector("input[name=name]")?.value === "UI 작업"`);
    await ui.fill("input[name=name]", "UI 작업 수정");
    await ui.click("다시 비교", { inDialog: true });
    f_Check(
        "다른 작업을 고친 채 다시 비교 → 변경 버리기 확인",
        await ui.until(
            `document.querySelector("dialog[open]")?.innerText.includes("변경 버리고 이동")`,
        ),
        await ui.dialogText(),
    );
    await ui.click("변경 버리고 이동", { inDialog: true });
    f_Check(
        "다시 비교 → 막힌 작업(sync 스모크)·비교 탭으로 옮겨 비교, 동기화 실행 활성",
        (await ui.until(`!document.querySelector("dialog[open]")`)) &&
            (await ui.until(syncReady, 20000)) &&
            (await a.evaluate(`document.querySelector("#job-title")?.textContent`)) ===
                "sync 스모크" &&
            (await a.evaluate(
                `document.querySelector("#job-tabs-tab-compare")?.getAttribute("aria-selected")`,
            )) === "true",
        (await ui.text()).slice(0, 300),
    );
    await ui.click("동기화 실행");
    await ui.until(`document.querySelector("dialog[open] #delete-confirm-ack")`);
    await a.evaluate(`document.querySelector("#delete-confirm-ack").click()`);
    await a.evaluate(`document.querySelector("#delete-confirm-large")?.click()`);
    await f_Sleep(100);
    f_Check(
        "다시 연 모달은 새 삭제 수(2개)",
        await ui.click("2개 삭제 포함 실행", { inDialog: true }),
        await ui.dialogText(),
    );
    const synced = await ui.until(`document.body.innerText.includes("동기화 완료")`, 20000);
    f_Check(
        "동기화 실행 → 완료, 대상이 원본과 같음",
        synced &&
            readdirSync(syncDst).toSorted().join(",") ===
                readdirSync(smokeSrc).toSorted().join(",") &&
            readFileSync(join(syncDst, "changed.txt"), "utf8") === "changed-longer",
        readdirSync(syncDst).toSorted().join(","),
    );
    const syncHist = (await a.evaluate("window.rclonegui.jobs.list()")).data.find(
        (j) => j.name === "sync 스모크",
    );
    f_Check(
        "sync lastRun success·active-run 없음",
        syncHist?.lastRun?.status === "success" && !existsSync(join(userData, "active-run.json")),
        JSON.stringify(syncHist?.lastRun),
    );
    await a.evaluate(`window.rclonegui.jobs.remove(${js(syncJob.data?.id)})`);
    await f_Sleep(300);

    // ===== 취소로 남은 임시 파일(.partial) 표시: 비교 목록·삭제 확인 창 (가짜 .partial, 사용자 파일 report.partial은 아님) =====
    const partSrc = join(smokeRoot, "partial-src");
    const partDst = join(smokeRoot, "partial-dst");
    mkdirSync(partSrc);
    mkdirSync(partDst);
    writeFileSync(join(partSrc, "a.txt"), "a");
    writeFileSync(join(partDst, "x.bin.0123abcd.partial"), "partial");
    writeFileSync(join(partDst, "report.partial"), "user");
    const partJob = await a.evaluate(
        `window.rclonegui.jobs.create({ ...${draft}, name: "partial 스모크", mode: "sync", source: ${js(partSrc)}, destination: ${js(partDst)} })`,
    );
    await ui.clickJob("partial 스모크");
    await ui.until(`document.querySelector("input[name=name]")?.value === "partial 스모크"`);
    await ui.click("비교");
    await ui.until(syncReady, 20000);
    const partRows = await a.evaluate(
        `[...document.querySelectorAll("tr[data-status=onlyDest]")].map((r) => r.cells[1]?.innerText ?? "")`,
    );
    const BADGE = "취소로 남은 임시 파일";
    f_Check(
        ".partial 표시: 비교 목록에서 x.bin.0123abcd.partial만 ‘취소로 남은 임시 파일’",
        partRows.length === 2 &&
            partRows.some((t) => t.includes("x.bin.0123abcd.partial") && t.includes(BADGE)) &&
            partRows.some((t) => t.includes("report.partial") && !t.includes(BADGE)),
        JSON.stringify(partRows),
    );
    await ui.click("동기화 실행");
    await ui.until(`document.querySelector("dialog[open] #delete-confirm-ack")`);
    const partSamples = await a.evaluate(
        `[...document.querySelectorAll("dialog[open] details li")].map((li) => li.innerText)`,
    );
    f_Check(
        ".partial 표시: 삭제 확인 창 샘플에도 같은 표시(report.partial은 없음)",
        partSamples.length === 2 &&
            partSamples.some((t) => t.includes("x.bin.0123abcd.partial") && t.includes(BADGE)) &&
            partSamples.some((t) => t.includes("report.partial") && !t.includes(BADGE)),
        JSON.stringify(partSamples),
    );
    await ui.click("취소", { inDialog: true });
    await ui.until(`!document.querySelector("dialog[open]")`);
    f_Check(
        ".partial 표시만 하고 대상은 그대로",
        readdirSync(partDst).toSorted().join(",") === "report.partial,x.bin.0123abcd.partial",
        readdirSync(partDst).toSorted().join(","),
    );
    await a.evaluate(`window.rclonegui.jobs.remove(${js(partJob.data?.id)})`);
    await f_Sleep(300);

    // ===== Phase 8: 설정(트레이·로그인 시작·이력 비우기)·일시정지 =====
    const pausePatch = await a.evaluate(
        `window.rclonegui.settings.update({ scheduler: { paused: true } })`,
    );
    f_Check(
        "settings:update로 일시정지 변경 거부(VALIDATION)",
        !pausePatch.ok && pausePatch.error.code === "VALIDATION",
    );
    await ui.click("설정");
    await ui.until(`document.querySelector("#settings-launch-at-login")`);
    const appSettingsText = await ui.text();
    f_Check(
        "설정: 트레이 숨김(기본 켜짐)·로그인 시 시작(개발 실행은 비활성+이유)",
        (await a.evaluate(`document.querySelector("#settings-minimize-to-tray")?.checked`)) ===
            true &&
            (await a.evaluate(`document.querySelector("#settings-launch-at-login")?.disabled`)) ===
                true &&
            appSettingsText.includes("개발 실행에서는 바꿀 수 없습니다"),
    );
    const histBefore = (await a.evaluate("window.rclonegui.history.list()")).data?.length ?? 0;
    await ui.click("이력 비우기…");
    await ui.until(`document.querySelector("dialog[open] #clear-history-logs")`);
    f_Check(
        "이력 비우기 확인 창: 로그 파일 삭제는 기본 해제",
        (await a.evaluate(`document.querySelector("#clear-history-logs").checked`)) === false,
    );
    await ui.click("이력 모두 지우기", { inDialog: true });
    const cleared = await ui.untilAsync(
        `window.rclonegui.history.list().then((r) => r.ok && r.data.length === 0)`,
        5000,
    );
    f_Check(
        "이력 비우기 → 이력 0건, 로그 파일은 남김",
        histBefore >= 3 &&
            cleared &&
            readdirSync(join(userData, "logs")).some((n) => n.startsWith("run-")),
        `before=${histBefore}`,
    );
    await ui.click("작업");
    await ui.click("자동 실행 일시정지");
    f_Check(
        "상단 막대 일시정지 → scheduler 상태 paused·문구",
        (await ui.untilAsync(
            `window.rclonegui.scheduler.getState().then((r) => r.data?.paused === true)`,
        )) && (await ui.until(`document.body.innerText.includes("자동 실행 일시정지됨")`)),
    );
    const errors1 = [...a.consoleErrors];
    await f_Close(a);

    // 2회차는 개발 실행 전용 환경 변수로 tick을 1초로 줄이고 종료 확인 창에 "종료"로 답한다
    const b = await f_Launch(userData, {
        env: { RCLONEGUI_DEV_TICK_MS: "1000", RCLONEGUI_DEV_QUIT_CHOICE: "quit" },
    });
    const jobs = await b.evaluate("window.rclonegui.jobs.list()");
    const names = jobs.ok ? jobs.data.map((j) => j.name).toSorted() : [];
    f_Check(
        "재시작 후 작업 유지",
        names.length === 2 && names.includes("스모크") && names.includes("UI 작업"),
        names.join(","),
    );
    const uiJobAfter = jobs.ok ? jobs.data.find((j) => j.name === "UI 작업") : null;
    f_Check(
        "재시작 후 lastRun 유지·active-run 없음·실행 없음",
        uiJobAfter?.lastRun?.status === "success" &&
            !existsSync(join(userData, "active-run.json")) &&
            (await b.evaluate("window.rclonegui.run.getActive()")).data === null,
        JSON.stringify(uiJobAfter?.lastRun),
    );
    const settings = await b.evaluate("window.rclonegui.settings.get()");
    f_Check(
        "재시작 후 설정 유지",
        settings.ok && settings.data.ui.theme === "light" && settings.data.defaults.checkers === 12,
    );
    f_Check(
        "저장된 테마(라이트) 적용",
        (await b.evaluate("document.documentElement.dataset.theme")) === "light",
    );
    // 선택은 메모리만: 재시작하면 이름순(ko) 첫 작업
    f_Check(
        "재시작 후 이름순 첫 작업 자동 선택",
        await f_Ui(b).until(`document.querySelector("input[name=name]")?.value === "스모크"`),
    );

    // ===== Phase 8: 일시정지 유지 → 재개 → 1분 주기 자동 실행 =====
    const bUi = f_Ui(b);
    f_Check(
        "재시작 후 일시정지 유지(설정·상단 막대)",
        settings.data.scheduler.paused === true &&
            (await bUi.until(`document.body.innerText.includes("자동 실행 일시정지됨")`)),
    );
    await bUi.click("자동 실행 재개");
    await bUi.untilAsync(
        `window.rclonegui.scheduler.getState().then((r) => r.data?.paused === false)`,
    );
    const autoCopyDst = join(smokeRoot, "auto-copy-dst");
    const autoSyncDst = join(smokeRoot, "auto-sync-dst");
    mkdirSync(autoCopyDst);
    mkdirSync(autoSyncDst);
    writeFileSync(join(autoSyncDst, "extra.txt"), "extra");
    const autoOn = `autoSync: { enabled: true, intervalMinutes: 1, allowDeletes: false }`;
    const autoCopy = await b.evaluate(
        `window.rclonegui.jobs.create({ ...${draft}, name: "자동 copy", source: ${js(smokeSrc)}, destination: ${js(autoCopyDst)}, ${autoOn} })`,
    );
    const autoSync = await b.evaluate(
        `window.rclonegui.jobs.create({ ...${draft}, name: "자동 sync", mode: "sync", source: ${js(smokeSrc)}, destination: ${js(autoSyncDst)}, ${autoOn} })`,
    );
    const autoCreatedAt = Date.now();
    f_Check(
        "자동 실행 켠 작업: nextRunAt = 만든 시각 + 1분, 상단 막대에 다음 자동 실행",
        autoCopy.ok &&
            autoSync.ok &&
            Math.abs(Date.parse(autoCopy.data.autoSync.nextRunAt) - (autoCreatedAt + 60_000)) <
                5000 &&
            (await bUi.until(`document.body.innerText.includes("다음 자동 실행")`)),
        JSON.stringify(autoCopy.data?.autoSync),
    );
    const autoRecs = `window.rclonegui.history.list().then((r) => (r.data ?? []).filter((x) => x.trigger === "scheduler"))`;
    const autoDone = await bUi.untilAsync(`${autoRecs}.then((l) => l.length >= 2)`, 120_000, 1000);
    const autoList = await b.evaluate(autoRecs);
    const autoCopyRec = autoList.find((r) => r.jobId === autoCopy.data?.id);
    const autoSyncRec = autoList.find((r) => r.jobId === autoSync.data?.id);
    f_Check(
        "1분 주기 자동 실행: copy 반영(이력 자동·완료)",
        autoDone &&
            autoCopyRec?.status === "success" &&
            readdirSync(autoCopyDst).toSorted().join(",") ===
                readdirSync(smokeSrc).toSorted().join(","),
        JSON.stringify(autoCopyRec?.status) + readdirSync(autoCopyDst).join(","),
    );
    f_Check(
        "자동 sync + 삭제 허용 끔 → blocked 이력, 대상 불변",
        autoSyncRec?.status === "blocked" &&
            autoSyncRec.error?.message.includes("삭제를 허용하지 않아") &&
            readdirSync(autoSyncDst).join(",") === "extra.txt",
        JSON.stringify(autoSyncRec?.error),
    );
    await bUi.untilAsync(
        `window.rclonegui.jobs.list().then((r) => r.data.filter((j) => j.name.startsWith("자동 ")).every((j) => j.autoSync.lastAutoRunAt !== null))`,
        5000,
    );
    const autoJobs = (await b.evaluate("window.rclonegui.jobs.list()")).data.filter((j) =>
        j.name.startsWith("자동 "),
    );
    f_Check(
        "자동 실행 뒤 다음 예약 = 끝난 시각 + 1분, lastAutoRunAt 기록, lastRun 갱신",
        autoJobs.length === 2 &&
            autoJobs.every(
                (j) =>
                    j.autoSync.lastAutoRunAt !== null &&
                    Date.parse(j.autoSync.nextRunAt) - Date.parse(j.autoSync.lastAutoRunAt) ===
                        60_000 &&
                    j.lastRun !== null,
            ),
        JSON.stringify(autoJobs.map((j) => [j.autoSync, j.lastRun?.status])),
    );
    // 이후 시나리오를 방해하지 않도록 일시정지(재시작 후 유지·예약 유지 확인용)
    await bUi.click("자동 실행 일시정지");
    await bUi.untilAsync(
        `window.rclonegui.scheduler.getState().then((r) => r.data?.paused === true)`,
    );
    const autoNextBefore = Object.fromEntries(autoJobs.map((j) => [j.id, j.autoSync.nextRunAt]));
    const autoCountBefore = autoList.length;

    // ===== 실행 중 앱 종료: 창 X는 트레이로 숨김(실행 계속), 트레이를 끄면 종료 확인 → 취소 뒤 종료 =====
    // 작은 파일 3000개를 transfers 1로 복사해 실행 중에 창을 닫는다(앱에는 대역폭 제한 옵션이 없다)
    const quitSrc = join(smokeRoot, "quit-src");
    const quitDst = join(smokeRoot, "quit-dst");
    mkdirSync(quitSrc);
    mkdirSync(quitDst);
    for (let i = 0; i < QUIT_FILES; i += 1) {
        writeFileSync(join(quitSrc, `f${String(i).padStart(4, "0")}.bin`), Buffer.alloc(4096, i));
    }
    const quitJob = await b.evaluate(
        `window.rclonegui.jobs.create({ ...${draft}, name: "종료 스모크", source: ${js(quitSrc)}, destination: ${js(quitDst)}, options: { ...${draft}.options, checkers: 1, transfers: 1 } })`,
    );
    const quitJobId = quitJob.data?.id;
    const quitCmp = await b.evaluate(`window.rclonegui.compare.run(${js(quitJobId)})`);
    const quitStart = await b.evaluate(
        `window.rclonegui.run.start({ jobId: ${js(quitJobId)}, dryRun: false, planToken: ${js(quitCmp.data?.planToken ?? "")}, confirmedDeletes: 0 })`,
    );
    const activeRunFile = join(userData, "active-run.json");
    await bUi.until(
        `window.rclonegui.run.getActive().then((r) => r.data?.phase === "transferring")`,
        20000,
    );
    for (let t = 0; t < 50 && !existsSync(activeRunFile); t += 1) await f_Sleep(100);
    const activeRec = existsSync(activeRunFile)
        ? JSON.parse(readFileSync(activeRunFile, "utf8"))
        : null;
    const runningBeforeQuit =
        quitStart.ok && (await b.evaluate("window.rclonegui.run.getActive()")).data !== null;
    f_Check(
        "종료 전: 실제 copy 실행 중·active-run.json에 rclone pid",
        runningBeforeQuit && Number.isInteger(activeRec?.pid),
        JSON.stringify({ quitStart, activeRec }),
    );
    const exitedB = new Promise((r) => b.child.once("exit", () => r(true)));
    // 트레이 숨김(기본 켜짐): 창을 닫아도 앱·실행은 계속된다
    await f_SendClose(b.child.pid);
    await f_Sleep(1000);
    const aliveAfterHide = await Promise.race([
        exitedB.then(() => false),
        f_Sleep(200).then(() => true),
    ]);
    f_Check(
        "실행 중 창 X(트레이 켜짐) → 창 숨김, 앱·실행 계속",
        aliveAfterHide &&
            !(await f_WindowShown(b.child.pid)) &&
            (await b.evaluate("window.rclonegui.run.getActive()")).data !== null,
    );
    // 단일 인스턴스: 한 번 더 띄우면 새 프로세스는 끝나고 숨긴 창이 다시 보인다
    await f_SecondInstance(userData);
    let shownAgain = false;
    for (let i = 0; i < 20 && !shownAgain; i += 1) {
        await f_Sleep(200);
        shownAgain = await f_WindowShown(b.child.pid);
    }
    f_Check("두 번째 실행(second-instance) → 숨긴 창 다시 표시", shownAgain);
    // 트레이를 끄면 창 X가 종료 흐름(확인 창 → 취소 → 최대 10초 대기)을 탄다
    await b.evaluate(`window.rclonegui.settings.update({ ui: { minimizeToTray: false } })`);
    const errorsB = [...b.consoleErrors];
    await f_SendClose(b.child.pid);
    const quitStartedAt = Date.now();
    const quitOk = await Promise.race([exitedB, f_Sleep(QUIT_TIMEOUT_MS).then(() => false)]);
    const quitMs = Date.now() - quitStartedAt;
    b.ws.close();
    if (!quitOk) await f_Close(b);
    const rcloneLeft = activeRec ? await f_PidAlive(activeRec.pid) : true;
    const quitHist = existsSync(join(userData, "history.json"))
        ? JSON.parse(readFileSync(join(userData, "history.json"), "utf8")).records.find(
              (r) => r.id === activeRec?.runId,
          )
        : null;
    const copiedCount = readdirSync(quitDst).length;
    f_Check(
        "트레이 끈 채 실행 중 창 닫기 → 종료 확인(종료) → 실행 취소 후 앱 종료",
        quitOk && quitMs < QUIT_TIMEOUT_MS,
        `quitOk=${quitOk} ${quitMs}ms`,
    );
    f_Check(
        "종료 뒤 rclone 프로세스 없음·active-run.json 없음",
        !rcloneLeft && !existsSync(activeRunFile),
        `pid=${activeRec?.pid} alive=${rcloneLeft}`,
    );
    f_Check(
        "종료 뒤 이력은 canceled(중단됨 아님)·전송 시작 기록·대상은 일부만 복사",
        quitHist?.status === "canceled" &&
            quitHist?.transferStarted === true &&
            copiedCount < QUIT_FILES,
        `status=${quitHist?.status} transferStarted=${quitHist?.transferStarted} copied=${copiedCount}`,
    );

    const cLaunchedAt = Date.now();
    const c = await f_Launch(userData, { env: { RCLONEGUI_DEV_TICK_MS: "1000" } });
    const notices = await c.evaluate("window.rclonegui.app.getNotices()");
    const quitJobAfter = (await c.evaluate("window.rclonegui.jobs.list()")).data.find(
        (j) => j.id === quitJobId,
    );
    f_Check(
        "재시작: 중단됨 안내 없음·실행 없음·lastRun canceled",
        notices.ok &&
            !notices.data.some((n) => n.message.includes("중단됨")) &&
            (await c.evaluate("window.rclonegui.run.getActive()")).data === null &&
            quitJobAfter?.lastRun?.status === "canceled",
        JSON.stringify({ notices: notices.data, lastRun: quitJobAfter?.lastRun }),
    );
    // 재시작: 일시정지 유지, 미래 예약은 그대로·지난 예약은 시작 + 60초(몰아서 실행하지 않음), 중복 실행 없음
    await f_Sleep(3000);
    const cState = await c.evaluate("window.rclonegui.scheduler.getState()");
    const cJobs = (await c.evaluate("window.rclonegui.jobs.list()")).data.filter((j) =>
        j.name.startsWith("자동 "),
    );
    const cAuto = (await c.evaluate("window.rclonegui.history.list()")).data.filter(
        (r) => r.trigger === "scheduler",
    );
    f_Check(
        "재시작 후 일시정지·자동 실행 예약 유지, 중복 실행 없음",
        cState.data?.paused === true &&
            cJobs.length === 2 &&
            cJobs.every((j) => {
                const before = autoNextBefore[j.id];
                const now = Date.parse(j.autoSync.nextRunAt);
                return Date.parse(before) > cLaunchedAt
                    ? j.autoSync.nextRunAt === before
                    : now >= cLaunchedAt + 55_000;
            }) &&
            cAuto.length === autoCountBefore,
        JSON.stringify({
            paused: cState.data?.paused,
            autoNextBefore,
            cJobs: cJobs.map((j) => j.autoSync.nextRunAt),
            cAuto: cAuto.length,
        }),
    );
    // 전송 중 취소한 기록의 이력 상세에는 .partial 안내가 보인다
    const cUi = f_Ui(c);
    await cUi.clickJob("종료 스모크");
    await cUi.until(`document.querySelector("#job-title")?.textContent === "종료 스모크"`);
    await c.evaluate(`document.querySelector("#job-tabs-tab-history")?.click()`);
    await cUi.until(
        `document.querySelectorAll("table[aria-label='실행 이력'] tbody tr button").length === 1`,
    );
    await c.evaluate(
        `document.querySelector("table[aria-label='실행 이력'] tbody tr button")?.click()`,
    );
    const quitDetail = await cUi.until(
        `document.querySelector("dialog[open]")?.innerText.includes("임시 파일(.partial)이 남을 수 있습니다")`,
        5000,
    );
    f_Check(
        "전송 중 취소한 기록의 이력 상세 → .partial 안내",
        quitDetail,
        (await cUi.dialogText()).replace(/\s+/g, " ").slice(0, 300),
    );
    await cUi.click("닫기", { inDialog: true });
    await f_Sleep(300);
    const errorsC = [...c.consoleErrors];
    await f_Close(c);

    // ===== 4회차: --hidden(로그인 시 시작)이면 창을 보이지 않는다 =====
    const d = await f_Launch(userData, { args: ["--hidden"] });
    await f_Sleep(1000);
    f_Check(
        "--hidden 시작 → 창 미표시(화면은 로드됨)",
        !(await f_WindowShown(d.child.pid)) &&
            (await d.evaluate("document.querySelector('h1')?.textContent")) === "rcloneGUI",
    );
    await f_Sleep(300);
    const errors = [...errors1, ...errorsB, ...errorsC, ...d.consoleErrors];
    f_Check("콘솔 오류 0건", errors.length === 0, errors.join(" | "));
    await f_Close(d);
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
