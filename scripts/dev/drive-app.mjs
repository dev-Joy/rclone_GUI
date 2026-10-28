/**
 * 빌드본(out/) 스모크 확인. 임시 userData로 앱을 두 번 띄워 원격 디버깅(CDP)으로 화면을 조작한다.
 * 1회차: 창 표시, window.rclonegui 확인, 작업 저장, 차단 경로 거부, 설정 변경,
 *        rclone 감지·경로 확인·WSL 목록·외부 링크 거부(설정 파일은 임시 rclone.conf),
 *        작업 화면(새 작업·저장 차단·저장·변경 확인·복제·삭제·remote 선택·접근 확인)과 설정 화면
 * 2회차: 재시작 후 작업·설정 유지, 이름순 첫 작업 자동 선택, 콘솔 오류 0건 확인
 * 실제 사용자 데이터는 건드리지 않는다(임시 폴더만 사용, 끝나면 삭제).
 *
 * 실행: pnpm run build 후 node scripts/dev/drive-app.mjs   (Windows node)
 *       개발 서버(HMR·개발 CSP)로 확인: node scripts/dev/drive-app.mjs --dev
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const js = (v) => JSON.stringify(v);

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
    f_Check(
        "저장 후에도 비교·실행 비활성(Phase 4)",
        (await ui.disabled("비교")).every(Boolean) &&
            (await ui.disabled("복사 실행")).every(Boolean) &&
            (await ui.text()).includes("비교·실행은 다음 단계에서 제공합니다"),
    );
    await ui.click("접근 확인");
    f_Check(
        "접근 확인(임시 원본 폴더) 성공",
        await ui.until(`document.querySelector("[data-state=ok]")`, 15000),
    );

    // 저장하지 않은 변경
    await ui.fill("input[name=name]", "UI 작업 수정");
    f_Check(
        "변경 중: 비교·실행·복제 비활성 + 안내",
        (await ui.disabled("비교")).every(Boolean) &&
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
    const errors1 = [...a.consoleErrors];
    await f_Close(a);

    const b = await f_Launch(userData);
    const jobs = await b.evaluate("window.rclonegui.jobs.list()");
    const names = jobs.ok ? jobs.data.map((j) => j.name).toSorted() : [];
    f_Check(
        "재시작 후 작업 유지",
        names.length === 2 && names.includes("스모크") && names.includes("UI 작업"),
        names.join(","),
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
