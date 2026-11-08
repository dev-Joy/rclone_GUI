/**
 * 작업 화면의 공통 중지 막대 (INT-002 T-08). 이 작업의 비교·미리보기·실행이 진행 중일 때만 보인다.
 * 진행 문구(실행이면 진행률 " · NN%")와 중지 버튼 하나만 둔다. 화면마다 한 곳에만 그린다:
 * 작업 화면은 하단 실행 막대 안, 이력·작업 설정 화면은 헤더 아래.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import { activityStop, progressPercent } from "@/lib/run-view";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { useRunStore } from "@/stores/run-store";
import styles from "./JobActivityBar.module.css";

// ========== Props & Types ==========
export interface itfJobActivityBarProps {
    jobId: string;
}

export default function JobActivityBar(props: itfJobActivityBarProps) {
    const { jobId } = props;

    // ========== hook & state 변수 선언 ==========
    const compareActive = useCompareStore((s) => s.active);
    const compareRunningJobId = useCompareStore((s) => s.runningJobId);
    const cancelCompare = useCompareStore((s) => s.cancel);
    const run = useRunStore((s) => s.active);
    const cancelRun = useRunStore((s) => s.cancel);

    // ========== 내부 변수 (_V) ==========
    const stop = activityStop({
        jobId,
        compare: runningCompare(compareActive, compareRunningJobId),
        run,
    });
    const percent = stop?.target === "run" && run ? progressPercent(run.stats) : null;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Stop = () => {
        if (stop?.target === "compare") void cancelCompare();
        else if (stop?.target === "run") void cancelRun();
    };

    if (!stop) return null;

    return (
        <div className={styles.JobActivityBar}>
            <output className={styles.text} aria-live="polite">
                {stop.text}
                {percent !== null && ` · ${percent}%`}
            </output>
            <ZBCButton
                id="job-stop"
                variant="danger"
                onClick={h_Stop}
                disabled={stop.disabled}
                title={stop.title}
            >
                {stop.label}
            </ZBCButton>
        </div>
    );
}
