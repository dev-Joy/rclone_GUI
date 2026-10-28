// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import {
    clsProcessSpawnError,
    type itfProcessResult,
    type itfRunProcessOptions,
    type typRunRclone,
} from "@/main/rclone/process";
import { clsActivityLock } from "@/main/services/activity-lock";
import { clsCompareService, type itfCompareServiceDeps } from "@/main/services/compare-service";
import { createDefaultSettings } from "@/shared/defaults";
import type { itfPathProbe } from "@/shared/ipc-contract";
import type { typJob } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";
import type { itfCompareProgress } from "@/shared/types/compare";
import { readFixture } from "./fixtures";

const BIN = "C:\\fake\\rclone.exe";
const CONF = "C:\\fake\\rclone.conf";
const SRC = "C:\\fake\\src";
const DST = "C:\\fake\\dst";
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const JOB2_ID = "00000000-0000-4000-8000-000000000002";
const T0 = Date.parse("2026-10-28T00:00:00.000Z");

function f_Job(over: Partial<typJob> = {}): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: JOB_ID,
        name: "작업1",
        notes: "",
        source: SRC,
        destination: DST,
        mode: "sync",
        excludes: [...excludes],
        options,
        configPathOverride: null,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 0,
        createdAt: "2026-10-28T00:00:00.000Z",
        updatedAt: "2026-10-28T00:00:00.000Z",
        lastRun: null,
        ...over,
    };
}

function f_Res(over: Partial<itfProcessResult> = {}): itfProcessResult {
    return {
        exitCode: 0,
        signal: null,
        stdout: "",
        stdoutBytes: Buffer.alloc(0),
        stdoutTruncated: false,
        stderrTail: "",
        timedOut: false,
        canceled: false,
        durationMs: 1,
        closed: true,
        ...over,
    };
}

/** lsjson 한 줄 */
function f_Item(path: string, size: number, modMs: number, hashes?: Record<string, string>) {
    const name = path.split("/").at(-1);
    return JSON.stringify({
        Path: path,
        Name: name,
        Size: size,
        ModTime: new Date(modMs).toISOString(),
        IsDir: false,
        ...(hashes ? { Hashes: hashes } : {}),
    });
}

function f_Lines(items: string[]): string[] {
    return ["[", ...items.map((x, i) => (i < items.length - 1 ? `${x},` : x)), "]"];
}

interface itfProc {
    path: string;
    args: string[];
    opts: Omit<itfRunProcessOptions, "env">;
    aborted: boolean;
    finish: (lines: string[], over?: Partial<itfProcessResult>) => void;
}

type typScript = (path: string) => { lines: string[]; over?: Partial<itfProcessResult> };

function f_Probe(path: string, over: Partial<itfPathProbe> = {}): itfPathProbe {
    return {
        kind: path.includes(":\\") ? "local" : "remote",
        displayPath: path,
        normalizedPath: path,
        exists: true,
        isDirectory: true,
        readable: path.includes(":\\") ? true : null,
        isRoot: false,
        message: "폴더가 있습니다.",
        warnings: [],
        ...over,
    };
}

interface itfHarnessOptions {
    jobs?: typJob[];
    /** null이면 프로세스를 직접 끝낸다(procs[i].finish) */
    script?: typScript | null;
    probes?: Record<string, Partial<itfPathProbe>>;
    configPath?: string | null;
    spawnError?: string;
}

function f_Harness(o: itfHarnessOptions = {}) {
    const jobs = new Map((o.jobs ?? [f_Job()]).map((j) => [j.id, j]));
    const settings: { value: typSettings } = { value: createDefaultSettings() };
    const procs: itfProc[] = [];
    const events: itfCompareProgress[] = [];
    const logs: string[] = [];
    const probed: string[] = [];
    let nowMs = T0;
    const defaultScript: typScript = (path) =>
        path === SRC
            ? { lines: f_Lines([f_Item("a.txt", 1, T0), f_Item("same.txt", 2, T0)]) }
            : { lines: f_Lines([f_Item("same.txt", 2, T0), f_Item("old.txt", 3, T0)]) };
    const script = o.script === undefined ? defaultScript : o.script;

    const run: typRunRclone = (_bin, args, opts) =>
        new Promise((resolve, reject) => {
            if (o.spawnError) {
                reject(new clsProcessSpawnError(o.spawnError, "spawn"));
                return;
            }
            const proc: itfProc = {
                path: args.at(-1)!,
                args: [...args],
                opts,
                aborted: false,
                finish: (lines, over = {}) => {
                    for (const line of lines) opts.onStdoutLine?.(line);
                    resolve(f_Res(over));
                },
            };
            opts.signal?.addEventListener("abort", () => {
                proc.aborted = true;
                resolve(f_Res({ canceled: true, exitCode: null }));
            });
            procs.push(proc);
            if (script) {
                const s = script(proc.path);
                setTimeout(() => proc.finish(s.lines, s.over), 0);
            }
        });

    const deps: itfCompareServiceDeps = {
        jobs: {
            get: (id) => {
                const j = jobs.get(id);
                if (!j) throw new clsAppError("NOT_FOUND", "작업을 찾을 수 없습니다.");
                return j;
            },
        },
        settings: { get: () => settings.value },
        rcloneEnv: {
            require: async () => ({ binaryPath: BIN, configPath: CONF }),
            resolveConfigFor: async (c) => c ?? (o.configPath === undefined ? CONF : o.configPath),
        },
        pathService: {
            probe: async ({ path }) => {
                probed.push(path);
                return f_Probe(path, o.probes?.[path]);
            },
        },
        activity: new clsActivityLock(),
        logger: {
            info: (m) => logs.push(m),
            warn: (m) => logs.push(m),
        },
        run,
        now: () => new Date(nowMs),
        emit: (e) => events.push(e),
        progressIntervalMs: 0,
    };
    const svc = new clsCompareService(deps);
    return {
        svc,
        deps,
        jobs,
        settings,
        procs,
        events,
        logs,
        probed,
        setNow: (ms: number) => {
            nowMs = ms;
        },
        /** 프로세스가 n개 시작될 때까지 기다린다 */
        waitProcs: async (n: number) => {
            for (let i = 0; i < 100 && procs.length < n; i += 1) {
                await new Promise((r) => setTimeout(r, 1));
            }
            expect(procs.length).toBe(n);
        },
    };
}

async function f_Err(p: Promise<unknown>): Promise<clsAppError> {
    const e = await p.then(
        () => null,
        (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(clsAppError);
    return e as clsAppError;
}

describe("clsCompareService.run 정상", () => {
    it("요약·entries·planToken·method·mode, 캐시 저장, 이벤트 순서", async () => {
        const h = f_Harness();
        const r = await h.svc.run(JOB_ID);
        expect(r.summary).toMatchObject({
            sourceFiles: 2,
            destFiles: 2,
            createFiles: 1,
            deleteFiles: 1,
            sameFiles: 1,
        });
        expect(r.entries.map((e) => `${e.status}:${e.path}`)).toEqual([
            "onlySource:a.txt",
            "onlyDest:old.txt",
            "equal:same.txt",
        ]);
        expect(r.planToken).toMatch(/^[0-9a-f]{32}$/);
        expect(r).toMatchObject({
            jobId: JOB_ID,
            jobRev: 0,
            mode: "sync",
            destMissing: false,
            method: { checkHashes: false, modtimeToleranceMs: 2000, caseInsensitive: true },
        });
        expect(h.svc.get(JOB_ID)).toBe(r);
        const phases = h.events.map((e) => e.phase);
        expect(phases[0]).toBe("check");
        expect(phases.at(-1)).toBe("done");
        expect(phases.indexOf("list")).toBeLessThan(phases.indexOf("diff"));
        expect(h.svc.getActive()).toBeNull();
    });

    it("lsjson 인자: 정규화 경로·설정 파일·--ask-password=false, 해시 OFF면 hash-type 없음", async () => {
        const h = f_Harness();
        await h.svc.run(JOB_ID);
        const args = h.procs[0]!.args;
        expect(args).toContain("--ask-password=false");
        expect(args).toContain(CONF);
        expect(args).not.toContain("--hash");
        expect(h.procs[0]!.opts.collectStdout).toBe(false);
    });

    it("원본·대상 lsjson은 둘 다 시작된 뒤에 끝난다(병렬)", async () => {
        const h = f_Harness({ script: null });
        const pending = h.svc.run(JOB_ID);
        await h.waitProcs(2);
        expect(h.procs.map((p) => p.path).toSorted()).toEqual([DST, SRC].toSorted());
        h.procs[1]!.finish(f_Lines([]));
        h.procs[0]!.finish(f_Lines([]));
        expect((await pending).summary.sourceFiles).toBe(0);
    });

    it("진행 이벤트(list)에 받은 파일 수가 실린다", async () => {
        const h = f_Harness();
        await h.svc.run(JOB_ID);
        const lastList = h.events.filter((e) => e.phase === "list").at(-1)!;
        expect(lastList.sourceFiles + lastList.destFiles).toBeGreaterThan(0);
    });

    it("실제 fixture 줄(lsjson-src-hashtype)과 해시 비교, hash-type 인자", async () => {
        const fixture = readFixture("lsjson-src-hashtype", "stdout").split(/\r?\n/);
        const h = f_Harness({
            jobs: [f_Job({ options: { ...f_Job().options, checkHashes: true }, mode: "copy" })],
            script: () => ({ lines: fixture }),
        });
        const r = await h.svc.run(JOB_ID);
        expect(h.procs[0]!.args.join(" ")).toContain("--hash --hash-type md5 --hash-type sha1");
        expect(r.summary.sameFiles).toBe(5);
        expect(r.summary.hashComparedFiles).toBe(5);
        expect(r.entries[0]!.hashAlgo).toBe("sha1");
    });

    it("수정시간 허용오차 2초: 1.9초 동일, 2.1초 변경", async () => {
        const h = f_Harness({
            script: (path) =>
                path === SRC
                    ? { lines: f_Lines([f_Item("a", 1, T0), f_Item("b", 1, T0)]) }
                    : { lines: f_Lines([f_Item("a", 1, T0 + 1900), f_Item("b", 1, T0 + 2100)]) },
        });
        const r = await h.svc.run(JOB_ID);
        expect(r.entries.map((e) => e.status)).toEqual(["equal", "modified"]);
        expect(r.entries[1]!.reasons).toEqual(["mtime"]);
    });

    it("로그에는 경로·파일 이름을 남기지 않는다", async () => {
        const h = f_Harness();
        await h.svc.run(JOB_ID);
        await f_Err(h.svc.run("00000000-0000-4000-8000-000000000009"));
        h.jobs.set(JOB_ID, f_Job({ source: "x:folder" }));
        await f_Err(h.svc.run(JOB_ID));
        expect(h.logs.length).toBeGreaterThan(0);
        for (const line of h.logs) {
            expect(line).not.toMatch(/fake|a\.txt|same\.txt|folder/);
        }
    });
});

describe("clsCompareService 락·취소", () => {
    it("진행 중 두 번째 run(같은·다른 작업) → BUSY, 끝나면 락 해제", async () => {
        const h = f_Harness({
            jobs: [f_Job(), f_Job({ id: JOB2_ID, name: "작업2", source: "C:\\fake\\s2" })],
            script: null,
        });
        const first = h.svc.run(JOB_ID);
        const busy1 = await f_Err(h.svc.run(JOB_ID));
        const busy2 = await f_Err(h.svc.run(JOB2_ID));
        expect(busy1.code).toBe("BUSY");
        expect(busy2.message).toContain("‘작업1’ 작업을 비교하는 중입니다");
        await h.waitProcs(2);
        for (const p of h.procs) p.finish(f_Lines([]));
        await first;
        expect(h.deps.activity.current()).toBeNull();
    });

    it("실패해도 락을 해제한다", async () => {
        const h = f_Harness({ script: () => ({ lines: [], over: { exitCode: 1 } }) });
        await f_Err(h.svc.run(JOB_ID));
        expect(h.deps.activity.current()).toBeNull();
        expect(h.svc.getActive()).toBeNull();
    });

    it("cancel → 두 프로세스 abort, CANCELED, 이전 캐시 삭제, canceled 이벤트, 중복 호출 안전", async () => {
        const h = f_Harness({ script: null });
        const ok = h.svc.run(JOB_ID);
        await h.waitProcs(2);
        for (const p of h.procs) p.finish(f_Lines([]));
        await ok;
        expect(h.svc.get(JOB_ID)).not.toBeNull();

        const pending = h.svc.run(JOB_ID);
        await h.waitProcs(4);
        expect(h.svc.getActive()).toMatchObject({ jobId: JOB_ID, phase: "list" });
        h.svc.cancel(JOB2_ID);
        expect(h.procs[2]!.aborted).toBe(false);
        h.svc.cancel(JOB_ID);
        h.svc.cancel(JOB_ID);
        const err = await f_Err(pending);
        expect(err.code).toBe("CANCELED");
        expect(h.procs[2]!.aborted && h.procs[3]!.aborted).toBe(true);
        expect(h.svc.get(JOB_ID)).toBeNull();
        expect(h.events.at(-1)!.phase).toBe("canceled");
        expect(h.deps.activity.current()).toBeNull();
        h.svc.cancel(JOB_ID);
    });

    it("경로 확인 중 취소해도 lsjson을 시작하지 않는다", async () => {
        const h = f_Harness();
        const releases: Array<() => void> = [];
        h.deps.pathService.probe = async ({ path }) => {
            await new Promise<void>((r) => {
                releases.push(r);
            });
            return f_Probe(path);
        };
        const svc = new clsCompareService(h.deps);
        const pending = svc.run(JOB_ID);
        await new Promise((r) => setTimeout(r, 5));
        svc.cancel(JOB_ID);
        for (const r of releases) r();
        expect((await f_Err(pending)).code).toBe("CANCELED");
        expect(h.procs).toHaveLength(0);
    });
});

describe("clsCompareService 실패 판정", () => {
    it("exit 3 → PATH_NOT_FOUND, stdout 줄을 받았어도 결과 없음", async () => {
        const h = f_Harness({
            script: (path) =>
                path === DST
                    ? {
                          lines: ["["],
                          over: {
                              exitCode: 3,
                              stderrTail: readFixture("lsjson-missing", "stderr"),
                          },
                      }
                    : { lines: f_Lines([f_Item("a", 1, T0)]) },
        });
        const err = await f_Err(h.svc.run(JOB_ID));
        expect(err.code).toBe("PATH_NOT_FOUND");
        expect(err.message.startsWith("대상:")).toBe(true);
        expect(h.svc.get(JOB_ID)).toBeNull();
        expect(h.events.at(-1)!.phase).toBe("failed");
    });

    it("exit 1 → RCLONE_FAILED(stderr 요약 detail), 다른 쪽은 abort", async () => {
        const h = f_Harness({ script: null });
        const pending = h.svc.run(JOB_ID);
        await h.waitProcs(2);
        const src = h.procs.find((p) => p.path === SRC)!;
        const dst = h.procs.find((p) => p.path === DST)!;
        src.finish([], { exitCode: 1, stderrTail: "ERROR : something bad" });
        const err = await f_Err(pending);
        expect(err.code).toBe("RCLONE_FAILED");
        expect(err.message).toContain("원본 목록을 읽지 못했습니다(exit 1)");
        expect(err.detail).toContain("something bad");
        expect(dst.aborted).toBe(true);
    });

    it("시간 초과 → RCLONE_FAILED", async () => {
        const h = f_Harness({
            script: () => ({ lines: [], over: { timedOut: true, exitCode: null } }),
        });
        const err = await f_Err(h.svc.run(JOB_ID));
        expect(err.code).toBe("RCLONE_FAILED");
        expect(err.message).toContain("30분 안에 끝나지 않았습니다");
    });

    it("spawn ENOENT → RCLONE_NOT_FOUND, 그 외 → RCLONE_NOT_EXECUTABLE", async () => {
        expect((await f_Err(f_Harness({ spawnError: "ENOENT" }).svc.run(JOB_ID))).code).toBe(
            "RCLONE_NOT_FOUND",
        );
        expect((await f_Err(f_Harness({ spawnError: "EACCES" }).svc.run(JOB_ID))).code).toBe(
            "RCLONE_NOT_EXECUTABLE",
        );
    });

    it("깨진 줄 → RCLONE_PARSE_ERROR, 두 쪽 모두 종료", async () => {
        const h = f_Harness({ script: null });
        const pending = h.svc.run(JOB_ID);
        await h.waitProcs(2);
        const src = h.procs.find((p) => p.path === SRC)!;
        const dst = h.procs.find((p) => p.path === DST)!;
        src.opts.onStdoutLine?.("[");
        src.opts.onStdoutLine?.('{"Path":');
        const err = await f_Err(pending);
        expect(err.code).toBe("RCLONE_PARSE_ERROR");
        expect(dst.aborted && src.aborted).toBe(true);
    });

    it("대상 없음 → 원본만 lsjson, 전부 onlySource, destMissing·경고", async () => {
        const h = f_Harness({ probes: { [DST]: { exists: false, message: "경로가 없습니다." } } });
        const r = await h.svc.run(JOB_ID);
        expect(h.procs.map((p) => p.path)).toEqual([SRC]);
        expect(r.destMissing).toBe(true);
        expect(r.entries.every((e) => e.status === "onlySource")).toBe(true);
        expect(r.warnings).toContain("대상 폴더가 없습니다. 실행하면 새로 만듭니다.");
    });

    it("대상에 연결할 수 없음(없음이 아닌 이유) → PATH_NOT_FOUND", async () => {
        const h = f_Harness({
            probes: { [DST]: { exists: false, message: "응답이 없습니다(15초)." } },
        });
        expect((await f_Err(h.svc.run(JOB_ID))).message).toBe("대상: 응답이 없습니다(15초).");
        expect(h.procs).toHaveLength(0);
    });

    it.each<[string, Partial<itfPathProbe>, string]>([
        ["원본이 파일", { isDirectory: false, message: "파일입니다." }, "PATH_NOT_DIRECTORY"],
        ["원본 없음", { exists: false, isDirectory: false }, "PATH_NOT_FOUND"],
        ["원본 권한 없음", { readable: false }, "PATH_NOT_FOUND"],
        ["원본 열기 시간 초과", { readable: null, message: "응답이 없습니다" }, "PATH_NOT_FOUND"],
    ])("%s → %s, lsjson 미실행", async (_label, probe, code) => {
        const h = f_Harness({ probes: { [SRC]: probe } });
        const err = await f_Err(h.svc.run(JOB_ID));
        expect(err.code).toBe(code);
        expect(err.message.startsWith("원본:")).toBe(true);
        expect(h.procs).toHaveLength(0);
    });

    it("대상이 파일 → PATH_NOT_DIRECTORY", async () => {
        const h = f_Harness({ probes: { [DST]: { isDirectory: false, message: "파일입니다." } } });
        expect((await f_Err(h.svc.run(JOB_ID))).code).toBe("PATH_NOT_DIRECTORY");
    });

    it("x:folder → PATH_INVALID, 어떤 확인·프로세스도 실행 안 함", async () => {
        const h = f_Harness({ jobs: [f_Job({ destination: "x:folder" })] });
        const err = await f_Err(h.svc.run(JOB_ID));
        expect(err.code).toBe("PATH_INVALID");
        expect(err.message).toContain("대상: ‘x:folder’");
        expect(h.procs).toHaveLength(0);
        expect(h.probed).toHaveLength(0);
    });

    it("remote + 설정 파일 없음 → CONFIG_REQUIRED", async () => {
        const h = f_Harness({
            jobs: [f_Job({ destination: "test-remote:dst" })],
            configPath: null,
        });
        expect((await f_Err(h.svc.run(JOB_ID))).code).toBe("CONFIG_REQUIRED");
        expect(h.procs).toHaveLength(0);
    });

    it("probe 오류는 측 접두사를 붙여 전달", async () => {
        const h = f_Harness();
        h.deps.pathService.probe = async () => {
            throw new clsAppError("RCLONE_FAILED", "remote가 응답하지 않았습니다.");
        };
        const err = await f_Err(new clsCompareService(h.deps).run(JOB_ID));
        expect(err.message).toBe("원본: remote가 응답하지 않았습니다.");
    });

    it("CASE_COLLISION 문구", async () => {
        const h = f_Harness({
            script: (path) =>
                path === SRC
                    ? { lines: f_Lines([f_Item("A.txt", 1, T0), f_Item("a.txt", 1, T0)]) }
                    : { lines: f_Lines([]) },
        });
        const err = await f_Err(h.svc.run(JOB_ID));
        expect(err.code).toBe("CASE_COLLISION");
        expect(err.message).toBe("원본: ‘A.txt’와 ‘a.txt’가 대소문자만 달라 비교할 수 없습니다.");
    });

    it("빈 원본 + sync → 삭제 경고", async () => {
        const h = f_Harness({
            script: (path) => ({
                lines: path === SRC ? f_Lines([]) : f_Lines([f_Item("x", 1, T0)]),
            }),
        });
        const r = await h.svc.run(JOB_ID);
        expect(r.warnings.join("\n")).toContain("대상 파일이 모두 삭제 대상");
    });

    it("비교 중 작업 rev 변경·삭제 → PLAN_STALE, 캐시 없음", async () => {
        for (const mutate of ["rev", "delete"] as const) {
            const h = f_Harness({ script: null });
            const pending = h.svc.run(JOB_ID);
            await h.waitProcs(2);
            if (mutate === "rev") h.jobs.set(JOB_ID, f_Job({ rev: 1 }));
            else h.jobs.delete(JOB_ID);
            for (const p of h.procs) p.finish(f_Lines([]));
            const err = await f_Err(pending);
            expect(err.code).toBe("PLAN_STALE");
            expect(h.svc.get(JOB_ID)).toBeNull();
        }
    });
});

describe("clsCompareService 캐시·requirePlan", () => {
    it("get: rev 변경·설정(caseInsensitive/rclonePath/configPath) 변경 → null & 삭제", async () => {
        const changes: Array<(s: typSettings) => typSettings> = [
            (s) => ({ ...s, compare: { caseInsensitivePaths: false } }),
            (s) => ({ ...s, rclonePath: "C:\\fake\\other.exe" }),
            (s) => ({ ...s, configPath: "C:\\fake\\other.conf" }),
        ];
        for (const change of changes) {
            const h = f_Harness();
            await h.svc.run(JOB_ID);
            h.settings.value = change(h.settings.value);
            expect(h.svc.get(JOB_ID)).toBeNull();
            h.settings.value = createDefaultSettings();
            expect(h.svc.get(JOB_ID)).toBeNull();
        }
        const h = f_Harness();
        await h.svc.run(JOB_ID);
        h.jobs.set(JOB_ID, f_Job({ rev: 1 }));
        expect(h.svc.get(JOB_ID)).toBeNull();
        h.jobs.set(JOB_ID, f_Job({ rev: 0 }));
        expect(h.svc.get(JOB_ID)).toBeNull();
    });

    it("maxCached 초과 시 오래된 것부터 버린다", async () => {
        const ids = [1, 2, 3, 4].map((n) => `00000000-0000-4000-8000-00000000001${n}`);
        const h = f_Harness({
            jobs: ids.map((id, i) => f_Job({ id, source: `C:\\fake\\s${i}` })),
            script: () => ({ lines: f_Lines([]) }),
        });
        for (const id of ids) await h.svc.run(id);
        expect(h.svc.get(ids[0]!)).toBeNull();
        expect(ids.slice(1).every((id) => h.svc.get(id) !== null)).toBe(true);
    });

    it("requirePlan: 없음/토큰 불일치 → PLAN_REQUIRED, rev 변경·나이 초과 → PLAN_STALE", async () => {
        const h = f_Harness();
        expect(() => h.svc.requirePlan(JOB_ID, "x")).toThrow(
            expect.objectContaining({ code: "PLAN_REQUIRED" }),
        );
        const r = await h.svc.run(JOB_ID);
        expect(h.svc.requirePlan(JOB_ID, r.planToken)).toBe(r);
        expect(() => h.svc.requirePlan(JOB_ID, "0".repeat(32))).toThrow(
            expect.objectContaining({ code: "PLAN_REQUIRED" }),
        );
        h.setNow(T0 + 11 * 60_000);
        expect(() => h.svc.requirePlan(JOB_ID, r.planToken)).toThrow(
            expect.objectContaining({ code: "PLAN_STALE" }),
        );
        h.setNow(T0);
        h.jobs.set(JOB_ID, f_Job({ rev: 5 }));
        expect(() => h.svc.requirePlan(JOB_ID, r.planToken)).toThrow(
            expect.objectContaining({ code: "PLAN_STALE" }),
        );
        expect(h.svc.get(JOB_ID)).toBeNull();
    });

    it("invalidate는 결과를 지운다", async () => {
        const h = f_Harness();
        await h.svc.run(JOB_ID);
        h.svc.invalidate(JOB_ID);
        expect(h.svc.get(JOB_ID)).toBeNull();
    });
});
