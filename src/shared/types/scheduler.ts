/**
 * 스케줄러 상태·앱 알림 타입 (MVP_SPEC §10, §12). main이 만들고 화면·트레이가 표시한다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import type { itfNextAutoRun } from "@/shared/schedule";
import type { typRunTrigger } from "@/shared/schemas/common";

/** scheduler:getState 결과와 scheduler:state 이벤트 */
export interface itfSchedulerState {
    /** 자동 실행 일시정지(진행 중 실행은 계속) */
    paused: boolean;
    /** 진행 중인 실행(수동·자동). 없으면 null */
    running: { jobId: string; jobName: string; trigger: typRunTrigger } | null;
    /** 다음 자동 실행. 켜진 작업이 없으면 null */
    next: itfNextAutoRun | null;
}

export type typAppNotifyLevel = "info" | "success" | "warning" | "error";

/** app:notify 이벤트: 창이 보이고 포커스가 있을 때 main이 보내는 알림(화면은 토스트로 표시) */
export interface itfAppNotify {
    level: typAppNotifyLevel;
    message: string;
}

/** Windows 작업 스케줄러에 등록한 작업 하나의 상태 (INT-003 T-01) */
export interface itfOsTaskStatus {
    jobId: string;
    registered: boolean;
    /** 등록된 <Command>가 지금 exe와 같은지. 출력 해독이 불확실하면 null */
    exeMatches: boolean | null;
    /** 마지막 등록·삭제 실패 문구(경로 없음). 없으면 null */
    error: string | null;
}

/** scheduler:osStatus 결과와 scheduler:osStatusChanged 이벤트 */
export interface itfOsScheduleStatus {
    available: boolean;
    /** available이 false인 이유(화면 표시) */
    reason: string | null;
    tasks: itfOsTaskStatus[];
}
