/**
 * 작업(Job) 목록 상태 (zustand). main이 보내는 jobs:changed 이벤트로도 갱신된다.
 * CRUD 액션은 envelope를 그대로 돌려주고(예외 없음), 성공하면 목록·선택을 바로 반영한다.
 * 선택은 메모리에만 둔다: 시작 시 이름순 첫 작업, 선택한 작업이 사라지면 다음 작업.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import { nextSelectionAfterRemove, sortJobs } from "@/lib/job-form";
import { ERROR_MESSAGES } from "@/shared/errors";
import type { typApiResult } from "@/shared/schemas/common";
import type { typJob, typJobDraft, typJobPatch } from "@/shared/schemas/job";

interface itfJobsState {
    /** main 원본 순서 (화면 정렬은 sortJobs) */
    jobs: typJob[];
    /** null = 선택 없음 또는 저장 전 새 작업 편집 중 */
    selectedJobId: string | null;
    loading: boolean;
    error: string | null;
    /** 성공 후 선택이 없거나 사라졌으면 이름순 첫 작업을 고른다 */
    load: () => Promise<void>;
    select: (id: string | null) => void;
    /** 성공 시 목록 갱신·새 작업 선택 */
    create: (draft: typJobDraft) => Promise<typApiResult<typJob>>;
    update: (id: string, patch: typJobPatch) => Promise<typApiResult<typJob>>;
    /** 성공 시 정렬 순서의 다음(없으면 이전) 작업 선택 */
    remove: (id: string) => Promise<typApiResult<null>>;
    /** 성공 시 사본 선택 */
    duplicate: (id: string) => Promise<typApiResult<typJob>>;
    /** main 이벤트 구독. 해제 함수를 돌려준다 */
    subscribe: () => () => void;
}

/** IPC 자체가 실패(창 종료 등)해도 envelope로 돌려준다 */
function f_Call<T>(pending: Promise<typApiResult<T>>): Promise<typApiResult<T>> {
    return pending.catch((): typApiResult<T> => ({
        ok: false,
        error: { code: "INTERNAL", message: ERROR_MESSAGES.INTERNAL },
    }));
}

function f_Upsert(jobs: readonly typJob[], job: typJob): typJob[] {
    return jobs.some((j) => j.id === job.id)
        ? jobs.map((j) => (j.id === job.id ? job : j))
        : [...jobs, job];
}

/** 선택한 작업이 사라졌을 때: 이전 정렬 순서의 다음 → 이전, 그것도 없으면 새 목록의 첫 작업 */
function f_Reselect(prev: readonly typJob[], next: readonly typJob[], removedId: string) {
    const candidate = nextSelectionAfterRemove(sortJobs(prev), removedId);
    if (candidate !== null && next.some((j) => j.id === candidate)) return candidate;
    return sortJobs(next)[0]?.id ?? null;
}

export const useJobsStore = create<itfJobsState>((set, get) => ({
    jobs: [],
    selectedJobId: null,
    loading: false,
    error: null,
    load: async () => {
        set({ loading: true });
        try {
            const jobs = await unwrap(getApi().jobs.list());
            const cur = get().selectedJobId;
            const selectedJobId =
                cur !== null && jobs.some((j) => j.id === cur)
                    ? cur
                    : (sortJobs(jobs)[0]?.id ?? null);
            set({ jobs, selectedJobId, error: null, loading: false });
        } catch (e) {
            set({ error: errorText(e), loading: false });
        }
    },
    select: (id) => set({ selectedJobId: id }),
    create: async (draft) => {
        const r = await f_Call(getApi().jobs.create(draft));
        if (r.ok) set((s) => ({ jobs: f_Upsert(s.jobs, r.data), selectedJobId: r.data.id }));
        return r;
    },
    update: async (id, patch) => {
        const r = await f_Call(getApi().jobs.update(id, patch));
        if (r.ok) set((s) => ({ jobs: f_Upsert(s.jobs, r.data) }));
        return r;
    },
    remove: async (id) => {
        const next = nextSelectionAfterRemove(sortJobs(get().jobs), id);
        const r = await f_Call(getApi().jobs.remove(id));
        if (r.ok) {
            set((s) => ({
                jobs: s.jobs.filter((j) => j.id !== id),
                selectedJobId: s.selectedJobId === id ? next : s.selectedJobId,
            }));
        }
        return r;
    },
    duplicate: async (id) => {
        const r = await f_Call(getApi().jobs.duplicate(id));
        if (r.ok) set((s) => ({ jobs: f_Upsert(s.jobs, r.data), selectedJobId: r.data.id }));
        return r;
    },
    subscribe: () =>
        getApi().events.onJobsChanged(({ jobs }) => {
            const cur = get().selectedJobId;
            // 선택한 작업이 다른 곳에서 지워졌을 때만 보정한다(null은 새 작업 편집일 수 있어 그대로 둔다)
            if (cur !== null && !jobs.some((j) => j.id === cur)) {
                set({ jobs, selectedJobId: f_Reselect(get().jobs, jobs, cur) });
            } else {
                set({ jobs });
            }
        }),
}));
