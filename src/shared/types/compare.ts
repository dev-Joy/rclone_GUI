/**
 * 비교 결과 타입 (MVP_SPEC §5.4). main이 만들고 화면이 표시한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typIsoDateString } from "@/shared/schemas/common";

export type typCompareStatus = "onlySource" | "onlyDest" | "modified" | "equal" | "typeConflict";
export type typModifiedReason = "size" | "mtime" | "hash" | "type" | "mtimeUnknown";

/** lsjson 한 항목에서 비교에 쓰는 값만 남긴 것 */
export interface itfFileMeta {
    /** "/" 구분 상대 경로 (rclone 원문) */
    path: string;
    size: number;
    modTimeMs: number | null;
    /** 소문자 알고리즘 이름 → 해시 값. --hash 없이 나열했으면 null */
    hashes: Record<string, string> | null;
}

export interface itfDiffSide {
    path: string;
    size: number;
    modTimeMs: number | null;
}

export interface itfDiffEntry {
    /** 표시 기준 경로 (원본 우선) */
    path: string;
    status: typCompareStatus;
    reasons: typModifiedReason[];
    source: itfDiffSide | null;
    dest: itfDiffSide | null;
    /** 양쪽 경로가 대소문자(또는 유니코드 정규화)만 다름 */
    caseOnly: boolean;
    /** 실제 비교에 쓴 공통 해시 알고리즘 (값은 보관하지 않음) */
    hashAlgo: string | null;
    hashUnavailable: boolean;
}

export interface itfCompareSummary {
    sourceFiles: number;
    destFiles: number;
    createFiles: number;
    updateFiles: number;
    deleteFiles: number;
    sameFiles: number;
    conflictFiles: number;
    conflictGroups: number;
    createBytes: number;
    updateBytes: number;
    deleteBytes: number;
    transferBytes: number;
    caseOnlyFiles: number;
    hashComparedFiles: number;
    hashUnavailableFiles: number;
}

export interface itfCompareResult {
    jobId: string;
    jobRev: number;
    createdAt: typIsoDateString;
    durationMs: number;
    summary: itfCompareSummary;
    /** 경로 키 오름차순 */
    entries: itfDiffEntry[];
    warnings: string[];
    planToken: string;
}
