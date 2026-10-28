/**
 * 전역 활동 락 (MVP_SPEC §7.4, intent T-07). 비교·실행·자동 실행이 동시에 돌지 않게 한다.
 * 판정은 동기라 같은 tick에 두 요청이 와도 하나만 잡는다. 메모리 전용이며 앱에 하나만 만든다
 * (index.ts에서 만들어 비교 서비스와 Phase 6 실행 서비스가 함께 쓴다).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { typIsoDateString } from "@/shared/schemas/common";

export type typActivity =
    | { kind: "compare"; jobId: string; startedAt: typIsoDateString }
    /** Phase 6 실행에서 사용 */
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
