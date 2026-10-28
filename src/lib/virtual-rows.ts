/**
 * 고정 높이 행의 가상 목록 창 계산. 보이는 행(+여유 행)만 그리고 위·아래는 빈 공간으로 채운다.
 * DOM 의존 없음 (단위 테스트는 node 환경). 화면 훅은 use-virtual-rows.ts.
 *
 * @author dev-Joy 2026-10-28
 */

export interface itfRowWindow {
    /** 그릴 첫 행(포함) */
    start: number;
    /** 그릴 마지막 행(제외) */
    end: number;
    padTop: number;
    padBottom: number;
    totalHeight: number;
}

export function computeRowWindow(
    scrollTop: number,
    viewportHeight: number,
    rowHeight: number,
    count: number,
    overscan: number,
): itfRowWindow {
    if (count <= 0 || rowHeight <= 0) {
        return { start: 0, end: 0, padTop: 0, padBottom: 0, totalHeight: 0 };
    }
    const first = Math.min(count, Math.floor(Math.max(0, scrollTop) / rowHeight));
    const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight);
    const start = Math.max(0, Math.min(first, count - 1) - overscan);
    const end = Math.min(count, first + visible + overscan);
    return {
        start,
        end,
        padTop: start * rowHeight,
        padBottom: (count - end) * rowHeight,
        totalHeight: count * rowHeight,
    };
}
