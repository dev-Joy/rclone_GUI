// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import { zCompareJobInput } from "@/shared/schemas/compare";
import { zJobDraft, zJobPatch } from "@/shared/schemas/job";
import { zListRemotesInput, zRcloneDetectInput, zTestPathInput } from "@/shared/schemas/rclone";
import { zStartRunInput } from "@/shared/schemas/run";
import { zSettings, zSettingsPatch } from "@/shared/schemas/settings";
import { zOpenExternalInput, zPickDirectoryInput, zPickFileInput } from "@/shared/schemas/system";

function f_Draft() {
    return {
        ...createJobDraft(createDefaultSettings()),
        name: "작업",
        source: "C:\\a",
        destination: "D:\\b",
    };
}

describe("기본값", () => {
    it("기본 설정은 스키마를 통과한다", () => {
        expect(zSettings.safeParse(createDefaultSettings()).success).toBe(true);
    });

    it("기본 Job 초안에 이름·경로만 채우면 통과한다", () => {
        expect(zJobDraft.safeParse(f_Draft()).success).toBe(true);
    });
});

describe("Job 검증 범위", () => {
    it.each([
        ["name 빈 값", { name: "  " }],
        ["name 81자", { name: "가".repeat(81) }],
        ["notes 4001자", { notes: "a".repeat(4001) }],
        ["excludes 101개", { excludes: Array.from({ length: 101 }, (_v, i) => `p${i}`) }],
        ["exclude 513자", { excludes: ["a".repeat(513)] }],
        ["exclude 줄바꿈", { excludes: ["a\nb"] }],
        ["exclude NUL", { excludes: ["a\u0000"] }],
        ["mode 잘못됨", { mode: "move" }],
    ])("%s 는 거부", (_label, over) => {
        expect(zJobDraft.safeParse({ ...f_Draft(), ...over }).success).toBe(false);
    });

    it.each([
        ["checkers", 0],
        ["checkers", 65],
        ["transfers", 33],
        ["modtimeToleranceMs", 600_001],
        ["modtimeToleranceMs", -1],
    ])("options.%s=%i 는 거부", (key, value) => {
        const d = f_Draft();
        expect(zJobDraft.safeParse({ ...d, options: { ...d.options, [key]: value } }).success).toBe(
            false,
        );
    });

    it("autoSync 간격 1..10080", () => {
        const d = f_Draft();
        expect(
            zJobDraft.safeParse({ ...d, autoSync: { ...d.autoSync, intervalMinutes: 10_081 } })
                .success,
        ).toBe(false);
        expect(
            zJobDraft.safeParse({ ...d, autoSync: { ...d.autoSync, intervalMinutes: 1 } }).success,
        ).toBe(true);
    });

    it("patch는 알 수 없는 키(id·rev 등)를 거부한다", () => {
        expect(zJobPatch.safeParse({ name: "x" }).success).toBe(true);
        expect(zJobPatch.safeParse({ rev: 9 }).success).toBe(false);
        expect(zJobPatch.safeParse({ id: "x" }).success).toBe(false);
    });
});

describe("Settings patch", () => {
    it("부분 입력을 받고 알 수 없는 키는 거부한다", () => {
        expect(zSettingsPatch.safeParse({ ui: { theme: "dark" } }).success).toBe(true);
        expect(zSettingsPatch.safeParse({ version: 2 }).success).toBe(false);
        expect(zSettingsPatch.safeParse({ ui: { color: "red" } }).success).toBe(false);
    });
});

describe("IPC 입력 스키마", () => {
    it("jobs:create 입력은 알 수 없는 최상위 키를 거부한다", async () => {
        const { zJobCreateInput } = await import("@/shared/schemas/job");
        expect(zJobCreateInput.safeParse(f_Draft()).success).toBe(true);
        expect(zJobCreateInput.safeParse({ ...f_Draft(), rev: 3 }).success).toBe(false);
        expect(zJobCreateInput.safeParse({ ...f_Draft(), id: "x" }).success).toBe(false);
    });
});

function f_Filter(extensions: string[]): boolean {
    return zPickFileInput.safeParse({ filters: [{ name: "rclone", extensions }] }).success;
}

describe("rclone·dialog·system IPC 입력 스키마", () => {
    it("rclone:detect 는 boolean force가 필수이고 알 수 없는 키를 거부한다", () => {
        expect(zRcloneDetectInput.safeParse({ force: false }).success).toBe(true);
        expect(zRcloneDetectInput.safeParse({}).success).toBe(false);
        expect(zRcloneDetectInput.safeParse({ force: "yes" }).success).toBe(false);
        expect(zRcloneDetectInput.safeParse({ force: true, x: 1 }).success).toBe(false);
    });

    it("listRemotes / testPath: configPath는 생략·null·1..4096자", () => {
        expect(zListRemotesInput.safeParse({}).success).toBe(true);
        expect(zListRemotesInput.safeParse({ configPath: null }).success).toBe(true);
        expect(zListRemotesInput.safeParse({ configPath: "  " }).success).toBe(false);
        expect(zListRemotesInput.safeParse({ configPath: "a".repeat(4097) }).success).toBe(false);
        expect(zTestPathInput.safeParse({ path: "" }).success).toBe(true);
        expect(zTestPathInput.safeParse({ path: "a".repeat(4097) }).success).toBe(false);
        expect(zTestPathInput.safeParse({ path: "C:\\a", extra: 1 }).success).toBe(false);
    });

    it("pickFile 필터 확장자는 영숫자 1..10자 또는 *", () => {
        expect(f_Filter(["exe"])).toBe(true);
        expect(f_Filter(["*"])).toBe(true);
        expect(f_Filter([".exe"])).toBe(false);
        expect(f_Filter(["a/b"])).toBe(false);
        expect(f_Filter([])).toBe(false);
        expect(zPickFileInput.safeParse({ title: "x".repeat(201) }).success).toBe(false);
        expect(zPickDirectoryInput.safeParse({ defaultPath: "C:\\a" }).success).toBe(true);
        expect(zPickDirectoryInput.safeParse({ properties: ["x"] }).success).toBe(false);
    });

    it("openExternal 은 URL 형식만 받는다", () => {
        expect(zOpenExternalInput.safeParse({ url: "https://rclone.org/install/" }).success).toBe(
            true,
        );
        expect(zOpenExternalInput.safeParse({ url: "not a url" }).success).toBe(false);
        expect(zOpenExternalInput.safeParse({ url: "https://a.b", x: 1 }).success).toBe(false);
    });
});

describe("비교 IPC 입력", () => {
    it("zCompareJobInput: uuid만, 알 수 없는 키 거부", () => {
        const jobId = "00000000-0000-4000-8000-000000000001";
        expect(zCompareJobInput.safeParse({ jobId }).success).toBe(true);
        expect(zCompareJobInput.safeParse({ jobId: "x" }).success).toBe(false);
        expect(zCompareJobInput.safeParse({ jobId, force: true }).success).toBe(false);
        expect(zCompareJobInput.safeParse({}).success).toBe(false);
    });
});

describe("실행 IPC 입력", () => {
    it("zStartRunInput: confirmLargeDeletes는 boolean만, confirmIgnoreErrors 등 알 수 없는 키 거부", () => {
        const base = {
            jobId: "00000000-0000-4000-8000-000000000001",
            dryRun: false,
            planToken: "a".repeat(32),
            confirmedDeletes: 3,
        };
        expect(zStartRunInput.safeParse(base).success).toBe(true);
        expect(zStartRunInput.safeParse({ ...base, confirmLargeDeletes: true }).success).toBe(true);
        expect(zStartRunInput.safeParse({ ...base, confirmLargeDeletes: "yes" }).success).toBe(
            false,
        );
        expect(zStartRunInput.safeParse({ ...base, confirmIgnoreErrors: true }).success).toBe(
            false,
        );
        expect(zStartRunInput.safeParse({ ...base, confirmedDeletes: -1 }).success).toBe(false);
    });
});
