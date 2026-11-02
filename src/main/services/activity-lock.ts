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

/** remote 이름을 소문자 키로 모은다(같은 remote 판정은 대소문자를 무시) */
function f_RemoteKeys(remotes: readonly string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const raw of remotes) {
        const name = raw.trim();
        if (name === "") continue;
        const key = name.toLowerCase();
        if (!out.has(key)) out.set(key, name);
    }
    return out;
}

export class clsActivityLock {
    private active: typActivity | null = null;
    /** 지금 탐색 중인 remote(소문자 키 → 표시 이름). 한 번에 한 탐색만 */
    private browsing = new Map<string, string>();

    /** 지금 잡고 있는 활동. 없으면 null */
    current(): typActivity | null {
        return this.active;
    }

    /** 지금 탐색 중인 remote. 없으면 null */
    browseRemotes(): readonly string[] | null {
        return this.browsing.size === 0 ? null : [...this.browsing.values()];
    }

    /**
     * remote 탐색을 잡는다(탐색끼리는 배타). 해제 함수는 여러 번 불러도 한 번만 적용된다.
     * 이미 다른 탐색이 있으면 BUSY.
     */
    beginBrowse(remotes: readonly string[]): () => void {
        const names = f_RemoteKeys(remotes);
        if (names.size === 0) return () => undefined;
        if (this.browsing.size > 0) {
            throw new clsAppError(
                "BUSY",
                "다른 리모트를 탐색하는 중입니다. 탐색이 끝난 뒤 다시 시도하세요.",
            );
        }
        for (const [key, name] of names) this.browsing.set(key, name);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            for (const key of names.keys()) {
                if (this.browsing.get(key) === names.get(key)) this.browsing.delete(key);
            }
        };
    }

    /** 이 remote를 탐색 중이면 BUSY. 비교·실행이 같은 remote를 건드리지 않게 한다 */
    assertNoBrowse(remotes: readonly string[]): void {
        for (const [key] of f_RemoteKeys(remotes)) {
            const name = this.browsing.get(key);
            if (name === undefined) continue;
            throw new clsAppError(
                "BUSY",
                `‘${name}:’ 리모트를 탐색하는 중입니다. 탐색이 끝난 뒤 다시 시도하세요.`,
            );
        }
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
