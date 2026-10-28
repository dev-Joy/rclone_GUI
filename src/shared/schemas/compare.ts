/**
 * 비교 IPC 입력 스키마 (compare:run / cancel / get).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

export const zCompareJobInput = z.object({ jobId: z.uuid() }).strict();
export type typCompareJobInput = z.infer<typeof zCompareJobInput>;
