// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    canStartCompare,
    compareStaleReason,
    DEFAULT_COMPARE_VIEW,
    reasonText,
    selectRowIndexes,
    statusLabel,
    statusTone,
    summaryCards,
    type itfCompareViewState,
    type typCompareSortKey,
} from "@/lib/compare-view";
import { createDefaultSettings } from "@/shared/defaults";
import { emptySummary } from "@/shared/diff-engine";
import type { typJob } from "@/shared/schemas/job";
import type { itfCompareResult, itfDiffEntry, typCompareStatus } from "@/shared/types/compare";

function f_E(
    path: string,
    status: typCompareStatus,
    src: [number, number | null] | null,
    dst: [number, number | null] | null,
): itfDiffEntry {
    return {
        path,
        status,
        reasons: [],
        source: src ? { path, size: src[0], modTimeMs: src[1] } : null,
        dest: dst ? { path, size: dst[0], modTimeMs: dst[1] } : null,
        caseOnly: false,
        hashAlgo: null,
        hashUnavailable: false,
    };
}

// 경로 키 오름차순 (diff-engine 결과와 같은 순서)
const ENTRIES: itfDiffEntry[] = [
    f_E("a/한글.txt", "onlySource", [10, 100], null),
    f_E("b.txt", "modified", [30, 300], [5, 200]),
    f_E("C.TXT", "equal", [20, 50], [20, 50]),
    f_E("d.txt", "onlyDest", null, [40, null]),
    f_E("e/x", "typeConflict", [1, 1], null),
];

function f_View(over: Partial<itfCompareViewState> = {}): itfCompareViewState {
    return { ...DEFAULT_COMPARE_VIEW, ...over };
}

function f_Paths(v: Partial<itfCompareViewState>): string[] {
    return selectRowIndexes(ENTRIES, f_View(v)).map((i) => ENTRIES[i]!.path);
}

function f_Job(over: Partial<typJob> = {}): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: "00000000-0000-4000-8000-000000000001",
        name: "작업",
        notes: "",
        source: "C:\\tmp\\src",
        destination: "D:\\tmp\\dst",
        mode: "copy",
        excludes,
        excludePatternIds: [],
        options,
        configPathOverride: null,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 2,
        createdAt: "2026-10-28T00:00:00.000Z",
        updatedAt: "2026-10-28T00:00:00.000Z",
        lastRun: null,
        ...over,
    };
}

describe("라벨·색·사유", () => {
    it("onlyDest는 모드에 따라 유지/삭제 예정", () => {
        expect(statusLabel("onlyDest", "copy")).toBe("대상만(유지)");
        expect(statusLabel("onlyDest", "sync")).toBe("대상만(삭제 예정)");
        expect(statusTone("onlyDest", "sync")).toBe("danger");
        expect(statusTone("onlyDest", "copy")).toBe("neutral");
        expect(statusLabel("onlySource", "copy")).toBe("원본만(복사)");
    });

    it("reasonText", () => {
        expect(reasonText(["size", "mtime"])).toBe("크기, 수정시간");
        expect(reasonText(["hash"])).toBe("해시");
        expect(reasonText(["mtimeUnknown", "type"])).toBe("수정시간 모름, 파일↔폴더");
        expect(reasonText([])).toBe("");
    });
});

describe("selectRowIndexes 필터", () => {
    it.each<[itfCompareViewState["status"], boolean, string[]]>([
        ["all", true, ["a/한글.txt", "b.txt", "d.txt", "e/x"]],
        ["all", false, ["a/한글.txt", "b.txt", "C.TXT", "d.txt", "e/x"]],
        ["changes", true, ["a/한글.txt", "b.txt", "d.txt", "e/x"]],
        ["changes", false, ["a/한글.txt", "b.txt", "d.txt", "e/x"]],
        ["onlySource", true, ["a/한글.txt"]],
        ["modified", false, ["b.txt"]],
        ["onlyDest", true, ["d.txt"]],
        ["typeConflict", true, ["e/x"]],
        ["equal", true, ["C.TXT"]],
        ["equal", false, ["C.TXT"]],
    ])("status=%s hideEqual=%s", (status, hideEqual, expected) => {
        expect(f_Paths({ status, hideEqual })).toEqual(expected);
    });

    it("검색은 대소문자 무시·NFC 부분 일치", () => {
        expect(f_Paths({ hideEqual: false, query: "c.t" })).toEqual(["C.TXT"]);
        expect(f_Paths({ query: "한글".normalize("NFD") })).toEqual(["a/한글.txt"]);
        expect(f_Paths({ query: "  " })).toHaveLength(4);
        expect(f_Paths({ query: "없음" })).toEqual([]);
    });
});

describe("selectRowIndexes 정렬", () => {
    it.each<[typCompareSortKey, string[]]>([
        ["path", ["a/한글.txt", "b.txt", "C.TXT", "d.txt", "e/x"]],
        ["status", ["e/x", "a/한글.txt", "b.txt", "d.txt", "C.TXT"]],
        ["srcSize", ["e/x", "a/한글.txt", "C.TXT", "b.txt", "d.txt"]],
        ["srcTime", ["e/x", "C.TXT", "a/한글.txt", "b.txt", "d.txt"]],
        ["dstSize", ["b.txt", "C.TXT", "d.txt", "a/한글.txt", "e/x"]],
        ["dstTime", ["C.TXT", "b.txt", "a/한글.txt", "d.txt", "e/x"]],
    ])("%s asc (null은 뒤, 같으면 경로순)", (sortKey, expected) => {
        expect(f_Paths({ hideEqual: false, sortKey })).toEqual(expected);
    });

    it.each<[typCompareSortKey, string[]]>([
        ["path", ["e/x", "d.txt", "C.TXT", "b.txt", "a/한글.txt"]],
        ["srcSize", ["b.txt", "C.TXT", "a/한글.txt", "e/x", "d.txt"]],
        ["dstTime", ["b.txt", "C.TXT", "a/한글.txt", "d.txt", "e/x"]],
    ])("%s desc (null은 여전히 뒤)", (sortKey, expected) => {
        expect(f_Paths({ hideEqual: false, sortKey, sortDir: "desc" })).toEqual(expected);
    });
});

describe("summaryCards", () => {
    const s = {
        ...emptySummary(),
        createFiles: 12,
        createBytes: 100,
        updateFiles: 8,
        deleteFiles: 3,
        sameFiles: 40,
    };

    it("일어날 일을 문구로", () => {
        expect(summaryCards(s, "sync").map((c) => c.label)).toEqual([
            "대상에 12개 복사",
            "8개 덮어씀",
            "3개 삭제",
            "동일 40개",
        ]);
        expect(summaryCards(s, "copy")[2]!.label).toBe("3개 대상에만 있음(유지)");
        expect(summaryCards(s, "copy")[0]).toMatchObject({ count: 12, bytes: 100 });
    });

    it("형식 충돌은 있을 때만", () => {
        const cards = summaryCards({ ...s, conflictFiles: 2 }, "copy");
        expect(cards.at(-1)).toMatchObject({ filter: "typeConflict", label: "형식 충돌 2개" });
    });
});

describe("compareStaleReason", () => {
    const result = { jobRev: 2, createdAt: "2026-10-28T00:00:00.000Z" } as itfCompareResult;
    const t0 = Date.parse(result.createdAt);

    it("정상 / rev 변경 / 나이 초과", () => {
        expect(compareStaleReason(result, { rev: 2 }, 10, t0 + 60_000)).toBeNull();
        expect(compareStaleReason(result, { rev: 3 }, 10, t0)).toBe(
            "작업 설정이 바뀌었습니다. 다시 비교하세요.",
        );
        expect(compareStaleReason(result, { rev: 2 }, 10, t0 + 11 * 60_000)).toBe(
            "비교한 지 11분 지났습니다. 실행 전 다시 비교하세요.",
        );
    });
});

describe("canStartCompare 이유 우선순위", () => {
    const base = { dirty: false, running: null, caseInsensitive: true };
    const active = {
        jobId: "other",
        phase: "list" as const,
        startedAt: "2026-10-28T00:00:00.000Z",
        sourceFiles: 0,
        destFiles: 0,
    };

    it("저장 안 됨 → 미저장 변경 → 경로 오류 → 진행 중", () => {
        expect(canStartCompare({ ...base, job: null })).toEqual({
            ok: false,
            reason: "먼저 작업을 저장하세요.",
        });
        const bad = f_Job({ destination: "x:folder" });
        expect(canStartCompare({ ...base, job: bad, dirty: true, running: active })).toMatchObject({
            reason: expect.stringContaining("저장하지 않은 변경"),
        });
        const r = canStartCompare({ ...base, job: bad, running: active });
        expect(r.ok).toBe(false);
        expect(r.ok ? "" : r.reason).toContain("대상: ‘x:folder’");
        expect(canStartCompare({ ...base, job: f_Job(), running: active })).toEqual({
            ok: false,
            reason: "다른 작업을 비교하는 중입니다.",
        });
        expect(
            canStartCompare({ ...base, job: f_Job(), running: { ...active, jobId: f_Job().id } }),
        ).toEqual({ ok: false, reason: "비교 중입니다." });
        expect(canStartCompare({ ...base, job: f_Job() })).toEqual({ ok: true });
    });
});
