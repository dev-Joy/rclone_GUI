/**
 * 작업 그룹 목록 상태 (zustand, INT-008 FR-17).
 * main이 보내는 groups:changed로도 갱신된다. 저장·삭제 액션은 envelope를 그대로 돌려준다(예외 없음).
 * 그룹은 작업 목록을 묶어 보는 이름일 뿐이며 실행에는 영향을 주지 않는다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import { ERROR_MESSAGES } from "@/shared/errors";
import type { itfGroupsChangedEvent } from "@/shared/ipc-contract";
import type { typApiResult } from "@/shared/schemas/common";
import type { itfGroup, typGroupSaveInput } from "@/shared/schemas/group";

interface itfGroupsState {
    /** position → 이름 순 */
    groups: itfGroup[];
    /** 한 번이라도 불러왔는지 */
    loaded: boolean;
    error: string | null;
    load: () => Promise<void>;
    save: (input: typGroupSaveInput) => Promise<typApiResult<itfGroup>>;
    /** 속한 작업은 그룹 없음이 된다(작업 목록은 jobs:changed로 갱신) */
    remove: (id: string) => Promise<typApiResult<true>>;
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

function f_Sort(groups: readonly itfGroup[]): itfGroup[] {
    return groups.toSorted((a, b) => a.position - b.position || a.name.localeCompare(b.name, "ko"));
}

function f_Upsert(groups: readonly itfGroup[], group: itfGroup): itfGroup[] {
    return f_Sort(
        groups.some((g) => g.id === group.id)
            ? groups.map((g) => (g.id === group.id ? group : g))
            : [...groups, group],
    );
}

export const useGroupsStore = create<itfGroupsState>((set) => ({
    groups: [],
    loaded: false,
    error: null,
    load: async () => {
        try {
            set({
                groups: f_Sort(await unwrap(getApi().groups.list())),
                loaded: true,
                error: null,
            });
        } catch (e) {
            set({ error: errorText(e) });
        }
    },
    save: async (input) => {
        const r = await f_Call(getApi().groups.save(input));
        if (r.ok) set((s) => ({ groups: f_Upsert(s.groups, r.data) }));
        return r;
    },
    remove: async (id) => {
        const r = await f_Call(getApi().groups.remove(id));
        if (r.ok) set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }));
        return r;
    },
    subscribe: () =>
        getApi().events.onGroupsChanged(({ groups }: itfGroupsChangedEvent) => {
            set({ groups: f_Sort(groups), loaded: true });
        }),
}));
