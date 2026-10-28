/**
 * 비교 계획 토큰 (MVP_SPEC §7.4). 비교 결과를 만든 조건이 같은지 실행 직전에 확인하는 값이다.
 * 필드 순서를 배열로 고정해 객체 키 순서에 기대지 않는다. node:crypto를 쓰므로 main 전용.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { createHash } from "node:crypto";

// ========== Internal imports ==========
import type { typIsoDateString, typRunMode } from "@/shared/schemas/common";
import type { typJobRunOptions } from "@/shared/schemas/job";
import type { itfCompareSummary } from "@/shared/types/compare";

export interface itfPlanTokenInput {
    jobId: string;
    jobRev: number;
    createdAt: typIsoDateString;
    /** 정규화 경로 */
    source: string;
    destination: string;
    mode: typRunMode;
    excludes: readonly string[];
    options: Pick<
        typJobRunOptions,
        "checkHashes" | "modtimeToleranceMs" | "skipLinks" | "fastList"
    >;
    caseInsensitive: boolean;
    binaryPath: string;
    configPath: string | null;
    summary: itfCompareSummary;
}

/** sha256(고정 순서 배열의 JSON) hex 앞 32자 */
export function computePlanToken(input: itfPlanTokenInput): string {
    const s = input.summary;
    const o = input.options;
    const fields: unknown[] = [
        1,
        input.jobId,
        input.jobRev,
        input.createdAt,
        input.source,
        input.destination,
        input.mode,
        [...input.excludes],
        [o.checkHashes, o.modtimeToleranceMs, o.skipLinks, o.fastList],
        input.caseInsensitive,
        input.binaryPath,
        input.configPath,
        [
            s.sourceFiles,
            s.destFiles,
            s.createFiles,
            s.updateFiles,
            s.deleteFiles,
            s.sameFiles,
            s.conflictFiles,
            s.conflictGroups,
            s.createBytes,
            s.updateBytes,
            s.deleteBytes,
            s.transferBytes,
            s.caseOnlyFiles,
            s.hashComparedFiles,
            s.hashUnavailableFiles,
        ],
    ];
    return createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 32);
}
