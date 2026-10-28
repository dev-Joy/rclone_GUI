/**
 * 화면 표시용 포맷 함수 (bytes / duration / percent / 로컬 시각 / 파일 수정시간).
 *
 * @author dev-Joy 2026-10-28
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** 1024 단위. 예: 1536 → "1.5 KB" */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "-";
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const digits = unit === 0 || value >= 100 ? 0 : 1;
    return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** 예: 3_723_000 → "1시간 2분 3초", 450 → "0.5초" */
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "-";
    if (ms < 1000) return `${(ms / 1000).toFixed(1)}초`;
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts: string[] = [];
    if (h) parts.push(`${h}시간`);
    if (m) parts.push(`${m}분`);
    if (s || parts.length === 0) parts.push(`${s}초`);
    return parts.join(" ");
}

/** 예: (1, 3) → "33%". total이 0이면 "-" */
export function formatPercent(part: number, total: number): string {
    if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return "-";
    return `${Math.floor((part / total) * 100)}%`;
}

function p(n: number): string {
    return String(n).padStart(2, "0");
}

function f_Local(d: Date): string {
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** UTC ISO 문자열을 로컬 시각 "YYYY-MM-DD HH:mm:ss"로. 잘못된 값이면 "-" */
export function formatLocalDateTime(iso: string | null): string {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return f_Local(d);
}

/** 파일 수정시간(ms)을 로컬 "YYYY-MM-DD HH:mm:ss"로. 모르면(null·잘못된 값) "—" */
export function formatModTime(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return "—";
    return f_Local(new Date(ms));
}
