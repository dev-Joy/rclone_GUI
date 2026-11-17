// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    canStartCompare,
    compareChips,
    compareStaleReason,
    DEFAULT_COMPARE_VIEW,
    dirSummaryText,
    emptyDirsUnsupportedText,
    reasonText,
    selectRowIndexes,
    statusLabel,
    statusTone,
    type itfCompareViewState,
    type typCompareChip,
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

/** 칩 다섯 개를 모두 켠 상태에서 off에 든 칩만 끈다 */
const ALL_CHIPS: Record<typCompareChip, boolean> = {
    onlySource: true,
    modified: true,
    onlyDest: true,
    typeConflict: true,
    equal: true,
};

function f_Chips(...off: typCompareChip[]): Record<typCompareChip, boolean> {
    const chips = { ...ALL_CHIPS };
    for (const key of off) chips[key] = false;
    return chips;
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
        scope: "files",
        excludes,
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

describe("selectRowIndexes 칩 필터", () => {
    it("기본값은 같음 칩만 꺼져 있다", () => {
        expect(DEFAULT_COMPARE_VIEW.chips).toEqual(f_Chips("equal"));
        expect(f_Paths({})).toEqual(["a/한글.txt", "b.txt", "d.txt", "e/x"]);
    });

    it("칩을 모두 켜면 같음까지 보인다", () => {
        expect(f_Paths({ chips: f_Chips() })).toEqual([
            "a/한글.txt",
            "b.txt",
            "C.TXT",
            "d.txt",
            "e/x",
        ]);
    });

    it.each<[typCompareChip, string[]]>([
        ["onlySource", ["b.txt", "d.txt", "e/x"]],
        ["modified", ["a/한글.txt", "d.txt", "e/x"]],
        ["onlyDest", ["a/한글.txt", "b.txt", "e/x"]],
        ["typeConflict", ["a/한글.txt", "b.txt", "d.txt"]],
        ["equal", ["a/한글.txt", "b.txt", "d.txt", "e/x"]],
    ])("%s 칩을 끄면 그 상태가 빠진다", (off, expected) => {
        expect(f_Paths({ chips: { ...DEFAULT_COMPARE_VIEW.chips, [off]: false } })).toEqual(
            expected,
        );
    });

    it("칩을 토글하면 행 수가 그 상태만큼 바뀐다", () => {
        const equalOn = { ...DEFAULT_COMPARE_VIEW.chips, equal: true };
        expect(f_Paths({ chips: equalOn })).toHaveLength(5);
        expect(f_Paths({ chips: { ...equalOn, equal: false } })).toHaveLength(4);
        expect(f_Paths({ chips: { ...equalOn, onlyDest: false } })).toHaveLength(4);
        expect(
            f_Paths({
                chips: f_Chips("onlySource", "modified", "onlyDest", "typeConflict", "equal"),
            }),
        ).toEqual([]);
    });

    it("검색은 대소문자 무시·NFC 부분 일치", () => {
        expect(f_Paths({ chips: f_Chips(), query: "c.t" })).toEqual(["C.TXT"]);
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
        expect(f_Paths({ chips: f_Chips(), sortKey })).toEqual(expected);
    });

    it.each<[typCompareSortKey, string[]]>([
        ["path", ["e/x", "d.txt", "C.TXT", "b.txt", "a/한글.txt"]],
        ["srcSize", ["b.txt", "C.TXT", "a/한글.txt", "e/x", "d.txt"]],
        ["dstTime", ["b.txt", "C.TXT", "a/한글.txt", "d.txt", "e/x"]],
    ])("%s desc (null은 여전히 뒤)", (sortKey, expected) => {
        expect(f_Paths({ chips: f_Chips(), sortKey, sortDir: "desc" })).toEqual(expected);
    });
});

describe("compareChips", () => {
    const s = {
        ...emptySummary(),
        createFiles: 12,
        createBytes: 100,
        updateFiles: 8,
        deleteFiles: 3,
        sameFiles: 40,
    };

    it("라벨·개수·색: 추가·변경·삭제(sync)·오류·같음", () => {
        expect(compareChips(s, "sync").map((c) => [c.key, c.label, c.count, c.tone])).toEqual([
            ["onlySource", "추가", 12, "add"],
            ["modified", "변경", 8, "change"],
            ["onlyDest", "삭제", 3, "delete"],
            ["typeConflict", "오류", 0, "danger"],
            ["equal", "같음", 40, "same"],
        ]);
    });

    it("copy에서는 대상만(삭제하지 않음), 형식 충돌 개수를 그대로 센다", () => {
        const chips = compareChips({ ...s, conflictFiles: 2 }, "copy");
        expect(chips[2]).toMatchObject({ key: "onlyDest", label: "대상만", count: 3 });
        expect(chips[3]).toMatchObject({ key: "typeConflict", label: "오류", count: 2 });
    });
});

describe("dirSummaryText (INT-002 T-05)", () => {
    it("폴더 생성·삭제 문구, copy는 유지, 둘 다 0이면 null", () => {
        const s = { ...emptySummary(), createDirs: 3, deleteDirs: 2 };
        expect(dirSummaryText(s, "sync")).toBe("빈 폴더 3개 생성, 폴더 2개 삭제");
        expect(dirSummaryText(s, "copy")).toBe("빈 폴더 3개 생성, 대상에만 있는 폴더 2개(유지)");
        expect(dirSummaryText(emptySummary(), "sync")).toBeNull();
    });

    it("빈 폴더를 못 만드는 대상(false)이면 생성 문구를 빼고, 남는 것이 없으면 null (INT-003 FR-31)", () => {
        const s = { ...emptySummary(), createDirs: 3, deleteDirs: 2 };
        expect(dirSummaryText(s, "sync", false)).toBe("폴더 2개 삭제");
        expect(dirSummaryText(s, "sync", null)).toBe("빈 폴더 3개 생성, 폴더 2개 삭제");
        expect(dirSummaryText({ ...emptySummary(), createDirs: 3 }, "copy", false)).toBeNull();
    });
});

describe("emptyDirsUnsupportedText (INT-003 FR-31)", () => {
    it("false이고 폴더 생성이 있을 때만 안내", () => {
        expect(emptyDirsUnsupportedText({ createDirs: 0 }, false)).toBeNull();
        expect(emptyDirsUnsupportedText({ createDirs: 3 }, true)).toBeNull();
        expect(emptyDirsUnsupportedText({ createDirs: 3 }, null)).toBeNull();
        const t = emptyDirsUnsupportedText({ createDirs: 3 }, false);
        expect(t).toContain("이 저장소는 빈 폴더를 만들 수 없음(3개)");
        expect(t).toContain("자동 실행은 이 차이만으로는 실행하지 않습니다");
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
