/**
 * 작업 화면의 공통 중지 막대 (INT-002 T-08). 이 작업의 비교·미리보기·실행이 진행 중일 때만 보인다.
 * 진행 문구와 중지 버튼 하나만 둔다(탭마다 따로 있던 취소 버튼을 대신한다).
 *
 * @author dev-Joy 2026-11-02
 */

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import { activityStop } from "@/lib/run-view";
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
