/**
 * 파일 선택 대화상자·외부 링크 열기 IPC 입력 스키마 (dialog:* / system:openExternal).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

export const zDialogFilter = z
    .object({
        name: z.string().trim().min(1).max(50),
        extensions: z
            .array(z.string().regex(/^(\*|[A-Za-z0-9]{1,10})$/))
            .min(1)
            .max(10),
    })
    .strict();
export type typDialogFilter = z.infer<typeof zDialogFilter>;

export const zPickDirectoryInput = z
    .object({
        title: z.string().max(200).optional(),
        defaultPath: z.string().max(4096).optional(),
    })
    .strict();
export type typPickDirectoryInput = z.infer<typeof zPickDirectoryInput>;

export const zPickFileInput = z
    .object({
        title: z.string().max(200).optional(),
        filters: z.array(zDialogFilter).max(5).optional(),
    })
    .strict();
export type typPickFileInput = z.infer<typeof zPickFileInput>;

export const zOpenExternalInput = z.object({ url: z.url().max(2048) }).strict();
export type typOpenExternalInput = z.infer<typeof zOpenExternalInput>;
