// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsLsjsonParseError, parseLsjsonOutput } from "@/main/parsers/lsjson-parser";
import { MAX_MESSAGE_LENGTH, normalizeStats, parseLogLine } from "@/main/parsers/log-parser";
import { fixtureLines, readFixture } from "./fixtures";

describe("parseLsjsonOutput (실제 rclone 1.75.1 출력)", () => {
    it("파일 목록과 수정시간(오프셋 포함 ISO)을 읽는다", () => {
        const files = parseLsjsonOutput(readFixture("lsjson-src", "stdout"));
        expect(files.map((f) => f.path).toSorted()).toEqual([
            "changed.txt",
            "same.txt",
            "sub/new.txt",
            "touch.txt",
            "한글 파일.txt",
        ]);
        const same = files.find((f) => f.path === "same.txt")!;
        expect(same).toEqual({
            path: "same.txt",
            size: 4,
            modTimeMs: Date.UTC(2026, 0, 1),
            hashes: null,
        });
    });

    it("--hash 출력의 해시를 소문자 키로 보관한다", () => {
        const files = parseLsjsonOutput(readFixture("lsjson-src-hash", "stdout"));
        expect(files.find((f) => f.path === "same.txt")!.hashes!.md5).toBe(
            "51037a4a37730f52c8732586d3aaa316",
        );
    });

    it("없는 경로: exit 3 + stdout '[' 는 파싱하면 실패한다 (호출 전에 exit code로 거른다)", () => {
        expect(readFixture("lsjson-missing", "exit").trim()).toBe("3");
        expect(() => parseLsjsonOutput(readFixture("lsjson-missing", "stdout"))).toThrow(
            clsLsjsonParseError,
        );
    });

    it.each([
        ["{}", "배열 아님"],
        ['[{"Path":"a","Size":"1","IsDir":false}]', "Size 문자열"],
        ['[{"Size":1,"IsDir":false}]', "Path 없음"],
    ])("비정형 %s (%s) 은 전체 실패", (text) => {
        expect(() => parseLsjsonOutput(text)).toThrow(clsLsjsonParseError);
    });

    it("폴더 항목은 건너뛰고 잘못된 ModTime은 null", () => {
        const files = parseLsjsonOutput(
            '[{"Path":"d","Size":-1,"IsDir":true},{"Path":"f","Size":1,"ModTime":"x","IsDir":false}]',
        );
        expect(files).toEqual([{ path: "f", size: 1, modTimeMs: null, hashes: null }]);
    });
});

describe("parseLogLine (실제 rclone 1.75.1 출력)", () => {
    it("sync dry-run: copy 3, delete 2, touch 2, removeDir 1과 최종 stats", () => {
        const parsed = fixtureLines("sync-dryrun").map(parseLogLine);
        const count = (k: string) => parsed.filter((p) => p.skipped === k).length;
        expect([count("copy"), count("delete"), count("touch"), count("removeDir")]).toEqual([
            3, 2, 2, 1,
        ]);
        expect(parsed.find((p) => p.skipped === "copy" && p.object === "한글 파일.txt")!.size).toBe(
            7,
        );
        const stats = parsed.filter((p) => p.stats).at(-1)!.stats!;
        expect(stats).toMatchObject({
            transfers: 3,
            deletes: 2,
            deletedDirs: 1,
            bytes: 24,
            errors: 0,
            fatalError: false,
            etaSeconds: null,
        });
    });

    it("copy dry-run에는 delete가 없다", () => {
        const parsed = fixtureLines("copy-dryrun").map(parseLogLine);
        expect(parsed.some((p) => p.skipped === "delete")).toBe(false);
        expect(parsed.filter((p) => p.skipped === "copy")).toHaveLength(3);
    });

    it("--max-delete 0 초과: exit 7, 오류 레벨, fatal stats", () => {
        expect(readFixture("sync-maxdelete0", "exit").trim()).toBe("7");
        const parsed = fixtureLines("sync-maxdelete0").map(parseLogLine);
        expect(parsed.filter((p) => p.level === "error").length).toBeGreaterThan(0);
        const stats = parsed.filter((p) => p.stats).at(-1)!.stats!;
        expect(stats).toMatchObject({
            deletes: 0,
            errors: 3,
            fatalError: true,
            lastError: "failed to delete 2 files",
        });
    });

    it("실제 sync: Copied/Deleted 이벤트와 stats", () => {
        const parsed = fixtureLines("sync-real").map(parseLogLine);
        expect(
            parsed
                .filter((p) => p.message === "Deleted")
                .map((p) => p.object)
                .toSorted(),
        ).toEqual(["extra.txt", "gone/old.txt"]);
        expect(parsed.filter((p) => p.stats).at(-1)!.stats).toMatchObject({
            transfers: 3,
            deletes: 2,
            errors: 0,
        });
    });

    it("비JSON 줄은 raw로 남기고 ERROR는 오류 레벨", () => {
        const [l1, l2] = fixtureLines("lsjson-missing").map(parseLogLine);
        expect(l1).toMatchObject({ raw: true, level: "error" });
        expect(l2).toMatchObject({ raw: true, level: "info" });
    });

    it.each(['{"level":"info","msg":"cut', "{not json", "[1,2]", "", "\r"])(
        "깨진 줄 %j 도 예외 없이 raw",
        (line) => {
            expect(parseLogLine(line).raw).toBe(true);
        },
    );

    it("알 수 없는 level은 info, warn은 warning", () => {
        expect(parseLogLine('{"level":"weird","msg":"x"}').level).toBe("info");
        expect(parseLogLine('{"level":"warn","msg":"x"}').level).toBe("warning");
        expect(parseLogLine('{"level":"critical","msg":"x"}').level).toBe("error");
    });

    it("긴 메시지는 8KB에서 자른다", () => {
        const msg = parseLogLine(
            JSON.stringify({ level: "info", msg: "a".repeat(MAX_MESSAGE_LENGTH + 10) }),
        ).message;
        expect(msg.length).toBe(MAX_MESSAGE_LENGTH + 1);
    });
});

describe("normalizeStats", () => {
    it("초 단위 elapsedTime을 ms로, 음수는 0으로", () => {
        expect(
            normalizeStats({ elapsedTime: 1.5, speed: 10, eta: 3, transfers: -1 }),
        ).toMatchObject({
            elapsedMs: 1500,
            speedBps: 10,
            etaSeconds: 3,
            transfers: 0,
        });
    });

    it("형식이 다르면 null", () => {
        expect(normalizeStats({ bytes: "x" })).toBeNull();
        expect(normalizeStats(null)).toBeNull();
    });
});
