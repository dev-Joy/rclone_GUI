/**
 * 실행(copy·sync, dry-run 포함) 화면 표시용 타입 (MVP_SPEC §5.5, §12). main이 만들고 화면이 표시한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type {
    typIsoDateString,
    typRunMode,
    typRunPhase,
    typRunStatus,
    typRunTrigger,
} from "@/shared/schemas/common";
import type { typRunRecord, typRunStats } from "@/shared/schemas/run";

export type typRunLogLevel = "debug" | "info" | "notice" | "warning" | "error";

/** 화면 로그 한 줄 (원문 전체는 실행 로그 파일에 있다) */
export interface itfRunLogLine {
    at: typIsoDateString;
    level: typRunLogLevel;
    message: string;
    /** rclone이 알려 준 대상 파일(상대 경로) */
    object?: string;
}

/** dry-run에서 rclone이 건너뛰었다고 알린 동작을 센 것 */
export interface itfDryRunSummary {
    copyFiles: number;
    copyBytes: number;
    deleteFiles: number;
    deleteBytes: number;
    /** 내용은 같고 수정시간만 맞출 파일 */
    touchFiles: number;
    /** 지울 빈 폴더 */
    removeDirs: number;
    /** 각 최대 DRY_RUN_SAMPLE_LIMIT개 (상대 경로) */
    copySamples: string[];
    deleteSamples: string[];
    touchSamples: string[];
}

/** 진행 중인 실행 (run:getActive, started 이벤트) */
export interface itfRunSnapshot {
    runId: string;
    jobId: string;
    jobName: string;
    mode: typRunMode;
    dryRun: boolean;
    trigger: typRunTrigger;
    status: typRunStatus;
    phase: typRunPhase;
    startedAt: typIsoDateString;
    stats: typRunStats | null;
    /** logs/ 기준 파일 이름 */
    logFile: string | null;
    /** 최근 로그(최대 RUN_TAIL_LINES줄) */
    tail: itfRunLogLine[];
    dryRunSummary: itfDryRunSummary | null;
    cancelRequested: boolean;
}

/** run:event. finished는 실행마다 맨 마지막에 한 번 온다 */
export type typRunEvent =
    | { type: "started"; snapshot: itfRunSnapshot }
    | { type: "phase"; runId: string; phase: typRunPhase; at: typIsoDateString }
    | { type: "stats"; runId: string; stats: typRunStats; at: typIsoDateString }
    | {
          type: "log";
          runId: string;
          lines: itfRunLogLine[];
          /** 묶음 상한을 넘어 화면에 보내지 않은 줄 수(로그 파일에는 있다) */
          dropped: number;
          at: typIsoDateString;
      }
    | {
          type: "finished";
          runId: string;
          record: typRunRecord;
          dryRunSummary: itfDryRunSummary | null;
      };

/** 화면·스냅샷에 남기는 최근 로그 줄 수 */
export const RUN_TAIL_LINES = 200;
/** dry-run 요약의 종류별 샘플 수 */
export const DRY_RUN_SAMPLE_LIMIT = 20;
