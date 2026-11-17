/**
 * 파일 내용 비교용 읽기 서비스 단위 테스트 (INT-009 AC-4·8·10·12).
 * 가짜 runner로 cat 호출 횟수·인자를 확인하고, 바이트 판정(크기·바이너리·잘림·인코딩)을 고정한다.
 * 실제 사용자 경로나 rclone.conf 내용은 쓰지 않는다(모두 가짜 경로·바이트).
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    clsProcessSpawnError,
    type itfProcessResult,
    type typRunRclone,
} from "@/main/rclone/process";
import {
    BINARY_SNIFF_BYTES,
    clsFileDiffService,
    FILE_DIFF_MAX_BYTES,
    type itfFileDiffServiceDeps,
} from "@/main/services/file-diff-service";
import { createDefaultSettings } from "@/shared/defaults";
import type { typJob } from "@/shared/schemas/job";
import { splitLines } from "@/shared/text-diff";
import type { itfCompareResult, itfDiffEntry } from "@/shared/types/compare";
import type { typFileSideState } from "@/shared/types/file-diff";

const BIN = "C:\\fake\\rclone.exe";
const CONF = "C:\\fake\\rclone.conf";
const SRC = "C:\\fake\\src";
const DST = "C:\\fake\\dst";
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-11-17T00:00:00.000Z";

function f_Job(): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: JOB_ID,
        name: "작업",
        notes: "",
        source: SRC,
        destination: DST,
        mode: "sync",
        scope: "files",
        excludes: [...excludes],
        excludePatternIds: [],
        options,
        configPathOverride: null,
        backupDir: null,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            kind: "interval",
            timeOfDay: "09:00",
            weekdays: 62,
            backend: "app",
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 0,
        createdAt: NOW,
        updatedAt: NOW,
        groupId: null,
        lastRun: null,
    };
}

function f_Entry(over: Partial<itfDiffEntry> = {}): itfDiffEntry {
    return {
        path: "a.txt",
        status: "modified",
        reasons: ["size"],
        source: { path: "a.txt", size: 5, modTimeMs: 0 },
        dest: { path: "a.txt", size: 5, modTimeMs: 0 },
        caseOnly: false,
        hashAlgo: null,
        hashUnavailable: false,
        ...over,
    };
}

function f_Result(entries: itfDiffEntry[]): itfCompareResult {
    return {
        jobId: JOB_ID,
        jobRev: 0,
        createdAt: NOW,
        durationMs: 1,
        mode: "sync",
        scope: "files",
        method: { checkHashes: false, modtimeToleranceMs: 1000, caseInsensitive: false },
        destMissing: false,
        destCanHaveEmptyDirs: true,
        summary: {
            sourceFiles: entries.length,
            destFiles: entries.length,
            createFiles: 0,
            updateFiles: 0,
            deleteFiles: 0,
            sameFiles: 0,
            conflictFiles: 0,
            conflictGroups: 0,
            createBytes: 0,
            updateBytes: 0,
            deleteBytes: 0,
            transferBytes: 0,
            caseOnlyFiles: 0,
            hashComparedFiles: 0,
            hashUnavailableFiles: 0,
            createDirs: 0,
            deleteDirs: 0,
        },
        entries,
        dirChanges: [],
        warnings: [],
        planToken: "token",
        excludeHash: "hash",
    };
}

function f_Res(bytes: Buffer, over: Partial<itfProcessResult> = {}): itfProcessResult {
    return {
        exitCode: 0,
        signal: null,
        stdout: bytes.toString("utf8"),
        stdoutBytes: bytes,
        stdoutTruncated: false,
        stderrTail: "",
        timedOut: false,
        canceled: false,
        durationMs: 1,
        closed: true,
        ...over,
    };
}

interface itfRunner {
    run: typRunRclone;
    /** cat에 넘긴 경로(요청 순서) */
    calls: string[];
}

/** 경로별 응답을 정하는 가짜 runner. Error를 돌려주면 그대로 던진다 */
function f_Runner(fn: (path: string) => itfProcessResult | Error): itfRunner {
    const calls: string[] = [];
    const run: typRunRclone = async (_bin, args) => {
        const path = args[args.length - 1]!;
        calls.push(path);
        const r = fn(path);
        if (r instanceof Error) throw r;
        return r;
    };
    return { run, calls };
}

function f_Deps(o: {
    result: itfCompareResult | null;
    run: typRunRclone;
    /** 호출마다 결과를 바꿀 때(rev 변경 흉내) */
    getOverride?: () => itfCompareResult | null;
}): itfFileDiffServiceDeps {
    return {
        jobs: { get: () => f_Job() },
        settings: { get: () => createDefaultSettings() },
        rcloneEnv: {
            require: async () => ({ binaryPath: BIN, configPath: CONF }),
            resolveConfigFor: async () => CONF,
            listRemotesAt: async () => [],
        },
        excludes: { patternsFor: () => [] },
        compare: { get: o.getOverride ?? (() => o.result) },
        run: o.run,
    };
}

/** 양쪽 모두 같은 바이트를 돌려주는 runner */
function f_SameBytes(bytes: Buffer): itfRunner {
    return f_Runner(() => f_Res(bytes));
}

describe("clsFileDiffService", () => {
    it("상한을 넘는 쪽은 cat을 실행하지 않고 tooLarge (AC-4)", async () => {
        const h = f_SameBytes(Buffer.from("x"));
        const big = FILE_DIFF_MAX_BYTES + 1;
        const deps = f_Deps({
            result: f_Result([
                f_Entry({
                    source: { path: "a.txt", size: big, modTimeMs: 0 },
                    dest: { path: "a.txt", size: 3, modTimeMs: 0 },
                }),
            ]),
            run: h.run,
        });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(data.source).toEqual({
            kind: "tooLarge",
            size: big,
            limit: FILE_DIFF_MAX_BYTES,
            truncated: false,
        });
        expect(data.dest).toMatchObject({ kind: "text" });
        // 큰 쪽은 부르지 않는다 → 작은 쪽 한 번만
        expect(h.calls).toEqual([`${DST}\\a.txt`]);
    });

    it("앞쪽에 NUL이 있으면 binary로 보고 내용을 보내지 않는다 (AC-4)", async () => {
        const h = f_SameBytes(Buffer.from([0x41, 0x00, 0x42]));
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(data.source).toEqual({ kind: "binary", size: 5 });
        expect(data.dest).toEqual({ kind: "binary", size: 5 });
        expect(h.calls).toHaveLength(2);
    });

    it("상한 뒤로는 NUL이 있어도 바이너리로 보지 않는다", async () => {
        const bytes = Buffer.alloc(BINARY_SNIFF_BYTES + 1, 0x41);
        bytes[BINARY_SNIFF_BYTES] = 0;
        const h = f_SameBytes(bytes);
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(data.source.kind).toBe("text");
    });

    it("잘림(stdoutTruncated)이면 tooLarge(truncated) (AC-4)", async () => {
        const bytes = Buffer.alloc(FILE_DIFF_MAX_BYTES + 1, 0x41);
        const h = f_Runner(() => f_Res(bytes, { stdoutTruncated: true }));
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(data.source).toEqual({
            kind: "tooLarge",
            size: FILE_DIFF_MAX_BYTES + 1,
            limit: FILE_DIFF_MAX_BYTES,
            truncated: true,
        });
    });

    it("읽은 길이가 상한을 넘으면 잘리지 않았어도 tooLarge (AC-4)", async () => {
        const bytes = Buffer.alloc(FILE_DIFF_MAX_BYTES + 1, 0x41);
        const h = f_SameBytes(bytes);
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(data.source).toMatchObject({ kind: "tooLarge", truncated: true });
    });

    it("캐시 결과가 없으면 PLAN_STALE, runner 호출 0회 (AC-8·12)", async () => {
        const h = f_SameBytes(Buffer.from("x"));
        const deps = f_Deps({ result: null, run: h.run });
        await expect(new clsFileDiffService(deps).diff(JOB_ID, "a.txt")).rejects.toMatchObject({
            code: "PLAN_STALE",
        });
        expect(h.calls).toHaveLength(0);
    });

    it("비교 뒤 rev가 바뀌어 get이 null이 되면 PLAN_STALE (AC-12)", async () => {
        const h = f_SameBytes(Buffer.from("x"));
        const result = f_Result([f_Entry()]);
        let valid: itfCompareResult | null = result;
        const svc = new clsFileDiffService(
            f_Deps({ result, run: h.run, getOverride: () => valid }),
        );
        await expect(svc.diff(JOB_ID, "a.txt")).resolves.toMatchObject({ status: "modified" });

        valid = null; // 작업 rev 변경 → compare.get이 결과를 버린다
        const before = h.calls.length;
        await expect(svc.diff(JOB_ID, "a.txt")).rejects.toMatchObject({ code: "PLAN_STALE" });
        expect(h.calls).toHaveLength(before);
    });

    it("캐시에 없는 경로는 NOT_FOUND, runner 호출 0회 (AC-8)", async () => {
        const h = f_SameBytes(Buffer.from("x"));
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        await expect(new clsFileDiffService(deps).diff(JOB_ID, "other.txt")).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
        expect(h.calls).toHaveLength(0);
    });

    it("equal·typeConflict 항목은 VALIDATION, runner 호출 0회 (AC-8)", async () => {
        const h = f_SameBytes(Buffer.from("x"));
        for (const status of ["equal", "typeConflict"] as const) {
            const deps = f_Deps({
                result: f_Result([f_Entry({ status, source: null, dest: null })]),
                run: h.run,
            });
            await expect(new clsFileDiffService(deps).diff(JOB_ID, "a.txt")).rejects.toMatchObject({
                code: "VALIDATION",
            });
        }
        expect(h.calls).toHaveLength(0);
    });

    it("CRLF/LF만 다른 두 쪽은 둘 다 text이고 줄 내용이 같다 (AC-10)", async () => {
        const h = f_Runner((path) =>
            f_Res(Buffer.from(path.startsWith(SRC) ? "가\r\n나\r\n" : "가\n나\n")),
        );
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        if (data.source.kind !== "text" || data.dest.kind !== "text") throw new Error("text 아님");
        expect(data.source.bom).toBe(false);
        expect(data.dest.bom).toBe(false);
        expect(splitLines(data.source.text)).toEqual(splitLines(data.dest.text));
        expect(data.source.text).not.toBe(data.dest.text);
    });

    it("BOM 유무만 다르면 둘 다 text이고 BOM만 다르다 (AC-10)", async () => {
        const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("가\n")]);
        const h = f_Runner((path) => f_Res(path.startsWith(SRC) ? withBom : Buffer.from("가\n")));
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        if (data.source.kind !== "text" || data.dest.kind !== "text") throw new Error("text 아님");
        expect(data.source.bom).toBe(true);
        expect(data.dest.bom).toBe(false);
        expect(data.source.text).toBe(data.dest.text);
    });

    it("UTF-8이 아닌 CP949 바이트는 euc-kr로 다시 읽는다 (Q-1)", async () => {
        // "한글"의 CP949 바이트
        const cp949 = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]);
        const h = f_SameBytes(cp949);
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(data.source).toEqual({
            kind: "text",
            text: "한글",
            encoding: "euc-kr",
            bom: false,
            size: 5,
        });
    });

    it("한쪽에만 있는 파일은 없는 쪽이 absent (FR-3·FR-9)", async () => {
        const h = f_SameBytes(Buffer.from("hello"));
        const deps = f_Deps({
            result: f_Result([
                f_Entry({
                    path: "sub/b.txt",
                    status: "onlyDest",
                    source: null,
                    dest: { path: "sub/b.txt", size: 5, modTimeMs: 0 },
                }),
            ]),
            run: h.run,
        });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "sub/b.txt");
        expect(data.source).toEqual({ kind: "absent" });
        expect(data.dest).toMatchObject({ kind: "text" });
        expect(h.calls).toEqual([`${DST}\\sub\\b.txt`]);
    });

    it("renderer가 보낸 경로는 파일 경로로 쓰지 않고 항목의 상대 경로만 쓴다 (NFR-5)", async () => {
        const h = f_SameBytes(Buffer.from("x"));
        const deps = f_Deps({
            result: f_Result([
                f_Entry({
                    path: "a.txt",
                    source: { path: "src-dir/a.txt", size: 1, modTimeMs: 0 },
                    dest: { path: "dst-dir/a.txt", size: 1, modTimeMs: 0 },
                }),
            ]),
            run: h.run,
        });
        await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(h.calls).toEqual([`${SRC}\\src-dir\\a.txt`, `${DST}\\dst-dir\\a.txt`]);
    });

    it("cat이 실패하면 그 쪽 error로 담고 경로·stderr 원문은 넣지 않는다 (FR-10·NFR-3)", async () => {
        const stderr =
            "2026/11/17 23:00:00 ERROR : open C:\\Users\\somebody\\secret.txt: Access is denied";
        const h = f_Runner((path) =>
            path.startsWith(SRC)
                ? f_Res(Buffer.alloc(0), { exitCode: 3, stderrTail: stderr })
                : f_Res(Buffer.from("ok")),
        );
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        const source = data.source as Extract<typFileSideState, { kind: "error" }>;
        expect(source.kind).toBe("error");
        expect(source.message).toContain("원본 파일을 읽지 못함");
        expect(source.message).not.toContain("secret.txt");
        expect(source.message).not.toContain("Users");
        expect(data.dest).toMatchObject({ kind: "text", text: "ok" });
    });

    it("시간 초과는 그 쪽 error (FR-10)", async () => {
        const h = f_Runner(() => f_Res(Buffer.alloc(0), { timedOut: true }));
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(data.source).toEqual({
            kind: "error",
            message: "파일을 읽는 시간 제한(60초)을 넘었습니다.",
        });
    });

    it("rclone 실행 파일이 없으면 전체 RCLONE_NOT_FOUND (FR-3 예외표)", async () => {
        const h = f_Runner(() => new clsProcessSpawnError("ENOENT", "없음"));
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        await expect(new clsFileDiffService(deps).diff(JOB_ID, "a.txt")).rejects.toMatchObject({
            code: "RCLONE_NOT_FOUND",
        });
    });

    it("실행 파일 권한 문제는 RCLONE_NOT_EXECUTABLE (FR-3 예외표)", async () => {
        const h = f_Runner(() => new clsProcessSpawnError("EACCES", "권한"));
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        await expect(new clsFileDiffService(deps).diff(JOB_ID, "a.txt")).rejects.toMatchObject({
            code: "RCLONE_NOT_EXECUTABLE",
        });
    });

    it("0바이트 파일은 빈 텍스트로 돌려준다", async () => {
        const h = f_SameBytes(Buffer.alloc(0));
        const deps = f_Deps({
            result: f_Result([
                f_Entry({
                    status: "onlySource",
                    dest: null,
                    source: { path: "a.txt", size: 0, modTimeMs: 0 },
                }),
            ]),
            run: h.run,
        });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(data.source).toMatchObject({ kind: "text", text: "", encoding: "utf-8" });
        expect(data.dest).toEqual({ kind: "absent" });
    });

    it("응답에 요청 path·상태·작업 모드를 담는다", async () => {
        const h = f_SameBytes(Buffer.from("x"));
        const deps = f_Deps({ result: f_Result([f_Entry()]), run: h.run });
        const data = await new clsFileDiffService(deps).diff(JOB_ID, "a.txt");
        expect(data).toMatchObject({ path: "a.txt", status: "modified", mode: "sync" });
    });
});
