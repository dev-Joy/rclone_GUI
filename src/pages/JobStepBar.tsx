/**
 * 작업 화면 위쪽 단계 막대: ① 비교 → ② 미리보기 → ③ 실행.
 * 단계마다 완료·지금 단계·대기·진행 중과 짧은 설명을 보여 준다(상태는 색만이 아니라 숨긴 글자로도 알린다).
 * 단계 상태는 순수 함수 jobSteps(@/lib/job-steps)가 정하고, 여기서는 그리기만 한다.
 *
 * @author dev-Joy 2026-11-08
 */

// ========== Internal imports ==========
import type { itfJobStep, typJobStepState } from "@/lib/job-steps";
import styles from "./JobStepBar.module.css";

// ========== Props & Types ==========
export interface itfJobStepBarProps {
    steps: readonly itfJobStep[];
}

/** 화면 읽기 프로그램용 상태 글자 */
const STATE_TEXT: Record<typJobStepState, string> = {
    done: "완료",
    current: "지금 단계",
    pending: "대기",
    running: "진행 중",
};

export default function JobStepBar(props: itfJobStepBarProps) {
    const { steps } = props;

    return (
        <ol id="job-steps" className={styles.JobStepBar} aria-label="진행 단계">
            {steps.map((s, index) => (
                <li
                    key={s.id}
                    className={styles.step}
                    data-state={s.state}
                    aria-current={
                        s.state === "current" || s.state === "running" ? "step" : undefined
                    }
                >
                    <span className={styles.marker} aria-hidden="true">
                        {s.state === "done" ? "✓" : index + 1}
                    </span>
                    <span className={styles.text}>
                        <span className={styles.label}>{s.label}</span>
                        {s.note && <span className={styles.note}>{s.note}</span>}
                    </span>
                    <span className={styles.srOnly}>{STATE_TEXT[s.state]}</span>
                </li>
            ))}
        </ol>
    );
}
