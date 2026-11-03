// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { normalizeStats, parseLogLine } from "@/main/parsers/log-parser";
import {
    createDryRunCollector,
    decideRunOutcome,
    parseTasklistCsv,
    type itfRunOutcomeInput,
} from "@/main/parsers/run-output";
import { checkPreflight } from "@/shared/run-plan";
import type { typRunPlan } from "@/shared/schemas/run";
import { fixtureLines, readFixture, readFixtureExitCode } from "./fixtures";

function f_Collect(name: string, limit?: number) {
    const c = createDryRunCollector(limit);
    for (const line of fixtureLines(name)) c.push(parseLogLine(line));
    return c.summary();
}

function f_LastStats(name: string) {
    const stats = fixtureLines(name)
        .map((l) => parseLogLine(l).stats)
        .filter((s) => s !== null);
    return stats.at(-1) ?? null;
}

describe("createDryRunCollector (fixture)", () => {
    it("copy dry-run: 복사 3(24 B), 시간만 맞춤 1(폴더 줄 제외), 삭제 0", () => {
        const s = f_Collect("copy-dryrun");
        expect(s).toMatchObject({
            copyFiles: 3,
            copyBytes: 24,
            touchFiles: 1,
            deleteFiles: 0,
            removeDirs: 0,
        });
        expect(s.copySamples.toSorted()).toEqual(["changed.txt", "sub/new.txt", "한글 파일.txt"]);
        expect(s.touchSamples).toEqual(["touch.txt"]);
    });

    it("sync dry-run: 삭제 2(8 B), 빈 폴더 정리 1", () => {
        const s = f_Collect("sync-dryrun");
        expect(s).toMatchObject({
            copyFiles: 3,
            touchFiles: 1,
            deleteFiles: 2,
            deleteBytes: 8,
            removeDirs: 1,
        });
        expect(s.deleteSamples.toSorted()).toEqual(["extra.txt", "gone/old.txt"]);
    });

    it("전체 범위 dry-run: 기존 폴더의 수정시간 줄(size 0)은 시간만 맞춤으로 세지 않는다 (INT-002 T-05)", () => {
        expect(f_Collect("scope-sync-all-dirsonly-dryrun")).toMatchObject({
            copyFiles: 1,
            touchFiles: 0,
            deleteFiles: 0,
            removeDirs: 3,
        });
        expect(f_Collect("scope-sync-all-dryrun")).toMatchObject({
            copyFiles: 1,
            touchFiles: 0,
            deleteFiles: 1,
            removeDirs: 4,
        });
    });

    it("샘플은 상한까지만 모으고 수는 모두 센다", () => {
        const s = f_Collect("copy-dryrun", 2);
        expect(s.copyFiles).toBe(3);
        expect(s.copySamples).toHaveLength(2);
    });

    it("실제 실행 로그(copy-real)에는 skipped가 없어 0", () => {
        const s = f_Collect("copy-real");
        expect(s.copyFiles + s.deleteFiles + s.touchFiles).toBe(0);
    });

    it("summary()는 복사본을 돌려준다", () => {
        const c = createDryRunCollector();
        const a = c.summary();
        a.copySamples.push("x");
        expect(c.summary().copySamples).toEqual([]);
    });
});

describe("--backup-dir dry-run (fixture, INT-003 FR-35)", () => {
    /** backup-both: 새 파일 1, 덮어쓰기 2 + 시간만 다름 1, 지울 파일 2(extra.txt, gone/old.txt) */
    const PLAN: typRunPlan = {
        sourceFiles: 5,
        destFiles: 6,
        createFiles: 1,
        updateFiles: 3,
        deleteFiles: 2,
        transferBytes: 32,
        deleteBytes: 8,
        conflictFiles: 0,
        caseOnlyFiles: 0,
        createDirs: 0,
        deleteDirs: 1,
    };

    it("삭제만: move into backup dir를 삭제로 센다(2개, 8 B)", () => {
        expect(f_Collect("backup-delonly-dryrun")).toMatchObject({
            copyFiles: 1,
            touchFiles: 1,
            deleteFiles: 2,
            deleteBytes: 8,
            removeDirs: 1,
        });
    });

    it("덮어쓰기만: move(덮어쓰기 이동)는 세지 않고 copy만 센다", () => {
        expect(f_Collect("backup-overonly-dryrun")).toMatchObject({
            copyFiles: 3,
            touchFiles: 1,
            deleteFiles: 0,
        });
    });

    it("AC-16: 삭제 + 덮어쓰기 → 수집기·stats 삭제 수 = 계획(2), 사전 확인 통과", () => {
        const s = f_Collect("backup-both-dryrun");
        expect(s).toMatchObject({ copyFiles: 3, touchFiles: 1, deleteFiles: 2 });
        expect(s.deleteSamples.toSorted()).toEqual(["extra.txt", "gone/old.txt"]);
        const stats = f_LastStats("backup-both-dryrun");
        expect(stats?.deletes).toBe(2);
        expect(checkPreflight(PLAN, s, stats)).toEqual({ ok: true, mismatches: [] });
    });

    it("회귀: move into backup dir를 삭제로 세지 않으면 사전 확인이 PLAN_DRIFT가 된다", () => {
        const c = createDryRunCollector();
        for (const line of fixtureLines("backup-both-dryrun")) {
            const p = parseLogLine(line);
            c.push(p.skipped === "delete" ? { ...p, skipped: "other" } : p);
        }
        expect(checkPreflight(PLAN, c.summary(), f_LastStats("backup-both-dryrun")).ok).toBe(false);
    });
});

describe("실제 실행 fixture의 stats", () => {
    it("copy-real: transfers 3, errors 0, exit 0 → success", () => {
        const stats = f_LastStats("copy-real");
        expect(stats).toMatchObject({ transfers: 3, bytes: 24, errors: 0 });
        expect(readFixture("copy-real", "exit").trim()).toBe("0");
        expect(
            decideRunOutcome({
                canceled: false,
                exitCode: 0,
                stats,
                errorLines: [],
                hint: null,
                stderrTail: "",
            }),
        ).toEqual({ status: "success", error: null });
    });

    it("copy-progress: 중간 stats 줄이 여러 번 오고 bytes가 늘어난다", () => {
        const all = fixtureLines("copy-progress")
            .map((l) => parseLogLine(l).stats)
            .filter((s) => s !== null);
        expect(all.length).toBeGreaterThanOrEqual(2);
        const bytes = all.map((s) => s.bytes);
        expect(bytes).toEqual(bytes.toSorted((a, b) => a - b));
        expect(all.at(-1)).toMatchObject({ bytes: 3 * 1024 * 1024, transfers: 3 });
        // 중간 stats의 transferring 같은 추가 키는 무시하고 정규화한다
        expect(normalizeStats({ bytes: 1, transferring: [{ name: "x" }] })?.bytes).toBe(1);
    });

    it("sync-maxdelete0: exit 7 → failed + MAX_DELETE_EXCEEDED, 오류 줄 detail", () => {
        const lines = fixtureLines("sync-maxdelete0").map((l) => parseLogLine(l));
        const errorLines = lines.filter((p) => p.level === "error").map((p) => p.message);
        const o = decideRunOutcome({
            canceled: false,
            exitCode: Number(readFixture("sync-maxdelete0", "exit").trim()),
            stats: f_LastStats("sync-maxdelete0"),
            errorLines: errorLines.slice(-5),
            hint: null,
            stderrTail: readFixture("sync-maxdelete0", "stderr"),
        });
        expect(o.status).toBe("failed");
        expect(o.error?.code).toBe("MAX_DELETE_EXCEEDED");
        expect(o.error?.detail).toContain("Fatal error received");
    });
});

describe("decideRunOutcome", () => {
    const base: itfRunOutcomeInput = {
        canceled: false,
        exitCode: 0,
        stats: null,
        errorLines: [],
        hint: null,
        stderrTail: "",
    };
    const stats = normalizeStats({ errors: 2 })!;

    it("취소가 가장 우선(exit 0·7이어도 canceled)", () => {
        for (const exitCode of [0, 7, null]) {
            const o = decideRunOutcome({ ...base, canceled: true, exitCode });
            expect(o.status).toBe("canceled");
            expect(o.error?.code).toBe("CANCELED");
            expect(o.error?.message).toContain("이미 복사된 파일은 대상에 남습니다");
        }
    });

    it("exit 3 → PATH_NOT_FOUND, exit 0 + 오류 → partial, 그 밖 → RCLONE_FAILED + 안내", () => {
        expect(decideRunOutcome({ ...base, exitCode: 3 }).error?.code).toBe("PATH_NOT_FOUND");
        const partial = decideRunOutcome({ ...base, stats });
        expect(partial.status).toBe("partial");
        expect(partial.error?.message).toContain("2건");
        const failed = decideRunOutcome({
            ...base,
            exitCode: 1,
            hint: "인증이 만료되었습니다.",
            errorLines: ["boom"],
        });
        expect(failed).toEqual({
            status: "failed",
            error: {
                code: "RCLONE_FAILED",
                message: "rclone이 오류로 끝났습니다(exit 1). 인증이 만료되었습니다.",
                detail: "boom",
            },
        });
        expect(decideRunOutcome({ ...base, exitCode: null }).error?.message).toContain(
            "알 수 없음",
        );
    });
});

describe("decideRunOutcome 외부 종료·충돌 (INT-005)", () => {
    const base: itfRunOutcomeInput = {
        canceled: false,
        exitCode: 0,
        stats: null,
        errorLines: [],
        hint: null,
        stderrTail: "",
    };

    it("AC-3: exit 4294967295·오류 줄 없음 → RCLONE_KILLED, 표기는 -1 (0xFFFFFFFF)", () => {
        const o = decideRunOutcome({ ...base, exitCode: 4294967295 });
        expect(o.status).toBe("failed");
        expect(o.error?.code).toBe("RCLONE_KILLED");
        expect(o.error?.message).toContain("-1 (0xFFFFFFFF)");
        expect(o.error?.message).toContain("오류 기록 없음");
        expect(o.error?.message).not.toContain("4294967295");
        expect(o.error?.detail).toBeUndefined();
    });

    it("AC-4: 외부 종료 코드 + 오류 줄 → RCLONE_FAILED, 표기는 -1 (0xFFFFFFFF)", () => {
        const o = decideRunOutcome({ ...base, exitCode: 4294967295, errorLines: ["boom"] });
        expect(o.status).toBe("failed");
        expect(o.error?.code).toBe("RCLONE_FAILED");
        expect(o.error?.message).toContain("-1 (0xFFFFFFFF)");
        expect(o.error?.detail).toBe("boom");
    });

    it("AC-5: exit 0xC0000005 → RCLONE_CRASHED, STATUS_ACCESS_VIOLATION", () => {
        const o = decideRunOutcome({ ...base, exitCode: 3221225477 });
        expect(o.status).toBe("failed");
        expect(o.error?.code).toBe("RCLONE_CRASHED");
        expect(o.error?.message).toContain("STATUS_ACCESS_VIOLATION");
        expect(o.error?.message).toContain("rclone이 비정상 종료했습니다");
    });

    it("AC-6: exit -1·오류 줄 없음이어도 stderr에 panic 줄이 있으면 RCLONE_CRASHED", () => {
        const o = decideRunOutcome({
            ...base,
            exitCode: -1,
            stderrTail: "panic: runtime error: invalid memory address\n\ngoroutine 1 [running]:\n",
        });
        expect(o.error?.code).toBe("RCLONE_CRASHED");
        expect(o.error?.message).toContain("-1 (0xFFFFFFFF)");
    });

    it("AC-7: 취소가 최우선, 표지 없는 exit 1은 RCLONE_FAILED(exit 1), 3·7·0은 기존 결과", () => {
        expect(decideRunOutcome({ ...base, canceled: true, exitCode: 1 }).error?.code).toBe(
            "CANCELED",
        );
        const failed = decideRunOutcome({
            ...base,
            exitCode: 1,
            stderrTail: '{"level":"info","msg":"Copied (new)"}',
        });
        expect(failed.error?.code).toBe("RCLONE_FAILED");
        expect(failed.error?.message).toContain("exit 1");
        expect(decideRunOutcome({ ...base, exitCode: 3 }).error?.code).toBe("PATH_NOT_FOUND");
        expect(decideRunOutcome({ ...base, exitCode: 7 }).error?.code).toBe("MAX_DELETE_EXCEEDED");
        expect(decideRunOutcome({ ...base, exitCode: 0 }).status).toBe("success");
    });

    it("AC-8: T-01 fixture 방식별 기대 분류", () => {
        /** 방식별 기대 분류(2026-11-03 실측, rclone-notes #58~#62) */
        const cases: Array<{ name: string; code: string | null; status: string }> = [
            { name: "kill-taskkill-f", code: "RCLONE_FAILED", status: "failed" },
            { name: "kill-taskkill-tf", code: "RCLONE_FAILED", status: "failed" },
            { name: "kill-stop-process", code: "RCLONE_KILLED", status: "failed" },
            { name: "kill-dotnet-kill", code: "RCLONE_KILLED", status: "failed" },
            // CIM Terminate(Reason 생략)는 exit 0이라 정상 종료와 구분할 수 없다(R-1)
            { name: "kill-cim-terminate", code: null, status: "success" },
            { name: "kill-ctrl-c", code: "RCLONE_KILLED", status: "failed" },
        ];
        for (const c of cases) {
            const errorLines = fixtureLines(c.name)
                .map((l) => parseLogLine(l))
                .filter((p) => p.level === "error")
                .map((p) => p.message);
            const o = decideRunOutcome({
                canceled: false,
                exitCode: readFixtureExitCode(c.name),
                stats: null,
                errorLines,
                hint: null,
                stderrTail: readFixture(c.name, "stderr"),
            });
            expect({ name: c.name, status: o.status, code: o.error?.code ?? null }).toEqual({
                name: c.name,
                status: c.status,
                code: c.code,
            });
        }
    });

    it("AC-15: exit 2 + Go 충돌 표지(합성)는 RCLONE_CRASHED, 표지 없으면 RCLONE_FAILED", () => {
        // 실제 Go 충돌 출력을 rclone에서 재현할 수 없어 Go 런타임 형식의 합성 문자열을 쓴다(R-5)
        for (const tail of [
            "fatal error: out of memory\n\nruntime stack:\n",
            "Exception 0xc0000005 0x0 0x1 0x2\n\tpc=0x1234\n",
        ]) {
            expect(decideRunOutcome({ ...base, exitCode: 2, stderrTail: tail }).error?.code).toBe(
                "RCLONE_CRASHED",
            );
        }
        expect(decideRunOutcome({ ...base, exitCode: 2, stderrTail: "" }).error?.code).toBe(
            "RCLONE_FAILED",
        );
    });

    it("AC-16: 0xC000013A는 외부 종료·충돌이 아니고(STATUS_CONTROL_C_EXIT), 0xC0000409는 충돌", () => {
        const controlC = decideRunOutcome({ ...base, exitCode: 3221225786 });
        expect(controlC.error?.code).toBe("RCLONE_FAILED");
        expect(controlC.error?.message).toContain("STATUS_CONTROL_C_EXIT");
        expect(decideRunOutcome({ ...base, exitCode: 3221226505 }).error?.code).toBe(
            "RCLONE_CRASHED",
        );
    });

    it("AC-17: exit 1 + 신호 표지 → RCLONE_KILLED(신호 문구), 취소는 CANCELED, 중간 문자열은 표지 아님", () => {
        const signalTail =
            '{"time":"2026-11-03T00:00:00Z","level":"info","msg":"Signal received: interrupt","source":"atexit/atexit.go:51"}\n' +
            '{"time":"2026-11-03T00:00:00Z","level":"info","msg":"Exiting...","source":"atexit/atexit.go:53"}\n';
        const o = decideRunOutcome({ ...base, exitCode: 1, stderrTail: signalTail });
        expect(o.status).toBe("failed");
        expect(o.error?.code).toBe("RCLONE_KILLED");
        expect(o.error?.message).toContain("중단 신호");
        expect(o.error?.message).toContain("종료 코드 1");
        expect(
            decideRunOutcome({ ...base, canceled: true, exitCode: 1, stderrTail: signalTail }).error
                ?.code,
        ).toBe("CANCELED");
        // JSON msg 중간에만 들어 있으면 표지가 아니다
        const middle = decideRunOutcome({
            ...base,
            exitCode: 1,
            stderrTail: '{"level":"info","msg":"seen Signal received: interrupt before"}',
        });
        expect(middle.error?.code).toBe("RCLONE_FAILED");
        // JSON이 아닌 줄(로그 메시지)에 같은 문자열이 있어도 신호 표지가 아니다
        expect(
            decideRunOutcome({
                ...base,
                exitCode: 1,
                stderrTail: "Signal received: interrupt",
            }).error?.code,
        ).toBe("RCLONE_FAILED");
    });

    it("E-8c: JSON 로그 메시지 안의 panic 문자열은 충돌 표지가 아니다", () => {
        const o = decideRunOutcome({
            ...base,
            exitCode: 2,
            stderrTail: '{"level":"error","msg":"panic: user text is not a Go panic"}',
        });
        expect(o.error?.code).toBe("RCLONE_FAILED");
    });

    it("hint는 외부 종료·충돌 문구 뒤에 한 칸 공백으로 붙는다", () => {
        const killed = decideRunOutcome({ ...base, exitCode: -1, hint: "안내입니다." });
        expect(killed.error?.message.endsWith(" 안내입니다.")).toBe(true);
        const crashed = decideRunOutcome({
            ...base,
            exitCode: 3221225477,
            hint: "안내입니다.",
        });
        expect(crashed.error?.message.endsWith(" 안내입니다.")).toBe(true);
    });
});

describe("parseTasklistCsv", () => {
    it("CSV 행을 읽는다(쉼표가 든 메모리 값 포함)", () => {
        const out = '"rclone.exe","1234","Console","1","12,345 K"\r\n';
        expect(parseTasklistCsv(out)).toEqual([{ imageName: "rclone.exe", pid: 1234 }]);
    });

    it("일치 없음 안내(영문·한국어)와 형식이 다른 줄은 무시한다", () => {
        expect(
            parseTasklistCsv("INFO: No tasks are running which match the specified criteria.\r\n"),
        ).toEqual([]);
        expect(
            parseTasklistCsv("정보: 지정된 조건에 일치하는 작업이 실행되고 있지 않습니다.\r\n"),
        ).toEqual([]);
        expect(parseTasklistCsv('"x.exe","abc"\n\n')).toEqual([]);
    });
});
