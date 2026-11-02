/**
 * 앱 시작 인자 파서(순수, INT-003 T-01 FR-13).
 *
 * - `--hidden`: 로그인 시 시작(창 없이 트레이).
 * - `--run-job <uuid>`: Windows 작업 스케줄러가 띄운 헤드리스 실행. 이 인자가 있을 때만 엄격하게 본다:
 *   값 없음·uuid 아님·`--run-job=<id>` 형식·두 번·`--`로 시작하지 않는 위치 인자는 invalid(종료 코드 2).
 *   그 밖의 `--xxx` 스위치는 무시한다(Chromium·Electron이 덧붙일 수 있음).
 * - 인자 값은 로그에 남기지 않는다(호출자 책임). 여기서는 reason만 돌려준다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== Internal imports ==========
import { OS_RUN_JOB_ARG } from "@/main/services/os-scheduler";
import { zRunJobAdditionalData } from "@/shared/schemas/scheduler";

/**
 *  Types · 상수
 */
export const RUN_JOB_ARG = OS_RUN_JOB_ARG;
/** 로그인 시 시작 인자: 창 없이 트레이로 시작 */
export const HIDDEN_ARG = "--hidden";

export type typRunJobInvalidReason = "missingValue" | "badUuid" | "duplicate" | "positional";

export type typRunJobArg =
    | { kind: "none" }
    /** jobId는 소문자로 정규화 */
    | { kind: "ok"; jobId: string }
    | { kind: "invalid"; reason: typRunJobInvalidReason };

export interface itfLaunchArgs {
    hidden: boolean;
    runJob: typRunJobArg;
}

/**
 *  export 함수
 */

/**
 * 시작 인자를 해석한다.
 * @param skip 앞에서 건너뛸 개수(설치본 1, 개발 실행 process.defaultApp이면 2)
 */
export function parseLaunchArgs(argv: readonly string[], skip: number): itfLaunchArgs {
    const args = argv.slice(Math.max(0, skip));
    const hidden = args.includes(HIDDEN_ARG);
    const hasRunJob = args.some((a) => a === RUN_JOB_ARG || a.startsWith(`${RUN_JOB_ARG}=`));
    if (!hasRunJob) return { hidden, runJob: { kind: "none" } };

    let value: string | null = null;
    let count = 0;
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i]!;
        if (a.startsWith(`${RUN_JOB_ARG}=`)) {
            return { hidden, runJob: { kind: "invalid", reason: "badUuid" } };
        }
        if (a === RUN_JOB_ARG) {
            count += 1;
            if (count > 1) return { hidden, runJob: { kind: "invalid", reason: "duplicate" } };
            const next = args[i + 1];
            if (next === undefined || next.startsWith("--")) {
                return { hidden, runJob: { kind: "invalid", reason: "missingValue" } };
            }
            value = next;
            i += 1;
            continue;
        }
        if (!a.startsWith("--")) {
            return { hidden, runJob: { kind: "invalid", reason: "positional" } };
        }
    }
    const r = zRunJobAdditionalData.shape.runJob.safeParse(value);
    if (!r.success) return { hidden, runJob: { kind: "invalid", reason: "badUuid" } };
    return { hidden, runJob: { kind: "ok", jobId: r.data.toLowerCase() } };
}
