/**
 * 비교 IPC 입력 스키마 (compare:run / cancel / get / fileDiff).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

export const zCompareJobInput = z.object({ jobId: z.uuid() }).strict();
export type typCompareJobInput = z.infer<typeof zCompareJobInput>;

/** compare:fileDiff — renderer는 경로만 보내고 main이 캐시된 비교 항목에서 실제 경로를 얻는다 */
export const zCompareFileDiffInput = z
    .object({ jobId: z.uuid(), path: z.string().min(1).max(4096) })
    .strict();
export type typCompareFileDiffInput = z.infer<typeof zCompareFileDiffInput>;
