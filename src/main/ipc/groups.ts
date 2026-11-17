/**
 * 작업 그룹 IPC (groups:list / save / delete, jobs:setGroup, INT-008 FR-17).
 * 그룹이 바뀌면 groups:changed, 작업의 그룹이 바뀌거나 그룹 삭제로 작업이 그룹 없음이 되면
 * 기존 jobs:changed로 알린다(job-store onChange).
 *
 * @author dev-Joy 2026-11-17
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import type { clsGroupStore } from "@/main/store/group-store";
import type { clsJobStore } from "@/main/store/job-store";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { zGroupDeleteInput, zGroupSave, zJobSetGroupInput } from "@/shared/schemas/group";

export interface itfGroupsIpcDeps extends itfIpcContext {
    groups: clsGroupStore;
    jobs: Pick<clsJobStore, "refreshGroups" | "setGroup">;
}

export function registerGroupsIpc(d: itfGroupsIpcDeps): void {
    handle(d, IPC_CHANNELS.groupsList, () => d.groups.list());
    handle(d, IPC_CHANNELS.groupsSave, (i) => d.groups.save(i), zGroupSave);
    handle(
        d,
        IPC_CHANNELS.groupsDelete,
        ({ id }) => {
            d.groups.remove(id);
            // 그룹이 사라졌으니 작업 캐시의 groupId도 다시 읽어 jobs:changed로 알린다
            d.jobs.refreshGroups();
            return true;
        },
        zGroupDeleteInput,
    );
    handle(
        d,
        IPC_CHANNELS.jobsSetGroup,
        ({ id, groupId }) => d.jobs.setGroup(id, groupId),
        zJobSetGroupInput,
    );
}
