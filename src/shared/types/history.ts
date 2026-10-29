/**
 * 실행 이력 화면 타입 (MVP_SPEC §11). history:readLog 결과.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import type { itfRunLogLine } from "@/shared/types/run";

/** history:readLog 기본·최대 읽기 크기 */
export const LOG_TAIL_DEFAULT_BYTES = 256 * 1024;
export const LOG_TAIL_MAX_BYTES = 1024 * 1024;

/** 실행 로그 파일 끝부분 */
export interface itfRunLogView {
    /** logs/ 기준 파일 이름. 이력에 로그 파일이 없으면 null */
    fileName: string | null;
    /** 파일이 남아 있는지(보관 기간이 지나 지워졌으면 false) */
    exists: boolean;
    sizeBytes: number;
    /** 앞부분을 잘라 끝부분만 읽었는지 */
    truncated: boolean;
    lines: itfRunLogLine[];
}
