// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import { zCompareJobInput } from "@/shared/schemas/compare";
import {
    zHistoryClearInput,
    zHistoryGetInput,
    zHistoryListInput,
    zHistoryReadLogInput,
} from "@/shared/schemas/history";
import { zJob, zJobDraft, zJobPatch } from "@/shared/schemas/job";
import { zListRemotesInput, zRcloneDetectInput, zTestPathInput } from "@/shared/schemas/rclone";
import { zStartRunInput } from "@/shared/schemas/run";
import { zSchedulerSetPausedInput } from "@/shared/schemas/scheduler";
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

    it("patch에 excludePatternIds가 없으면 기본값을 채우지 않는다(연결 유지)", () => {
        const r = zJobPatch.parse({ name: "x" });
        expect("excludePatternIds" in r).toBe(false);
    });
});

const f_Ids = (n: number) =>
    Array.from({ length: n }, (_v, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

function f_Stored(over: Record<string, unknown> = {}) {
    return {
        ...f_Draft(),
        id: "00000000-0000-4000-8000-0000000000aa",
        autoSync: { ...f_Draft().autoSync, nextRunAt: null, lastAutoRunAt: null },
        rev: 0,
        createdAt: "2026-10-29T00:00:00.000Z",
        updatedAt: "2026-10-29T00:00:00.000Z",
        lastRun: null,
        ...over,
    };
}

describe("저장 한도와 읽기 한도 (INT-002 T-09)", () => {
    it("경로 4096자는 읽을 때 통과하고 저장 입력에서는 거부한다", () => {
        const long = `C:\\${"a".repeat(4090)}`;
        expect(zJob.safeParse(f_Stored({ source: long })).success).toBe(true);
        expect(zJobDraft.safeParse({ ...f_Draft(), source: long }).success).toBe(false);
        expect(zJobPatch.safeParse({ destination: long }).success).toBe(false);
        expect(
            zJobDraft.safeParse({ ...f_Draft(), source: `C:\\${"a".repeat(1000)}` }).success,
        ).toBe(true);
    });

    it("excludePatternIds가 없는 예전 저장 값은 []로 읽는다", () => {
        const { excludePatternIds: _x, ...old } = f_Stored();
        expect(zJob.parse(old).excludePatternIds).toEqual([]);
    });

    it("공용 + 작업 전용 합계 501은 거부, 500은 통과", () => {
        const jobOnly = Array.from({ length: 100 }, (_v, i) => `p${i}`);
        expect(
            zJobDraft.safeParse({ ...f_Draft(), excludes: jobOnly, excludePatternIds: f_Ids(400) })
                .success,
        ).toBe(true);
        const r = zJobDraft.safeParse({
            ...f_Draft(),
            excludes: jobOnly,
            excludePatternIds: f_Ids(401),
        });
        expect(r.success).toBe(false);
        expect(r.error?.issues[0]?.path).toEqual(["excludes"]);
    });

    it("excludePatternIds 600개·uuid 아님은 거부", () => {
        expect(zJobDraft.safeParse({ ...f_Draft(), excludePatternIds: f_Ids(600) }).success).toBe(
            false,
        );
        expect(zJobDraft.safeParse({ ...f_Draft(), excludePatternIds: ["x"] }).success).toBe(false);
    });

    it("설정 patch 경로는 1024자까지, 읽기는 4096자까지", () => {
        const long = `C:\\${"a".repeat(2000)}`;
        expect(zSettingsPatch.safeParse({ configPath: long }).success).toBe(false);
        expect(zSettings.safeParse({ ...createDefaultSettings(), configPath: long }).success).toBe(
            true,
        );
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

describe("이력·스케줄러 IPC 입력", () => {
    const RUN = "00000000-0000-4000-8000-000000000001";

    it("history:list: jobId uuid·limit 1..5000, 알 수 없는 키 거부", () => {
        expect(zHistoryListInput.safeParse({}).success).toBe(true);
        expect(zHistoryListInput.safeParse({ jobId: RUN, limit: 50 }).success).toBe(true);
        expect(zHistoryListInput.safeParse({ jobId: "x" }).success).toBe(false);
        expect(zHistoryListInput.safeParse({ limit: 0 }).success).toBe(false);
        expect(zHistoryListInput.safeParse({ limit: 5001 }).success).toBe(false);
        expect(zHistoryListInput.safeParse({ status: "failed" }).success).toBe(false);
    });

    it("history:get·readLog: runId uuid, tailBytes 1..1MB, 경로 같은 키 거부", () => {
        expect(zHistoryGetInput.safeParse({ runId: RUN }).success).toBe(true);
        expect(zHistoryGetInput.safeParse({ runId: "../x" }).success).toBe(false);
        expect(zHistoryReadLogInput.safeParse({ runId: RUN }).success).toBe(true);
        expect(zHistoryReadLogInput.safeParse({ runId: RUN, tailBytes: 1024 * 1024 }).success).toBe(
            true,
        );
        expect(
            zHistoryReadLogInput.safeParse({ runId: RUN, tailBytes: 1024 * 1024 + 1 }).success,
        ).toBe(false);
        expect(zHistoryReadLogInput.safeParse({ runId: RUN, file: "app.log" }).success).toBe(false);
    });

    it("history:clear: deleteLogs boolean 필수", () => {
        expect(zHistoryClearInput.safeParse({ deleteLogs: false }).success).toBe(true);
        expect(zHistoryClearInput.safeParse({}).success).toBe(false);
        expect(zHistoryClearInput.safeParse({ deleteLogs: "yes" }).success).toBe(false);
    });

    it("scheduler:setPaused: paused boolean만", () => {
        expect(zSchedulerSetPausedInput.safeParse({ paused: true }).success).toBe(true);
        expect(zSchedulerSetPausedInput.safeParse({ paused: 1 }).success).toBe(false);
        expect(zSchedulerSetPausedInput.safeParse({ paused: true, x: 1 }).success).toBe(false);
    });
});
