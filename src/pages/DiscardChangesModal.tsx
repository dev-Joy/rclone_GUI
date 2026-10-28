/**
 * 저장하지 않은 변경이 있을 때 다른 화면·작업으로 옮기기 전 확인. Esc·닫기는 "계속 편집".
 * 작업 편집기(job-editor-store.pendingAction)와 설정 화면(ui-store.pendingLeave) 둘 다 쓴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useUiStore } from "@/stores/ui-store";

export default function DiscardChangesModal() {
    // ========== hook & state 변수 선언 ==========
    const jobPending = useJobEditorStore((s) => s.pendingAction !== null);
    const confirmDiscard = useJobEditorStore((s) => s.confirmDiscard);
    const cancelDiscard = useJobEditorStore((s) => s.cancelDiscard);
    const settingsPending = useUiStore((s) => s.pendingLeave !== null);
    const confirmLeave = useUiStore((s) => s.confirmLeave);
    const cancelLeave = useUiStore((s) => s.cancelLeave);

    // ========== 내부 변수 (_V) ==========
    const forSettings = settingsPending;
    const onConfirm = forSettings ? confirmLeave : confirmDiscard;
    const onCancel = forSettings ? cancelLeave : cancelDiscard;

    return (
        <ZBCModal
            open={jobPending || settingsPending}
            title="저장하지 않은 변경이 있습니다"
            onClose={onCancel}
            footer={
                <>
                    <ZBCButton onClick={onCancel} initialFocus>
                        계속 편집
                    </ZBCButton>
                    <ZBCButton variant="danger" onClick={onConfirm}>
                        변경 버리고 이동
                    </ZBCButton>
                </>
            }
        >
            <p>
                {forSettings
                    ? "이동하면 설정 화면에서 고친 내용을 저장하지 않고 버립니다."
                    : "이동하면 이 작업에서 고친 내용을 저장하지 않고 버립니다."}
            </p>
        </ZBCModal>
    );
}
