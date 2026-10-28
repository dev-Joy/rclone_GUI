/**
 * 미리보기(dry-run) 결과 카드: rclone이 실제로 할 일(복사·수정시간만 맞춤·삭제·빈 폴더 정리)과 샘플 경로.
 * 비교 결과가 있으면 계획과 같은지도 보여 준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { dryRunHeadline } from "@/lib/run-view";
import { formatBytes } from "@/shared/format";
import type { itfPlanMatch } from "@/shared/run-plan";
import type { typRunMode } from "@/shared/schemas/common";
import type { itfDryRunSummary } from "@/shared/types/run";
import styles from "./DryRunSummary.module.css";

// ========== Props & Types ==========
export interface itfDryRunSummaryProps {
    summary: itfDryRunSummary;
    mode: typRunMode;
    /** 비교 계획과 맞춰 본 결과. 비교 결과가 없으면 null */
    match: itfPlanMatch | null;
}

function f_Samples(title: string, total: number, samples: readonly string[]) {
    if (samples.length === 0) return null;
    return (
        <details className={styles.samples}>
            <summary>
                {title} {samples.length < total ? `(${samples.length}/${total}개)` : `(${total}개)`}
            </summary>
            <ul>
                {samples.map((p) => (
                    <li key={p}>{p}</li>
                ))}
            </ul>
        </details>
    );
}

export default function DryRunSummary(props: itfDryRunSummaryProps) {
    const { summary: s, mode, match } = props;

    return (
        <section className={styles.DryRunSummary} aria-label="미리보기 결과">
            <p className={styles.headline}>{dryRunHeadline(s)}</p>
            <ul className={styles.counts}>
                <li>
                    복사 {s.copyFiles.toLocaleString("ko-KR")}개 ({formatBytes(s.copyBytes)})
                </li>
                <li>수정시간만 맞춤 {s.touchFiles.toLocaleString("ko-KR")}개</li>
                <li data-tone={s.deleteFiles > 0 ? "danger" : undefined}>
                    삭제 {s.deleteFiles.toLocaleString("ko-KR")}개
                    {s.deleteFiles > 0 ? ` (${formatBytes(s.deleteBytes)})` : ""}
                </li>
                {s.removeDirs > 0 && <li>빈 폴더 정리 {s.removeDirs}개</li>}
            </ul>
            {mode === "sync" && s.deleteFiles > 0 && (
                <p className={styles.note}>
                    동기화를 실제로 실행하면 대상에서 위 파일을 지웁니다(실제 실행은 다음 단계에서
                    제공).
                </p>
            )}
            {match && (
                <p className={styles.match} data-ok={match.ok}>
                    {match.ok
                        ? "비교 결과와 같은 일을 합니다."
                        : `비교 결과와 다릅니다. 다시 비교하세요. ${match.mismatches.join(" · ")}`}
                </p>
            )}
            {f_Samples("복사할 파일", s.copyFiles, s.copySamples)}
            {f_Samples("수정시간만 맞출 파일", s.touchFiles, s.touchSamples)}
            {f_Samples("삭제할 파일", s.deleteFiles, s.deleteSamples)}
        </section>
    );
}
