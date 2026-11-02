/**
 * `rclone backend features <대상>` stdout 파서. 순수 함수, 예외를 던지지 않는다.
 *
 * - Features.Move: 서버 쪽 이동 지원(INT-003 FR-36 — 백업 폴더 sync 실행 조건, rclone-notes #30).
 * - Features.CanHaveEmptyDirectories: 빈 폴더를 만들 수 있는지(FR-30, rclone-notes #27).
 * - JSON이 아니거나 필드가 없거나 boolean이 아니면 그 값은 null(알 수 없음)이다.
 *   출력 Root·String에는 대상 경로가 들어가므로 이 파서는 기능 값만 꺼내고 원문을 남기지 않는다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { z } from "zod";

export interface itfBackendFeatures {
    /** 서버 쪽 이동(Move) 지원. 알 수 없으면 null */
    canMove: boolean | null;
    /** 빈 폴더를 만들 수 있는지. 알 수 없으면 null */
    canHaveEmptyDirs: boolean | null;
}

const zFeatureFlag = z.boolean().nullable().catch(null);

const zFeaturesOutput = z.object({
    Features: z.object({
        Move: zFeatureFlag.default(null),
        CanHaveEmptyDirectories: zFeatureFlag.default(null),
    }),
});

/** 알 수 없음(조회 실패·해석 실패) */
export const UNKNOWN_FEATURES: Readonly<itfBackendFeatures> = {
    canMove: null,
    canHaveEmptyDirs: null,
};

/** backend features stdout → 필요한 기능 값. 해석할 수 없으면 모두 null */
export function parseBackendFeatures(stdout: string): itfBackendFeatures {
    let json: unknown;
    try {
        json = JSON.parse(stdout);
    } catch {
        return { ...UNKNOWN_FEATURES };
    }
    const r = zFeaturesOutput.safeParse(json);
    if (!r.success) return { ...UNKNOWN_FEATURES };
    return {
        canMove: r.data.Features.Move,
        canHaveEmptyDirs: r.data.Features.CanHaveEmptyDirectories,
    };
}
