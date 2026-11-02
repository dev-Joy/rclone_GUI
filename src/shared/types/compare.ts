/**
 * 비교 결과 타입 (MVP_SPEC §5.4). main이 만들고 화면이 표시한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typIsoDateString, typRunMode } from "@/shared/schemas/common";
import type { typSyncScope } from "@/shared/schemas/job";

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
    /** 전체 범위에서만: 파일이 없는 원본 전용 폴더(--create-empty-src-dirs 때문에만 생김) */
    createDirs: number;
    /** 전체 범위에서만: 대상에만 있는 폴더 전부(sync면 지워짐) */
    deleteDirs: number;
}

/** 전체 범위의 폴더 변화(파일 5상태와 섞지 않는다, spec Q4) */
export interface itfDirChange {
    path: string;
    action: "create" | "delete";
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
    /** 비교할 때의 동기화 범위 */
    scope: typSyncScope;
    method: itfCompareMethod;
    /** 대상 폴더가 없어 빈 목록으로 비교했다(실행하면 새로 만든다) */
    destMissing: boolean;
    /**
     * 대상이 빈 폴더를 만들 수 있는지(INT-003 FR-30·FR-31). 로컬·UNC는 true,
     * remote는 backend features의 CanHaveEmptyDirectories, 조회 실패·알 수 없음은 null(지금처럼 동작).
     * 파일만 범위의 remote 대상은 조회하지 않고 null(결정 D-3)
     */
    destCanHaveEmptyDirs: boolean | null;
    summary: itfCompareSummary;
    /** 경로 키 오름차순 */
    entries: itfDiffEntry[];
    /** 폴더 변화, 경로 오름차순(파일만 범위면 []) */
    dirChanges: itfDirChange[];
    warnings: string[];
    planToken: string;
    /** 비교에 쓴 제외 패턴·전달 방식 해시. 실행 시점 값과 다르면 PLAN_STALE */
    excludeHash: string;
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
