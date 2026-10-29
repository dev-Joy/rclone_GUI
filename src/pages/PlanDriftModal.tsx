/**
 * 사전 확인 불일치(PLAN_DRIFT, S14) 안내. 실제 실행 직전 미리보기가 비교 결과와 달라 실행하지 않았음을 알리고
 * 차이(계획 대비 사전 확인 수)를 보여 준다. "다시 비교"는 막힌 작업을 선택하고 비교 탭으로 옮긴 뒤 비교한다
 * (run-store recompareDrift — 지금 보이는 작업에 저장하지 않은 변경이 있으면 버리기 확인을 거친다).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import { useRunStore } from "@/stores/run-store";
import styles from "./PlanDriftModal.module.css";

// ========== Props & Types ==========
export interface itfPlanDriftModalProps {
    /** 다시 비교할 수 없는 이유(실행·비교 중). 없으면 null */
    compareBlockedReason?: string | null;
}

const propsDefault = {
    compareBlockedReason: null,
} satisfies Partial<itfPlanDriftModalProps>;

export default function PlanDriftModal(props: itfPlanDriftModalProps) {
    const compareBlockedReason = props.compareBlockedReason ?? propsDefault.compareBlockedReason;

    // ========== hook & state 변수 선언 ==========
    const notice = useRunStore((s) => s.driftNotice);
    const dismiss = useRunStore((s) => s.dismissDrift);
    const recompare = useRunStore((s) => s.recompareDrift);

    // ========== 내부 변수 (_V) ==========
    const lines = notice?.error?.detail?.split("\n").filter(Boolean) ?? [];

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Recompare = () => recompare();

    return (
        <ZBCModal
            open={notice !== null}
            title="비교 뒤 바뀐 파일이 있습니다"
            onClose={dismiss}
            footer={
                <>
                    <ZBCButton onClick={dismiss}>닫기</ZBCButton>
                    <ZBCButton
                        variant="primary"
                        onClick={h_Recompare}
                        disabled={compareBlockedReason !== null}
                        title={compareBlockedReason ?? undefined}
                        initialFocus
                    >
                        다시 비교
                    </ZBCButton>
                </>
            }
        >
            {notice && (
                <div className={styles.PlanDriftModal}>
                    <p>
                        ‘{notice.jobName}’: 실행 직전 사전 확인 결과가 비교 결과와 달라 실행하지
                        않았습니다. 대상 파일은 바뀌지 않았습니다.
                    </p>
                    {lines.length > 0 && (
                        <ul className={styles.diff} aria-label="비교 결과와 다른 점">
                            {lines.map((l) => (
                                <li key={l}>{l}</li>
                            ))}
                        </ul>
                    )}
                    <p className={styles.note}>다시 비교한 뒤 바뀐 내용을 확인하고 실행하세요.</p>
                </div>
            )}
        </ZBCModal>
    );
}
