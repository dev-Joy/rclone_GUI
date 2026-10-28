/**
 * 앱 전체 에러 코드와 사용자용 기본 메시지. IPC 응답의 error.code로 쓴다.
 *
 * @author dev-Joy 2026-10-28
 */

export const ERROR_CODES = [
    "VALIDATION",
    "NOT_FOUND",
    "BUSY",
    "RCLONE_NOT_FOUND",
    "RCLONE_NOT_EXECUTABLE",
    "RCLONE_VERSION_UNSUPPORTED",
    "RCLONE_FAILED",
    "RCLONE_PARSE_ERROR",
    "COMMAND_BLOCKED",
    "PATH_INVALID",
    "PATH_NOT_FOUND",
    "PATH_NOT_DIRECTORY",
    "CASE_COLLISION",
    "CONFIG_REQUIRED",
    "CONFIG_NOT_FOUND",
    "PLAN_REQUIRED",
    "PLAN_STALE",
    "PLAN_DRIFT",
    "SAFETY_BLOCKED",
    "EMPTY_SOURCE_BLOCKED",
    "MAX_DELETE_EXCEEDED",
    "CANCELED",
    "STORE_ERROR",
    "STORE_VERSION_UNSUPPORTED",
    "FORBIDDEN_SENDER",
    "INTERNAL",
] as const;

export type typErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Record<typErrorCode, string> = {
    VALIDATION: "입력값을 확인하세요.",
    NOT_FOUND: "대상을 찾을 수 없습니다.",
    BUSY: "다른 작업이 실행 중입니다.",
    RCLONE_NOT_FOUND: "rclone을 찾지 못했습니다.",
    RCLONE_NOT_EXECUTABLE: "rclone을 실행할 수 없습니다.",
    RCLONE_VERSION_UNSUPPORTED: "rclone 업그레이드가 필요합니다.",
    RCLONE_FAILED: "rclone 실행에 실패했습니다.",
    RCLONE_PARSE_ERROR: "rclone 출력을 해석하지 못했습니다.",
    COMMAND_BLOCKED: "위험한 rclone 옵션이 포함되어 실행을 막았습니다.",
    PATH_INVALID: "경로 형식이 올바르지 않습니다.",
    PATH_NOT_FOUND: "경로를 찾을 수 없습니다.",
    PATH_NOT_DIRECTORY: "폴더 경로가 아닙니다.",
    CASE_COLLISION: "대소문자만 다른 파일이 같은 폴더에 있어 비교할 수 없습니다.",
    CONFIG_REQUIRED: "rclone 설정 파일을 확인하세요.",
    CONFIG_NOT_FOUND: "rclone 설정 파일을 찾을 수 없습니다.",
    PLAN_REQUIRED: "먼저 비교하세요.",
    PLAN_STALE: "비교 결과가 오래되었습니다. 다시 비교하세요.",
    PLAN_DRIFT: "비교 후 변경이 감지되었습니다. 다시 비교하세요.",
    SAFETY_BLOCKED: "안전 규칙으로 실행이 차단되었습니다.",
    EMPTY_SOURCE_BLOCKED: "원본이 비어 있어 대상 삭제를 막았습니다.",
    MAX_DELETE_EXCEEDED: "삭제 안전 한도를 넘어 중단했습니다.",
    CANCELED: "취소되었습니다.",
    STORE_ERROR: "설정 저장에 실패했습니다.",
    STORE_VERSION_UNSUPPORTED: "지원하지 않는 저장 파일 버전입니다.",
    FORBIDDEN_SENDER: "허용되지 않은 요청입니다.",
    INTERNAL: "내부 오류가 발생했습니다.",
};
