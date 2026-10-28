/**
 * 실행 화면의 순수 로직: 실행 버튼 가능 여부·이유, 진행률, 로그 tail, 상태·요약·확인 문구.
 * 문구는 일어날 일로 쓴다(예: "대상에 3개 복사, 1개 덮어씀"). DOM·window 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { compareStaleReason } from "@/lib/compare-view";
import { formatBytes } from "@/shared/format";
import { checkRunPaths } from "@/shared/path-utils";
import type { typRunMode, typRunStatus } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import type { typRunStats } from "@/shared/schemas/run";
import type { itfCompareActive, itfCompareResult, itfCompareSummary } from "@/shared/types/compare";
import { RUN_TAIL_LINES, type itfDryRunSummary, type itfRunLogLine } from "@/shared/types/run";

export type typCheck = { ok: true } | { ok: false; reason: string };

export interface itfCanStartRunInput {
    job: typJob | null;
    dirty: boolean;
    caseInsensitive: boolean;
    /** 진행 중인 비교(어느 작업이든) */
    comparing: itfCompareActive | null;
    /** 진행 중인 실행의 작업 id(어느 작업이든). 없으면 null */
    runningJobId: string | null;
    dryRun: boolean;
    /** 화면에 있는 비교 결과(다른 작업 것일 수 있음) */
    compare: itfCompareResult | null;
    maxAgeMinutes: number;
    nowMs: number;
}

/**
 * 미리보기·실제 실행 버튼 가능 여부와 이유.
 * 공통: 저장 안 됨 → 미저장 변경 → 경로 오류 → 비교 중 → 실행 중.
 * 실제 실행: 동기화 아직 미지원 → 유효한 비교 결과 → 낡음 → 충돌 → 바꿀 파일 없음.
 */
export function canStartRun(input: itfCanStartRunInput): typCheck {
    const { job } = input;
    if (!job) return { ok: false, reason: "먼저 작업을 저장하세요." };
    if (input.dirty) {
        return {
            ok: false,
            reason: "저장하지 않은 변경이 있습니다. 저장한 뒤 실행할 수 있습니다.",
        };
    }
    const first = checkRunPaths(job.source, job.destination, input.caseInsensitive).errors[0];
    if (first) return { ok: false, reason: first.message };
    if (input.comparing) return { ok: false, reason: "비교가 끝난 뒤 실행할 수 있습니다." };
    if (input.runningJobId !== null) {
        return {
            ok: false,
            reason:
                input.runningJobId === job.id ? "실행 중입니다." : "다른 작업을 실행하는 중입니다.",
        };
    }
    if (input.dryRun) return { ok: true };
    if (job.mode === "sync") {
        return {
            ok: false,
            reason: "동기화(삭제 포함) 실제 실행은 아직 지원하지 않습니다. ‘미리보기’로 일어날 일을 확인할 수 있습니다.",
        };
    }
    const r = input.compare;
    if (!r || r.jobId !== job.id) return { ok: false, reason: "먼저 비교하세요." };
    const stale = compareStaleReason(r, job, input.maxAgeMinutes, input.nowMs);
    if (stale) return { ok: false, reason: stale };
    if (r.mode !== job.mode)
        return { ok: false, reason: "작업 설정이 바뀌었습니다. 다시 비교하세요." };
    const s = r.summary;
    if (s.conflictFiles > 0 || s.caseOnlyFiles > 0) {
        return {
            ok: false,
            reason: "파일·폴더 이름이 겹치거나 대소문자만 다른 항목이 있어 실행할 수 없습니다.",
        };
    }
    if (s.createFiles + s.updateFiles === 0) {
        return { ok: false, reason: "복사할 파일이 없습니다(대상이 이미 같습니다)." };
    }
    return { ok: true };
}

/** 진행률(0~100). 바이트 기준, 바이트를 모르면 파일 수 기준. 계산할 수 없으면 null */
export function progressPercent(stats: typRunStats | null): number | null {
    if (!stats) return null;
    let ratio: number | null = null;
    if (stats.totalBytes > 0) ratio = stats.bytes / stats.totalBytes;
    else if (stats.totalTransfers > 0) ratio = stats.transfers / stats.totalTransfers;
    if (ratio === null || !Number.isFinite(ratio)) return null;
    return Math.min(100, Math.max(0, Math.floor(ratio * 100)));
}

/** 로그 tail 뒤에 줄을 붙이고 최근 max줄만 남긴다(새 배열) */
export function appendTail(
    tail: readonly itfRunLogLine[],
    lines: readonly itfRunLogLine[],
    max = RUN_TAIL_LINES,
): itfRunLogLine[] {
    const next = [...tail, ...lines];
    return next.length > max ? next.slice(next.length - max) : next;
}

const MODE_VERB: Record<typRunMode, string> = { copy: "복사", sync: "동기화" };

/** 상태 문구. 예: 미리보기 완료, 복사 완료, 복사 취소됨 */
export function runStatusText(status: typRunStatus, dryRun: boolean, mode: typRunMode): string {
    const what = dryRun ? "미리보기" : MODE_VERB[mode];
    switch (status) {
        case "running":
            return `${what} 진행 중`;
        case "success":
            return `${what} 완료`;
        case "partial":
            return `${what} 일부 실패`;
        case "failed":
            return `${what} 실패`;
        case "canceled":
            return `${what} 취소됨`;
        case "blocked":
            return `${what} 차단됨`;
        case "noop":
            return "바꿀 파일 없음";
        case "interrupted":
            return `${what} 중단됨(앱 종료)`;
    }
}

/** dry-run 요약 한 줄. 예: "실행하면 대상에 3개 복사(24 B), 1개 수정시간만 맞춤, 2개 삭제" */
export function dryRunHeadline(s: itfDryRunSummary): string {
    const parts: string[] = [];
    if (s.copyFiles > 0) parts.push(`대상에 ${s.copyFiles}개 복사(${formatBytes(s.copyBytes)})`);
    if (s.touchFiles > 0) parts.push(`${s.touchFiles}개 수정시간만 맞춤`);
    if (s.deleteFiles > 0) parts.push(`${s.deleteFiles}개 삭제`);
    if (parts.length === 0) return "실행해도 바뀌는 파일이 없습니다.";
    return `실행하면 ${parts.join(", ")}`;
}

/** 실제 실행 확인 문구(비교 결과 기준). 예: "대상에 3개 복사, 1개 덮어씀 (총 1.2 MB)" */
export function realRunConfirmText(s: itfCompareSummary, mode: typRunMode): string {
    const parts: string[] = [];
    if (s.createFiles > 0) parts.push(`대상에 ${s.createFiles}개 복사`);
    if (s.updateFiles > 0) parts.push(`${s.updateFiles}개 덮어씀`);
    if (mode === "sync" && s.deleteFiles > 0) parts.push(`${s.deleteFiles}개 삭제`);
    if (parts.length === 0) return "바뀌는 파일이 없습니다.";
    return `${parts.join(", ")} (총 ${formatBytes(s.transferBytes)})`;
}
