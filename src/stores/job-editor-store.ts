/**
 * 작업 편집기 상태 (zustand): 편집 중 초안(draft)과 저장본(baseline), 변경 여부, 저장, 변경 버리기 확인.
 * 헤더·사이드바·설정 이동이 같은 변경 여부를 봐야 해서 전역에 둔다.
 * jobs-store만 import 한다(단방향). jobs 변경은 HomePage가 syncFromJobs로 알려 준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { isDraftEqual, jobToDraft, validateJobDraft, type itfJobFormCheck } from "@/lib/job-form";
import { createJobDraft } from "@/shared/defaults";
import type { typAppErrorPayload } from "@/shared/schemas/common";
import type { typJob, typJobDraft, typJobRunOptions } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";
import { useJobsStore } from "@/stores/jobs-store";

export interface itfJobEditorState {
    /** null = 저장 전 새 작업 */
    jobId: string | null;
    /** 열려 있는지 (빈 상태 구분) */
    open: boolean;
    baseline: typJobDraft | null;
    draft: typJobDraft | null;
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
    close: () => void;
    setField: <K extends keyof typJobDraft>(key: K, value: typJobDraft[K]) => void;
    setOptions: (patch: Partial<typJobRunOptions>) => void;
    setAutoSync: (patch: Partial<typJobDraft["autoSync"]>) => void;
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
    | "close"
    | "setField"
    | "setOptions"
    | "setAutoSync"
    | "revert"
    | "save"
    | "syncFromJobs"
    | "guard"
    | "confirmDiscard"
    | "cancelDiscard"
>;

const CLOSED: typEditorData = {
    jobId: null,
    open: false,
    baseline: null,
    draft: null,
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
    return s.draft !== null && s.baseline !== null && !isDraftEqual(s.draft, s.baseline);
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
            open: true,
            baseline: jobToDraft(job),
            draft: jobToDraft(job),
            baseRev: job.rev,
        });
    },
    openNew: (settings) => {
        session += 1;
        set({
            ...CLOSED,
            open: true,
            baseline: createJobDraft(settings),
            draft: createJobDraft(settings),
        });
    },
    close: () => {
        session += 1;
        set({ ...CLOSED });
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
    revert: () =>
        set((s) => ({
            draft: s.baseline ? structuredClone(s.baseline) : null,
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
        const r =
            s.jobId === null ? await jobs.create(submitted) : await jobs.update(s.jobId, submitted);
        // 저장하는 동안 다른 작업으로 옮겼다면 그 편집을 건드리지 않는다
        if (mine !== session) return r.ok;
        if (!r.ok) {
            set({ saving: false, serverError: r.error, showErrors: true });
            return false;
        }
        const saved = jobToDraft(r.data);
        const cur = get().draft;
        set({
            jobId: r.data.id,
            baseline: saved,
            baseRev: r.data.rev,
            // 저장 중 더 고친 내용은 남긴다
            draft: cur && !isDraftEqual(cur, submitted) ? cur : structuredClone(saved),
            externalChange: false,
            saving: false,
            showErrors: false,
        });
        return true;
    },
    syncFromJobs: (jobs) => {
        const s = get();
        if (!s.open || s.jobId === null || s.saving) return;
        const job = jobs.find((j) => j.id === s.jobId);
        if (!job) {
            get().close();
            return;
        }
        // 같거나 오래된 rev(늦게 온 이벤트)는 무시한다
        if (s.baseRev !== null && job.rev <= s.baseRev) return;
        if (selectDirty(s)) {
            set({ externalChange: true });
            return;
        }
        set({ baseline: jobToDraft(job), draft: jobToDraft(job), baseRev: job.rev });
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
