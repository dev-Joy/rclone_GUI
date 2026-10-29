/**
 * 공용 제외 패턴 라이브러리 스키마와 타입 (INT-002 T-03). 저장소 행 검증과 IPC 입력 검증에 같이 쓴다.
 *
 * - 입력 패턴은 앞뒤 공백을 지운 뒤 libraryPatternIssue로 검사한다(#·; 시작·제어문자 거부).
 * - 수정·삭제는 화면이 보여준 사용 작업 목록(confirmedJobIds)을 함께 받는다.
 *   main의 지금 목록과 다르면 CONFIRM_REQUIRED로 다시 확인하게 한다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { libraryPatternIssue, normalizeExcludePattern } from "@/shared/exclude-patterns";
import { zIsoDate, type typRunMode } from "@/shared/schemas/common";

export const zExcludePatternText = z
    .string()
    .transform(normalizeExcludePattern)
    .superRefine((v, ctx) => {
        const m = libraryPatternIssue(v);
        if (m) ctx.addIssue({ code: "custom", message: m });
    });

export const zExcludePattern = z.object({
    id: z.uuid(),
    pattern: z.string(),
    createdAt: zIsoDate,
    updatedAt: zIsoDate,
});
export type typExcludePattern = z.infer<typeof zExcludePattern>;

const zConfirmedJobIds = z.array(z.uuid()).max(1000);

export const zExcludeCreateInput = z.object({ pattern: zExcludePatternText }).strict();
export const zExcludeUpdateInput = z
    .object({ id: z.uuid(), pattern: zExcludePatternText, confirmedJobIds: zConfirmedJobIds })
    .strict();
export const zExcludeDeleteInput = z
    .object({ id: z.uuid(), confirmedJobIds: zConfirmedJobIds })
    .strict();
export type typExcludeUpdateInput = z.infer<typeof zExcludeUpdateInput>;
export type typExcludeDeleteInput = z.infer<typeof zExcludeDeleteInput>;

/** 패턴을 쓰는 작업 */
export interface itfExcludeUser {
    jobId: string;
    jobName: string;
    mode: typRunMode;
    /** 자동 실행이 켜져 있는지 */
    auto: boolean;
}

export interface itfExcludePatternUsage extends typExcludePattern {
    usedBy: itfExcludeUser[];
}
