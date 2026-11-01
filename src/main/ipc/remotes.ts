/**
 * remote 북마크 IPC (remotes:list / create / update / delete / test, INT-002 T-02).
 * 연결 테스트는 탐색 락을 잡으므로 같은 remote 비교·실행 중이면 BUSY를 돌려준다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import type { clsRemoteService } from "@/main/services/remote-service";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { zRemoteCreateInput, zRemoteIdInput, zRemoteUpdateInput } from "@/shared/schemas/remotes";

export interface itfRemotesIpcDeps extends itfIpcContext {
    remotes: clsRemoteService;
}

export function registerRemotesIpc(d: itfRemotesIpcDeps): void {
    handle(d, IPC_CHANNELS.remotesList, () => d.remotes.list());
    handle(d, IPC_CHANNELS.remotesCreate, (input) => d.remotes.create(input), zRemoteCreateInput);
    handle(d, IPC_CHANNELS.remotesUpdate, (input) => d.remotes.update(input), zRemoteUpdateInput);
    handle(d, IPC_CHANNELS.remotesDelete, ({ id }) => d.remotes.remove(id), zRemoteIdInput);
    handle(d, IPC_CHANNELS.remotesTest, ({ id }) => d.remotes.test(id), zRemoteIdInput);
}
