/**
 * 파일 내용 비교(diff) 응답 타입 (INT-009). main이 rclone cat으로 읽은 양쪽 내용을 화면에 전달한다.
 * 텍스트는 화면이 줄 단위로 비교하고, 바이너리·크기 초과·읽기 실패는 그 쪽 이유만 보여 준다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== Internal imports ==========
import type { typRunMode } from "@/shared/schemas/common";

/** 텍스트로 읽은 인코딩. UTF-8 엄격 디코딩이 실패하면 EUC-KR로 다시 읽는다(spec §10 Q-1) */
export type typFileTextEncoding = "utf-8" | "euc-kr";

/** 내용을 볼 수 있는 상태만 요청한다. typCompareStatus의 부분집합(equal·typeConflict 제외) */
export type typFileDiffStatus = "modified" | "onlySource" | "onlyDest";

/** 한쪽(원본 또는 대상)의 읽기 결과 */
export type typFileSideState =
    | { kind: "text"; text: string; encoding: typFileTextEncoding; bom: boolean; size: number }
    /** 그 쪽에 파일이 없다(onlySource의 대상, onlyDest의 원본) */
    | { kind: "absent" }
    /** 앞 8000바이트에 NUL이 있어 내용을 보내지 않는다 */
    | { kind: "binary"; size: number }
    /** 상한(2MB) 초과. truncated면 비교 뒤 커져서 잘렸다는 뜻 */
    | { kind: "tooLarge"; size: number; limit: number; truncated: boolean }
    /** 읽기 실패(시간 초과·rclone 오류). message에는 경로를 넣지 않는다 */
    | { kind: "error"; message: string };

export interface itfFileDiffData {
    /** 요청한 비교 항목의 표시 경로 */
    path: string;
    status: typFileDiffStatus;
    /** 비교할 때의 작업 모드(한쪽 미리보기 문구에 쓴다) */
    mode: typRunMode;
    source: typFileSideState;
    dest: typFileSideState;
}

/** 화면이 파일 행 메뉴·더블클릭에 넘기는 대상(상태로 진입 가능 여부를 가른다) */
export interface itfFileDiffTarget {
    path: string;
    status: typFileDiffStatus;
}
