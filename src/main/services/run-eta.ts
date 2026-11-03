/**
 * 실행 남은 시간(ETA) 계산. 순수 함수 모음(INT-004).
 * - rclone `eta`는 남은 바이트 ÷ 최근 속도만 보므로, 파일당 처리 시간이 큰 remote에서
 *   작은 파일 구간에 수 시간~수십 시간으로 튄다.
 * - 이 모듈은 실행 전체 누적 평균으로 파일 기준·바이트 기준 남은 시간을 구하고 긴 쪽을 쓴다.
 * - 진행 중 파일의 부분 전송분을 완료 파일 수에 더한다(파일 기준 ETA가 부풀지 않게).
 * - 표시값은 "예상 총 소요"에만 지수 평균(기본 30초)을 걸어 초 단위 떨림을 줄인다.
 * - 시계·I/O·전역 상태를 쓰지 않는다. 평활 상태는 호출자가 들고 다닌다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== Internal imports ==========
import type { typRunPlan, typRunStats } from "@/shared/schemas/run";

/** 분모(totalTransfers)가 이 시간 동안 그대로이면 더 늘지 않는다고 본다(FR-2) */
export const ETA_STABLE_MS = 5_000;

/** 표시값 평활 시간 상수(FR-6) */
export const ETA_TAU_MS = 30_000;

/** 숫자를 내기 전 최소 경과(FR-4) */
const ETA_MIN_ELAPSED_MS = 10_000;

/** 숫자를 내기 전 최소 완료 파일 수(FR-4) */
const ETA_MIN_DONE_FILES = 5;

/** 숫자를 내기 전 최소 바이트 진행률(FR-4) */
const ETA_MIN_BYTE_RATIO = 0.05;

/** `rawEtaSeconds`가 숫자를 낼 수 없을 때의 값 */
export type typRawEta = number | "pending" | null;

export interface itfEtaTotals {
    totalFiles: number;
    totalBytes: number;
    /** 분모가 더 늘지 않는다고 볼 수 있는지 */
    settled: boolean;
}

export interface itfEtaState {
    /** 평활한 예상 총 소요(ms). 숫자가 처음 나오기 전에는 null */
    totalMs: number | null;
    /** 마지막으로 평활에 반영한 경과(ms) */
    atMs: number;
    /** 마지막으로 본 rclone totalTransfers (FR-2 안정 판정) */
    lastTotalTransfers: number;
    /** lastTotalTransfers가 그 값이 된 경과(ms) */
    stableSinceMs: number;
}

export interface itfEtaStep {
    state: itfEtaState;
    etaSeconds: number | null;
    etaPending: boolean;
}

/**
 * FR-2: 계획과 rclone stats로 분모를 정한다.
 * - 계획이 있으면 처음부터 확정으로 본다(비교와 실행 사이에 늘어난 값은 max로 따라간다).
 * - 계획이 없으면 확인이 끝났거나(checks >= totalChecks) totalTransfers가 stableMs 동안 그대로일 때 확정한다.
 */
export function etaTotals(
    stats: typRunStats,
    plan: typRunPlan | null,
    stableMs: number,
): itfEtaTotals {
    const planFiles = plan ? plan.createFiles + plan.updateFiles : 0;
    const planBytes = plan ? plan.transferBytes : 0;
    const totalFiles = Math.max(planFiles, stats.totalTransfers);
    const totalBytes = Math.max(planBytes, stats.totalBytes);

    let settled = plan !== null;
    if (!settled) {
        if (stats.totalChecks > 0 && stats.checks >= stats.totalChecks) settled = true;
        else if (stableMs >= ETA_STABLE_MS) settled = true;
    }

    return { totalFiles, totalBytes, settled };
}

/**
 * FR-3~FR-5, FR-7, FR-8: 원시 남은 시간(초).
 * - 전체 파일·바이트가 모두 0이면 바꿀 것이 없으므로 null(화면 "-", FR-8).
 * - 남은 파일·바이트가 모두 0이면 0초(FR-7).
 * - 아직 숫자를 낼 수 없으면 "pending"(FR-4).
 */
export function rawEtaSeconds(stats: typRunStats, totals: itfEtaTotals): typRawEta {
    const { totalFiles, totalBytes } = totals;
    if (totalFiles === 0 && totalBytes === 0) return null;

    const doneFiles = Math.min(stats.transfers + stats.partialFiles, totalFiles);
    const doneBytes = Math.min(stats.bytes, totalBytes);

    // 이미 다 옮겼으면 평활·대기 조건과 관계없이 0초
    if (doneFiles === totalFiles && doneBytes === totalBytes) return 0;

    const enoughFiles = doneFiles >= ETA_MIN_DONE_FILES;
    const enoughBytes = totalBytes > 0 && doneBytes / totalBytes >= ETA_MIN_BYTE_RATIO;
    if (stats.elapsedMs < ETA_MIN_ELAPSED_MS || !totals.settled || (!enoughFiles && !enoughBytes)) {
        return "pending";
    }

    const elapsedSeconds = stats.elapsedMs / 1000;
    const fileEta =
        doneFiles > 0 && totalFiles > 0
            ? (elapsedSeconds * (totalFiles - doneFiles)) / doneFiles
            : null;
    const byteEta =
        doneBytes > 0 && totalBytes > 0
            ? (elapsedSeconds * (totalBytes - doneBytes)) / doneBytes
            : null;

    if (fileEta === null && byteEta === null) return "pending";
    return Math.max(fileEta ?? 0, byteEta ?? 0);
}

/**
 * FR-1~FR-8: 이번 stats와 이전 평활 상태로 다음 상태·표시값을 낸다.
 * - `prev`가 null이면 이번 stats가 단계의 첫 줄이다(FR-9: 단계마다 새 상태).
 * - 표시값은 평활한 예상 총 소요에서 현재 경과를 뺀 값이다(FR-6).
 * - 같은 경과의 stats가 다시 오면(Δt <= 0) 평활을 갱신하지 않고 직전 값으로 다시 계산한다.
 */
export function nextEta(
    prev: itfEtaState | null,
    stats: typRunStats,
    plan: typRunPlan | null,
    tauMs: number = ETA_TAU_MS,
): itfEtaStep {
    const state: itfEtaState = prev
        ? { ...prev }
        : {
              totalMs: null,
              atMs: stats.elapsedMs,
              lastTotalTransfers: stats.totalTransfers,
              stableSinceMs: stats.elapsedMs,
          };

    if (state.lastTotalTransfers !== stats.totalTransfers) {
        state.lastTotalTransfers = stats.totalTransfers;
        state.stableSinceMs = stats.elapsedMs;
    }

    const totals = etaTotals(stats, plan, Math.max(0, stats.elapsedMs - state.stableSinceMs));
    const raw = rawEtaSeconds(stats, totals);

    if (raw === null) {
        return { state, etaSeconds: null, etaPending: false };
    }
    if (raw === "pending") {
        return { state, etaSeconds: null, etaPending: true };
    }

    const rawTotalMs = stats.elapsedMs + raw * 1000;
    if (state.totalMs === null) {
        state.totalMs = rawTotalMs;
    } else {
        const deltaMs = stats.elapsedMs - state.atMs;
        if (deltaMs > 0 && tauMs > 0) {
            const alpha = 1 - Math.exp(-deltaMs / tauMs);
            state.totalMs += (rawTotalMs - state.totalMs) * alpha;
        }
    }
    state.atMs = stats.elapsedMs;

    const etaSeconds = Math.max(0, (state.totalMs - stats.elapsedMs) / 1000);
    return { state, etaSeconds, etaPending: false };
}
