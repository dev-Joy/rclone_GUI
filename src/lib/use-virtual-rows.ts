/**
 * 고정 높이 가상 목록 훅. 스크롤 컨테이너(ref)의 scroll·크기 변화를 requestAnimationFrame 1회로 묶어
 * 보이는 행 범위(computeRowWindow)를 돌려준다. resetKey가 바뀌면(필터·정렬 변경) 맨 위로 돌아간다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

// ========== Internal imports ==========
import { computeRowWindow, type itfRowWindow } from "@/lib/virtual-rows";

export interface itfVirtualRows<T extends HTMLElement> {
    ref: RefObject<T | null>;
    win: itfRowWindow;
}

export function useVirtualRows<T extends HTMLElement>(
    count: number,
    rowHeight = 30,
    overscan = 10,
    resetKey: unknown = null,
): itfVirtualRows<T> {
    const ref = useRef<T>(null);
    const [view, setView] = useState({ top: 0, height: 0 });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        let frame = 0;
        const f_Update = () => {
            frame = 0;
            setView({ top: el.scrollTop, height: el.clientHeight });
        };
        const f_Schedule = () => {
            if (frame === 0) frame = requestAnimationFrame(f_Update);
        };
        el.addEventListener("scroll", f_Schedule, { passive: true });
        const observer = new ResizeObserver(f_Schedule);
        observer.observe(el);
        f_Update();
        return () => {
            el.removeEventListener("scroll", f_Schedule);
            observer.disconnect();
            if (frame !== 0) cancelAnimationFrame(frame);
        };
    }, []);

    // 필터·정렬이 바뀌면(resetKey) 맨 위로
    const lastKey = useRef(resetKey);
    useLayoutEffect(() => {
        if (lastKey.current === resetKey) return;
        lastKey.current = resetKey;
        const el = ref.current;
        if (el && el.scrollTop !== 0) el.scrollTop = 0;
    }, [resetKey]);

    const win = useMemo(
        () => computeRowWindow(view.top, view.height, rowHeight, count, overscan),
        [view.top, view.height, rowHeight, count, overscan],
    );
    return { ref, win };
}
