/**
 * remote 북마크 경로 조합 (INT-002 T-02). Node·DOM 의존 없음.
 * remote 이름과 기준 경로를 "name:base" 형태로 합치고, 폴더 이름 하나를 안전하게 덧붙인다.
 * 실제 경로 해석·정규화는 path-utils의 parsePath가 담당한다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== Internal imports ==========
import { PATH_MAX_INPUT } from "@/shared/option-limits";
import { parsePath } from "@/shared/path-utils";

export type typRemoteBasePathResult =
    | { ok: true; basePath: string }
    | { ok: false; message: string };

function f_Fail(message: string): typRemoteBasePathResult {
    return { ok: false, message };
}

/**
 * remote 기준 경로를 정규화한다. "name:" 뒤의 경로만 돌려준다(선두 "/"는 보존).
 * 빈 값은 remote 루트("")다. "."·".."·제어문자·잘못된 remote 이름은 거부한다.
 */
export function normalizeRemoteBasePath(remoteName: string, raw: string): typRemoteBasePathResult {
    const name = remoteName.trim();
    if (name === "") return f_Fail("remote 이름을 입력하세요.");
    const text = `${name}:${raw.trim()}`;
    if (text.length > PATH_MAX_INPUT) {
        return f_Fail(`경로는 ${PATH_MAX_INPUT}자 이내로 입력하세요.`);
    }
    const parsed = parsePath(text);
    if (!parsed.ok) return f_Fail(parsed.issue.message);
    if (parsed.path.kind !== "remote") return f_Fail("remote 경로가 아닙니다.");
    if (parsed.path.root !== `${name}:`) return f_Fail("remote 이름과 경로가 맞지 않습니다.");
    return { ok: true, basePath: parsed.path.normalized.slice(parsed.path.root.length) };
}

/** "name:" + 기준 경로. 기준 경로는 normalizeRemoteBasePath 결과를 쓴다 */
export function composeRemotePath(remoteName: string, basePath: string): string {
    return `${remoteName}:${basePath}`;
}

/** 기준 경로 아래에 폴더 이름 하나를 덧붙인다. 이름은 isRemoteSegmentName을 통과해야 한다 */
export function joinRemotePath(remoteName: string, basePath: string, segment: string): string {
    const base = basePath === "" || basePath.endsWith("/") ? basePath : `${basePath}/`;
    return `${remoteName}:${base}${segment}`;
}

/** 폴더 목록에서 받은 이름 하나를 경로 조각으로 쓸 수 있는지 */
export function isRemoteSegmentName(name: string): boolean {
    if (name === "" || name !== name.trim()) return false;
    if (name === "." || name === "..") return false;
    if (name.length > 255) return false;
    if (/[\\/]/.test(name)) return false;
    // oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
    return !/[\u0000-\u001f\u007f]/.test(name);
}
