/**
 * 비교 IPC (compare:run / compare:cancel / compare:get / compare:getActive).
 * 진행 이벤트(compare:progress)는 index.ts가 비교 서비스의 emit으로 창에 보낸다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import type { clsCompareService } from "@/main/services/compare-service";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { zCompareJobInput } from "@/shared/schemas/compare";

export interface itfCompareIpcDeps extends itfIpcContext {
    compare: clsCompareService;
}

export function registerCompareIpc(d: itfCompareIpcDeps): void {
    handle(d, IPC_CHANNELS.compareRun, ({ jobId }) => d.compare.run(jobId), zCompareJobInput);
    handle(d, IPC_CHANNELS.compareCancel, ({ jobId }) => d.compare.cancel(jobId), zCompareJobInput);
    handle(d, IPC_CHANNELS.compareGet, ({ jobId }) => d.compare.get(jobId), zCompareJobInput);
    handle(d, IPC_CHANNELS.compareGetActive, () => d.compare.getActive());
}
