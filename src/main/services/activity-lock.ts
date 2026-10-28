/**
 * 전역 활동 락 (MVP_SPEC §7.4, intent T-07). 비교·실행·자동 실행이 동시에 돌지 않게 한다.
 * 판정은 동기라 같은 tick에 두 요청이 와도 하나만 잡는다. 메모리 전용이며 앱에 하나만 만든다
 * (index.ts에서 만들어 비교 서비스와 실행 서비스가 함께 쓴다).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { typIsoDateString } from "@/shared/schemas/common";

export type typActivity =
    | { kind: "compare"; jobId: string; startedAt: typIsoDateString }
    | { kind: "run"; jobId: string; runId: string; startedAt: typIsoDateString };

export class clsActivityLock {
    private active: typActivity | null = null;

    /** 지금 잡고 있는 활동. 없으면 null */
    current(): typActivity | null {
        return this.active;
    }

    /**
     * 비어 있으면 잡고 해제 함수를 돌려준다(여러 번 불러도 한 번만 해제).
     * 차 있으면 clsAppError("BUSY", busyMessage(현재 활동))를 던진다.
     */
    acquire(activity: typActivity, busyMessage: (cur: typActivity) => string): () => void {
        const cur = this.active;
        if (cur) throw new clsAppError("BUSY", busyMessage(cur));
        this.active = activity;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            if (this.active === activity) this.active = null;
        };
    }
}

/**
 * BUSY 안내 문구. 작업 이름을 찾지 못하면 "다른 작업을"으로 쓴다.
 * 예: "‘백업’ 작업을 실행하는 중입니다. 끝나거나 취소한 뒤 다시 시도하세요."
 */
export function busyMessageFor(
    cur: typActivity,
    jobs: { get(id: string): { name: string } },
): string {
    let name: string | null = null;
    try {
        name = jobs.get(cur.jobId).name;
    } catch {
        name = null;
    }
    const who = name === null ? "다른 작업을" : `‘${name}’ 작업을`;
    return cur.kind === "compare"
        ? `${who} 비교하는 중입니다. 끝나거나 취소한 뒤 다시 시도하세요.`
        : `${who} 실행하는 중입니다. 끝나거나 취소한 뒤 다시 시도하세요.`;
}
