/**
 * remote 북마크 상태 (zustand, INT-002 T-02).
 *
 * - 목록은 remotes:list 결과(별칭 순)를 그대로 둔다. 추가·수정·삭제 뒤에는 다시 불러온다.
 * - 액션은 envelope를 그대로 돌려준다(예외 없음). 연결 테스트는 결과를 화면이 직접 보관한다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import { ERROR_MESSAGES } from "@/shared/errors";
import type { itfPathProbe } from "@/shared/ipc-contract";
import { createLatestGate } from "@/shared/latest-request";
import type { typApiResult } from "@/shared/schemas/common";
import type {
    typRemoteCreateInput,
    typRemoteIdInput,
    typRemoteUpdateInput,
} from "@/shared/schemas/remotes";
import type { itfRemoteBookmark } from "@/shared/types/remotes";

interface itfRemotesState {
    items: itfRemoteBookmark[];
    /** 한 번이라도 불러왔는지 */
    loaded: boolean;
    loading: boolean;
    error: string | null;
    load: () => Promise<void>;
    create: (input: typRemoteCreateInput) => Promise<typApiResult<itfRemoteBookmark>>;
    update: (input: typRemoteUpdateInput) => Promise<typApiResult<itfRemoteBookmark>>;
    remove: (input: typRemoteIdInput) => Promise<typApiResult<null>>;
    test: (input: typRemoteIdInput) => Promise<typApiResult<itfPathProbe>>;
}

/** IPC 자체가 실패해도 envelope로 돌려준다 */
function f_Call<T>(pending: Promise<typApiResult<T>>): Promise<typApiResult<T>> {
    return pending.catch((): typApiResult<T> => ({
        ok: false,
        error: { code: "INTERNAL", message: ERROR_MESSAGES.INTERNAL },
    }));
}

export const useRemotesStore = create<itfRemotesState>((set, get) => {
    /** 늦게 온 이전 목록 응답이 최신 목록을 덮지 않게 한다 */
    const gate = createLatestGate();
    return {
        items: [],
        loaded: false,
        loading: false,
        error: null,
        load: async () => {
            const isLatest = gate.next();
            set({ loading: true });
            try {
                const items = await unwrap(getApi().remotes.list());
                if (isLatest()) set({ items, loaded: true, error: null });
            } catch (e) {
                if (isLatest()) set({ error: errorText(e) });
            } finally {
                if (isLatest()) set({ loading: false });
            }
        },
        create: async (input) => {
            const r = await f_Call(getApi().remotes.create(input));
            if (r.ok) await get().load();
            return r;
        },
        update: async (input) => {
            const r = await f_Call(getApi().remotes.update(input));
            if (r.ok) await get().load();
            return r;
        },
        remove: async (input) => {
            const r = await f_Call(getApi().remotes.remove(input));
            if (r.ok) await get().load();
            return r;
        },
        test: (input) => f_Call(getApi().remotes.test(input)),
    };
});

/** 별칭 순 목록 */
export function selectBookmarks(s: Pick<itfRemotesState, "items">): itfRemoteBookmark[] {
    return s.items;
}
