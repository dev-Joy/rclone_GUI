/**
 * 비교 결과 표의 파일 행 하나. 평면 표(CompareTable)와 트리 표(CompareTree)가 함께 쓴다.
 * 열: 항목(경로) · 원본 크기 · 원본 수정 시각 · 할 일(+사유) · 대상 수정 시각 · 대상 크기.
 * 대상에만 있는 rclone 임시 파일(.partial)은 항목 앞에 "취소로 남은 임시 파일"로 표시한다.
 * 파일 행에서 우클릭·키보드 메뉴 키(ContextMenu·Shift+F10)로 줄 메뉴(경로 복사)를 연다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import {
    memo,
    type KeyboardEvent as typReactKeyboardEvent,
    type MouseEvent as typReactMouseEvent,
} from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import { reasonText, statusLabel, statusTone } from "@/lib/compare-view";
import { formatBytes, formatModTime } from "@/shared/format";
import { isRclonePartial, PARTIAL_BADGE_TEXT, PARTIAL_BADGE_TITLE } from "@/shared/partial-files";
import type { typRunMode } from "@/shared/schemas/common";
import type { itfDiffEntry } from "@/shared/types/compare";
import type { itfFileMenuTarget } from "./FileRowMenu";
import styles from "./CompareTable.module.css";

// ========== Props & Types ==========
export interface itfCompareRowProps {
    entry: itfDiffEntry;
    mode: typRunMode;
    rowIndex: number;
    /** 트리 보기의 들여쓰기 단계(평면은 0) */
    depth?: number;
    /** 주면 파일 행에서 우클릭·메뉴 키로 줄 메뉴를 연다 */
    onFileMenu?: (target: itfFileMenuTarget) => void;
}

const propsDefault = {
    depth: 0,
} satisfies Partial<itfCompareRowProps>;

// ========== 내부 함수 ==========
function f_Size(side: itfDiffEntry["source"]): string {
    return side ? formatBytes(side.size) : "—";
}

function f_Time(side: itfDiffEntry["source"]): string {
    return side ? formatModTime(side.modTimeMs) : "—";
}

export const CompareRow = memo(function CompareRow(iProps: itfCompareRowProps) {
    const { entry, mode, rowIndex, onFileMenu } = iProps;
    const depth = iProps.depth ?? propsDefault.depth;
    const reasons = entry.status === "modified" ? reasonText(entry.reasons) : "";
    const partial = entry.status === "onlyDest" && isRclonePartial(entry.dest?.path ?? entry.path);
    const pathTitle =
        entry.dest && entry.source && entry.dest.path !== entry.source.path
            ? `원본: ${entry.source.path}\n대상: ${entry.dest.path}`
            : entry.path;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    /** 줄 메뉴를 연다. 줄에 초점을 두어 닫힐 때 초점이 이 줄로 돌아오게 한다 */
    const h_ContextMenu = (event: typReactMouseEvent<HTMLTableRowElement>) => {
        if (!onFileMenu) return;
        event.preventDefault();
        event.currentTarget.focus();
        onFileMenu({ path: entry.path, x: event.clientX, y: event.clientY });
    };
    /** 키보드 메뉴 키·Shift+F10은 줄 아래쪽을 기준점으로 연다 */
    const h_KeyDown = (event: typReactKeyboardEvent<HTMLTableRowElement>) => {
        if (!onFileMenu) return;
        if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onFileMenu({ path: entry.path, x: rect.left + 24, y: rect.bottom - 4 });
    };

    return (
        <tr
            className={styles.row}
            aria-rowindex={rowIndex}
            data-status={entry.status}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 파일 행에서 키보드 메뉴 키를 받아야 한다
            tabIndex={0}
            onContextMenu={h_ContextMenu}
            onKeyDown={h_KeyDown}
        >
            <td
                className={styles.path}
                title={pathTitle}
                style={depth > 0 ? { paddingLeft: 8 + depth * 14 } : undefined}
            >
                {partial && (
                    <span className={styles.partial}>
                        <ZBCBadge tone="warning" title={PARTIAL_BADGE_TITLE}>
                            {PARTIAL_BADGE_TEXT}
                        </ZBCBadge>
                    </span>
                )}
                {entry.path}
                {entry.caseOnly && <span className={styles.caseOnly}> 대소문자만 다름</span>}
            </td>
            <td className={styles.num}>{f_Size(entry.source)}</td>
            <td className={styles.time}>{f_Time(entry.source)}</td>
            <td>
                <ZBCBadge tone={statusTone(entry.status, mode)}>
                    {statusLabel(entry.status, mode)}
                </ZBCBadge>
                {reasons && <span className={styles.reason}>{reasons}</span>}
            </td>
            <td className={styles.time}>{f_Time(entry.dest)}</td>
            <td className={styles.num}>{f_Size(entry.dest)}</td>
        </tr>
    );
});
