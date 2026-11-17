/**
 * 화면 상태 (zustand): 작업 화면 탭(파일 목록·기록), 작업 편집기·설정 모달, 로그인 시 시작 안내.
 * 라우터 없이 이 값으로 전환한다. 메모리에만 둔다(재시작 시 파일 목록 탭).
 * 설정에 저장하지 않은 변경이 있으면 닫기 전에 확인한다(leaveSettings·pendingLeave).
 * 로그인 시 시작 안내(자동 실행을 처음 켤 때)는 세션당 한 번만 보인다(loginHintShown).
 * job-editor-store가 이 저장소를 import 한다(단방향). 여기서는 다른 store를 import 하지 않는다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

/** 작업 화면 안 탭: 파일 목록 / 기록 */
export type typJobTab = "files" | "history";
/** 작업 편집기 모드: 새 작업 / 편집 / 복제 */
export type typEditorMode = "new" | "edit" | "duplicate";

export interface itfEditorTarget {
    mode: typEditorMode;
    /** null = 저장 전 새 작업 */
    jobId: string | null;
}

interface itfUiState {
    /** 작업 화면 탭. 작업을 바꾸면 "files" */
    tab: typJobTab;
    /** 열려 있는 작업 편집기 대상. null = 닫힘 */
    editor: itfEditorTarget | null;
    /** 설정 모달이 열려 있는지 */
    settingsOpen: boolean;
    /** 설정에 저장하지 않은 변경이 있는지 (SettingsPage가 알려 준다) */
    settingsDirty: boolean;
    /** 설정 닫기 확인 대기 중인 동작 */
    pendingLeave: (() => void) | null;
    /** 이번 세션에 로그인 시 시작 안내를 보였는지 */
    loginHintShown: boolean;
    setTab: (tab: typJobTab) => void;
    openEditor: (target: itfEditorTarget) => void;
    /** 편집기를 닫는다. 초안(draft)은 건드리지 않는다(호출부가 close·guard와 함께 쓴다) */
    closeEditor: () => void;
    openSettings: () => void;
    /** 저장하지 않은 변경이 있으면 pendingLeave에 보관하고, 없으면 닫는다 */
    closeSettings: () => void;
    setSettingsDirty: (dirty: boolean) => void;
    /** 설정에서 떠나는 이동: 변경이 있으면 보관(확인 모달), 아니면 즉시 실행 */
    leaveSettings: (action: () => void) => void;
    /** 설정 변경을 버리고 보관한 동작 실행 */
    confirmLeave: () => void;
    cancelLeave: () => void;
    markLoginHintShown: () => void;
}

export const useUiStore = create<itfUiState>((set, get) => ({
    tab: "files",
    editor: null,
    settingsOpen: false,
    settingsDirty: false,
    pendingLeave: null,
    loginHintShown: false,
    setTab: (tab) => set({ tab }),
    openEditor: (editor) => set({ editor }),
    closeEditor: () => set({ editor: null }),
    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => {
        const s = get();
        if (!s.settingsOpen) return;
        if (s.settingsDirty) set({ pendingLeave: () => get().closeSettings() });
        else set({ settingsOpen: false });
    },
    setSettingsDirty: (settingsDirty) => set({ settingsDirty }),
    leaveSettings: (action) => {
        const s = get();
        if (s.settingsOpen && s.settingsDirty) set({ pendingLeave: action });
        else action();
    },
    confirmLeave: () => {
        const action = get().pendingLeave;
        set({ pendingLeave: null, settingsDirty: false });
        action?.();
    },
    cancelLeave: () => set({ pendingLeave: null }),
    markLoginHintShown: () => set({ loginHintShown: true }),
}));
