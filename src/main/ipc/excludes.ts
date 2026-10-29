/**
 * 공용 제외 패턴 IPC (excludes:list / create / update / delete, INT-002 T-03).
 * 연결이 바뀐 작업 목록은 기존 jobs:changed 이벤트로 알린다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import type { clsExcludeService } from "@/main/services/exclude-service";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import {
    zExcludeCreateInput,
    zExcludeDeleteInput,
    zExcludeUpdateInput,
} from "@/shared/schemas/excludes";

export interface itfExcludesIpcDeps extends itfIpcContext {
    excludes: clsExcludeService;
}

export function registerExcludesIpc(d: itfExcludesIpcDeps): void {
    handle(d, IPC_CHANNELS.excludesList, () => d.excludes.list());
    handle(d, IPC_CHANNELS.excludesCreate, (i) => d.excludes.create(i), zExcludeCreateInput);
    handle(d, IPC_CHANNELS.excludesUpdate, (i) => d.excludes.update(i), zExcludeUpdateInput);
    handle(d, IPC_CHANNELS.excludesDelete, (i) => d.excludes.remove(i), zExcludeDeleteInput);
}
