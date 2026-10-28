/**
 * 실행 통계 표(rclone stats): 진행률·전송량·파일 수·확인·삭제·오류·속도·남은 시간·경과 시간.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { progressPercent } from "@/lib/run-view";
import { formatBytes, formatDuration } from "@/shared/format";
import type { typRunStats } from "@/shared/schemas/run";
import styles from "./RunStatsGrid.module.css";

// ========== Props & Types ==========
export interface itfRunStatsGridProps {
    stats: typRunStats | null;
    /** 미리보기면 "복사 예정"으로 표시한다 */
    dryRun: boolean;
}

function f_Count(n: number): string {
    return n.toLocaleString("ko-KR");
}

export default function RunStatsGrid(props: itfRunStatsGridProps) {
    const { stats, dryRun } = props;

    // ========== 내부 변수 (_V) ==========
    const percent = progressPercent(stats);

    if (!stats) {
        return <p className={styles.RunStatsGrid}>rclone 통계를 기다리는 중…</p>;
    }
    const items: Array<[string, string]> = [
        ["진행률", percent === null ? "-" : `${percent}%`],
        [
            dryRun ? "복사 예정 크기" : "전송",
            `${formatBytes(stats.bytes)} / ${formatBytes(stats.totalBytes)}`,
        ],
        [
            dryRun ? "복사 예정 파일" : "복사한 파일",
            `${f_Count(stats.transfers)} / ${f_Count(stats.totalTransfers)}`,
        ],
        ["확인한 파일", `${f_Count(stats.checks)} / ${f_Count(stats.totalChecks)}`],
        ["삭제", f_Count(stats.deletes)],
        ["오류", f_Count(stats.errors)],
        ["속도", stats.speedBps === null ? "-" : `${formatBytes(stats.speedBps)}/s`],
        ["남은 시간", stats.etaSeconds === null ? "-" : formatDuration(stats.etaSeconds * 1000)],
        ["경과", formatDuration(stats.elapsedMs)],
    ];

    return (
        <div className={styles.RunStatsGrid}>
            {percent !== null && (
                <progress className={styles.bar} max={100} value={percent} aria-label="진행률" />
            )}
            <dl className={styles.grid}>
                {items.map(([label, value]) => (
                    <div
                        key={label}
                        className={styles.item}
                        data-error={label === "오류" && stats.errors > 0}
                    >
                        <dt className={styles.label}>{label}</dt>
                        <dd className={styles.value}>{value}</dd>
                    </div>
                ))}
            </dl>
            {stats.lastError && <p className={styles.lastError}>마지막 오류: {stats.lastError}</p>}
        </div>
    );
}
