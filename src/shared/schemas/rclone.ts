/**
 * rclone 환경·경로 확인 IPC 입력 스키마 (rclone:detect / listRemotes / testPath).
 * 경로 형식 검사는 path-utils의 parsePath가 담당하고, 여기서는 모양과 길이만 본다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

/** rclone.conf 경로. null은 "감지된 설정 사용" */
export const zConfigPathInput = z.string().trim().min(1).max(4096).nullable();

export const zRcloneDetectInput = z.object({ force: z.boolean() }).strict();
export type typRcloneDetectInput = z.infer<typeof zRcloneDetectInput>;

export const zListRemotesInput = z.object({ configPath: zConfigPathInput.optional() }).strict();
export type typListRemotesInput = z.infer<typeof zListRemotesInput>;

export const zTestPathInput = z
    .object({
        // 빈 값은 parsePath가 VALIDATION으로 거부한다
        path: z.string().max(4096),
        configPath: zConfigPathInput.optional(),
    })
    .strict();
export type typTestPathInput = z.infer<typeof zTestPathInput>;
