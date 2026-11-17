/**
 * 파일 행 줄 메뉴 (INT-008 FR-13, INT-009 FR-2). 평면 표·트리 표의 파일 행에서 우클릭·키보드 메뉴 키로 연다.
 * 항목은 `원본·대상 내용 비교`(modified·onlySource·onlyDest만 활성)와 `경로 복사`(원본 기준 상대 경로 = entry.path)다.
 * 같음·형식 충돌 행은 비교 항목을 비활성으로 두고 title로 이유를 보인다.
 * 복사 실패는 오류 토스트로 알린다. 좌표 앵커·Escape·바깥 클릭 닫기·초점 이동은 ItemMenu가 맡는다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import type { typCompareStatus } from "@/shared/types/compare";
import type { itfFileDiffTarget } from "@/shared/types/file-diff";
import { useToastStore } from "@/stores/toast-store";
import ItemMenu from "./ItemMenu";

// ========== Props & Types ==========
/** 메뉴를 연 파일 행의 표시 경로·상태와 화면 좌표(px). status로 비교 항목 활성 여부를 가른다 */
export interface itfFileMenuTarget {
    path: string;
    /** typCompareStatus 전체. equal·typeConflict면 내용 비교를 열 수 없다 */
    status: typCompareStatus;
    x: number;
    y: number;
}

export interface itfFileRowMenuProps {
    /** null이면 닫힌 상태다 */
    target: itfFileMenuTarget | null;
    /** 원본·대상 내용 비교를 고르면 호출한다(비활성 상태에서는 부르지 않는다) */
    onOpenDiff: (target: itfFileDiffTarget) => void;
    onClose: () => void;
}

const MENU_WIDTH = 180;

/** 메뉴 상태에서 실제로 비교할 수 있는 대상만 골라낸다(itfFileDiffTarget 재사용) */
function f_DiffTarget(target: itfFileMenuTarget | null): itfFileDiffTarget | null {
    if (!target) return null;
    if (
        target.status === "modified" ||
        target.status === "onlySource" ||
        target.status === "onlyDest"
    ) {
        return { path: target.path, status: target.status };
    }
    return null;
}

/** 비활성 항목의 이유 문구(FR-2) */
function f_DisabledReason(target: itfFileMenuTarget | null): string | undefined {
    if (target?.status === "equal") return "같은 파일이라 비교할 내용이 없음";
    if (target?.status === "typeConflict") return "파일과 폴더가 섞여 내용을 비교할 수 없음";
    return undefined;
}

export default function FileRowMenu(props: itfFileRowMenuProps) {
    const { target, onOpenDiff, onClose } = props;

    // ========== hook & state 변수 선언 ==========
    const pushToast = useToastStore((s) => s.push);

    // ========== 내부 변수 (_V) ==========
    const diffTarget = f_DiffTarget(target);
    const diffDisabledReason = f_DisabledReason(target);

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
            items={[
                {
                    label: "원본·대상 내용 비교",
                    disabled: diffTarget === null,
                    title: diffDisabledReason,
                    onSelect: () => {
                        if (diffTarget) onOpenDiff(diffTarget);
                    },
                },
                { label: "경로 복사", onSelect: () => void h_Copy() },
            ]}
            onClose={onClose}
        />
    );
}
