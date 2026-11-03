/**
 *  종료 코드 도우미 (INT-005)
 *
 *  @author dev-Joy 2026-11-03
 *  @description
 *      - Node `exit` 이벤트의 Windows 종료 코드는 부호 없는 DWORD(예: 4294967295)이므로 int32로 정규화한다
 *      - 화면용·로그용 표기와 외부 종료/충돌 분류, NTSTATUS 이름 표를 제공한다
 *      - Node·DOM에 의존하지 않는 순수 함수만 둔다 (shared 경계)
 */

/** 정수면 int32로, null·정수가 아니면 null (FR-1, ToInt32) */
export function toInt32ExitCode(code: number | null): number | null {
    if (code === null || !Number.isInteger(code)) return null;
    // `| 0`은 ECMAScript ToInt32: 4294967295 → -1, 3221225786 → -1073741510
    return code | 0;
}

/** 8자리 대문자 16진(부호 없는 32비트) */
function f_Hex32(value: number): string {
    return (value >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/** NTSTATUS 이름 표. 표에 없는 코드는 16진만 쓴다 */
const NTSTATUS_NAMES: Readonly<Record<string, string>> = {
    C0000005: "STATUS_ACCESS_VIOLATION",
    C0000017: "STATUS_NO_MEMORY",
    C00000FD: "STATUS_STACK_OVERFLOW",
    C000013A: "STATUS_CONTROL_C_EXIT",
    C0000409: "STATUS_STACK_BUFFER_OVERRUN",
};

/** Windows STATUS_CONTROL_C_EXIT(0xC000013A) */
const STATUS_CONTROL_C_EXIT = 0xc000013a | 0;

/** 화면용: "3", "-1 (0xFFFFFFFF)", "-1073741819 (0xC0000005 STATUS_ACCESS_VIOLATION)" (FR-2) */
export function formatExitCode(code: number | null): string {
    const value = toInt32ExitCode(code);
    if (value === null) return "알 수 없음";
    if (value >= 0) return String(value);
    const hex = f_Hex32(value);
    const name = NTSTATUS_NAMES[hex];
    return name === undefined ? `${value} (0x${hex})` : `${value} (0x${hex} ${name})`;
}

/** 로그용: "3", "-1(0xFFFFFFFF)", null → "-" (FR-11, 공백 없음) */
export function formatExitCodeForLog(code: number | null): string {
    const value = toInt32ExitCode(code);
    if (value === null) return "-";
    if (value >= 0) return String(value);
    return `${value}(0x${f_Hex32(value)})`;
}

/** 외부 종료로 볼 코드(int32). 확정: -1. 0xC000013A는 T-01에서 재현되지 않아 제외 */
export const EXTERNAL_KILL_EXIT_CODES: readonly number[] = [-1];

/** 코드만 본 분류. 오류 줄·Go 충돌 표지는 decideRunOutcome이 함께 판단한다 */
export type typAbnormalExit = "killed" | "crash" | null;

/**
 * 외부 종료 집합 → "killed", 0xC0000000 이상(0xC000013A 제외) → "crash", 그 밖 → null.
 * 0~10·0xC000013A·null은 null이다.
 */
export function classifyAbnormalExit(code: number | null): typAbnormalExit {
    const value = toInt32ExitCode(code);
    if (value === null) return null;
    if (EXTERNAL_KILL_EXIT_CODES.includes(value)) return "killed";
    if (value === STATUS_CONTROL_C_EXIT) return null;
    // 0xC0000000 이상: 부호 없는 32비트 값으로 비교한다
    if (value >>> 0 >= 0xc0000000) return "crash";
    return null;
}
