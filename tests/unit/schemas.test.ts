// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import { zJobDraft, zJobPatch } from "@/shared/schemas/job";
import { zSettings, zSettingsPatch } from "@/shared/schemas/settings";

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
