/**
 * remote 탐색·연결 테스트 직렬화 (INT-002 T-02, E-7).
 *
 * - 앱에서 탐색·연결 테스트는 한 번에 하나만 돈다(전역 큐).
 * - 비교·실행이 같은 remote를 쓰는 중이면 BUSY로 막는다(다른 remote면 허용).
 * - OAuth 토큰 갱신처럼 같은 remote에 동시에 rclone을 부르면 경합할 수 있어 같은 remote만 막는다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { clsMutex } from "@/main/lib/mutex";
import { busyMessageFor, type clsActivityLock } from "@/main/services/activity-lock";
import { remoteNamesOfJob } from "@/main/services/job-context";
import type { clsJobStore } from "@/main/store/job-store";

export interface itfRemoteOpsDeps {
    activity: clsActivityLock;
    jobs: Pick<clsJobStore, "get">;
}

function f_Overlaps(a: readonly string[], b: readonly string[]): boolean {
    const keys = new Set(a.map((x) => x.toLowerCase()));
    return b.some((x) => keys.has(x.toLowerCase()));
}

export class clsRemoteOps {
    private readonly deps: itfRemoteOpsDeps;
    private readonly mutex = new clsMutex();

    constructor(deps: itfRemoteOpsDeps) {
        this.deps = deps;
    }

    /** remotes를 쓰는 작업을 큐에서 하나씩 실행한다. 끝나면 탐색 락을 푼다 */
    run<T>(remotes: readonly string[], task: () => Promise<T> | T): Promise<T> {
        return this.mutex.runExclusive(async () => {
            const cur = this.deps.activity.current();
            if (cur) {
                let names: string[];
                try {
                    names = remoteNamesOfJob(this.deps.jobs.get(cur.jobId));
                } catch {
                    // 작업을 찾지 못하면 보수적으로 막는다
                    throw new clsAppError("BUSY", busyMessageFor(cur, this.deps.jobs));
                }
                if (f_Overlaps(names, remotes)) {
                    throw new clsAppError("BUSY", busyMessageFor(cur, this.deps.jobs));
                }
            }
            const release = this.deps.activity.beginBrowse(remotes);
            try {
                return await task();
            } finally {
                release();
            }
        });
    }
}
