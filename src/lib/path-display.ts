/**
 * 경로 입력란 옆에 보여 줄 종류 배지 문구 (로컬 / UNC / remote / 형식 오류).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { parsePath, type typPathKind } from "@/shared/path-utils";

export interface itfPathKindBadge {
    text: string;
    /** 형식 오류면 null */
    kind: typPathKind | null;
}

export const PATH_KIND_LABEL: Record<typPathKind, string> = {
    local: "로컬",
    unc: "UNC",
    remote: "remote",
};

/** 입력 원문의 배지. 빈 값은 null, 형식 오류는 { text: "형식 오류", kind: null } */
export function pathKindBadge(raw: string): itfPathKindBadge | null {
    if (raw.trim() === "") return null;
    const r = parsePath(raw);
    return r.ok
        ? { text: PATH_KIND_LABEL[r.path.kind], kind: r.path.kind }
        : { text: "형식 오류", kind: null };
}
