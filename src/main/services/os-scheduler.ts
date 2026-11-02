/**
 * Windows 작업 스케줄러 OS 예약 (INT-003 T-01, spec FR-6~FR-11).
 *
 * - 작업 이름은 `\rcloneGUI\<jobId>`, 동작은 `<exe> --run-job <jobId>`뿐이다. 사용자 문자열(작업 이름·경로)은
 *   schtasks 인자에 넣지 않고, exe 경로는 XML 본문에만 넣는다.
 * - schtasks는 `%SystemRoot%\System32\schtasks.exe` 절대 경로 + execFile(shell: false)로만 부른다.
 * - schtasks 출력은 파이프에서 콘솔 코드페이지로 나온다(windows-task-scheduler-notes #1).
 *   목록은 우리 ASCII 이름만 정규식으로 뽑고(언어 독립), 해독이 불확실하면 exe 경로를 비교하지 않는다.
 * - `<Description>`의 `spec=<hash>`(XML 틀 버전·exe·jobId·예약 값)로 우리 쪽 변경만 감지한다.
 *   사용자가 작업 스케줄러 화면에서 트리거만 바꾼 것은 감지하지 않는다.
 * - StartBoundary는 항상 다음 미래 시각이다(지난 시각 + StartWhenAvailable의 즉시 실행 위험 차단).
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { z } from "zod";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsLogger } from "@/main/lib/logger";
import { clsMutex } from "@/main/lib/mutex";
import { decodeConsoleOutput } from "@/main/parsers/console-output";
import { nextLocalTimeOfDay, nextOccurrence, type typScheduleSpec } from "@/shared/schedule";
import { WEEKDAYS_ALL, type typJob } from "@/shared/schemas/job";
import type { itfOsScheduleStatus, itfOsTaskStatus } from "@/shared/types/scheduler";

/**
 *  Types · 상수
 */
export const OS_TASK_FOLDER = "\\rcloneGUI\\";
/** OS 쪽 실행 시간 제한(앱 자체 제한 12시간보다 1시간 길게, 마지막 방어선) */
export const OS_TASK_EXEC_LIMIT = "PT13H";
/** XML 틀을 바꾸면 올린다(spec 해시에 들어가 다음 시작 때 다시 등록된다) */
export const OS_TASK_XML_VERSION = 1;
/** userData 아래 등록용 임시 XML 폴더 */
export const OS_TASK_TMP_DIR = "os-tasks";
/** 실행 인자 */
export const OS_RUN_JOB_ARG = "--run-job";

export type typTaskSpec = typScheduleSpec;

export interface itfTaskXmlInput {
    exePath: string;
    jobId: string;
    spec: typTaskSpec;
    now: Date;
    specHash: string;
}

export interface itfParsedTaskXml {
    command: string | null;
    args: string | null;
    specHash: string | null;
}

export interface itfExistingTask {
    command: string | null;
    specHash: string | null;
    /** 출력 해독을 믿을 수 있는지(아니면 비ASCII exe 경로를 비교하지 않는다) */
    reliable: boolean;
}

export interface itfReconcilePlan {
    unregister: string[];
    register: string[];
    /** 등록되어 있는 원하는 작업의 exe 일치 여부. 판단할 수 없으면 null */
    exeMatches: Map<string, boolean | null>;
}

export interface itfOsAvailability {
    available: boolean;
    reason: string | null;
}

export type typExecBuffer = (
    file: string,
    args: readonly string[],
    opts: { timeoutMs: number },
) => Promise<{ code: number | null; stdout: Buffer; stderr: Buffer }>;

export interface itfOsSchedulerDeps {
    /** 기본: execFile(encoding buffer, shell false, windowsHide) */
    exec?: typExecBuffer;
    userDataDir: string;
    execPath: string;
    availability: itfOsAvailability;
    logger: Pick<clsLogger, "info" | "warn">;
    now?: () => Date;
    onStatus?: (s: itfOsScheduleStatus) => void;
}

/** schtasks 한 번의 시간 제한 */
export const SCHTASKS_TIMEOUT_MS = 30_000;
/** 없는 작업을 /Query했을 때의 종료 코드(windows-task-scheduler-notes #2) */
export const SCHTASKS_NOT_FOUND_CODE = 1;

const zTaskJobId = z.uuid();
const TMP_XML_RE = /^task-.*\.xml$/;
const TASK_NAME_RE = /^"\\rcloneGUI\\([0-9a-fA-F-]{36})"/;
const SPEC_RE = /rcloneGUI;spec=([0-9a-f]{16})/;
const DAY_ELEMENTS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
] as const;
// oxlint-disable-next-line no-control-regex -- ASCII 밖의 글자를 찾기 위한 정규식
const NON_ASCII_RE = /[^\u0000-\u007f]/;

export const OS_UNAVAILABLE = {
    platform: "Windows에서만 쓸 수 있습니다.",
    notPackaged: "설치한 앱에서만 쓸 수 있습니다(개발 실행에서는 쓸 수 없음).",
    e2e: "테스트 실행에서는 쓸 수 없습니다.",
    userData: "임시 프로필(RCLONEGUI_USER_DATA)로 실행 중이라 쓸 수 없습니다.",
} as const;

/**
 *  내부 함수
 */

function f_Pad(n: number): string {
    return String(n).padStart(2, "0");
}

function f_XmlUnescape(text: string): string {
    return text
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}

function f_Tag(text: string, tag: string): string | null {
    const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text);
    return m ? f_XmlUnescape(m[1]!) : null;
}

/** 다음 정시(daily·weekly). 요일이 없거나 시각이 틀리면 VALIDATION */
function f_NextSlot(spec: typTaskSpec, now: Date): Date {
    const mask = spec.kind === "daily" ? WEEKDAYS_ALL : spec.weekdays;
    const at = nextLocalTimeOfDay(now, spec.timeOfDay, mask);
    if (at === null) throw new clsAppError("VALIDATION", "예약 시각·요일을 확인하세요.");
    return at;
}

function f_Trigger(spec: typTaskSpec, now: Date): string {
    if (spec.kind === "interval") {
        const start = formatTaskDateTime(new Date(nextOccurrence(spec, now)));
        return (
            `    <TimeTrigger>\n` +
            `      <Repetition>\n        <Interval>PT${spec.intervalMinutes}M</Interval>\n      </Repetition>\n` +
            `      <StartBoundary>${start}</StartBoundary>\n      <Enabled>true</Enabled>\n    </TimeTrigger>`
        );
    }
    const start = formatTaskDateTime(f_NextSlot(spec, now));
    const schedule =
        spec.kind === "daily"
            ? `      <ScheduleByDay>\n        <DaysInterval>1</DaysInterval>\n      </ScheduleByDay>`
            : `      <ScheduleByWeek>\n        <WeeksInterval>1</WeeksInterval>\n` +
              `        <DaysOfWeek>${weekdaysXml(spec.weekdays)}</DaysOfWeek>\n      </ScheduleByWeek>`;
    return (
        `    <CalendarTrigger>\n      <StartBoundary>${start}</StartBoundary>\n` +
        `      <Enabled>true</Enabled>\n${schedule}\n    </CalendarTrigger>`
    );
}

/** exe 경로가 같은지. 해독을 믿을 수 없는데 어느 쪽이든 비ASCII면 판단하지 않는다(null) */
function f_ExeMatch(command: string | null, execPath: string, reliable: boolean): boolean | null {
    if (command === null) return false;
    if (!reliable && (NON_ASCII_RE.test(command) || NON_ASCII_RE.test(execPath))) return null;
    return win32.normalize(command).toLowerCase() === win32.normalize(execPath).toLowerCase();
}

/**
 *  export 함수
 */

/** 작업 이름 `\rcloneGUI\<id>`. id가 uuid가 아니면 VALIDATION(인자에 다른 문자열이 들어가지 않도록) */
export function taskNameOf(jobId: string): string {
    const r = zTaskJobId.safeParse(jobId);
    if (!r.success) throw new clsAppError("VALIDATION", "작업 id 형식이 올바르지 않습니다.");
    return `${OS_TASK_FOLDER}${r.data.toLowerCase()}`;
}

export function xmlEscape(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

/** 로컬 "YYYY-MM-DDTHH:mm:ss"(오프셋 없음 = 작업 스케줄러가 로컬로 해석) */
export function formatTaskDateTime(d: Date): string {
    return (
        `${d.getFullYear()}-${f_Pad(d.getMonth() + 1)}-${f_Pad(d.getDate())}` +
        `T${f_Pad(d.getHours())}:${f_Pad(d.getMinutes())}:${f_Pad(d.getSeconds())}`
    );
}

/** 요일 마스크(bit0 = 일요일, schedule.ts와 같음) → `<Sunday /><Monday />…` */
export function weekdaysXml(mask: number): string {
    return DAY_ELEMENTS.filter((_d, i) => (mask & (1 << i)) !== 0)
        .map((d) => `<${d} />`)
        .join("");
}

/** 등록 스펙 해시(sha256 앞 16hex). XML 틀 버전·exe(대소문자 무시)·jobId·종류에 따라 쓰는 예약 값만 */
export function taskSpecHash(exePath: string, jobId: string, spec: typTaskSpec): string {
    const when =
        spec.kind === "interval"
            ? [spec.intervalMinutes]
            : spec.kind === "daily"
              ? [spec.timeOfDay]
              : [spec.timeOfDay, spec.weekdays & WEEKDAYS_ALL];
    const key = JSON.stringify([
        OS_TASK_XML_VERSION,
        win32.normalize(exePath).toLowerCase(),
        jobId.toLowerCase(),
        spec.kind,
        ...when,
    ]);
    return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** 작업 XML(UTF-16으로 저장한다). 비밀번호·UserId·RestartOnFailure 없음, 인자는 `--run-job <id>`뿐 */
export function buildTaskXml(i: itfTaskXmlInput): string {
    const jobId = taskNameOf(i.jobId).slice(OS_TASK_FOLDER.length);
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>rcloneGUI;spec=${xmlEscape(i.specHash)}</Description>
  </RegistrationInfo>
  <Triggers>
${f_Trigger(i.spec, i.now)}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>${OS_TASK_EXEC_LIMIT}</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(i.exePath)}</Command>
      <Arguments>${OS_RUN_JOB_ARG} ${jobId}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

/**
 * schtasks 출력 해독. UTF-16이 아니고 비ASCII 바이트가 있으면 reliable false —
 * 코드페이지(CP949) 바이트가 우연히 올바른 UTF-8로 읽힐 수 있어 UTF-8 판정도 믿지 않는다(notes #1).
 */
export function decodeSchtasksOutput(buf: Uint8Array): { text: string; reliable: boolean } {
    const d = decodeConsoleOutput(buf);
    if (d.encoding === "utf16le") return { text: d.text, reliable: true };
    const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const ascii = buf.every((b) => b < 0x80);
    return { text: d.text, reliable: d.reliable && (ascii || hasBom) };
}

/** `/Query /FO CSV /NH` 출력에서 줄 첫 필드가 `"\rcloneGUI\<uuid>"`인 jobId만(소문자, 중복 제거, 순서 유지) */
export function parseTaskNames(text: string): string[] {
    const out: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const m = TASK_NAME_RE.exec(line.replace(/^﻿/, ""));
        if (!m) continue;
        const id = m[1]!.toLowerCase();
        if (zTaskJobId.safeParse(id).success && !out.includes(id)) out.push(id);
    }
    return out;
}

/** `/Query /TN … /XML` 출력에서 Command·Arguments·spec 해시. 없으면 null */
export function parseTaskXml(text: string): itfParsedTaskXml {
    const desc = f_Tag(text, "Description");
    const m = desc === null ? null : SPEC_RE.exec(desc);
    return {
        command: f_Tag(text, "Command"),
        args: f_Tag(text, "Arguments"),
        specHash: m ? m[1]! : null,
    };
}

/** OS 예약을 원하는 작업: 켜짐 + 예약 방식 os → jobId(소문자) → spec 해시 */
export function desiredTasks(jobs: readonly typJob[], execPath: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const j of jobs) {
        if (!j.autoSync.enabled || j.autoSync.backend !== "os") continue;
        out.set(j.id.toLowerCase(), taskSpecHash(execPath, j.id, j.autoSync));
    }
    return out;
}

/**
 * 앱 시작 때 맞출 등록·삭제(FR-10).
 * - 원하지 않는데 있는 작업 → 삭제(skip에 있어도 지운다: 실행 중 인스턴스는 끝나지 않는다, notes #8)
 * - 원하는데 없음 / spec 해시 다름 / exe 다름 → 등록. skip(지금 실행·대기 중)은 등록하지 않는다
 * - exe 비교를 믿을 수 없으면 exeMatches null, 그것만으로는 다시 등록하지 않는다(무한 재등록 방지)
 */
export function planReconcile(i: {
    desired: ReadonlyMap<string, string>;
    existing: ReadonlyMap<string, itfExistingTask>;
    execPath: string;
    skip: ReadonlySet<string>;
}): itfReconcilePlan {
    const unregister: string[] = [];
    const register: string[] = [];
    const exeMatches = new Map<string, boolean | null>();
    for (const id of i.existing.keys()) {
        if (!i.desired.has(id)) unregister.push(id);
    }
    for (const [id, hash] of i.desired) {
        const e = i.existing.get(id);
        const match = e ? f_ExeMatch(e.command, i.execPath, e.reliable) : null;
        if (e) exeMatches.set(id, match);
        if (i.skip.has(id)) continue;
        if (!e || e.specHash !== hash || match === false) register.push(id);
    }
    return { unregister, register, exeMatches };
}

/**
 * OS 예약을 쓸 수 있는지(순수). 설치본 + Windows + E2E 아님 + 임시 프로필이 아니어야 한다.
 * 임시 프로필(RCLONEGUI_USER_DATA)에서 reconcile하면 사용자의 실제 예약을 고아로 지울 수 있고,
 * OS가 띄운 실행은 env 없이 실제 %APPDATA%로 돌기 때문이다. 설치 스모크만 smokeOptIn으로 허용한다.
 */
export function osSchedulerAvailability(e: {
    platform: NodeJS.Platform;
    isPackaged: boolean;
    e2e: boolean;
    userDataOverride: boolean;
    smokeOptIn: boolean;
}): itfOsAvailability {
    if (e.platform !== "win32") return { available: false, reason: OS_UNAVAILABLE.platform };
    if (!e.isPackaged) return { available: false, reason: OS_UNAVAILABLE.notPackaged };
    if (e.e2e) return { available: false, reason: OS_UNAVAILABLE.e2e };
    if (e.userDataOverride && !e.smokeOptIn) {
        return { available: false, reason: OS_UNAVAILABLE.userData };
    }
    return { available: true, reason: null };
}

/**
 *  실행부
 */

/** schtasks.exe 절대 경로(killProcessTree와 같은 방식) */
export function schtasksPath(): string {
    return `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\schtasks.exe`;
}

/** 기본 실행기: 인자 배열 그대로, 셸 없음, 출력은 바이트 */
export const execBuffer: typExecBuffer = (file, args, opts) =>
    new Promise((resolve) => {
        execFile(
            file,
            [...args],
            { shell: false, windowsHide: true, encoding: "buffer", timeout: opts.timeoutMs },
            (err, stdout, stderr) => {
                // 0이 아닌 종료는 err.code가 종료 코드(숫자), 실행 실패(ENOENT 등)는 문자열
                const raw: unknown = err ? err.code : 0;
                resolve({
                    code: typeof raw === "number" ? raw : null,
                    stdout: Buffer.from(stdout ?? []),
                    stderr: Buffer.from(stderr ?? []),
                });
            },
        );
    });

/** 화면에 보일 등록 실패 문구(경로 없음) */
export function registerFailText(code: number | null): string {
    return (
        `Windows 작업 스케줄러에 등록하지 못했습니다(exit ${code ?? "없음"}). ` +
        "회사 PC는 정책으로 막혀 있을 수 있습니다. ‘앱이 켜져 있을 때’로 바꿀 수 있습니다."
    );
}

export function unregisterFailText(code: number | null): string {
    return `Windows 작업 스케줄러에서 예약을 지우지 못했습니다(exit ${code ?? "없음"}). 작업 스케줄러에서 직접 지울 수 있습니다.`;
}

/**
 * OS 예약 등록 수명주기. 모든 schtasks 호출은 내부 큐로 직렬화한다.
 * available이 false면 schtasks를 한 번도 부르지 않는다.
 */
export class clsOsScheduler {
    private readonly deps: itfOsSchedulerDeps;
    private readonly exec: typExecBuffer;
    private readonly mutex = new clsMutex();
    /** 마지막으로 등록에 성공한 spec 해시(jobId 소문자) — syncJobs 차분 기준 */
    private readonly registered = new Map<string, string>();
    /**
     * 등록에 실패한 spec 해시(jobId 소문자). 같은 해시는 syncJobs에서 다시 시도하지 않는다(정책 차단 PC에서
     * lastRun 등 onChange마다 /Create를 반복하지 않게). 해시가 바뀌거나 reconcile(앱 시작)에서만 다시 시도한다
     */
    private readonly failed = new Map<string, string>();
    private readonly tasks = new Map<string, itfOsTaskStatus>();
    private latestJobs: readonly typJob[] = [];
    private syncQueued = false;

    constructor(deps: itfOsSchedulerDeps) {
        this.deps = deps;
        this.exec = deps.exec ?? execBuffer;
    }

    status(): itfOsScheduleStatus {
        const { available, reason } = this.deps.availability;
        return {
            available,
            reason,
            tasks: available ? [...this.tasks.values()].map((t) => ({ ...t })) : [],
        };
    }

    /** 앱 시작(GUI·헤드리스): 남은 임시 XML 정리 → 이름 목록 → 작업별 /Query /XML → planReconcile → 삭제·등록 */
    reconcile(jobs: readonly typJob[], skip: ReadonlySet<string> = new Set()): Promise<void> {
        if (!this.deps.availability.available) return Promise.resolve();
        const skipIds = new Set([...skip].map((x) => x.toLowerCase()));
        return this.mutex.runExclusive(async () => {
            try {
                await this.f_Reconcile(jobs, skipIds);
            } catch (e) {
                this.deps.logger.warn("os 예약 맞추기 실패", e);
            } finally {
                this.f_Emit();
            }
        });
    }

    /** job-store onChange: 마지막으로 등록한 spec 해시와 비교해 바뀐 것만 등록·삭제(직렬화, 연속 호출은 마지막 목록으로 한 번) */
    syncJobs(jobs: readonly typJob[]): void {
        if (!this.deps.availability.available) return;
        this.latestJobs = jobs;
        if (this.syncQueued) return;
        this.syncQueued = true;
        void this.mutex.runExclusive(async () => {
            this.syncQueued = false;
            try {
                await this.f_Sync(this.latestJobs);
            } catch (e) {
                this.deps.logger.warn("os 예약 반영 실패", e);
            }
        });
    }

    /** 진행 중인 등록·삭제가 끝날 때까지(테스트·종료) */
    idle(): Promise<void> {
        return this.mutex.runExclusive(() => undefined);
    }

    private f_Emit(): void {
        try {
            this.deps.onStatus?.(this.status());
        } catch {
            // 창 갱신 실패로 등록을 멈추지 않는다
        }
    }

    private f_Run(args: readonly string[]) {
        return this.exec(schtasksPath(), args, { timeoutMs: SCHTASKS_TIMEOUT_MS });
    }

    private async f_Reconcile(jobs: readonly typJob[], skip: ReadonlySet<string>): Promise<void> {
        await this.f_CleanupTmp();
        const q = await this.f_Run(["/Query", "/FO", "CSV", "/NH"]);
        if (q.code !== 0) {
            // 목록을 못 얻으면 아무것도 지우거나 등록하지 않는다
            this.deps.logger.warn(`os 예약 목록 실패: exit=${q.code}`);
            return;
        }
        const existing = new Map<string, itfExistingTask>();
        for (const id of parseTaskNames(decodeSchtasksOutput(q.stdout).text)) {
            const x = await this.f_Run(["/Query", "/TN", taskNameOf(id), "/XML"]);
            if (x.code !== 0) {
                existing.set(id, { command: null, specHash: null, reliable: true });
                continue;
            }
            const d = decodeSchtasksOutput(x.stdout);
            const p = parseTaskXml(d.text);
            existing.set(id, { command: p.command, specHash: p.specHash, reliable: d.reliable });
        }
        const desired = desiredTasks(jobs, this.deps.execPath);
        const plan = planReconcile({ desired, existing, execPath: this.deps.execPath, skip });
        this.deps.logger.info(
            `os 예약 맞추기: 있음 ${existing.size} 원함 ${desired.size} 삭제 ${plan.unregister.length} 등록 ${plan.register.length}`,
        );
        this.registered.clear();
        this.failed.clear();
        this.tasks.clear();
        for (const [id, hash] of desired) {
            const e = existing.get(id);
            if (!e) {
                this.tasks.set(id, { jobId: id, registered: false, exeMatches: null, error: null });
                continue;
            }
            // 그대로 둔 작업은 등록된 것으로 기록(spec이 다르면 아래 등록이 덮어쓴다)
            if (e.specHash === hash) this.registered.set(id, hash);
            this.tasks.set(id, {
                jobId: id,
                registered: true,
                exeMatches: plan.exeMatches.get(id) ?? null,
                error: null,
            });
        }
        for (const id of plan.unregister) await this.f_Unregister(id);
        const byId = new Map(jobs.map((j) => [j.id.toLowerCase(), j]));
        for (const id of plan.register) {
            const job = byId.get(id);
            if (job) await this.f_Register(job);
        }
    }

    private async f_Sync(jobs: readonly typJob[]): Promise<void> {
        const desired = desiredTasks(jobs, this.deps.execPath);
        const byId = new Map(jobs.map((j) => [j.id.toLowerCase(), j]));
        const unregister = [...this.tasks.keys()].filter((id) => !desired.has(id));
        const register = [...desired].filter(
            ([id, h]) => this.registered.get(id) !== h && this.failed.get(id) !== h,
        );
        if (unregister.length === 0 && register.length === 0) return;
        for (const id of unregister) await this.f_Unregister(id);
        for (const [id] of register) {
            const job = byId.get(id);
            if (job) await this.f_Register(job);
        }
        this.f_Emit();
    }

    private async f_CleanupTmp(): Promise<void> {
        const dir = join(this.deps.userDataDir, OS_TASK_TMP_DIR);
        let names: string[];
        try {
            names = await readdir(dir);
        } catch {
            return;
        }
        for (const n of names.filter((x) => TMP_XML_RE.test(x))) {
            await rm(join(dir, n), { force: true }).catch(() => undefined);
        }
    }

    private async f_Register(job: typJob): Promise<void> {
        const id = job.id.toLowerCase();
        const prev = this.tasks.get(id);
        const hash = taskSpecHash(this.deps.execPath, id, job.autoSync);
        const dir = join(this.deps.userDataDir, OS_TASK_TMP_DIR);
        const file = join(dir, `task-${id}-${randomUUID()}.xml`);
        let created = false;
        try {
            const xml = buildTaskXml({
                exePath: this.deps.execPath,
                jobId: id,
                spec: job.autoSync,
                now: this.deps.now?.() ?? new Date(),
                specHash: hash,
            });
            await mkdir(dir, { recursive: true });
            await writeFile(
                file,
                Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]),
                { flag: "wx" },
            );
            created = true;
            const r = await this.f_Run(["/Create", "/XML", file, "/TN", taskNameOf(id), "/F"]);
            this.deps.logger.info(`os 예약 등록: job=${id} exit=${r.code}`);
            if (r.code === 0) {
                this.registered.set(id, hash);
                this.failed.delete(id);
                this.tasks.set(id, { jobId: id, registered: true, exeMatches: true, error: null });
            } else {
                this.registered.delete(id);
                this.failed.set(id, hash);
                this.tasks.set(id, {
                    jobId: id,
                    registered: prev?.registered ?? false,
                    exeMatches: prev?.exeMatches ?? null,
                    error: registerFailText(r.code),
                });
            }
        } catch (e) {
            this.deps.logger.warn(`os 예약 등록 실패: job=${id}`, e);
            this.registered.delete(id);
            this.failed.set(id, hash);
            this.tasks.set(id, {
                jobId: id,
                registered: prev?.registered ?? false,
                exeMatches: prev?.exeMatches ?? null,
                error: registerFailText(null),
            });
        } finally {
            if (created) await rm(file, { force: true }).catch(() => undefined);
        }
    }

    private async f_Unregister(id: string): Promise<void> {
        const name = taskNameOf(id);
        const r = await this.f_Run(["/Delete", "/TN", name, "/F"]);
        this.deps.logger.info(`os 예약 삭제: job=${id} exit=${r.code}`);
        // 실패해도 이미 없으면 성공으로 본다. "없음"은 /Query exit 1로만 판정한다
        // (windows-task-scheduler-notes #2: 없는 작업은 exit 1). 시간 초과(null)·그 밖의 코드는 실패로 둔다
        const gone =
            r.code === 0 ||
            (await this.f_Run(["/Query", "/TN", name])).code === SCHTASKS_NOT_FOUND_CODE;
        if (gone) {
            this.registered.delete(id);
            this.failed.delete(id);
            this.tasks.delete(id);
            return;
        }
        this.tasks.set(id, {
            jobId: id,
            registered: true,
            exeMatches: this.tasks.get(id)?.exeMatches ?? null,
            error: unregisterFailText(r.code),
        });
    }
}
