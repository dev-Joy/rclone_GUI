/**
 * 백업 폴더(--backup-dir)의 실행별 하위 폴더 이름 (INT-003 T-03 FR-25, E-11). 순수 함수.
 *
 * - 이름: "YYYY-MM-DD_HHmmss_<jobId 앞 8자>" (로컬 시각, 0 채움). 시각이 앞이라 시간순으로 정렬된다.
 * - 같은 하위 폴더에 같은 이름 파일이 있으면 rclone이 예전 백업을 지우고 덮어쓰므로(rclone-notes #31),
 *   같은 프로세스 안에서는 백업 시각이 1초 이상씩 늘어나게 한다(nextBackupTime).
 *
 * @author dev-Joy 2026-11-02
 */

function f_Pad(n: number): string {
    return String(n).padStart(2, "0");
}

/** 실행별 하위 폴더 이름. 예: 2026-11-02_103000_1a2b3c4d */
export function buildBackupSubdir(at: Date, jobId: string): string {
    const date = `${at.getFullYear()}-${f_Pad(at.getMonth() + 1)}-${f_Pad(at.getDate())}`;
    const time = `${f_Pad(at.getHours())}${f_Pad(at.getMinutes())}${f_Pad(at.getSeconds())}`;
    return `${date}_${time}_${jobId.slice(0, 8)}`;
}

/**
 * 이번 실행의 백업 시각. last(같은 프로세스에서 마지막으로 쓴 시각)가 없거나 now가 초 단위로 더 늦으면 now,
 * 아니면(같은 초·시계가 뒤로 감) last + 1초. 초 아래는 버린다.
 */
export function nextBackupTime(now: Date, last: Date | null): Date {
    const sec = Math.floor(now.getTime() / 1000);
    if (last === null) return new Date(sec * 1000);
    const lastSec = Math.floor(last.getTime() / 1000);
    return new Date(Math.max(sec, lastSec + 1) * 1000);
}
