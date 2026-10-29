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
