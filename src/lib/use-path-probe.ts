/**
 * 경로 접근 확인 훅. main의 rclone:testPath를 부르고 마지막 요청 결과만 반영한다.
 * 결과에는 확인한 경로·설정 파일을 같이 남겨, 입력이 바뀌면 쓰는 쪽에서 isFor()로 지난 결과를 숨긴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useCallback, useState } from "react";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import type { itfPathProbe } from "@/shared/ipc-contract";
import { createLatestGate } from "@/shared/latest-request";

interface itfProbeResult {
    path: string;
    configPath: string | null;
    probe: itfPathProbe | null;
    error: string | null;
}

export interface itfPathProbeState {
    probe: itfPathProbe | null;
    error: string | null;
    checking: boolean;
    /** 마지막 호출 결과만 반영 (createLatestGate). configPath null이면 main이 설정값을 쓴다 */
    check: (path: string, configPath: string | null) => Promise<void>;
    /** 진행 중 요청 무효화 + 결과 지움 */
    reset: () => void;
    /** 지금 결과가 이 입력에 대한 것인지 */
    isFor: (path: string, configPath: string | null) => boolean;
}

export function usePathProbe(): itfPathProbeState {
    const [result, setResult] = useState<itfProbeResult | null>(null);
    const [checkingFor, setCheckingFor] = useState<string | null>(null);
    const [gate] = useState(createLatestGate);

    const check = useCallback(
        async (path: string, configPath: string | null) => {
            const isLatest = gate.next();
            setCheckingFor(path);
            try {
                const api = getApi().rclone;
                const probe = await unwrap(
                    configPath === null ? api.testPath(path) : api.testPath(path, configPath),
                );
                if (isLatest()) setResult({ path, configPath, probe, error: null });
            } catch (e) {
                if (isLatest()) setResult({ path, configPath, probe: null, error: errorText(e) });
            } finally {
                if (isLatest()) setCheckingFor(null);
            }
        },
        [gate],
    );

    const reset = useCallback(() => {
        gate.invalidate();
        setCheckingFor(null);
        setResult(null);
    }, [gate]);

    const isFor = useCallback(
        (path: string, configPath: string | null) =>
            result !== null && result.path === path && result.configPath === configPath,
        [result],
    );

    return {
        probe: result?.probe ?? null,
        error: result?.error ?? null,
        checking: checkingFor !== null,
        check,
        reset,
        isFor,
    };
}
