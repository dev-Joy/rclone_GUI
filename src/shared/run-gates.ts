/**
 * 실제 실행 안전 게이트 (MVP_SPEC §9.1 S5·S6·S7·S11·S15, §8.4). 순수 함수.
 * main(run-service 재검증)과 화면(실행 버튼·삭제 확인 모달)이 같은 함수를 쓴다.
 *
 * - checkPlanSafety: 확인해도 넘길 수 없는 차단(형식 충돌·대소문자만 다름·빈 원본 sync·백업 없는 오류 무시 sync).
 * - isLargeDelete: 대량 삭제(추가 확인 필요). 기준값을 엄격히 넘을 때만이며, 기준값 0이면 삭제 1개도 대량이다.
 * - needsPreflight: 실제 sync 직전 같은 실행 안에서 사전 확인 dry-run을 할지(폴더 삭제만 있어도 한다).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import type { typErrorCode } from "@/shared/errors";
import { plannedDeleteCount } from "@/shared/run-plan";
import type { typJob } from "@/shared/schemas/job";
import type { typRunPlan } from "@/shared/schemas/run";
import type { typSettings } from "@/shared/schemas/settings";

/**
 * 동기화 + ‘오류가 나도 계속’ + 백업 폴더 없음 → 실행 차단 안내(편집기·옵션·실행 공통, INT-003 FR-26·FR-29).
 */
export const SYNC_IGNORE_ERRORS_TEXT =
    "동기화에서 ‘오류가 나도 계속’을 쓰려면 백업 폴더를 지정하세요. 백업 폴더가 없으면 실행하지 않습니다. 오류 난 파일만 건너뛰고 계속하려면 복사 모드를 쓰세요.";

/** 백업 폴더 안내(편집기, INT-003 FR-28·FR-29) */
export const BACKUP_DIR_NOTE_TEXT =
    "지우거나 덮어쓸 대상 파일은 실행마다 백업 폴더 아래 ‘날짜_시각_작업ID’ 폴더로 옮깁니다. 앱은 백업 폴더를 지우지 않으니 직접 정리하세요.";

/** 게이트에 걸린 이유 (IPC 오류로 그대로 쓴다) */
export interface itfGateBlock {
    code: typErrorCode;
    message: string;
}

export type typDeleteThresholds = Pick<
    typSettings["safety"],
    "deleteConfirmFiles" | "deleteConfirmPercent"
>;

type typGateJob = Pick<typJob, "mode" | "backupDir"> & {
    options: Pick<typJob["options"], "ignoreErrors" | "preflightBeforeDestructive">;
};

/**
 * 대량 삭제인지(S11). deleteFiles > 기준 개수 또는 대상 파일 수 대비 비율 > 기준 %.
 * 대상 파일이 0개인데 삭제가 있으면(있을 수 없는 계획) 대량으로 본다.
 */
export function isLargeDelete(
    plan: Pick<typRunPlan, "deleteFiles" | "destFiles">,
    safety: typDeleteThresholds,
): boolean {
    const d = plan.deleteFiles;
    if (d <= 0) return false;
    return d > safety.deleteConfirmFiles || d * 100 > plan.destFiles * safety.deleteConfirmPercent;
}

/** 확인으로 넘길 수 없는 차단. 통과하면 null. 순서: S5 → S6 → S7 → S15 */
export function checkPlanSafety(plan: typRunPlan, job: typGateJob): itfGateBlock | null {
    if (plan.conflictFiles > 0) {
        return {
            code: "SAFETY_BLOCKED",
            message: `파일과 폴더 이름이 겹치는 항목(${plan.conflictFiles}개)이 있어 실행할 수 없습니다. 직접 정리한 뒤 다시 비교하세요.`,
        };
    }
    if (plan.caseOnlyFiles > 0) {
        return {
            code: "SAFETY_BLOCKED",
            message: `대소문자만 다른 항목(${plan.caseOnlyFiles}개)이 있어 실행할 수 없습니다. 직접 정리한 뒤 다시 비교하세요.`,
        };
    }
    if (job.mode === "sync" && plan.sourceFiles === 0 && plan.destFiles > 0) {
        return {
            code: "EMPTY_SOURCE_BLOCKED",
            message: `원본에 파일이 없어 대상 파일 ${plan.destFiles}개를 모두 지우게 되므로 막았습니다. 원본 경로를 확인하세요.`,
        };
    }
    if (job.mode === "sync" && job.options.ignoreErrors && job.backupDir === null) {
        return {
            code: "SAFETY_BLOCKED",
            message: SYNC_IGNORE_ERRORS_TEXT,
        };
    }
    return null;
}

/** 실제 sync 직전에 사전 확인 dry-run을 할지: sync + 삭제(파일 또는 폴더) 있음 + 작업 옵션 켜짐 */
export function needsPreflight(
    plan: Pick<typRunPlan, "deleteFiles" | "deleteDirs">,
    job: typGateJob,
): boolean {
    return (
        job.mode === "sync" &&
        plannedDeleteCount(plan) > 0 &&
        job.options.preflightBeforeDestructive
    );
}
