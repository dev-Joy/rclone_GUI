// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { isSettingsEqual, settingsToPatch, validateSettingsDraft } from "@/lib/settings-form";
import { createDefaultSettings } from "@/shared/defaults";
import { zSettingsPatch } from "@/shared/schemas/settings";

describe("설정 폼 검증", () => {
    it("기본 설정은 통과", () => {
        expect(validateSettingsDraft(createDefaultSettings())).toEqual({
            fieldErrors: {},
            ok: true,
        });
    });

    it("범위 밖 값은 필드 오류", () => {
        const s = createDefaultSettings();
        s.logs.historyLimit = 99;
        s.safety.deleteConfirmPercent = 101;
        s.safety.compareMaxAgeMinutes = 0;
        s.defaults.checkers = Number.NaN;
        const r = validateSettingsDraft(s);
        expect(r.ok).toBe(false);
        expect(r.fieldErrors["logs.historyLimit"]).toBe("100~5000 사이의 정수를 입력하세요.");
        expect(r.fieldErrors["safety.deleteConfirmPercent"]).toBe(
            "0~100 사이의 숫자를 입력하세요.",
        );
        expect(r.fieldErrors["safety.compareMaxAgeMinutes"]).toContain("1~1440");
        expect(r.fieldErrors["defaults.checkers"]).toBe("숫자를 입력하세요.");
    });

    it("제외 규칙 오류", () => {
        const s = createDefaultSettings();
        s.defaults.excludes = ["a", "x".repeat(513)];
        expect(validateSettingsDraft(s).fieldErrors["defaults.excludes"]).toBe(
            "2번째 줄: 제외 규칙 한 줄은 512자까지 쓸 수 있습니다.",
        );
    });
});

describe("settingsToPatch", () => {
    it("노출된 섹션만 담고 zSettingsPatch를 통과한다", () => {
        const patch = settingsToPatch(createDefaultSettings());
        expect(Object.keys(patch).toSorted()).toEqual([
            "compare",
            "defaults",
            "logs",
            "safety",
            "ui",
        ]);
        expect(patch.ui).toEqual({ theme: "system" });
        expect(patch).not.toHaveProperty("scheduler");
        expect(patch).not.toHaveProperty("version");
        expect(() => zSettingsPatch.parse(patch)).not.toThrow();
    });

    it("isSettingsEqual은 노출된 값만 비교한다", () => {
        const a = createDefaultSettings();
        const b = createDefaultSettings();
        b.scheduler.paused = true;
        b.ui.minimizeToTray = false;
        expect(isSettingsEqual(a, b)).toBe(true);
        b.ui.theme = "dark";
        expect(isSettingsEqual(a, b)).toBe(false);
    });
});
