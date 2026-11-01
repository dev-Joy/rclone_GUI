/**
 * 실제 실행 확인 창 (INT-002 T-04). useRunFlow의 pending을 받아
 * 삭제(파일 또는 폴더)가 있는 동기화는 삭제 확인 모달(DeleteConfirmModal), 그 밖에는 간단한 확인 창을 띄운다.
 * 작업 화면 헤더와 작업 목록이 같이 쓴다. 확인하면 수동 실제 실행을 시작한다.
 *
 * @author dev-Joy 2026-11-02
 */

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import { RUN_LABEL, realRunConfirmText } from "@/lib/run-view";
import type { itfRunFlow } from "@/lib/use-run-flow";
import type { typDeleteThresholds } from "@/shared/run-gates";
import DeleteConfirmModal from "./DeleteConfirmModal";

// ========== Props & Types ==========
export interface itfRunConfirmModalsProps {
    flow: itfRunFlow;
    safety: typDeleteThresholds;
}

const CANCEL_NOTE = "취소해도 이미 복사된 파일은 대상에 남습니다.";

export default function RunConfirmModals(props: itfRunConfirmModalsProps) {
    const { flow, safety } = props;

    // ========== 내부 변수 (_V) ==========
    const p = flow.pending;
    const label = RUN_LABEL[p?.job.mode ?? "copy"];

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Cancel = () => flow.cancel();
    const h_Confirm = () => flow.confirm();

    return (
        <>
            <ZBCModal
                open={p !== null && !p.askDeletes}
                title={label}
                onClose={h_Cancel}
                footer={
                    <>
                        <ZBCButton onClick={h_Cancel} initialFocus>
                            취소
                        </ZBCButton>
                        <ZBCButton variant="primary" onClick={h_Confirm}>
                            {label}
                        </ZBCButton>
                    </>
                }
            >
                {p && (
                    <>
                        <p>
                            ‘{p.job.name}’: {realRunConfirmText(p.compare.summary, p.job.mode)}
                        </p>
                        <p>
                            {p.job.mode === "sync"
                                ? "삭제는 일어나지 않습니다(대상에만 있는 파일 없음)."
                                : "대상에만 있는 파일은 지우지 않습니다."}{" "}
                            {CANCEL_NOTE}
                        </p>
                    </>
                )}
            </ZBCModal>
            {p?.askDeletes && (
                <DeleteConfirmModal
                    key={p.job.id}
                    open
                    job={p.job}
                    compare={p.compare}
                    safety={safety}
                    onCancel={h_Cancel}
                    onConfirm={flow.confirm}
                />
            )}
        </>
    );
}
