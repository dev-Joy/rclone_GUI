/**
 * 이력 비우기 확인 창. 모든 작업의 실행 이력을 지운다(진행 중 실행은 남김, 실행 중이면 main이 BUSY로 막음).
 * "로그 파일도 삭제"는 기본 해제다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCCheckbox from "@/components/ZBCCheckbox";
import ZBCModal from "@/components/ZBCModal";
import { useHistoryStore } from "@/stores/history-store";

// ========== Props & Types ==========
export interface itfClearHistoryModalProps {
    open: boolean;
    onClose: () => void;
}

export default function ClearHistoryModal(props: itfClearHistoryModalProps) {
    const { open, onClose } = props;

    // ========== hook & state 변수 선언 ==========
    const clear = useHistoryStore((s) => s.clear);
    const [deleteLogs, setDeleteLogs] = useState(false);
    const [busy, setBusy] = useState(false);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Close = () => {
        if (busy) return;
        setDeleteLogs(false);
        onClose();
    };
    const f_Clear = async () => {
        setBusy(true);
        const ok = await clear(deleteLogs);
        setBusy(false);
        if (ok) {
            setDeleteLogs(false);
            onClose();
        }
    };
    const h_Clear = () => void f_Clear();

    return (
        <ZBCModal
            open={open}
            title="이력 비우기"
            onClose={h_Close}
            footer={
                <>
                    <ZBCButton onClick={h_Close} disabled={busy} initialFocus>
                        취소
                    </ZBCButton>
                    <ZBCButton variant="danger" onClick={h_Clear} disabled={busy}>
                        {busy ? "지우는 중…" : "이력 모두 지우기"}
                    </ZBCButton>
                </>
            }
        >
            <p>
                모든 작업의 실행 이력을 지웁니다. 원본·대상 폴더의 파일과 작업 설정은 바뀌지
                않습니다. 실행 중에는 지울 수 없습니다.
            </p>
            <ZBCCheckbox
                id="clear-history-logs"
                name="clearHistoryLogs"
                checked={deleteLogs}
                onChange={setDeleteLogs}
                label="실행 로그 파일도 삭제"
                description="끄면 로그 파일은 보관 일수가 지날 때까지 로그 폴더에 남습니다."
            />
        </ZBCModal>
    );
}
