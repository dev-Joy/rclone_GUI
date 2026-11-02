/**
 * 스케줄러 IPC 입력 스키마 (scheduler:setPaused). 알 수 없는 키는 거부한다.
 * 일시정지는 settings:update가 아니라 이 채널로만 바꾼다(해제 시 지난 예약 재조정).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { z } from "zod";

export const zSchedulerSetPausedInput = z.object({ paused: z.boolean() }).strict();
export type typSchedulerSetPausedInput = z.infer<typeof zSchedulerSetPausedInput>;

/**
 * second-instance additionalData(INT-003 T-01): 두 번째 프로세스가 `--run-job <id>`를 첫 프로세스에 넘길 때.
 * 형식이 다르면(데이터 없음·예전 버전) 사용자가 앱을 연 것으로 본다.
 */
export const zRunJobAdditionalData = z.object({ runJob: z.uuid() }).strict();
export type typRunJobAdditionalData = z.infer<typeof zRunJobAdditionalData>;
