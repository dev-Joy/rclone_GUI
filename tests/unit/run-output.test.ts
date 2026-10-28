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
import { fixtureLines, readFixture } from "./fixtures";

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

describe("실제 실행 fixture의 stats", () => {
    it("copy-real: transfers 3, errors 0, exit 0 → success", () => {
        const stats = f_LastStats("copy-real");
        expect(stats).toMatchObject({ transfers: 3, bytes: 24, errors: 0 });
        expect(readFixture("copy-real", "exit").trim()).toBe("0");
        expect(
            decideRunOutcome({ canceled: false, exitCode: 0, stats, errorLines: [], hint: null }),
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
