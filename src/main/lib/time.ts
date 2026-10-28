/**
 * 시간 도우미. 저장은 항상 UTC ISO.
 *
 * @author dev-Joy 2026-10-28
 */

function p(n: number): string {
    return String(n).padStart(2, "0");
}

export function nowIso(): string {
    return new Date().toISOString();
}

/** 파일 이름용 시각. 예: 20261028-173500 (로컬 시각) */
export function fileStamp(d = new Date()): string {
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
