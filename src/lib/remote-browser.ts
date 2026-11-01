/**
 * remote 폴더 탐색 경로 도우미 (INT-002 T-02, E-12). Node·DOM 의존 없음.
 * 북마크 기준 경로 밖으로는 올라가지 않고, 목록에서 받은 이름 하나만 안전하게 덧붙인다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== Internal imports ==========
import { parsePath, remoteParentOf, type itfParsedPath } from "@/shared/path-utils";
import { isRemoteSegmentName, joinRemotePath } from "@/shared/remote-path";
import type { itfDirEntry, itfRemoteBookmark } from "@/shared/types/remotes";

function f_Remote(path: string, remoteName: string): itfParsedPath | null {
    const r = parsePath(path);
    if (!r.ok || r.path.kind !== "remote") return null;
    if (r.path.root !== `${remoteName}:`) return null;
    return r.path;
}

/** remote 경로 안에서 기준 경로("name:" 뒤)만 뽑는다 */
function f_BaseOf(p: itfParsedPath): string {
    return p.normalized.slice(p.root.length);
}

/** 후보가 기준 경로 자체이거나 그 아래인지 */
function f_WithinBase(basePath: string, candidate: string): boolean {
    if (basePath === "") return true;
    if (basePath === "/") return candidate.startsWith("/");
    return candidate === basePath || candidate.startsWith(`${basePath}/`);
}

/** 기준 경로 위로 올라간 부모. 기준 경로에 닿았거나 밖이면 null */
export function browserParent(bookmark: itfRemoteBookmark, path: string): string | null {
    const p = f_Remote(path, bookmark.remoteName);
    if (!p) return null;
    const cur = f_BaseOf(p);
    if (cur === bookmark.basePath || !f_WithinBase(bookmark.basePath, cur)) return null;
    const split = remoteParentOf(p);
    if (!split) return null;
    const parent = f_Remote(split.parent, bookmark.remoteName);
    if (!parent) return null;
    return f_WithinBase(bookmark.basePath, f_BaseOf(parent)) ? parent.normalized : null;
}

/** 현재 경로 아래 폴더 이름 하나를 덧붙인 경로. 이름이 안전하지 않거나 기준 밖이면 null */
export function browserChild(
    bookmark: itfRemoteBookmark,
    path: string,
    name: string,
): string | null {
    if (!isRemoteSegmentName(name)) return null;
    const p = f_Remote(path, bookmark.remoteName);
    if (!p) return null;
    const cur = f_BaseOf(p);
    if (!f_WithinBase(bookmark.basePath, cur)) return null;
    const next = joinRemotePath(bookmark.remoteName, cur, name);
    const parsed = f_Remote(next, bookmark.remoteName);
    if (!parsed) return null;
    return f_WithinBase(bookmark.basePath, f_BaseOf(parsed)) ? parsed.normalized : null;
}

/** remote 루트("name:")인지. 루트는 작업 경로로 고를 수 없다 */
export function isBrowserRoot(path: string): boolean {
    const r = parsePath(path);
    return r.ok && r.path.kind === "remote" && r.path.segments.length === 0;
}

/** 더 보기: 앞에서 shown개만 */
export function visibleDirEntries(entries: readonly itfDirEntry[], shown: number): itfDirEntry[] {
    return entries.slice(0, Math.max(0, shown));
}
