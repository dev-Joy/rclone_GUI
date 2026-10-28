/**
 * 비교 결과 타입 (MVP_SPEC §5.4). main이 만들고 화면이 표시한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typIsoDateString, typRunMode } from "@/shared/schemas/common";

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

/** 결과에 비교 방식을 남긴다(화면 표시·Phase 7 게이트) */
export interface itfCompareMethod {
    checkHashes: boolean;
    modtimeToleranceMs: number;
    caseInsensitive: boolean;
}

export interface itfCompareResult {
    jobId: string;
    jobRev: number;
    createdAt: typIsoDateString;
    durationMs: number;
    /** 비교할 때의 작업 모드(onlyDest 표시: copy 유지 / sync 삭제 예정) */
    mode: typRunMode;
    method: itfCompareMethod;
    /** 대상 폴더가 없어 빈 목록으로 비교했다(실행하면 새로 만든다) */
    destMissing: boolean;
    summary: itfCompareSummary;
    /** 경로 키 오름차순 */
    entries: itfDiffEntry[];
    warnings: string[];
    planToken: string;
}

/** 비교 진행 단계: 경로 확인 → 목록 읽기 → 차이 계산 */
export type typComparePhase = "check" | "list" | "diff";
/** 진행 이벤트 단계(종료 3종 포함) */
export type typCompareEventPhase = typComparePhase | "done" | "failed" | "canceled";

/** 진행 중인 비교(앱 전역 하나) */
export interface itfCompareActive {
    jobId: string;
    phase: typComparePhase;
    startedAt: typIsoDateString;
    sourceFiles: number;
    destFiles: number;
}

/** compare:progress 이벤트 */
export interface itfCompareProgress {
    jobId: string;
    phase: typCompareEventPhase;
    sourceFiles: number;
    destFiles: number;
    at: typIsoDateString;
}
