/**
 * 스케줄러 상태 (zustand): 일시정지 여부, 진행 중 실행, 다음 자동 실행. main의 scheduler:state 이벤트로 갱신한다.
 * 일시정지는 scheduler:setPaused로만 바꾼다(settings:update는 거부됨).
 * Windows 작업 스케줄러 예약 상태(INT-003 T-01)는 scheduler:osStatus 1회 + scheduler:osStatusChanged 이벤트로 받는다.
 * 이벤트로 어떤 작업에 새 등록·삭제 실패 문구가 생기면 토스트로 알린다(경로 없는 문구).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { getApi, unwrap } from "@/lib/api";
import type {
    itfOsScheduleStatus,
    itfOsTaskStatus,
    itfSchedulerState,
} from "@/shared/types/scheduler";
import { useJobsStore } from "@/stores/jobs-store";
import { useToastStore } from "@/stores/toast-store";

interface itfSchedulerStoreState {
    state: itfSchedulerState | null;
    /** Windows 작업 스케줄러 예약 상태. 받기 전에는 null */
    osStatus: itfOsScheduleStatus | null;
    /** setPaused 응답 대기 중 */
    pending: boolean;
    setPaused: (paused: boolean) => Promise<void>;
    /** scheduler:state·scheduler:osStatusChanged 구독 + getState·osStatus 1회. 해제 함수를 돌려준다 */
    subscribe: () => () => void;
}

/** 이전 상태에 없던(또는 바뀐) 실패 문구가 생긴 작업을 알린다 */
function f_ToastNewErrors(prev: itfOsScheduleStatus | null, next: itfOsScheduleStatus): void {
    const before = new Map((prev?.tasks ?? []).map((t) => [t.jobId, t.error]));
    const jobs = useJobsStore.getState().jobs;
    for (const t of next.tasks) {
        if (t.error === null || before.get(t.jobId) === t.error) continue;
        const name = jobs.find((j) => j.id.toLowerCase() === t.jobId)?.name;
        useToastStore.getState().push("error", name ? `‘${name}’: ${t.error}` : t.error);
    }
}

/** 작업 하나의 OS 예약 상태(없으면 null). jobId는 대소문자 무시 */
export function osTaskOf(
    status: itfOsScheduleStatus | null,
    jobId: string | null,
): itfOsTaskStatus | null {
    if (!status || jobId === null) return null;
    const id = jobId.toLowerCase();
    return status.tasks.find((t) => t.jobId === id) ?? null;
}

export const useSchedulerStore = create<itfSchedulerStoreState>((set, get) => ({
    state: null,
    osStatus: null,
    pending: false,
    setPaused: async (paused) => {
        if (get().pending) return;
        set({ pending: true });
        try {
            set({ state: await unwrap(getApi().scheduler.setPaused(paused)) });
            useToastStore
                .getState()
                .push(
                    "info",
                    paused
                        ? "자동 실행을 일시정지했습니다. 진행 중인 실행은 계속됩니다."
                        : "자동 실행을 다시 시작합니다. 지난 예약은 30초 뒤에 실행합니다.",
                );
        } catch {
            useToastStore.getState().push("error", "자동 실행 일시정지를 바꾸지 못했습니다.");
        } finally {
            set({ pending: false });
        }
    },
    subscribe: () => {
        const api = getApi();
        const off = api.events.onSchedulerState((state) => set({ state }));
        const offOs = api.events.onSchedulerOsStatus((osStatus) => {
            f_ToastNewErrors(get().osStatus, osStatus);
            set({ osStatus });
        });
        unwrap(api.scheduler.getState())
            .then((state) => (get().state === null ? set({ state }) : undefined))
            .catch(() => undefined);
        unwrap(api.scheduler.osStatus())
            .then((osStatus) => (get().osStatus === null ? set({ osStatus }) : undefined))
            .catch(() => undefined);
        return () => {
            off();
            offOs();
        };
    },
}));
