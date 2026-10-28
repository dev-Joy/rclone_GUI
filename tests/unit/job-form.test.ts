// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    excludesToText,
    isDraftEqual,
    jobToDraft,
    nextSelectionAfterRemove,
    parseExcludesText,
    serverErrorToCheck,
    sortJobs,
    validateJobDraft,
} from "@/lib/job-form";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import { zJobDraft, type typJob, type typJobDraft } from "@/shared/schemas/job";

function f_Draft(over: Partial<typJobDraft> = {}): typJobDraft {
    return {
        ...createJobDraft(createDefaultSettings()),
        name: "작업",
        source: "C:\\tmp\\src",
        destination: "D:\\tmp\\dst",
        ...over,
    };
}

function f_Job(id: string, name: string, createdAt = "2026-10-28T00:00:00.000Z"): typJob {
    const d = f_Draft({ name });
    return {
        ...d,
        id,
        autoSync: { ...d.autoSync, nextRunAt: "2026-10-28T01:00:00.000Z", lastAutoRunAt: null },
        rev: 3,
        createdAt,
        updatedAt: createdAt,
        lastRun: { runId: null, at: createdAt, status: "success" },
    };
}

describe("validateJobDraft 기본", () => {
    it("기본 초안 + 유효 경로는 통과", () => {
        const r = validateJobDraft(f_Draft(), true);
        expect(r.ok).toBe(true);
        expect(r.fieldErrors).toEqual({});
        expect(r.formErrors).toEqual([]);
    });

    it("이름 빈칸·81자", () => {
        expect(validateJobDraft(f_Draft({ name: "  " }), true).fieldErrors.name).toBe(
            "이름을 입력하세요.",
        );
        expect(validateJobDraft(f_Draft({ name: "가".repeat(81) }), true).fieldErrors.name).toBe(
            "이름은 80자 이내로 입력하세요.",
        );
    });

    it.each([
        ["checkers", 0, "options.checkers", "1~64 사이의 정수를 입력하세요."],
        ["checkers", 65, "options.checkers", "1~64 사이의 정수를 입력하세요."],
        ["checkers", Number.NaN, "options.checkers", "숫자를 입력하세요."],
        ["checkers", 2.5, "options.checkers", "1~64 사이의 정수를 입력하세요."],
        ["transfers", 33, "options.transfers", "1~32 사이의 정수를 입력하세요."],
        [
            "modtimeToleranceMs",
            600_001,
            "options.modtimeToleranceMs",
            "0~600000 사이의 정수를 입력하세요.",
        ],
    ] as const)("options.%s = %s → 오류", (key, value, field, text) => {
        const d = f_Draft();
        d.options = { ...d.options, [key]: value };
        const r = validateJobDraft(d, true);
        expect(r.ok).toBe(false);
        expect(r.fieldErrors[field]).toBe(text);
    });

    it.each([0, 10_081, Number.NaN])("자동 실행 간격 %s → 오류", (v) => {
        const d = f_Draft();
        d.autoSync = { ...d.autoSync, intervalMinutes: v };
        expect(validateJobDraft(d, true).fieldErrors["autoSync.intervalMinutes"]).toBeDefined();
    });

    it("제외 규칙 101개·513자", () => {
        const many = validateJobDraft(
            f_Draft({ excludes: Array.from({ length: 101 }, (_, i) => `a${i}`) }),
            true,
        );
        expect(many.fieldErrors.excludes).toBe("제외 규칙은 100개까지 쓸 수 있습니다.");
        const long = validateJobDraft(f_Draft({ excludes: ["ok", "x".repeat(513)] }), true);
        expect(long.fieldErrors.excludes).toBe(
            "2번째 줄: 제외 규칙 한 줄은 512자까지 쓸 수 있습니다.",
        );
    });
});

describe("validateJobDraft 경로", () => {
    it("WSL 리눅스 경로·상대 경로는 해당 필드 오류", () => {
        const r = validateJobDraft(f_Draft({ source: "/home/x", destination: "work\\src" }), true);
        expect(r.fieldErrors.source).toContain("WSL 리눅스 경로");
        expect(r.fieldErrors.destination).toContain("상대 경로");
        expect(r.formErrors).toEqual([]);
    });

    it("빈 경로는 입력 안내", () => {
        expect(validateJobDraft(f_Draft({ source: "" }), true).fieldErrors.source).toBe(
            "경로를 입력하세요.",
        );
    });

    it("remote 루트는 대상 필드 오류", () => {
        const r = validateJobDraft(f_Draft({ destination: "remote:" }), true);
        expect(r.fieldErrors.destination).toContain("루트 전체는 지정할 수 없습니다");
    });

    it.each([
        ["C:\\tmp\\a", "c:\\TMP\\a", "원본과 대상이 같은 폴더입니다."],
        ["C:\\tmp\\a", "C:\\tmp\\a\\b", "대상이 원본 폴더 안에 있습니다."],
        ["C:\\tmp\\a\\b", "C:\\tmp\\a", "원본이 대상 폴더 안에 있습니다."],
        ["\\\\wsl$\\D\\mnt\\c\\a", "C:\\a\\b", "대상이 원본 폴더 안에 있습니다."],
    ])("%s / %s → formErrors + 두 필드 강조", (source, destination, msg) => {
        const r = validateJobDraft(f_Draft({ source, destination }), true);
        expect(r.ok).toBe(false);
        expect(r.formErrors).toContain(msg);
        expect(r.fieldErrors.source).toBe("원본과 대상 경로를 확인하세요.");
        expect(r.fieldErrors.destination).toBe("원본과 대상 경로를 확인하세요.");
    });
});

describe("validateJobDraft 경고", () => {
    it("동기화 + 오류 무시 / 사전점검 끔", () => {
        const d = f_Draft({ mode: "sync" });
        d.options = { ...d.options, ignoreErrors: true, preflightBeforeDestructive: false };
        const r = validateJobDraft(d, true);
        expect(r.ok).toBe(true);
        expect(r.formWarnings.some((w) => w.includes("오류 무시"))).toBe(true);
        expect(r.formWarnings.some((w) => w.includes("사전점검"))).toBe(true);
    });

    it("복사 + 자동 삭제 허용 / 동기화 + 자동 실행 삭제", () => {
        const copy = f_Draft();
        copy.autoSync = { ...copy.autoSync, allowDeletes: true };
        expect(validateJobDraft(copy, true).formWarnings.join()).toContain("복사 모드에서는");
        const sync = f_Draft({ mode: "sync" });
        sync.autoSync = { ...sync.autoSync, enabled: true, allowDeletes: true };
        expect(validateJobDraft(sync, true).formWarnings.join()).toContain("자동 실행이");
    });

    it("x:folder 대상은 한 글자 remote 경고(저장은 허용)", () => {
        const r = validateJobDraft(f_Draft({ destination: "x:folder" }), true);
        expect(r.ok).toBe(true);
        expect(r.fieldWarnings.destination?.[0]).toContain("드라이브 문자로 해석");
        expect(r.fieldWarnings.source).toBeUndefined();
    });

    it("/mnt 별칭 경고는 해당 필드로", () => {
        const r = validateJobDraft(
            f_Draft({ source: "\\\\wsl.localhost\\D\\mnt\\e\\tmp", destination: "D:\\tmp\\dst" }),
            true,
        );
        expect(r.fieldWarnings.source?.[0]).toContain("WSL /mnt 경로");
        expect(r.formWarnings).toEqual([]);
    });
});

describe("serverErrorToCheck", () => {
    it("접두사로 필드 매핑, 없으면 formErrors", () => {
        const dst = serverErrorToCheck({ code: "SAFETY_BLOCKED", message: "대상: 루트입니다." });
        expect(dst.fieldErrors.destination).toBe("루트입니다.");
        expect(dst.ok).toBe(false);
        const form = serverErrorToCheck({
            code: "SAFETY_BLOCKED",
            message: "원본과 대상이 같은 폴더입니다.",
        });
        expect(form.formErrors).toEqual(["원본과 대상이 같은 폴더입니다."]);
    });
});

describe("초안 변환·비교", () => {
    it("jobToDraft는 관리 필드를 빼고 zJobDraft.strict를 통과한다", () => {
        const d = jobToDraft(f_Job("j1", "a"));
        for (const k of ["id", "rev", "lastRun", "createdAt", "updatedAt"]) {
            expect(d).not.toHaveProperty(k);
        }
        expect(d.autoSync).not.toHaveProperty("nextRunAt");
        expect(d.autoSync).not.toHaveProperty("lastAutoRunAt");
        expect(() => zJobDraft.strict().parse(d)).not.toThrow();
    });

    it("isDraftEqual: 순서 바뀐 excludes·옵션 변경은 다르다", () => {
        const a = f_Draft({ excludes: ["a", "b"] });
        expect(isDraftEqual(a, { ...a, excludes: ["a", "b"] })).toBe(true);
        expect(isDraftEqual(a, { ...a, excludes: ["b", "a"] })).toBe(false);
        expect(isDraftEqual(a, { ...a, options: { ...a.options, checkers: 9 } })).toBe(false);
    });

    it("제외 규칙 문자열 변환", () => {
        expect(parseExcludesText("a\n\n  b  \r\n")).toEqual(["a", "b"]);
        expect(parseExcludesText(excludesToText(["x/**", "y"]))).toEqual(["x/**", "y"]);
    });
});

describe("정렬·삭제 후 선택", () => {
    it("이름(ko 정렬: 한글 먼저, 대소문자 무시) → createdAt", () => {
        const jobs = [
            f_Job("1", "나"),
            f_Job("2", "b"),
            f_Job("3", "A", "2026-10-28T02:00:00.000Z"),
            f_Job("4", "a", "2026-10-28T01:00:00.000Z"),
            f_Job("5", "가"),
        ];
        expect(sortJobs(jobs).map((j) => j.id)).toEqual(["5", "1", "4", "3", "2"]);
    });

    it("다음 → 이전 → null", () => {
        const s = [f_Job("1", "a"), f_Job("2", "b"), f_Job("3", "c")];
        expect(nextSelectionAfterRemove(s, "1")).toBe("2");
        expect(nextSelectionAfterRemove(s, "2")).toBe("3");
        expect(nextSelectionAfterRemove(s, "3")).toBe("2");
        expect(nextSelectionAfterRemove([f_Job("1", "a")], "1")).toBeNull();
    });
});
