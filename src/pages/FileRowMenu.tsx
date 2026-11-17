/**
 * 파일 행 줄 메뉴 (INT-008 FR-13). 평면 표·트리 표의 파일 행에서 우클릭·키보드 메뉴 키로 연다.
 * 항목은 `경로 복사` 하나이고(원본 기준 상대 경로 = entry.path), 복사 실패는 오류 토스트로 알린다.
 * 좌표 앵커·Escape·바깥 클릭 닫기·초점 이동은 ItemMenu가 맡는다(좌표를 화면 안으로 보정한다).
 *
 * @author dev-Joy 2026-11-17
 */

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import { useToastStore } from "@/stores/toast-store";
import ItemMenu from "./ItemMenu";

// ========== Props & Types ==========
/** 메뉴를 연 파일 행의 경로와 화면 좌표(px) */
export interface itfFileMenuTarget {
    path: string;
    x: number;
    y: number;
}

export interface itfFileRowMenuProps {
    /** null이면 닫힌 상태다 */
    target: itfFileMenuTarget | null;
    onClose: () => void;
}

const MENU_WIDTH = 180;

export default function FileRowMenu(props: itfFileRowMenuProps) {
    const { target, onClose } = props;

    // ========== hook & state 변수 선언 ==========
    const pushToast = useToastStore((s) => s.push);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    /** 원본 기준 상대 경로를 클립보드에 넣는다. 실패는 오류 토스트로 알린다 */
    async function h_Copy(): Promise<void> {
        if (!target) return;
        try {
            await unwrap(getApi().app.copyText(target.path));
            pushToast("success", "경로를 복사했습니다.");
        } catch (error) {
            pushToast("error", errorText(error));
        }
    }

    return (
        <ItemMenu
            open={target !== null}
            x={target?.x}
            y={target?.y}
            width={MENU_WIDTH}
            label="파일 메뉴"
            items={[{ label: "경로 복사", onSelect: () => void h_Copy() }]}
            onClose={onClose}
        />
    );
}
