/**
 * 공용 제외 패턴 라이브러리 상태 (zustand, INT-002 T-03).
 *
 * - 목록은 excludes:list 결과(패턴 순, 쓰는 작업 포함)를 그대로 둔다. 작업 연결이 바뀌면(jobs:changed)
 *   화면이 load()를 다시 불러 사용 작업 수를 맞춘다.
 * - 수정·삭제는 화면에 보여 준 사용 작업(confirmedJobIds)을 함께 보낸다. main이 CONFIRM_REQUIRED로
 *   거부하면 목록을 다시 불러 확인 창이 새 목록을 그리게 한다.
 * - 액션은 envelope를 그대로 돌려준다(예외 없음).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { create } from "zustand";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import { ERROR_MESSAGES } from "@/shared/errors";
import type { typApiResult } from "@/shared/schemas/common";
import type { itfExcludePatternUsage, typExcludePattern } from "@/shared/schemas/excludes";

interface itfExcludesState {
    items: itfExcludePatternUsage[];
    /** 한 번이라도 불러왔는지 */
    loaded: boolean;
    error: string | null;
    load: () => Promise<void>;
    create: (
        pattern: string,
    ) => Promise<typApiResult<{ item: typExcludePattern; created: boolean }>>;
    update: (
        id: string,
        pattern: string,
        confirmedJobIds: string[],
    ) => Promise<typApiResult<typExcludePattern>>;
    remove: (id: string, confirmedJobIds: string[]) => Promise<typApiResult<null>>;
}

/** IPC 자체가 실패해도 envelope로 돌려준다 */
function f_Call<T>(pending: Promise<typApiResult<T>>): Promise<typApiResult<T>> {
    return pending.catch((): typApiResult<T> => ({
        ok: false,
        error: { code: "INTERNAL", message: ERROR_MESSAGES.INTERNAL },
    }));
}

export const useExcludesStore = create<itfExcludesState>((set, get) => ({
    items: [],
    loaded: false,
    error: null,
    load: async () => {
        try {
            set({ items: await unwrap(getApi().excludes.list()), loaded: true, error: null });
        } catch (e) {
            set({ error: errorText(e) });
        }
    },
    create: async (pattern) => {
        const r = await f_Call(getApi().excludes.create(pattern));
        if (r.ok) await get().load();
        return r;
    },
    update: async (id, pattern, confirmedJobIds) => {
        const r = await f_Call(getApi().excludes.update({ id, pattern, confirmedJobIds }));
        // 성공·확인 목록 변경 모두 목록을 다시 불러 화면을 맞춘다
        if (r.ok || r.error.code === "CONFIRM_REQUIRED") await get().load();
        return r;
    },
    remove: async (id, confirmedJobIds) => {
        const r = await f_Call(getApi().excludes.remove({ id, confirmedJobIds }));
        if (r.ok || r.error.code === "CONFIRM_REQUIRED") await get().load();
        return r;
    },
}));
