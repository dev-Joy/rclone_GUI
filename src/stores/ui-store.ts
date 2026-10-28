/**
 * 화면 전환 상태 (zustand): 작업 화면 / 설정 화면, 작업 화면의 탭.
 * 라우터 없이 이 값으로 전환한다. 메모리에만 둔다(재시작 시 작업 화면).
 * 설정 화면에 저장하지 않은 변경이 있으면 화면을 떠나기 전에 확인한다(leaveSettings).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

export type typAppView = "job" | "settings";
export type typJobTab = "compare" | "run" | "history" | "edit";

interface itfUiState {
    view: typAppView;
    /** "compare"·"edit" 활성 (run·history는 다음 단계). 새 작업에서는 compare 대신 edit로 보인다 */
    tab: typJobTab;
    /** 설정 화면에 저장하지 않은 변경이 있는지 (SettingsPage가 알려 준다) */
    settingsDirty: boolean;
    /** 설정 변경 버리기 확인 대기 중인 이동 */
    pendingLeave: (() => void) | null;
    setView: (v: typAppView) => void;
    setTab: (t: typJobTab) => void;
    setSettingsDirty: (dirty: boolean) => void;
    /** 설정 화면에서 떠나는 이동: 변경이 있으면 보관(확인 모달), 아니면 즉시 실행 */
    leaveSettings: (action: () => void) => void;
    /** 설정 변경을 버리고 보관한 이동 실행 */
    confirmLeave: () => void;
    cancelLeave: () => void;
}

export const useUiStore = create<itfUiState>((set, get) => ({
    view: "job",
    tab: "edit",
    settingsDirty: false,
    pendingLeave: null,
    setView: (view) => set({ view }),
    setTab: (tab) => set({ tab }),
    setSettingsDirty: (settingsDirty) => set({ settingsDirty }),
    leaveSettings: (action) => {
        const s = get();
        if (s.view === "settings" && s.settingsDirty) set({ pendingLeave: action });
        else action();
    },
    confirmLeave: () => {
        const action = get().pendingLeave;
        set({ pendingLeave: null, settingsDirty: false });
        action?.();
    },
    cancelLeave: () => set({ pendingLeave: null }),
}));
