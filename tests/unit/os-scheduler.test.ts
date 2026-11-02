// StartBoundary(로컬 시각) 계산을 서울 시간대(UTC+9)로 고정한다. 이 파일은 별도 worker에서 돈다.
process.env.TZ = "Asia/Seoul";

// ========== External imports ==========
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { decodeConsoleOutput } from "@/main/parsers/console-output";
import { decodeWslOutput } from "@/main/parsers/wsl-parser";
import {
    buildTaskXml,
    clsOsScheduler,
    decodeSchtasksOutput,
    desiredTasks,
    formatTaskDateTime,
    OS_UNAVAILABLE,
    osSchedulerAvailability,
    parseTaskNames,
    parseTaskXml,
    planReconcile,
    registerFailText,
    taskNameOf,
    taskSpecHash,
    type typExecBuffer,
    type typTaskSpec,
    weekdaysXml,
    xmlEscape,
} from "@/main/services/os-scheduler";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import type { typJob } from "@/shared/schemas/job";
import type { itfOsScheduleStatus } from "@/shared/types/scheduler";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "schtasks");
const ID = "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b";
const ID2 = "00000000-0000-4000-8000-000000000002";
const EXE = "C:\\Program Files\\rcloneGUI\\rcloneGUI.exe";
/** 2026-10-29(목) 10:00 KST */
const NOW = new Date(2026, 9, 29, 10, 0, 0, 0);

function f_Spec(over: Partial<typTaskSpec> = {}): typTaskSpec {
    return { kind: "interval", intervalMinutes: 30, timeOfDay: "09:00", weekdays: 62, ...over };
}

function f_Xml(spec: typTaskSpec, exePath = EXE): string {
    return buildTaskXml({ exePath, jobId: ID, spec, now: NOW, specHash: "0123456789abcdef" });
}

function f_Job(id: string, over: Partial<typJob["autoSync"]> = {}): typJob {
    const d = createJobDraft(createDefaultSettings());
    return {
        ...d,
        name: "작업",
        source: "C:\\fake\\src",
        destination: "C:\\fake\\dst",
        id,
        autoSync: { ...d.autoSync, nextRunAt: null, lastAutoRunAt: null, ...over },
        rev: 0,
        createdAt: "2026-10-29T00:00:00.000Z",
        updatedAt: "2026-10-29T00:00:00.000Z",
        lastRun: null,
    };
}

describe("시간대 고정", () => {
    it("Asia/Seoul이 적용되어 있다", () => {
        expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-540);
    });
});

describe("buildTaskXml", () => {
    it("interval: TimeTrigger + 반복 간격, 시작은 now+주기(로컬, 오프셋 없음)", () => {
        const x = f_Xml(f_Spec({ intervalMinutes: 90 }));
        expect(x).toContain("<TimeTrigger>");
        expect(x).toContain("<Interval>PT90M</Interval>");
        expect(x).toContain("<StartBoundary>2026-10-29T11:30:00</StartBoundary>");
        expect(x).not.toContain("CalendarTrigger");
    });

    it("daily: 오늘 시각이 지났으면 내일, 아니면 오늘", () => {
        expect(f_Xml(f_Spec({ kind: "daily", timeOfDay: "09:00" }))).toContain(
            "<StartBoundary>2026-10-30T09:00:00</StartBoundary>",
        );
        const x = f_Xml(f_Spec({ kind: "daily", timeOfDay: "21:15" }));
        expect(x).toContain("<StartBoundary>2026-10-29T21:15:00</StartBoundary>");
        expect(x).toContain("<DaysInterval>1</DaysInterval>");
    });

    it("weekly: 요일 비트 → DaysOfWeek(일·토 경계), 시작은 다음 해당 요일", () => {
        const x = f_Xml(f_Spec({ kind: "weekly", timeOfDay: "08:00", weekdays: 0b1000001 }));
        expect(x).toContain("<DaysOfWeek><Sunday /><Saturday /></DaysOfWeek>");
        // 목요일 10:00 → 다음 토요일 08:00
        expect(x).toContain("<StartBoundary>2026-10-31T08:00:00</StartBoundary>");
        expect(x).toContain("<WeeksInterval>1</WeeksInterval>");
    });

    it("StartBoundary는 항상 now 이후", () => {
        for (const spec of [
            f_Spec({ intervalMinutes: 1 }),
            f_Spec({ kind: "daily", timeOfDay: "10:00" }),
            f_Spec({ kind: "weekly", timeOfDay: "10:00", weekdays: 1 << 4 }),
        ]) {
            const m = /<StartBoundary>([^<]+)<\/StartBoundary>/.exec(f_Xml(spec));
            expect(Date.parse(m![1]!)).toBeGreaterThan(NOW.getTime());
        }
    });

    it("설정: 13시간 제한·IgnoreNew·StartWhenAvailable·배터리 false, 재시도·계정·비밀번호 없음", () => {
        const x = f_Xml(f_Spec());
        expect(x).toContain("<ExecutionTimeLimit>PT13H</ExecutionTimeLimit>");
        expect(x).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
        expect(x).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
        expect(x).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
        expect(x).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
        expect(x).toContain("<LogonType>InteractiveToken</LogonType>");
        expect(x).toContain("<RunLevel>LeastPrivilege</RunLevel>");
        expect(x).not.toMatch(/RestartOnFailure|UserId|Password/);
        expect(x).toContain("<Description>rcloneGUI;spec=0123456789abcdef</Description>");
    });

    it("exe 경로는 이스케이프하고 인자는 --run-job <uuid>뿐", () => {
        const x = f_Xml(f_Spec(), "C:\\a&b<c>\"d'\\app.exe");
        expect(x).toContain("<Command>C:\\a&amp;b&lt;c&gt;&quot;d&apos;\\app.exe</Command>");
        expect(x).toContain(`<Arguments>--run-job ${ID}</Arguments>`);
        expect(parseTaskXml(x)).toEqual({
            command: "C:\\a&b<c>\"d'\\app.exe",
            args: `--run-job ${ID}`,
            specHash: "0123456789abcdef",
        });
    });

    it("jobId가 uuid가 아니면 거부", () => {
        expect(() =>
            buildTaskXml({ exePath: EXE, jobId: "a&b", spec: f_Spec(), now: NOW, specHash: "x" }),
        ).toThrow("작업 id 형식이 올바르지 않습니다.");
    });
});

describe("이름·형식 도우미", () => {
    it("taskNameOf: uuid만, 소문자", () => {
        expect(taskNameOf(ID.toUpperCase())).toBe(`\\rcloneGUI\\${ID}`);
        expect(() => taskNameOf("not-a-uuid")).toThrow("작업 id 형식이 올바르지 않습니다.");
        expect(() => taskNameOf(`${ID} /F`)).toThrow("작업 id 형식이 올바르지 않습니다.");
    });

    it("xmlEscape·formatTaskDateTime·weekdaysXml", () => {
        expect(xmlEscape(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
        expect(formatTaskDateTime(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02T03:04:05");
        expect(weekdaysXml(0b0111110)).toBe(
            "<Monday /><Tuesday /><Wednesday /><Thursday /><Friday />",
        );
        expect(weekdaysXml(0)).toBe("");
    });

    it("taskSpecHash: 종류에 따라 쓰는 값만, exe 대소문자 무시, 16hex", () => {
        const h = taskSpecHash(EXE, ID, f_Spec());
        expect(h).toMatch(/^[0-9a-f]{16}$/);
        expect(taskSpecHash(EXE.toUpperCase(), ID.toUpperCase(), f_Spec())).toBe(h);
        expect(taskSpecHash(EXE, ID, f_Spec({ timeOfDay: "10:00" }))).toBe(h);
        expect(taskSpecHash(EXE, ID, f_Spec({ intervalMinutes: 31 }))).not.toBe(h);
        expect(taskSpecHash("D:\\other.exe", ID, f_Spec())).not.toBe(h);
        const daily = f_Spec({ kind: "daily" });
        expect(taskSpecHash(EXE, ID, { ...daily, weekdays: 1 })).toBe(taskSpecHash(EXE, ID, daily));
        const weekly = f_Spec({ kind: "weekly" });
        expect(taskSpecHash(EXE, ID, { ...weekly, weekdays: 1 })).not.toBe(
            taskSpecHash(EXE, ID, weekly),
        );
    });
});

describe("decodeConsoleOutput / decodeSchtasksOutput", () => {
    const text = '"\\rcloneGUI\\x","N/A","준비"\r\n';

    it("UTF-16 BOM·BOM 없음은 확실히 해독", () => {
        const bom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
        expect(decodeSchtasksOutput(bom)).toEqual({ text, reliable: true });
        expect(decodeSchtasksOutput(Buffer.from(text, "utf16le"))).toEqual({
            text,
            reliable: true,
        });
    });

    it("UTF-8: ASCII·BOM 있으면 믿고, BOM 없는 비ASCII는 믿지 않는다(코드페이지 우연 일치)", () => {
        expect(decodeSchtasksOutput(Buffer.from("abc\r\n", "utf8"))).toEqual({
            text: "abc\r\n",
            reliable: true,
        });
        const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
        expect(decodeSchtasksOutput(withBom)).toEqual({ text, reliable: true });
        expect(decodeSchtasksOutput(Buffer.from(text, "utf8"))).toEqual({ text, reliable: false });
        expect(decodeConsoleOutput(Buffer.from(text, "utf8")).reliable).toBe(true);
    });

    it("실제 /Query /XML 출력(코드페이지, 비ASCII exe 경로)은 reliable false이고 ASCII 부분은 읽힌다", () => {
        const buf = readFileSync(join(FIXTURES, "query-xml-nonascii.bin"));
        const d = decodeSchtasksOutput(buf);
        expect(d.reliable).toBe(false);
        expect(decodeConsoleOutput(buf).encoding).toBe("codepage");
        const p = parseTaskXml(d.text);
        expect(p.args).toBe("--run-job x");
        expect(p.command).toMatch(/^C:\\probe\\.+\\dummy\.cmd$/);
        expect(p.command).not.toContain("한글");
    });

    it("실제 /Query /FO CSV 출력(코드페이지): probe 폴더 이름은 우리 이름이 아니다", () => {
        const d = decodeSchtasksOutput(readFileSync(join(FIXTURES, "query-csv-probe.bin")));
        expect(d.reliable).toBe(false);
        expect(d.text).toContain('"\\rcloneGUI-probe\\00000000"');
        expect(parseTaskNames(d.text)).toEqual([]);
        const ours = d.text.replaceAll("\\rcloneGUI-probe\\00000000", `\\rcloneGUI\\${ID}`);
        expect(parseTaskNames(ours)).toEqual([ID]);
    });

    it("wsl 해독은 그대로(UTF-16 판정 공유, 그 외 utf-8 대체 문자)", () => {
        expect(decodeWslOutput(Buffer.from("Ubuntu\r\n", "utf16le"))).toBe("Ubuntu\r\n");
        expect(decodeWslOutput(Buffer.from([0x41, 0xff]))).toBe("A\uFFFD");
    });
});

describe("parseTaskNames / parseTaskXml", () => {
    it("우리 폴더 uuid만, 소문자·중복 제거·CRLF, 다른 폴더·probe·하위 폴더 제외", () => {
        const text = [
            `"\\rcloneGUI\\${ID.toUpperCase()}","N/A","Ready"`,
            `"\\rcloneGUI\\${ID}","2026-11-02 9:00:00","준비"`,
            `"\\rcloneGUI-probe\\${ID2}","N/A","Ready"`,
            `"\\Other\\rcloneGUI\\${ID2}","N/A","Ready"`,
            `"\\rcloneGUI\\sub\\${ID2}","N/A","Ready"`,
            `"\\rcloneGUI\\not-a-uuid-not-a-uuid-not-a-uuid-xxxx","N/A","Ready"`,
            `"\\rcloneGUI\\${ID2}","N/A","Ready"`,
            "",
        ].join("\r\n");
        expect(parseTaskNames(text)).toEqual([ID, ID2]);
    });

    it("Command·Arguments·spec이 없으면 null", () => {
        expect(parseTaskXml("<Task></Task>")).toEqual({
            command: null,
            args: null,
            specHash: null,
        });
        expect(parseTaskXml("<Description>사용자 설명</Description>").specHash).toBeNull();
    });
});

describe("desiredTasks / planReconcile", () => {
    it("켜짐 + os만 원한다", () => {
        const jobs = [
            f_Job(ID, { enabled: true, backend: "os" }),
            f_Job(ID2, { enabled: true, backend: "app" }),
            f_Job("00000000-0000-4000-8000-000000000003", { enabled: false, backend: "os" }),
        ];
        const d = desiredTasks(jobs, EXE);
        expect([...d.keys()]).toEqual([ID]);
        expect(d.get(ID)).toBe(taskSpecHash(EXE, ID, jobs[0]!.autoSync));
    });

    const H = "aaaaaaaaaaaaaaaa";
    const ok = { command: EXE, specHash: H, reliable: true };

    it("고아 삭제 / 없음 등록 / exe 다름 등록 / spec 다름 등록 / 같으면 그대로", () => {
        const plan = planReconcile({
            desired: new Map([
                ["a", H],
                ["b", H],
                ["c", H],
                ["d", H],
            ]),
            existing: new Map([
                ["b", { ...ok, command: "D:\\old\\rcloneGUI.exe" }],
                ["c", { ...ok, specHash: "bbbbbbbbbbbbbbbb" }],
                ["d", { ...ok, command: EXE.toLowerCase() }],
                ["orphan", ok],
            ]),
            execPath: EXE,
            skip: new Set(),
        });
        expect(plan.unregister).toEqual(["orphan"]);
        expect(plan.register).toEqual(["a", "b", "c"]);
        expect(Object.fromEntries(plan.exeMatches)).toEqual({ b: false, c: true, d: true });
    });

    it("해독 불확실 + 비ASCII면 exe 비교 안 함(null)·재등록 안 함, ASCII면 비교한다", () => {
        const kr = "C:\\Users\\사용자\\rcloneGUI.exe";
        const plan = planReconcile({
            desired: new Map([
                ["a", H],
                ["b", H],
            ]),
            existing: new Map([
                ["a", { command: "C:\\Users\\???\\rcloneGUI.exe", specHash: H, reliable: false }],
                ["b", { command: "C:\\Users\\???\\rcloneGUI.exe", specHash: "x", reliable: false }],
            ]),
            execPath: kr,
            skip: new Set(),
        });
        expect(plan.register).toEqual(["b"]);
        expect(plan.exeMatches.get("a")).toBeNull();
        const ascii = planReconcile({
            desired: new Map([["a", H]]),
            existing: new Map([["a", { command: "D:\\x.exe", specHash: H, reliable: false }]]),
            execPath: EXE,
            skip: new Set(),
        });
        expect(ascii.register).toEqual(["a"]);
    });

    it("skip(실행·대기 중)은 등록하지 않지만 고아 삭제는 한다", () => {
        const plan = planReconcile({
            desired: new Map([["a", H]]),
            existing: new Map([["orphan", ok]]),
            execPath: EXE,
            skip: new Set(["a", "orphan"]),
        });
        expect(plan.register).toEqual([]);
        expect(plan.unregister).toEqual(["orphan"]);
    });

    it("Command가 없으면 exe 다름(false)으로 다시 등록", () => {
        const plan = planReconcile({
            desired: new Map([["a", H]]),
            existing: new Map([["a", { command: null, specHash: H, reliable: true }]]),
            execPath: EXE,
            skip: new Set(),
        });
        expect(plan.register).toEqual(["a"]);
        expect(plan.exeMatches.get("a")).toBe(false);
    });
});

describe("osSchedulerAvailability", () => {
    const base = {
        platform: "win32" as NodeJS.Platform,
        isPackaged: true,
        e2e: false,
        userDataOverride: false,
        smokeOptIn: false,
    };

    it("설치본 + Windows + 실제 프로필만 가능", () => {
        expect(osSchedulerAvailability(base)).toEqual({ available: true, reason: null });
        expect(osSchedulerAvailability({ ...base, platform: "linux" })).toEqual({
            available: false,
            reason: OS_UNAVAILABLE.platform,
        });
        expect(osSchedulerAvailability({ ...base, isPackaged: false }).reason).toBe(
            OS_UNAVAILABLE.notPackaged,
        );
        expect(osSchedulerAvailability({ ...base, e2e: true }).reason).toBe(OS_UNAVAILABLE.e2e);
        expect(osSchedulerAvailability({ ...base, userDataOverride: true }).reason).toBe(
            OS_UNAVAILABLE.userData,
        );
    });

    it("임시 프로필은 설치 스모크 opt-in일 때만, E2E·개발 실행은 opt-in이어도 불가", () => {
        expect(
            osSchedulerAvailability({ ...base, userDataOverride: true, smokeOptIn: true })
                .available,
        ).toBe(true);
        expect(osSchedulerAvailability({ ...base, e2e: true, smokeOptIn: true }).available).toBe(
            false,
        );
        expect(
            osSchedulerAvailability({ ...base, isPackaged: false, smokeOptIn: true }).available,
        ).toBe(false);
    });
});

function f_Ok(text: string) {
    return { code: 0, stdout: Buffer.from(text, "latin1"), stderr: Buffer.alloc(0) };
}

const f_Failing: typExecBuffer = async () => ({
    code: 1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
});

function f_OsJob(id: string, over: Partial<typJob["autoSync"]> = {}): typJob {
    return { ...f_Job(id, { enabled: true, backend: "os", ...over }), name: "a&b" };
}

function f_ExistingXml(job: typJob, exePath = EXE): string {
    return buildTaskXml({
        exePath,
        jobId: job.id,
        spec: job.autoSync,
        now: NOW,
        specHash: taskSpecHash(exePath, job.id, job.autoSync),
    });
}

describe("clsOsScheduler (exec 주입)", () => {
    const dirs: string[] = [];
    afterEach(() => {
        for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    interface itfCall {
        args: string[];
        /** /Create 때 읽은 XML 파일 정보 */
        file?: { inTmp: boolean; bom: boolean; xml: string };
    }

    function f_Harness(
        o: {
            existing?: Record<string, string>;
            createCode?: number;
            deleteCode?: number;
            /** null = 시간 초과 */
            queryOneCode?: number | null;
            available?: boolean;
        } = {},
    ) {
        const userData = mkdtempSync(join(tmpdir(), "rclonegui-os-"));
        dirs.push(userData);
        const tmp = join(userData, "os-tasks");
        const calls: itfCall[] = [];
        const statuses: itfOsScheduleStatus[] = [];
        const logs: string[] = [];
        const existing = new Map(Object.entries(o.existing ?? {}));
        const exec: typExecBuffer = async (file, args) => {
            expect(file.toLowerCase().endsWith("\\system32\\schtasks.exe")).toBe(true);
            const call: itfCall = { args: [...args] };
            calls.push(call);
            const [verb, a1, a2, a3] = args;
            if (verb === "/Query" && a1 === "/FO") {
                return f_Ok(
                    [...existing.keys()]
                        .map((id) => `"\\rcloneGUI\\${id}","N/A","Ready"`)
                        .join("\r\n"),
                );
            }
            if (verb === "/Query" && a3 === "/XML") {
                const id = a2!.split("\\").at(-1)!;
                const xml = existing.get(id);
                return xml === undefined ? { ...f_Ok(""), code: 1 } : f_Ok(xml);
            }
            if (verb === "/Query") {
                return { ...f_Ok(""), code: o.queryOneCode === undefined ? 1 : o.queryOneCode };
            }
            if (verb === "/Create") {
                const path = a2!;
                const buf = readFileSync(path);
                call.file = {
                    inTmp: path.startsWith(tmp),
                    bom: buf[0] === 0xff && buf[1] === 0xfe,
                    xml: buf.subarray(2).toString("utf16le"),
                };
                const code = o.createCode ?? 0;
                if (code === 0) existing.set(args[4]!.split("\\").at(-1)!, call.file.xml);
                return { ...f_Ok(""), code };
            }
            if (verb === "/Delete") {
                const code = o.deleteCode ?? 0;
                if (code === 0) existing.delete(a2!.split("\\").at(-1)!);
                return { ...f_Ok(""), code };
            }
            throw new Error(`예상하지 못한 호출: ${args.join(" ")}`);
        };
        const sched = new clsOsScheduler({
            exec,
            userDataDir: userData,
            execPath: EXE,
            availability:
                o.available === false
                    ? { available: false, reason: OS_UNAVAILABLE.notPackaged }
                    : { available: true, reason: null },
            logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
            now: () => NOW,
            onStatus: (st) => statuses.push(st),
        });
        return { sched, calls, statuses, logs, tmp, existing, userData };
    }

    it("available false면 schtasks를 한 번도 부르지 않는다", async () => {
        const h = f_Harness({ available: false });
        await h.sched.reconcile([f_OsJob(ID)]);
        h.sched.syncJobs([f_OsJob(ID)]);
        await h.sched.idle();
        expect(h.calls).toHaveLength(0);
        expect(h.sched.status()).toEqual({
            available: false,
            reason: OS_UNAVAILABLE.notPackaged,
            tasks: [],
        });
    });

    it("reconcile: 남은 임시 XML 정리, 고아 삭제, 없는 작업 등록(인자에 작업 이름·경로 없음, 임시 XML은 지움)", async () => {
        const orphan = "00000000-0000-4000-8000-0000000000ff";
        const h = f_Harness({ existing: { [orphan]: "<Task />" } });
        mkdirSync(h.tmp, { recursive: true });
        writeFileSync(join(h.tmp, "task-left.xml"), "x");
        writeFileSync(join(h.tmp, "keep.txt"), "x");
        await h.sched.reconcile([f_OsJob(ID), f_Job(ID2, { enabled: true, backend: "app" })]);
        expect(readdirSync(h.tmp)).toEqual(["keep.txt"]);
        const verbs = h.calls.map((c) => c.args.slice(0, 2).join(" "));
        expect(verbs).toEqual(["/Query /FO", "/Query /TN", "/Delete /TN", "/Create /XML"]);
        expect(h.calls[2]!.args).toEqual(["/Delete", "/TN", `\\rcloneGUI\\${orphan}`, "/F"]);
        const create = h.calls[3]!;
        expect(create.args[3]).toBe("/TN");
        expect(create.args.slice(3)).toEqual(["/TN", `\\rcloneGUI\\${ID}`, "/F"]);
        expect(create.file).toMatchObject({ inTmp: true, bom: true });
        expect(create.file!.xml).toContain(`<Arguments>--run-job ${ID}</Arguments>`);
        for (const c of h.calls) {
            expect(c.args.join(" ")).not.toContain("a&b");
            expect(c.args.join(" ")).not.toContain("rcloneGUI.exe");
        }
        expect(existsSync(create.args[2]!)).toBe(false);
        expect(h.sched.status().tasks).toEqual([
            { jobId: ID, registered: true, exeMatches: true, error: null },
        ]);
        expect(h.statuses.at(-1)?.tasks).toHaveLength(1);
        expect(h.logs.join("\n")).not.toContain("a&b");
    });

    it("reconcile: 같은 spec·exe면 다시 등록하지 않고, exe가 다르면 다시 등록한다", async () => {
        const job = f_OsJob(ID);
        const same = f_Harness({ existing: { [ID]: f_ExistingXml(job) } });
        await same.sched.reconcile([job]);
        expect(same.calls.some((c) => c.args[0] === "/Create")).toBe(false);
        // 다른 exe로 등록된 작업(spec 해시는 지금 exe 기준과 다름)
        const moved = f_Harness({
            existing: { [ID]: f_ExistingXml(job, "D:\\old\\rcloneGUI.exe") },
        });
        await moved.sched.reconcile([job]);
        expect(moved.calls.filter((c) => c.args[0] === "/Create")).toHaveLength(1);
    });

    it("reconcile: skip(실행·대기 중)은 다시 등록하지 않는다", async () => {
        const job = f_OsJob(ID, { intervalMinutes: 15 });
        const h = f_Harness({ existing: { [ID]: f_ExistingXml(f_OsJob(ID)) } });
        await h.sched.reconcile([job], new Set([ID.toUpperCase()]));
        expect(h.calls.some((c) => c.args[0] === "/Create")).toBe(false);
    });

    it("등록 실패는 status.error와 onStatus로 알린다(경로 없음)", async () => {
        const h = f_Harness({ createCode: 5 });
        await h.sched.reconcile([f_OsJob(ID)]);
        expect(h.sched.status().tasks).toEqual([
            { jobId: ID, registered: false, exeMatches: null, error: registerFailText(5) },
        ]);
        expect(h.statuses.at(-1)?.tasks[0]?.error).toBe(registerFailText(5));
        expect(readdirSync(h.tmp)).toEqual([]);
    });

    it("syncJobs: 바뀐 것만 — 예약 기록만 바뀌면 무시, 예약 변경은 등록, 끄거나 지우면 삭제", async () => {
        const h = f_Harness();
        const job = f_OsJob(ID);
        await h.sched.reconcile([job]);
        const base = h.calls.length;
        h.sched.syncJobs([
            { ...job, autoSync: { ...job.autoSync, lastAutoRunAt: NOW.toISOString() } },
        ]);
        await h.sched.idle();
        expect(h.calls).toHaveLength(base);
        h.sched.syncJobs([{ ...job, autoSync: { ...job.autoSync, intervalMinutes: 45 } }]);
        await h.sched.idle();
        expect(h.calls.slice(base).map((c) => c.args[0])).toEqual(["/Create"]);
        expect(h.calls.at(-1)!.file!.xml).toContain("<Interval>PT45M</Interval>");
        h.sched.syncJobs([{ ...job, autoSync: { ...job.autoSync, backend: "app" } }]);
        await h.sched.idle();
        expect(h.calls.at(-1)!.args).toEqual(["/Delete", "/TN", `\\rcloneGUI\\${ID}`, "/F"]);
        expect(h.sched.status().tasks).toEqual([]);
    });

    it("syncJobs: 연속 호출은 직렬화되고 마지막 목록으로 한 번만 반영한다", async () => {
        const h = f_Harness();
        await h.sched.reconcile([]);
        const base = h.calls.length;
        const job = f_OsJob(ID);
        h.sched.syncJobs([job]);
        h.sched.syncJobs([{ ...job, autoSync: { ...job.autoSync, intervalMinutes: 20 } }]);
        h.sched.syncJobs([{ ...job, autoSync: { ...job.autoSync, intervalMinutes: 25 } }]);
        await h.sched.idle();
        const creates = h.calls.slice(base).filter((c) => c.args[0] === "/Create");
        expect(creates).toHaveLength(1);
        expect(creates[0]!.file!.xml).toContain("<Interval>PT25M</Interval>");
    });

    it("삭제가 실패해도 이미 없으면 성공, 남아 있으면 오류를 남긴다", async () => {
        const job = f_OsJob(ID);
        const gone = f_Harness({ deleteCode: 1, queryOneCode: 1 });
        await gone.sched.reconcile([job]);
        gone.sched.syncJobs([]);
        await gone.sched.idle();
        expect(gone.sched.status().tasks).toEqual([]);
        const stuck = f_Harness({ deleteCode: 1, queryOneCode: 0 });
        await stuck.sched.reconcile([job]);
        stuck.sched.syncJobs([]);
        await stuck.sched.idle();
        expect(stuck.sched.status().tasks[0]).toMatchObject({ jobId: ID, registered: true });
        expect(stuck.sched.status().tasks[0]?.error).toMatch(/지우지 못했습니다\(exit 1\)/);
    });

    it("삭제 뒤 확인 /Query가 시간 초과·exit 1 아닌 코드면 지운 것으로 보지 않는다", async () => {
        const job = f_OsJob(ID);
        for (const code of [null, 5]) {
            const h = f_Harness({ deleteCode: 1, queryOneCode: code });
            await h.sched.reconcile([job]);
            h.sched.syncJobs([]);
            await h.sched.idle();
            expect(h.sched.status().tasks[0]).toMatchObject({ jobId: ID, registered: true });
            expect(h.sched.status().tasks[0]?.error).toMatch(/지우지 못했습니다/);
        }
    });

    it("등록 실패한 같은 spec은 syncJobs에서 다시 시도하지 않고, spec이 바뀌거나 reconcile이면 다시 시도한다", async () => {
        const h = f_Harness({ createCode: 5 });
        const job = f_OsJob(ID);
        await h.sched.reconcile([job]);
        const creates = () => h.calls.filter((c) => c.args[0] === "/Create").length;
        expect(creates()).toBe(1);
        // 예약 기록만 바뀐 onChange·같은 spec 재저장: 다시 시도하지 않고 실패 상태 유지
        h.sched.syncJobs([
            { ...job, autoSync: { ...job.autoSync, lastAutoRunAt: NOW.toISOString() } },
        ]);
        h.sched.syncJobs([job]);
        await h.sched.idle();
        expect(creates()).toBe(1);
        expect(h.sched.status().tasks[0]).toMatchObject({
            registered: false,
            error: registerFailText(5),
        });
        // spec이 바뀌면 다시 시도
        const changed = { ...job, autoSync: { ...job.autoSync, intervalMinutes: 45 } };
        h.sched.syncJobs([changed]);
        await h.sched.idle();
        expect(creates()).toBe(2);
        // 앱 시작(reconcile)은 다시 시도
        await h.sched.reconcile([changed]);
        expect(creates()).toBe(3);
    });

    it("목록 조회가 실패하면 아무것도 지우거나 등록하지 않는다", async () => {
        const h = f_Harness();
        const sched = new clsOsScheduler({
            exec: f_Failing,
            userDataDir: h.userData,
            execPath: EXE,
            availability: { available: true, reason: null },
            logger: { info: () => undefined, warn: () => undefined },
        });
        await sched.reconcile([f_OsJob(ID)]);
        expect(sched.status().tasks).toEqual([]);
    });
});
