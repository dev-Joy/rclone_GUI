/**
 * remote 설정 IPC 입력 스키마 (INT-006 T-03·T-05).
 * 옵션 값은 rcd HTTP 본문으로만 넘어가며 명령줄에 나오지 않는다.
 * 옵션 이름·값의 모양만 보고, providers 정의와의 대조는 main 서비스가 한다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { REMOTE_NAME_MAX } from "@/shared/option-limits";

/** 옵션 이름: providers의 snake_case 이름. `=`·제어문자는 rclone 설정 문법을 깨뜨린다 */
const zRemoteOptionName = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine((v) => !v.includes("="), "옵션 이름에 =를 넣을 수 없습니다.")
    // oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
    .refine((v) => !/[\u0000-\u001f]/.test(v), "옵션 이름에 제어문자를 넣을 수 없습니다.");

/** 옵션 값: 개행·NUL은 rclone 설정을 깨뜨리므로 거부한다 */
const zRemoteOptionValue = z
    .string()
    .max(4096)
    // oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
    .refine((v) => !/[\u0000-\u001f]/.test(v), "옵션 값에 줄바꿈·제어문자를 넣을 수 없습니다.");

const zRemoteOptionMap = z.record(zRemoteOptionName, zRemoteOptionValue);

const zRemoteConfigName = z.string().trim().min(1, "이름을 입력하세요.").max(REMOTE_NAME_MAX);

export const zRemoteConfigNameInput = z.object({ name: zRemoteConfigName }).strict();
export type typRemoteConfigNameInput = z.infer<typeof zRemoteConfigNameInput>;

export const zRemoteConfigCreateInput = z
    .object({
        name: zRemoteConfigName,
        type: z.string().trim().min(1).max(64),
        /** 비밀 아닌 값. 빈 값은 보내지 않는다 */
        values: zRemoteOptionMap,
        /** 비밀 평문. main은 rcd 본문에만 넣고 보관하지 않는다 */
        secrets: zRemoteOptionMap,
    })
    .strict();
export type typRemoteConfigCreateInput = z.infer<typeof zRemoteConfigCreateInput>;

export const zRemoteConfigUpdateInput = z
    .object({
        name: zRemoteConfigName,
        /** 바뀐 칸만 */
        values: zRemoteOptionMap,
        /** 바꿀 비밀 칸만(비워 두면 기존 값 유지) */
        secrets: zRemoteOptionMap,
    })
    .strict();
export type typRemoteConfigUpdateInput = z.infer<typeof zRemoteConfigUpdateInput>;

export const zRemoteConfigDeleteInput = z
    .object({
        name: zRemoteConfigName,
        /** 예약 켜진 참조 작업의 자동 실행을 끄고 지우는 데 동의했는지 */
        disableSchedules: z.boolean().optional(),
    })
    .strict();
export type typRemoteConfigDeleteInput = z.infer<typeof zRemoteConfigDeleteInput>;

export const zRemoteConfigAnswerInput = z
    .object({
        state: z.string().min(1).max(200),
        result: zRemoteOptionValue,
    })
    .strict();
export type typRemoteConfigAnswerInput = z.infer<typeof zRemoteConfigAnswerInput>;
