/**
 * 작업 편집기 상태 (zustand): 편집 중 초안(draft)과 저장본(baseline), 변경 여부, 저장, 변경 버리기 확인.
 * 헤더·사이드바·설정 이동이 같은 변경 여부를 봐야 해서 전역에 둔다.
 * jobs-store·ui-store만 import 한다(단방향). jobs 변경은 HomePage가 syncFromJobs로 알려 준다.
 * 편집기 열기·닫기는 job-editor-store 적재와 ui-store.editor를 같은 동작에서 함께 맞춘다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import {
    isDraftEqual,
    jobToDraft,
    sortJobs,
    validateJobDraft,
    type itfJobFormCheck,
} from "@/lib/job-form";
import { createJobDraft } from "@/shared/defaults";
import type { typApiResult, typAppErrorPayload } from "@/shared/schemas/common";
import type { typJob, typJobDraft, typJobRunOptions } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";
import { useJobsStore } from "@/stores/jobs-store";
import { useUiStore } from "@/stores/ui-store";

export interface itfJobEditorState {
    /** null = 저장 전 새 작업 */
    jobId: string | null;
    baseline: typJobDraft | null;
    draft: typJobDraft | null;
    /** 편집 중 그룹 지정(저장 입력이 아니라 jobs:setGroup으로 반영한다, FR-17) */
    groupId: string | null;
    /** 열었을 때의 그룹. groupId와 다르면 저장할 때 setGroup을 부른다 */
    baseGroupId: string | null;
    /** 열었을 때의 rev. jobs:changed로 rev가 바뀌면 외부 변경 */
    baseRev: number | null;
    externalChange: boolean;
    /** 저장을 한 번 누른 뒤부터 필드 오류 표시 */
    showErrors: boolean;
    saving: boolean;
    serverError: typAppErrorPayload | null;
    /** 변경 버리기 확인 대기 중인 이동 */
    pendingAction: (() => void) | null;

    openJob: (job: typJob) => void;
    /** 설정 기본값(createJobDraft)으로 새 초안 */
    openNew: (settings: typSettings) => void;
    /** 기존 작업 값을 복제 초안으로(이름에 " (복제)", 예약은 끔). 저장하면 새 작업이 된다 */
    openDuplicate: (job: typJob) => void;
    close: () => void;
    /**
     * 편집기를 닫고 돌아갈 작업을 고른다. 새 작업이면 목록의 첫 작업(작업 화면으로 복귀),
     * 편집·복제는 보던 작업 선택을 그대로 둔다(중복 초안은 원래 작업에서 열었으므로).
     */
    closeAndReturn: () => void;
    setField: <K extends keyof typJobDraft>(key: K, value: typJobDraft[K]) => void;
    setOptions: (patch: Partial<typJobRunOptions>) => void;
    setAutoSync: (patch: Partial<typJobDraft["autoSync"]>) => void;
    /** 그룹 select. 저장 전에는 main을 부르지 않는다(rev를 올리지 않는다) */
    setGroup: (groupId: string | null) => void;
    /** draft = baseline */
    revert: () => void;
    /** 검증 → create/update → 성공 시 baseline 갱신. caseInsensitive는 settings.compare 값 */
    save: (caseInsensitive: boolean) => Promise<boolean>;
    /** 목록 갱신 시: 같은 작업이면 dirty 아닐 때 교체, dirty면 externalChange 표시. 사라졌으면 close */
    syncFromJobs: (jobs: readonly typJob[]) => void;
    /** dirty면 pendingAction에 보관(확인 모달), 아니면 즉시 실행 */
    guard: (action: () => void) => void;
    /** revert 후 pendingAction 실행 */
    confirmDiscard: () => void;
    cancelDiscard: () => void;
}

type typEditorData = Omit<
    itfJobEditorState,
    | "openJob"
    | "openNew"
    | "openDuplicate"
    | "close"
    | "closeAndReturn"
    | "setField"
    | "setOptions"
    | "setAutoSync"
    | "setGroup"
    | "revert"
    | "save"
    | "syncFromJobs"
    | "guard"
    | "confirmDiscard"
    | "cancelDiscard"
>;

const CLOSED: typEditorData = {
    jobId: null,
    baseline: null,
    draft: null,
    groupId: null,
    baseGroupId: null,
    baseRev: null,
    externalChange: false,
    showErrors: false,
    saving: false,
    serverError: null,
    pendingAction: null,
};

/** 편집 대상이 바뀔 때마다 늘린다. 저장 응답이 다른 작업 편집을 덮지 않게 한다 */
let session = 0;

export function selectDirty(s: itfJobEditorState): boolean {
    return (
        s.draft !== null &&
        s.baseline !== null &&
        (!isDraftEqual(s.draft, s.baseline) || s.groupId !== s.baseGroupId)
    );
}

export function selectCheck(
    s: itfJobEditorState,
    caseInsensitive: boolean,
): itfJobFormCheck | null {
    return s.draft ? validateJobDraft(s.draft, caseInsensitive) : null;
}

export const useJobEditorStore = create<itfJobEditorState>((set, get) => ({
    ...CLOSED,
    openJob: (job) => {
        session += 1;
        set({
            ...CLOSED,
            jobId: job.id,
            baseline: jobToDraft(job),
            draft: jobToDraft(job),
            groupId: job.groupId,
            baseGroupId: job.groupId,
            baseRev: job.rev,
        });
        useUiStore.getState().openEditor({ mode: "edit", jobId: job.id });
    },
    openNew: (settings) => {
        session += 1;
        set({
            ...CLOSED,
            baseline: createJobDraft(settings),
            draft: createJobDraft(settings),
        });
        useUiStore.getState().openEditor({ mode: "new", jobId: null });
    },
    openDuplicate: (job) => {
        session += 1;
        // 1세대 rcloud cloneJob과 같다: 이름에 " (복제)", 예약은 끄고, id는 저장할 때 새로 만든다
        const draft = jobToDraft(job);
        draft.name = `${job.name} (복제)`;
        draft.autoSync = { ...draft.autoSync, enabled: false };
        set({
            ...CLOSED,
            baseline: structuredClone(draft),
            draft,
            // 그룹은 그대로 이어받는다(저장할 때 jobs:setGroup으로 반영된다)
            groupId: job.groupId,
            baseGroupId: job.groupId,
        });
        useUiStore.getState().openEditor({ mode: "duplicate", jobId: null });
    },
    close: () => {
        session += 1;
        set({ ...CLOSED });
    },
    closeAndReturn: () => {
        // 새 작업만 첫 작업 화면으로 돌아간다. 복제 초안도 jobId는 null이지만 원래 작업을 보던 중이었다
        const mode = useUiStore.getState().editor?.mode ?? null;
        get().close();
        useUiStore.getState().closeEditor();
        if (mode === "new") {
            const first = sortJobs(useJobsStore.getState().jobs)[0]?.id ?? null;
            useJobsStore.getState().select(first);
        }
    },
    setField: (key, value) =>
        set((s) => (s.draft ? { draft: { ...s.draft, [key]: value }, serverError: null } : {})),
    setOptions: (patch) =>
        set((s) =>
            s.draft
                ? {
                      draft: { ...s.draft, options: { ...s.draft.options, ...patch } },
                      serverError: null,
                  }
                : {},
        ),
    setAutoSync: (patch) =>
        set((s) =>
            s.draft
                ? {
                      draft: { ...s.draft, autoSync: { ...s.draft.autoSync, ...patch } },
                      serverError: null,
                  }
                : {},
        ),
    setGroup: (groupId) => set({ groupId, serverError: null }),
    revert: () =>
        set((s) => ({
            draft: s.baseline ? structuredClone(s.baseline) : null,
            groupId: s.baseGroupId,
            serverError: null,
            showErrors: false,
        })),
    save: async (caseInsensitive) => {
        const s = get();
        if (!s.draft || s.saving) return false;
        if (!validateJobDraft(s.draft, caseInsensitive).ok) {
            set({ showErrors: true });
            return false;
        }
        const mine = session;
        const submitted = s.draft;
        set({ saving: true, serverError: null });
        const jobs = useJobsStore.getState();
        // 그룹만 바꿨으면 jobs.update(rev +1)를 부르지 않고 setGroup만 한다(비교 계획 보호, Q-3)
        const draftChanged = s.baseline === null || !isDraftEqual(submitted, s.baseline);
        let r: typApiResult<typJob>;
        if (s.jobId === null) {
            r = await jobs.create(submitted);
        } else if (draftChanged) {
            r = await jobs.update(s.jobId, submitted);
        } else {
            const cur = jobs.jobs.find((j) => j.id === s.jobId);
            r = cur
                ? { ok: true, data: cur }
                : {
                      ok: false,
                      error: { code: "NOT_FOUND", message: "작업을 찾을 수 없습니다." },
                  };
        }
        // 저장하는 동안 다른 작업으로 옮겼다면 그 편집을 건드리지 않는다
        if (mine !== session) return r.ok;
        if (!r.ok) {
            set({ saving: false, serverError: r.error, showErrors: true });
            return false;
        }
        let job = r.data;
        if (job.groupId !== s.groupId) {
            const g = await jobs.setGroup(job.id, s.groupId);
            if (mine !== session) return g.ok;
            if (!g.ok) {
                set({ saving: false, serverError: g.error, showErrors: true });
                return false;
            }
            job = g.data;
        }
        const saved = jobToDraft(job);
        const cur = get().draft;
        set({
            jobId: job.id,
            baseline: saved,
            baseRev: job.rev,
            groupId: job.groupId,
            baseGroupId: job.groupId,
            // 저장 중 더 고친 내용은 남긴다
            draft: cur && !isDraftEqual(cur, submitted) ? cur : structuredClone(saved),
            externalChange: false,
            saving: false,
            showErrors: false,
        });
        // 새 작업을 저장했으면 편집기 대상도 그 작업으로 옮긴다(저장 뒤에도 같은 편집기가 이어진다)
        const ui = useUiStore.getState();
        if (ui.editor !== null && ui.editor.jobId !== job.id) {
            ui.openEditor({ mode: "edit", jobId: job.id });
        }
        return true;
    },
    syncFromJobs: (jobs) => {
        const s = get();
        if (s.draft === null || s.jobId === null || s.saving) return;
        const job = jobs.find((j) => j.id === s.jobId);
        if (!job) {
            get().close();
            useUiStore.getState().closeEditor();
            return;
        }
        // 같거나 오래된 rev(늦게 온 이벤트)는 무시한다. 단 공용 제외 패턴이 지워져 연결만 바뀐 경우
        // (rev 그대로)는 저장본과 초안에서 지워진 id를 뺀다
        if (s.baseRev !== null && job.rev <= s.baseRev) {
            if (job.rev === s.baseRev && s.baseline && s.draft) {
                const removed = s.baseline.excludePatternIds.filter(
                    (x) => !job.excludePatternIds.includes(x),
                );
                if (removed.length > 0) {
                    set({
                        baseline: { ...s.baseline, excludePatternIds: [...job.excludePatternIds] },
                        draft: {
                            ...s.draft,
                            excludePatternIds: s.draft.excludePatternIds.filter(
                                (x) => !removed.includes(x),
                            ),
                        },
                    });
                }
            }
            // 그룹 지정은 rev를 올리지 않는다. 사용자가 아직 안 바꿨으면 바깥 변경을 따른다
            if (
                job.rev === s.baseRev &&
                job.groupId !== s.baseGroupId &&
                s.groupId === s.baseGroupId
            ) {
                set({ groupId: job.groupId, baseGroupId: job.groupId });
            }
            return;
        }
        if (selectDirty(s)) {
            set({ externalChange: true });
            return;
        }
        set({
            baseline: jobToDraft(job),
            draft: jobToDraft(job),
            groupId: job.groupId,
            baseGroupId: job.groupId,
            baseRev: job.rev,
        });
    },
    guard: (action) => {
        if (selectDirty(get())) set({ pendingAction: action });
        else action();
    },
    confirmDiscard: () => {
        const action = get().pendingAction;
        get().revert();
        set({ pendingAction: null });
        action?.();
    },
    cancelDiscard: () => set({ pendingAction: null }),
}));
