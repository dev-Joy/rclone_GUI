/**
 * 경로 입력란 옆에 보여 줄 종류 배지 문구 (로컬 / UNC / remote / 형식 오류)와 긴 경로 줄임.
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

/**
 * 긴 경로를 가운데를 "…"로 줄여 앞뒤를 남긴다(작업 목록 표시용). max 이하면 그대로.
 * 앞 ceil((max-1)/2)자, 뒤 floor((max-1)/2)자를 남긴다.
 */
export function shortenPath(path: string, max = 36): string {
    if (path.length <= max) return path;
    const head = Math.ceil((max - 1) / 2);
    const tail = Math.floor((max - 1) / 2);
    return `${path.slice(0, head)}…${tail > 0 ? path.slice(-tail) : ""}`;
}
