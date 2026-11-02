/**
 * Windows 작업 스케줄러(schtasks) 동작 확인 실험 (INT-003 Phase 2 S2-1).
 *
 * - 작업은 `\rcloneGUI-probe\<랜덤 8hex>` 폴더에만 만들고, 끝나면(실패해도) 모두 지운다.
 *   실제 앱이 쓰는 `\rcloneGUI\` 폴더는 읽지도 지우지도 않는다.
 * - 임시 폴더의 더미 node 스크립트만 실행한다. schtasks는 절대 경로 + execFile(shell: false)로만 부른다.
 * - fixture(tests/fixtures/schtasks/)에는 임시 폴더 경로를 `C:\probe`로 바꾼 사본만 저장한다.
 *   사용자 이름이 남아 있으면 저장하지 않고 실패한다.
 * - 결과는 docs/knowhow/windows-task-scheduler-notes.md에 기록한다. Windows를 올리면 다시 실행한다.
 *
 * 실행: node scripts/probes/schtasks-probes.mjs [--quick]   (Windows node, 약 4분)
 *       --quick이면 시간이 걸리는 실험(재시도·시간 제한·지난 시작 시각)을 건너뛴다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, release, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const QUICK = process.argv.includes("--quick");
const SYSROOT = process.env.SystemRoot ?? "C:\\Windows";
const SCHTASKS = `${SYSROOT}\\System32\\schtasks.exe`;
const TASKLIST = `${SYSROOT}\\System32\\tasklist.exe`;
const TASKKILL = `${SYSROOT}\\System32\\taskkill.exe`;
const POWERSHELL = `${SYSROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const FOLDER = "\\rcloneGUI-probe\\";
const PROBE_PREFIX = '"\\rcloneGUI-probe\\';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(repoRoot, "tests", "fixtures", "schtasks");
mkdirSync(outDir, { recursive: true });

const work = mkdtempSync(join(tmpdir(), "rclonegui-schtasks-"));
const userName = userInfo().username;
/** 만든 작업 이름(끝에서 모두 지운다) */
const created = new Set();
/** 더미가 남긴 pid(끝에서 남아 있으면 끝낸다) */
const pids = new Set();
const results = { windows: release(), node: process.version };

// ========== 도우미 ==========

function f_Delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function f_Hex8() {
    return randomBytes(4).toString("hex");
}

/** execFile(buffer). 종료 코드와 원본 바이트를 돌려준다 */
function f_Exec(file, args, timeoutMs = 30_000) {
    return new Promise((res) => {
        execFile(
            file,
            args,
            { shell: false, windowsHide: true, encoding: "buffer", timeout: timeoutMs },
            (err, stdout, stderr) => {
                const code = err ? (typeof err.code === "number" ? err.code : null) : 0;
                res({ code, stdout: Buffer.from(stdout ?? []), stderr: Buffer.from(stderr ?? []) });
            },
        );
    });
}

/** 출력 바이트의 인코딩 추정: utf16le(BOM 유무), utf8, 그 밖(코드페이지 → latin1로 바이트 보존) */
function f_Detect(buf) {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { enc: "utf16le", bom: 2 };
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        return { enc: "utf8", bom: 3 };
    }
    let oddZeros = 0;
    for (let i = 1; i < buf.length; i += 2) if (buf[i] === 0) oddZeros++;
    if (buf.length >= 4 && oddZeros >= buf.length / 4) return { enc: "utf16le", bom: 0 };
    try {
        new TextDecoder("utf-8", { fatal: true }).decode(buf);
        return { enc: "utf8", bom: 0 };
    } catch {
        return { enc: "latin1", bom: 0 };
    }
}

function f_Decode(buf) {
    const d = f_Detect(buf);
    return { ...d, text: buf.subarray(d.bom).toString(d.enc) };
}

function f_Encode(text, d) {
    const head =
        d.bom === 2
            ? Buffer.from([0xff, 0xfe])
            : d.bom === 3
              ? Buffer.from([0xef, 0xbb, 0xbf])
              : Buffer.alloc(0);
    return Buffer.concat([head, Buffer.from(text, d.enc)]);
}

/** 임시 폴더 경로를 C:\probe로 바꾼다. latin1(코드페이지)은 UTF-8 바이트를 latin1로 본 형태도 바꾼다 */
function f_Sanitize(text) {
    const variants = [
        work,
        Buffer.from(work, "utf8").toString("latin1"),
        work.replaceAll("\\", "/"),
    ];
    let out = text;
    for (const v of variants.toSorted((a, b) => b.length - a.length)) {
        out = out.replaceAll(v, "C:\\probe");
    }
    // 내보낸 XML의 작성자·계정(SID 또는 도메인\\사용자)과 컴퓨터 이름도 가린다
    return out
        .replace(/<Author>[^<]*<\/Author>/g, "<Author>PC\\user</Author>")
        .replace(/<UserId>[^<]*<\/UserId>/g, "<UserId>S-1-5-21-0</UserId>")
        .replaceAll(hostname(), "PC");
}

/** 사용자 이름이 어떤 형태로도 남아 있지 않은지 */
function f_AssertClean(name, buf) {
    const forms = [
        Buffer.from(userName, "utf16le"),
        Buffer.from(userName, "utf8"),
        Buffer.from(userName.toLowerCase(), "utf8"),
        Buffer.from(userName.toLowerCase(), "utf16le"),
    ];
    if (forms.some((f) => f.length > 0 && buf.includes(f))) {
        throw new Error(`${name}: 사용자 이름이 남아 저장하지 않았습니다.`);
    }
}

function f_SaveBin(name, buf) {
    f_AssertClean(name, buf);
    writeFileSync(join(outDir, name), buf);
}

/** 바이트 앞부분 16진수(기록용) */
function f_HeadHex(buf, n = 8) {
    return [...buf.subarray(0, n)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

function f_Pad(n) {
    return String(n).padStart(2, "0");
}

/** 로컬 "YYYY-MM-DDTHH:mm:ss" */
function f_LocalDt(d) {
    return (
        `${d.getFullYear()}-${f_Pad(d.getMonth() + 1)}-${f_Pad(d.getDate())}` +
        `T${f_Pad(d.getHours())}:${f_Pad(d.getMinutes())}:${f_Pad(d.getSeconds())}`
    );
}

function f_XmlEscape(t) {
    return t
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

/**
 * 앱 설계(S2-3)와 같은 틀의 작업 XML. extra로 시간 제한·재시도·트리거를 바꾼다.
 */
function f_TaskXml({ command, args, trigger, limit = "PT13H", restart = "" }) {
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>rcloneGUI-probe</Description></RegistrationInfo>
  <Triggers>${trigger}</Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden>
    <WakeToRun>false</WakeToRun><ExecutionTimeLimit>${limit}</ExecutionTimeLimit><Priority>7</Priority>${restart}
  </Settings>
  <Actions Context="Author"><Exec><Command>${f_XmlEscape(command)}</Command><Arguments>${f_XmlEscape(args)}</Arguments></Exec></Actions>
</Task>
`;
}

/** 먼 미래(1년 뒤) 시작 — 등록만 하고 스스로 발화하지 않는다 */
function f_FarTrigger() {
    const at = new Date(Date.now() + 365 * 86_400_000);
    return `<TimeTrigger><StartBoundary>${f_LocalDt(at)}</StartBoundary><Enabled>true</Enabled></TimeTrigger>`;
}

async function f_Create(name, xml) {
    const file = join(work, `task-${f_Hex8()}.xml`);
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]), {
        flag: "wx",
    });
    created.add(name);
    try {
        return await f_Exec(SCHTASKS, ["/Create", "/XML", file, "/TN", name, "/F"]);
    } finally {
        rmSync(file, { force: true });
    }
}

function f_Delete(name) {
    return f_Exec(SCHTASKS, ["/Delete", "/TN", name, "/F"]);
}

function f_Run(name) {
    return f_Exec(SCHTASKS, ["/Run", "/TN", name]);
}

/** /Query /FO CSV /NH 전체에서 probe 폴더 작업 이름만 */
async function f_ProbeTaskNames() {
    const r = await f_Exec(SCHTASKS, ["/Query", "/FO", "CSV", "/NH"]);
    const { text } = f_Decode(r.stdout);
    return text
        .split(/\r?\n/)
        .filter((l) => l.startsWith(PROBE_PREFIX))
        .map((l) => l.slice(1, l.indexOf('"', 1)));
}

async function f_PidAlive(pid) {
    const r = await f_Exec(TASKLIST, ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    return f_Decode(r.stdout).text.includes(`"${pid}"`);
}

function f_ReadLines(file) {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

/** 더미 node 스크립트 */
function f_WriteDummies() {
    // 실행할 때마다 로그 파일에 한 줄 쓰고 exit 1
    writeFileSync(
        join(work, "fail.mjs"),
        'import { appendFileSync } from "node:fs";\n' +
            "appendFileSync(process.argv[2], `${new Date().toISOString()} ${process.pid}\\n`);\n" +
            "process.exit(1);\n",
    );
    // 자식 프로세스 하나를 띄우고(둘 다 pid 기록) 끝없이 기다린다
    writeFileSync(
        join(work, "child.mjs"),
        'import { appendFileSync } from "node:fs";\n' +
            'import { spawn } from "node:child_process";\n' +
            "const log = process.argv[2];\n" +
            "if (process.argv[3] === 'child') {\n" +
            "    appendFileSync(log, `child ${process.pid}\\n`);\n" +
            "    setInterval(() => undefined, 60_000);\n" +
            "} else {\n" +
            "    appendFileSync(log, `parent ${process.pid}\\n`);\n" +
            "    spawn(process.execPath, [process.argv[1], log, 'child'], { stdio: 'ignore', windowsHide: true });\n" +
            "    setInterval(() => undefined, 60_000);\n" +
            "}\n",
    );
    // 실행할 때마다 한 줄 쓰고 exit 0
    writeFileSync(
        join(work, "ok.mjs"),
        'import { appendFileSync } from "node:fs";\n' +
            "appendFileSync(process.argv[2], `${new Date().toISOString()} ${process.pid}\\n`);\n",
    );
    mkdirSync(join(work, "한글"), { recursive: true });
    writeFileSync(join(work, "한글", "dummy.cmd"), "@exit /b 0\r\n");
}

function f_Args(script, log, extra = "") {
    return `"${join(work, script)}" "${log}"${extra}`;
}

// ========== 실험 ==========

/** Q-1·2·3·7: 등록·XML·CSV·폴더 Query */
async function f_ProbeQuery() {
    const hex = f_Hex8();
    const name = `${FOLDER}${hex}`;
    const exe = join(work, "한글", "dummy.cmd");
    const c = await f_Create(
        name,
        f_TaskXml({ command: exe, args: "--run-job x", trigger: f_FarTrigger() }),
    );
    results.createNoUserId = { exit: c.code, stderr: f_Sanitize(f_Decode(c.stderr).text.trim()) };

    // 1. /Query /TN /XML
    const x = await f_Exec(SCHTASKS, ["/Query", "/TN", name, "/XML"]);
    const dx = f_Decode(x.stdout);
    const xmlText = f_Sanitize(dx.text).replaceAll(hex, "00000000");
    results.queryXml = {
        exit: x.code,
        bytes: x.stdout.length,
        headHex: f_HeadHex(x.stdout),
        encoding: dx.enc,
        bom: dx.bom > 0,
        koreanPathIntact: dx.text.includes("한글"),
        commandLine: (xmlText.match(/<Command>[^<]*<\/Command>/) ?? [null])[0],
    };
    f_SaveBin("query-xml-nonascii.bin", f_Encode(xmlText, dx));

    // 2. /Query /FO CSV /NH — 한글 이름 작업도 하나 더 만들어 둘을 함께 본다
    const krName = `${FOLDER}한글-${hex}`;
    await f_Create(krName, f_TaskXml({ command: exe, args: "x", trigger: f_FarTrigger() }));
    const q = await f_Exec(SCHTASKS, ["/Query", "/FO", "CSV", "/NH"]);
    const dq = f_Decode(q.stdout);
    const lines = dq.text.split(/\r?\n/).filter((l) => l.startsWith(PROBE_PREFIX));
    // 전체 출력의 앞부분은 다른 프로그램의 작업 이름이므로 남기지 않는다
    results.queryCsv = {
        exit: q.code,
        encoding: dq.enc,
        bom: dq.bom > 0,
        crlf: dq.text.includes("\r\n"),
        probeLines: lines.length,
        koreanNameIntact: lines.some((l) => l.includes("한글-")),
        sample: lines.map((l) => l.replaceAll(hex, "00000000")),
    };
    f_SaveBin(
        "query-csv-probe.bin",
        f_Encode(lines.map((l) => l.replaceAll(hex, "00000000")).join("\r\n") + "\r\n", dq),
    );

    // 3. 폴더 이름 Query
    const f = await f_Exec(SCHTASKS, ["/Query", "/TN", FOLDER, "/FO", "CSV", "/NH"]);
    const missing = await f_Exec(SCHTASKS, [
        "/Query",
        "/TN",
        `\\rcloneGUI-probe-none-${f_Hex8()}\\`,
    ]);
    const one = await f_Exec(SCHTASKS, ["/Query", "/TN", `${FOLDER}none-${f_Hex8()}`]);
    results.queryFolder = {
        exit: f.code,
        lines: f_Decode(f.stdout)
            .text.split(/\r?\n/)
            .filter(Boolean)
            .map((l) => f_Sanitize(l).replaceAll(hex, "00000000")),
        missingFolderExit: missing.code,
        missingFolderStderr: f_Decode(missing.stderr).text.trim(),
        missingTaskExit: one.code,
    };

    // 삭제 후 존재 확인
    const d = await f_Delete(krName);
    const after = await f_Exec(SCHTASKS, ["/Query", "/TN", krName]);
    const again = await f_Delete(krName);
    results.delete = { exit: d.code, queryAfterExit: after.code, deleteAgainExit: again.code };
    if (d.code === 0) created.delete(krName);
}

/** Q-2: RestartOnFailure + exit 1 */
async function f_ProbeRestart() {
    const name = `${FOLDER}${f_Hex8()}`;
    const log = join(work, "restart.log");
    const c = await f_Create(
        name,
        f_TaskXml({
            command: process.execPath,
            args: f_Args("fail.mjs", log),
            trigger: f_FarTrigger(),
            restart:
                "<RestartOnFailure><Interval>PT1M</Interval><Count>2</Count></RestartOnFailure>",
        }),
    );
    const r = await f_Run(name);
    await f_Delay(200_000);
    results.restartOnFailure = {
        createExit: c.code,
        runExit: r.code,
        runsIn200s: f_ReadLines(log).length,
    };
}

/** Q-8: ExecutionTimeLimit + 자식 프로세스 */
async function f_ProbeTimeLimit() {
    const name = `${FOLDER}${f_Hex8()}`;
    const log = join(work, "limit.log");
    const c = await f_Create(
        name,
        f_TaskXml({
            command: process.execPath,
            args: f_Args("child.mjs", log),
            trigger: f_FarTrigger(),
            limit: "PT1M",
        }),
    );
    const r = await f_Run(name);
    const started = Date.now();
    let parent = null;
    let child = null;
    while (Date.now() - started < 20_000 && (parent === null || child === null)) {
        await f_Delay(1000);
        for (const l of f_ReadLines(log)) {
            const [who, pid] = l.split(" ");
            if (who === "parent") parent = Number(pid);
            if (who === "child") child = Number(pid);
        }
    }
    if (parent !== null) pids.add(parent);
    if (child !== null) pids.add(child);
    let parentEndMs = null;
    if (parent !== null) {
        while (Date.now() - started < 190_000) {
            if (!(await f_PidAlive(parent))) {
                parentEndMs = Date.now() - started;
                break;
            }
            await f_Delay(5000);
        }
    }
    results.timeLimit = {
        createExit: c.code,
        runExit: r.code,
        parentStarted: parent !== null,
        childStarted: child !== null,
        parentEndedAfterMs: parentEndMs,
        childAliveAfterParentEnd: child !== null ? await f_PidAlive(child) : null,
    };
}

/** 지난 StartBoundary + StartWhenAvailable */
async function f_ProbePastBoundary() {
    const name = `${FOLDER}${f_Hex8()}`;
    const log = join(work, "past.log");
    const at = new Date(Date.now() - 10 * 60_000);
    const trigger =
        `<CalendarTrigger><StartBoundary>${f_LocalDt(at)}</StartBoundary>` +
        "<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>";
    const c = await f_Create(
        name,
        f_TaskXml({ command: process.execPath, args: f_Args("ok.mjs", log), trigger }),
    );
    await f_Delay(150_000);
    results.pastStartBoundary = { createExit: c.code, runsIn150s: f_ReadLines(log).length };
}

/**
 * 앱 XML 틀의 트리거 3종(os-scheduler.ts buildTaskXml과 같은 요소 순서)이 등록되고,
 * 다시 내보낸 XML에 반복 간격·요일·시간 제한이 남는지. 시작 시각은 1년 뒤라 발화하지 않는다.
 */
async function f_ProbeAppTriggers() {
    const at = f_LocalDt(new Date(Date.now() + 365 * 86_400_000));
    const triggers = {
        interval:
            "<TimeTrigger><Repetition><Interval>PT5M</Interval></Repetition>" +
            `<StartBoundary>${at}</StartBoundary><Enabled>true</Enabled></TimeTrigger>`,
        daily:
            `<CalendarTrigger><StartBoundary>${at}</StartBoundary><Enabled>true</Enabled>` +
            "<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>",
        weekly:
            `<CalendarTrigger><StartBoundary>${at}</StartBoundary><Enabled>true</Enabled>` +
            "<ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><Sunday /><Monday /><Saturday /></DaysOfWeek>" +
            "</ScheduleByWeek></CalendarTrigger>",
    };
    results.appTriggers = {};
    for (const [kind, trigger] of Object.entries(triggers)) {
        const name = `${FOLDER}${f_Hex8()}`;
        const c = await f_Create(
            name,
            f_TaskXml({ command: join(work, "ok.cmd"), args: "--run-job x", trigger }),
        );
        const x = f_Decode((await f_Exec(SCHTASKS, ["/Query", "/TN", name, "/XML"])).stdout).text;
        results.appTriggers[kind] = {
            createExit: c.code,
            interval: (x.match(/<Interval>([^<]*)<\/Interval>/) ?? [null, null])[1],
            days: [
                ...x.matchAll(/<(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) ?\/>/g),
            ].map((m) => m[1]),
            limit: (x.match(/<ExecutionTimeLimit>([^<]*)<\/ExecutionTimeLimit>/) ?? [
                null,
                null,
            ])[1],
            startWhenAvailable: x.includes("<StartWhenAvailable>true</StartWhenAvailable>"),
        };
        const d = await f_Delete(name);
        if (d.code === 0) created.delete(name);
    }
}

/** 실행 중 인스턴스가 있을 때 /Create /F 덮어쓰기와 /Delete */
async function f_ProbeOverwrite() {
    const name = `${FOLDER}${f_Hex8()}`;
    const log = join(work, "overwrite.log");
    const xml = f_TaskXml({
        command: process.execPath,
        args: f_Args("child.mjs", log),
        trigger: f_FarTrigger(),
    });
    await f_Create(name, xml);
    await f_Run(name);
    let parent = null;
    for (let i = 0; i < 20 && parent === null; i++) {
        await f_Delay(1000);
        const l = f_ReadLines(log).find((x) => x.startsWith("parent "));
        if (l) parent = Number(l.split(" ")[1]);
    }
    if (parent !== null) pids.add(parent);
    for (const l of f_ReadLines(log)) if (l.startsWith("child ")) pids.add(Number(l.split(" ")[1]));
    const re = await f_Create(name, xml);
    await f_Delay(5000);
    const aliveAfterCreate = parent !== null ? await f_PidAlive(parent) : null;
    const d = await f_Delete(name);
    if (d.code === 0) created.delete(name);
    await f_Delay(5000);
    results.overwriteRunning = {
        parentStarted: parent !== null,
        recreateExit: re.code,
        aliveAfterCreateF: aliveAfterCreate,
        deleteExit: d.code,
        aliveAfterDelete: parent !== null ? await f_PidAlive(parent) : null,
    };
}

// ========== 정리 ==========

async function f_Cleanup() {
    for (const name of new Set([...created, ...(await f_ProbeTaskNames())])) {
        await f_Delete(name);
    }
    for (const pid of pids) {
        if (await f_PidAlive(pid)) await f_Exec(TASKKILL, ["/PID", String(pid), "/T", "/F"]);
    }
    // 빈 probe 폴더도 지운다(상수 문자열만, 사용자 입력 없음)
    await f_Exec(POWERSHELL, [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$s=New-Object -ComObject Schedule.Service;$s.Connect();try{$s.GetFolder('\\').DeleteFolder('rcloneGUI-probe',0)}catch{}",
    ]);
    const left = await f_ProbeTaskNames();
    results.leftProbeTasks = left.length;
    rmSync(work, { recursive: true, force: true });
    return left.length;
}

async function f_Main() {
    for (const name of await f_ProbeTaskNames()) await f_Delete(name);
    f_WriteDummies();
    try {
        await f_ProbeQuery();
        await f_ProbeAppTriggers();
        await f_ProbeOverwrite();
        if (!QUICK)
            await Promise.all([f_ProbeRestart(), f_ProbeTimeLimit(), f_ProbePastBoundary()]);
    } finally {
        const left = await f_Cleanup();
        f_SaveBin(
            "probe-results.json",
            Buffer.from(`${JSON.stringify(results, null, 4)}\n`, "utf8"),
        );
        console.log(JSON.stringify(results, null, 2));
        if (left > 0) {
            console.error(
                `probe 작업 ${left}개가 남았습니다. 작업 스케줄러에서 ${FOLDER}를 확인하세요.`,
            );
            process.exitCode = 1;
        }
    }
}

await f_Main();
