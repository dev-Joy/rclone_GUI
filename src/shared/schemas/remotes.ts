/**
 * remote 북마크 IPC 입력 스키마 (INT-002 T-02).
 * 경로 형식 검사는 path-utils의 parsePath와 remote-path의 normalize가 담당하고,
 * 여기서는 모양과 길이만 본다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { PATH_MAX_INPUT, REMOTE_ALIAS_MAX, REMOTE_NAME_MAX } from "@/shared/option-limits";
import { zConfigPathInput } from "@/shared/schemas/rclone";

const zNoControlChars = (max: number) =>
    z
        .string()
        .max(max)
        // oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
        .refine((v) => !/[\u0000-\u001f]/.test(v), "제어문자(줄바꿈 포함)는 쓸 수 없습니다.");

/** 북마크 별칭. 앞뒤 공백은 지운다 */
export const zRemoteAlias = z
    .string()
    .trim()
    .min(1, "별칭을 입력하세요.")
    .pipe(zNoControlChars(REMOTE_ALIAS_MAX));

/** rclone.conf의 remote 이름(":" 제외) */
export const zRemoteName = z
    .string()
    .trim()
    .min(1, "리모트를 고르세요.")
    .pipe(zNoControlChars(REMOTE_NAME_MAX));

/** remote 기준 경로. 빈 값은 remote 루트 */
export const zRemoteBasePath = z.string().max(PATH_MAX_INPUT);

export const zRemoteCreateInput = z
    .object({
        alias: zRemoteAlias,
        remoteName: zRemoteName,
        basePath: zRemoteBasePath,
    })
    .strict();
export type typRemoteCreateInput = z.infer<typeof zRemoteCreateInput>;

export const zRemoteUpdateInput = z
    .object({
        id: z.uuid(),
        alias: zRemoteAlias,
        remoteName: zRemoteName,
        basePath: zRemoteBasePath,
    })
    .strict();
export type typRemoteUpdateInput = z.infer<typeof zRemoteUpdateInput>;

export const zRemoteIdInput = z.object({ id: z.uuid() }).strict();
export type typRemoteIdInput = z.infer<typeof zRemoteIdInput>;

/** 폴더 탐색 입력. configPath는 이 작업의 rclone.conf(null = 감지된 설정) */
export const zListDirInput = z
    .object({
        path: z.string().trim().min(1).max(PATH_MAX_INPUT),
        configPath: zConfigPathInput.optional(),
    })
    .strict();
export type typListDirInput = z.infer<typeof zListDirInput>;
