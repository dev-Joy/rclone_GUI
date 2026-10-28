// ========== External imports ==========
import { beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { useUiStore } from "@/stores/ui-store";

function f_Ui() {
    return useUiStore.getState();
}

beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState(), true);
});

describe("ui-store 설정 화면 떠나기 확인", () => {
    it("설정 화면이 아니거나 변경이 없으면 즉시 실행", () => {
        const action = vi.fn<() => void>();
        f_Ui().setSettingsDirty(true);
        f_Ui().leaveSettings(action); // view = job
        f_Ui().setView("settings");
        f_Ui().setSettingsDirty(false);
        f_Ui().leaveSettings(action);
        expect(action).toHaveBeenCalledTimes(2);
        expect(f_Ui().pendingLeave).toBeNull();
    });

    it("설정 화면에 변경이 있으면 보관 → 취소 유지 / 확인 실행·dirty 해제", () => {
        const action = vi.fn<() => void>();
        f_Ui().setView("settings");
        f_Ui().setSettingsDirty(true);
        f_Ui().leaveSettings(action);
        expect(action).not.toHaveBeenCalled();
        expect(f_Ui().pendingLeave).not.toBeNull();
        f_Ui().cancelLeave();
        expect(f_Ui().pendingLeave).toBeNull();
        expect(f_Ui().settingsDirty).toBe(true);
        f_Ui().leaveSettings(action);
        f_Ui().confirmLeave();
        expect(action).toHaveBeenCalledTimes(1);
        expect(f_Ui().settingsDirty).toBe(false);
        expect(f_Ui().pendingLeave).toBeNull();
    });
});
