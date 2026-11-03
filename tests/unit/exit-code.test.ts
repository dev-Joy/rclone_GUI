// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    classifyAbnormalExit,
    EXTERNAL_KILL_EXIT_CODES,
    formatExitCode,
    formatExitCodeForLog,
    toInt32ExitCode,
} from "@/shared/exit-code";

describe("toInt32ExitCode (AC-1)", () => {
    it("부호 없는 DWORD를 int32로 정규화한다", () => {
        expect(toInt32ExitCode(4294967295)).toBe(-1);
        expect(toInt32ExitCode(3221225786)).toBe(-1073741510);
        expect(toInt32ExitCode(3221225477)).toBe(-1073741819);
    });

    it("0 이상·null·정수가 아닌 값", () => {
        expect(toInt32ExitCode(3)).toBe(3);
        expect(toInt32ExitCode(0)).toBe(0);
        expect(toInt32ExitCode(null)).toBeNull();
        expect(toInt32ExitCode(1.5)).toBeNull();
        expect(toInt32ExitCode(Number.NaN)).toBeNull();
        expect(toInt32ExitCode(Number.POSITIVE_INFINITY)).toBeNull();
    });
});

describe("formatExitCode (AC-2)", () => {
    it("0 이상은 숫자만, 음수는 부호 있는 값·8자리 16진", () => {
        expect(formatExitCode(3)).toBe("3");
        expect(formatExitCode(0)).toBe("0");
        expect(formatExitCode(-1)).toBe("-1 (0xFFFFFFFF)");
        expect(formatExitCode(4294967295)).toBe("-1 (0xFFFFFFFF)");
    });

    it("알려진 NTSTATUS는 이름을 덧붙인다", () => {
        expect(formatExitCode(3221225477)).toBe("-1073741819 (0xC0000005 STATUS_ACCESS_VIOLATION)");
        expect(formatExitCode(3221225786)).toBe("-1073741510 (0xC000013A STATUS_CONTROL_C_EXIT)");
        expect(formatExitCode(-1073741801)).toBe("-1073741801 (0xC0000017 STATUS_NO_MEMORY)");
        expect(formatExitCode(-1073741571)).toBe("-1073741571 (0xC00000FD STATUS_STACK_OVERFLOW)");
        expect(formatExitCode(-1073740791)).toBe(
            "-1073740791 (0xC0000409 STATUS_STACK_BUFFER_OVERRUN)",
        );
    });

    it("표에 없는 음수는 16진만, null은 알 수 없음", () => {
        expect(formatExitCode(-2)).toBe("-2 (0xFFFFFFFE)");
        expect(formatExitCode(null)).toBe("알 수 없음");
    });
});

describe("formatExitCodeForLog (FR-11)", () => {
    it("공백 없이 16진을 붙이고 null은 -", () => {
        expect(formatExitCodeForLog(3)).toBe("3");
        expect(formatExitCodeForLog(4294967295)).toBe("-1(0xFFFFFFFF)");
        expect(formatExitCodeForLog(-1073741819)).toBe("-1073741819(0xC0000005)");
        expect(formatExitCodeForLog(null)).toBe("-");
        expect(formatExitCodeForLog(1.5)).toBe("-");
    });
});

describe("classifyAbnormalExit", () => {
    it("외부 종료 집합은 killed", () => {
        expect(EXTERNAL_KILL_EXIT_CODES).toEqual([-1]);
        expect(classifyAbnormalExit(-1)).toBe("killed");
        expect(classifyAbnormalExit(4294967295)).toBe("killed");
    });

    it("0xC0000000 이상(0xC000013A 제외)은 crash", () => {
        expect(classifyAbnormalExit(3221225477)).toBe("crash");
        expect(classifyAbnormalExit(-2)).toBe("crash");
        expect(classifyAbnormalExit(-1073740791)).toBe("crash");
    });

    it("0xC000013A·0~10·null은 분류하지 않는다", () => {
        expect(classifyAbnormalExit(3221225786)).toBeNull();
        expect(classifyAbnormalExit(-1073741510)).toBeNull();
        expect(classifyAbnormalExit(0)).toBeNull();
        expect(classifyAbnormalExit(1)).toBeNull();
        expect(classifyAbnormalExit(3)).toBeNull();
        expect(classifyAbnormalExit(null)).toBeNull();
        expect(classifyAbnormalExit(1.5)).toBeNull();
    });
});
