// ========== External imports ==========
import { beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useUiStore } from "@/stores/ui-store";
import { makeJob } from "./fake-api";

function f_Ui() {
    return useUiStore.getState();
}

beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState(), true);
    useJobEditorStore.setState(useJobEditorStore.getInitialState(), true);
});

describe("ui-store 작업 탭·편집기", () => {
    it("처음에는 파일 목록 탭이고 편집기는 닫혀 있다", () => {
        expect(f_Ui().tab).toBe("files");
        expect(f_Ui().editor).toBeNull();
        f_Ui().setTab("history");
        expect(f_Ui().tab).toBe("history");
        f_Ui().openEditor({ mode: "edit", jobId: "job-1" });
        expect(f_Ui().editor).toEqual({ mode: "edit", jobId: "job-1" });
    });

    it("closeEditor는 편집기만 닫고 초안(draft)은 건드리지 않는다", () => {
        const job = makeJob({ name: "a" });
        useJobEditorStore.getState().openJob(job);
        expect(f_Ui().editor).toEqual({ mode: "edit", jobId: job.id });
        const draft = useJobEditorStore.getState().draft;
        f_Ui().closeEditor();
        expect(f_Ui().editor).toBeNull();
        expect(useJobEditorStore.getState().draft).toBe(draft);
    });
});

describe("ui-store 설정 모달 떠나기 확인", () => {
    it("설정이 닫혀 있거나 변경이 없으면 즉시 실행", () => {
        const action = vi.fn<() => void>();
        f_Ui().setSettingsDirty(true);
        f_Ui().leaveSettings(action); // 설정 닫힘
        f_Ui().openSettings();
        f_Ui().setSettingsDirty(false);
        f_Ui().leaveSettings(action);
        expect(action).toHaveBeenCalledTimes(2);
        expect(f_Ui().pendingLeave).toBeNull();
    });

    it("설정에 변경이 있으면 보관 → 취소 유지 / 확인 실행·dirty 해제", () => {
        const action = vi.fn<() => void>();
        f_Ui().openSettings();
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

    it("closeSettings는 변경이 있으면 보관하고, 없으면 즉시 닫는다", () => {
        f_Ui().openSettings();
        f_Ui().setSettingsDirty(true);
        f_Ui().closeSettings();
        expect(f_Ui().settingsOpen).toBe(true);
        expect(f_Ui().pendingLeave).not.toBeNull();
        f_Ui().confirmLeave();
        expect(f_Ui().settingsOpen).toBe(false);
        expect(f_Ui().settingsDirty).toBe(false);
        expect(f_Ui().pendingLeave).toBeNull();

        f_Ui().openSettings();
        f_Ui().closeSettings();
        expect(f_Ui().settingsOpen).toBe(false);
        expect(f_Ui().pendingLeave).toBeNull();
    });
});

describe("ui-store 로그인 시 시작 안내 (INT-002 T-06)", () => {
    it("처음에는 보이지 않은 상태이고, 한 번 표시하면 세션 동안 유지한다", () => {
        expect(f_Ui().loginHintShown).toBe(false);
        f_Ui().markLoginHintShown();
        expect(f_Ui().loginHintShown).toBe(true);
    });
});
