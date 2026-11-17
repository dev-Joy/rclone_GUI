/**
 * 작업 그룹 스키마와 타입 (INT-008 FR-17).
 * 그룹은 작업 목록을 묶어 보는 이름일 뿐이며 실행에는 영향을 주지 않는다.
 * 그룹 지정은 jobs.group_id 열이 원본이고 작업 저장 입력(zJobDraft·zJobPatch)에는 넣지 않는다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import type { typIsoDateString } from "@/shared/schemas/common";

/** 그룹 id. main이 `g-<난수>`로 만든다(1세대와 같은 형식) */
export const zGroupId = z.string().regex(/^g-[a-z0-9-]{1,40}$/);

/** 그룹 만들기·이름 바꾸기 입력. id가 없으면 새 그룹 */
export const zGroupSave = z
    .object({
        id: zGroupId.optional(),
        name: z.string().trim().min(1, "그룹 이름을 입력하세요.").max(50),
    })
    .strict();
export type typGroupSaveInput = z.infer<typeof zGroupSave>;

export interface itfGroup {
    id: string;
    name: string;
    /** 목록에서 보이는 순서(작을수록 위) */
    position: number;
    createdAt: typIsoDateString;
    updatedAt: typIsoDateString;
}

/** groups:delete 입력 */
export const zGroupDeleteInput = z.object({ id: zGroupId });

/** jobs:setGroup 입력. groupId가 null이면 그룹 없음 */
export const zJobSetGroupInput = z.object({ id: z.uuid(), groupId: zGroupId.nullable() });
export type typJobSetGroupInput = z.infer<typeof zJobSetGroupInput>;
