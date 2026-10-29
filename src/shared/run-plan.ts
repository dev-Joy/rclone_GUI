/**
 * 비교 요약 → 실행 계획, 계획과 dry-run 결과 맞춰 보기 (MVP_SPEC §8.4). 순수 함수.
 *
 * - copy는 대상에서 지우지 않으므로 삭제 예정 수가 항상 0이다.
 * - 내용이 같고 수정시간만 다른 파일은 diff에서 "변경"이지만 rclone은 복사하지 않고 시간만 맞춘다
 *   (rclone-notes #1). 그래서 "복사 + 시간만 맞춤 == 새 파일 + 변경"으로 맞춰 본다.
 * - 실제 sync 직전 사전 확인(checkPreflight)은 여기에 삭제 수(수집기·stats 둘 다)와 오류 0을 더 본다.
 *   바이트는 비교하지 않는다(시간만 맞춤 파일 때문에 계획 바이트와 달라질 수 있음, Phase 7 결정 D3).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typRunMode } from "@/shared/schemas/common";
import type { typRunPlan, typRunStats } from "@/shared/schemas/run";
import type { itfCompareSummary } from "@/shared/types/compare";
import type { itfDryRunSummary } from "@/shared/types/run";

/** 비교 요약으로 실행 계획을 만든다. copy는 삭제 0 */
export function planFromCompare(summary: itfCompareSummary, mode: typRunMode): typRunPlan {
    const deletes = mode === "sync";
    return {
        sourceFiles: summary.sourceFiles,
        destFiles: summary.destFiles,
        createFiles: summary.createFiles,
        updateFiles: summary.updateFiles,
        deleteFiles: deletes ? summary.deleteFiles : 0,
        transferBytes: summary.transferBytes,
        deleteBytes: deletes ? summary.deleteBytes : 0,
        conflictFiles: summary.conflictFiles,
        caseOnlyFiles: summary.caseOnlyFiles,
    };
}

/** 실행하면 대상에서 지울 파일 수 (실제 실행 전 확인한 수와 맞춰 본다) */
export function expectedDeletes(summary: itfCompareSummary, mode: typRunMode): number {
    return planFromCompare(summary, mode).deleteFiles;
}

export interface itfPlanMatch {
    ok: boolean;
    /** 다른 항목 설명. 예: "복사: 계획 4개, 미리보기 3개 + 시간만 맞춤 0개" */
    mismatches: string[];
}

/** 계획(비교)과 dry-run 결과가 같은 일을 하는지 */
export function matchPlanWithDryRun(plan: typRunPlan, dry: itfDryRunSummary): itfPlanMatch {
    const mismatches: string[] = [];
    const planned = plan.createFiles + plan.updateFiles;
    const actual = dry.copyFiles + dry.touchFiles;
    if (planned !== actual) {
        mismatches.push(
            `복사: 계획 ${planned}개, 미리보기 ${dry.copyFiles}개 + 시간만 맞춤 ${dry.touchFiles}개`,
        );
    }
    if (plan.deleteFiles !== dry.deleteFiles) {
        mismatches.push(`삭제: 계획 ${plan.deleteFiles}개, 미리보기 ${dry.deleteFiles}개`);
    }
    return { ok: mismatches.length === 0, mismatches };
}

/**
 * 실제 sync 직전 사전 확인(dry-run)이 계획과 같은지 (MVP_SPEC §8.4, S14).
 * matchPlanWithDryRun + stats.deletes == 계획 삭제 수 + stats.errors == 0. stats가 없으면 불일치로 본다.
 */
export function checkPreflight(
    plan: typRunPlan,
    dry: itfDryRunSummary,
    stats: typRunStats | null,
): itfPlanMatch {
    const mismatches = [...matchPlanWithDryRun(plan, dry).mismatches];
    if (stats === null) {
        mismatches.push("사전 확인 통계를 받지 못했습니다.");
    } else {
        if (stats.deletes !== plan.deleteFiles) {
            mismatches.push(`삭제(통계): 계획 ${plan.deleteFiles}개, 사전 확인 ${stats.deletes}개`);
        }
        if (stats.errors > 0) mismatches.push(`사전 확인 중 오류 ${stats.errors}건`);
    }
    return { ok: mismatches.length === 0, mismatches };
}
