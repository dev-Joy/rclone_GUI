/**
 * 취소·실패로 대상에 남은 rclone 임시 파일(`<이름>.<8자리 16진수>.partial`) 판정과 안내 문구.
 * 표시만 한다(정리·제외 규칙은 바꾸지 않음). rclone-notes #14·#17. Node·DOM 의존 없음.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import type { typRunRecord } from "@/shared/schemas/run";

/** 마지막 경로 요소: 이름 1자 이상 + "." + 16진수 8자리 + ".partial" (예: big.bin.74798c6b.partial) */
const RCLONE_PARTIAL_NAME = /^.+\.[0-9a-f]{8}\.partial$/i;

/** 화면(토스트·실행 결과·이력 상세)에 쓰는 안내 */
export const PARTIAL_LEFT_NOTICE =
    "실행이 멈춰 대상에 임시 파일(.partial)이 남을 수 있습니다. 다시 실행하거나 비교 화면에서 확인하세요.";

/** 자동 실행 알림에 덧붙이는 짧은 안내(경로 없음) */
export const PARTIAL_LEFT_NOTICE_SHORT = "대상에 임시 파일(.partial)이 남을 수 있습니다.";

/** 비교 목록·삭제 확인 창의 표시 */
export const PARTIAL_BADGE_TEXT = "취소로 남은 임시 파일";
export const PARTIAL_BADGE_TITLE =
    "rclone이 복사를 끝내지 못하고 남긴 임시 파일(.partial)입니다. 같은 원본을 다시 복사하면 없어집니다.";

/** 상대 경로의 마지막 요소가 rclone 임시 파일 이름인지 (`report.partial` 같은 사용자 파일은 아님) */
export function isRclonePartial(path: string): boolean {
    const parts = path.split(/[\\/]/);
    const name = parts[parts.length - 1] ?? "";
    return RCLONE_PARTIAL_NAME.test(name);
}

/** mayLeavePartial 입력. 자동 실행 결과처럼 레코드 일부만 있어도 된다 */
export type typPartialCheckInput = Pick<typRunRecord, "dryRun" | "status" | "transferStarted">;

/**
 * 실제 실행이 전송 단계에서 멈춰(취소·실패·비정상 종료) 대상에 `.partial`이 남을 수 있는지.
 * dry-run·사전 확인 단계에서 멈춤·rclone 시작 전 실패(transferStarted가 true가 아님)·성공은 false.
 */
export function mayLeavePartial(rec: typPartialCheckInput): boolean {
    if (rec.dryRun || rec.transferStarted !== true) return false;
    // interrupted: 실행 중 앱이 비정상 종료돼 다음 시작 때 정리된 기록
    return rec.status === "canceled" || rec.status === "failed" || rec.status === "interrupted";
}
