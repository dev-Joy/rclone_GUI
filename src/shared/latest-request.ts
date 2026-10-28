/**
 * "마지막 요청만 반영" 도우미. 비동기 요청을 여러 번 보냈을 때 늦게 도착한 이전 응답이
 * 최신 결과를 덮지 않게 한다(화면 상태 갱신용). Node·DOM 의존 없음.
 *
 * @author dev-Joy 2026-10-28
 */

export interface itfLatestGate {
    /** 새 요청을 시작한다. 돌려받은 함수는 이 요청이 아직 최신인지 알려준다 */
    next(): () => boolean;
    /** 진행 중인 요청을 모두 무효로 만든다(입력이 바뀌었을 때) */
    invalidate(): void;
}

export function createLatestGate(): itfLatestGate {
    let seq = 0;
    return {
        next: () => {
            seq += 1;
            const mine = seq;
            return () => mine === seq;
        },
        invalidate: () => {
            seq += 1;
        },
    };
}
