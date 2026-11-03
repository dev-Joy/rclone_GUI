/**
 * 옵션 길이·개수 한도 (INT-002 T-09).
 * 경로는 읽기·저장 입력 모두 4096자로 통일한다(깊은 UNC·확장 경로 보호, spec Q1 결정).
 * 제외 패턴은 --filter-from 파일로 넘기므로 개수 한도만 두고, Windows 명령줄 길이 한도도 여기서 정한다(INT-007).
 *
 * @author dev-Joy 2026-10-29
 */

/** 저장된 경로를 읽을 때의 한도 */
export const PATH_MAX_STORED = 4096;
/** 새로 저장하는 경로 입력 한도 */
export const PATH_MAX_INPUT = 4096;
/** 일반 옵션 문자열 한도(예약) */
export const OPTION_STRING_MAX = 256;
/** 제외 패턴 한 개 길이 */
export const EXCLUDE_PATTERN_MAX_LEN = 512;
/** 작업 전용 제외 패턴 수 */
export const JOB_EXCLUDES_MAX = 100;
/** 작업 하나에 걸리는 제외 패턴 합계(공용 + 작업 전용) */
export const EXCLUDES_TOTAL_MAX = 500;
/** 공용 제외 패턴 라이브러리 크기 */
export const EXCLUDE_LIBRARY_MAX = 1000;
/** remote 북마크 별칭 길이 */
export const REMOTE_ALIAS_MAX = 64;
/** rclone remote 이름 길이(":" 제외) */
export const REMOTE_NAME_MAX = 128;
/** remote 북마크 수 */
export const REMOTE_BOOKMARKS_MAX = 200;
/** 폴더 탐색 결과로 돌려줄 최대 항목 수 */
export const LIST_DIR_MAX = 500;
/** 폴더 탐색 화면에 한 번에 보여 줄 항목 수 */
export const LIST_DIR_PAGE = 200;
/** Windows CreateProcess 명령줄 최대 길이 */
export const WIN_CMDLINE_MAX = 32_767;
/** 명령줄 추정 오차 여유 */
export const CMDLINE_SAFETY_MARGIN = 512;
