/**
 * 편집기 경고용 대상 빈 폴더 가능 여부 훅 (INT-003 FR-32).
 * 범위가 '전체'이고 대상이 remote일 때만 remote 루트가 400ms 동안 그대로면 main의 remotes:features를 부른다.
 * 결과는 (루트, configPath) 키와 같을 때만 돌려주고, 그 밖·실패·조회 중은 null. 마지막 요청만 반영한다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { useEffect, useState } from "react";

// ========== Internal imports ==========
import { getApi, unwrap } from "@/lib/api";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { createLatestGate } from "@/shared/latest-request";
import { parsePath } from "@/shared/path-utils";

/** 입력이 멈춘 뒤 조회까지 기다리는 시간 */
const QUERY_DELAY_MS = 400;

interface itfEmptyDirResult {
    key: string;
    value: boolean | null;
}

/** 조회 키: 해석되는 remote 경로면 remote 루트("name:"), 아니면 null(로컬·UNC·입력 중). 순수 */
export function emptyDirQueryRoot(destination: string): string | null {
    const parsed = parsePath(destination);
    if (!parsed.ok || parsed.path.kind !== "remote") return null;
    return parsed.path.root;
}

/**
 * 대상이 빈 폴더를 만들 수 있는지. enabled가 아니면 null, 로컬·UNC는 조회하지 않고 true,
 * remote는 조회 결과(실패·알 수 없음·조회 중은 null). 실패는 알리지 않는다(경고를 띄우지 않을 뿐)
 */
export function useEmptyDirSupport(
    destination: string,
    configPath: string | null,
    enabled: boolean,
): boolean | null {
    // ========== hook & state 변수 선언 ==========
    const [result, setResult] = useState<itfEmptyDirResult | null>(null);
    const [gate] = useState(createLatestGate);
    const root = enabled ? emptyDirQueryRoot(destination) : null;
    const key = JSON.stringify([root, configPath]);
    const settled = useDebouncedValue(key, QUERY_DELAY_MS);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        // 입력이 멈춘 뒤(settled === key)에만 조회한다
        if (root === null || settled !== key) return;
        const isLatest = gate.next();
        void (async () => {
            let value: boolean | null = null;
            try {
                const r = await unwrap(getApi().remotes.features({ path: root, configPath }));
                value = r.canHaveEmptyDirs;
            } catch {
                value = null;
            }
            if (isLatest()) setResult({ key, value });
        })();
        return () => gate.invalidate();
    }, [root, configPath, key, settled, gate]);

    // ========== 내부 변수 (_V) ==========
    if (!enabled) return null;
    if (root === null) {
        const parsed = parsePath(destination);
        return parsed.ok ? true : null;
    }
    return result !== null && result.key === key ? result.value : null;
}
