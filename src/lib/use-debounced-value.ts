/**
 * 값이 ms 동안 바뀌지 않으면 그 값을 돌려주는 훅(검색 입력 등).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, ms: number): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);
    return settled;
}
