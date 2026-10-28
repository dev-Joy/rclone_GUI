/**
 * 실행 IPC (run:start / run:cancel / run:getActive).
 * 진행 이벤트(run:event)는 index.ts가 실행 서비스의 emit으로 창에 보낸다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import type { clsRunService } from "@/main/services/run-service";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { zRunIdInput, zStartRunInput } from "@/shared/schemas/run";

export interface itfRunIpcDeps extends itfIpcContext {
    runs: clsRunService;
}

export function registerRunIpc(d: itfRunIpcDeps): void {
    handle(d, IPC_CHANNELS.runStart, (input) => d.runs.start(input), zStartRunInput);
    handle(d, IPC_CHANNELS.runCancel, ({ runId }) => d.runs.cancel(runId), zRunIdInput);
    handle(d, IPC_CHANNELS.runGetActive, () => d.runs.getActive());
}
