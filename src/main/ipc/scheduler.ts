/**
 * 스케줄러 IPC (scheduler:getState / scheduler:setPaused, MVP_SPEC §10, intent T-10).
 * 상태 변경 이벤트(scheduler:state)는 index.ts가 스케줄러의 emitState로 창에 보낸다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import type { clsScheduler } from "@/main/services/scheduler";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { zSchedulerSetPausedInput } from "@/shared/schemas/scheduler";

export interface itfSchedulerIpcDeps extends itfIpcContext {
    scheduler: clsScheduler;
}

export function registerSchedulerIpc(d: itfSchedulerIpcDeps): void {
    handle(d, IPC_CHANNELS.schedulerGetState, () => d.scheduler.getState());
    handle(
        d,
        IPC_CHANNELS.schedulerSetPaused,
        ({ paused }) => d.scheduler.setPaused(paused),
        zSchedulerSetPausedInput,
    );
}
