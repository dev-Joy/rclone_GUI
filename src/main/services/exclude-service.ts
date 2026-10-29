/**
 * 공용 제외 패턴 라이브러리 서비스 (INT-002 T-03).
 *
 * 수정·삭제 순서: 사용 작업을 구함 → 화면이 확인한 목록(confirmedJobIds)과 다르면 CONFIRM_REQUIRED
 *   → 사용 작업이 지금 비교·실행 중이면 BUSY → 저장소 변경 → (삭제면) 작업 연결 캐시 갱신
 *   → 사용 작업의 비교 결과를 버린다(전역 패턴이 바뀌어도 작업 rev는 그대로라 토큰만으로는 못 막는다).
 * 로그에는 패턴 id와 작업 수만 남긴다(패턴 문자열은 남기지 않음).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsLogger } from "@/main/lib/logger";
import { busyMessageFor, type clsActivityLock } from "@/main/services/activity-lock";
import type { clsCompareService } from "@/main/services/compare-service";
import type { clsExcludeStore } from "@/main/store/exclude-store";
import type { clsJobStore } from "@/main/store/job-store";
import type {
    itfExcludePatternUsage,
    itfExcludeUser,
    typExcludeDeleteInput,
    typExcludePattern,
    typExcludeUpdateInput,
} from "@/shared/schemas/excludes";

export interface itfExcludeServiceDeps {
    store: clsExcludeStore;
    jobs: Pick<clsJobStore, "list" | "get" | "refreshExcludeLinks">;
    compare: Pick<clsCompareService, "invalidate">;
    activity: Pick<clsActivityLock, "current">;
    logger: Pick<clsLogger, "info">;
}

const UNKNOWN_JOB_NAME = "(읽을 수 없는 작업)";

/** 두 id 목록이 같은 집합인지 */
function f_SameSet(a: readonly string[], b: readonly string[]): boolean {
    const sa = new Set(a);
    const sb = new Set(b);
    return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

export class clsExcludeService {
    private readonly d: itfExcludeServiceDeps;

    constructor(d: itfExcludeServiceDeps) {
        this.d = d;
    }

    /** 패턴 목록과 쓰는 작업(이름순) */
    list(): itfExcludePatternUsage[] {
        return this.d.store.list().map((p) => ({ ...p, usedBy: this.users(p.id) }));
    }

    create(i: { pattern: string }): { item: typExcludePattern; created: boolean } {
        const r = this.d.store.create(i.pattern);
        this.d.logger.info(`공용 제외 패턴 추가: id=${r.item.id} created=${r.created}`);
        return r;
    }

    update(i: typExcludeUpdateInput): typExcludePattern {
        const users = this.guard(i.id, i.confirmedJobIds);
        const item = this.d.store.update(i.id, i.pattern);
        for (const u of users) this.d.compare.invalidate(u.jobId);
        this.d.logger.info(`공용 제외 패턴 수정: id=${i.id} jobs=${users.length}`);
        return item;
    }

    remove(i: typExcludeDeleteInput): void {
        const users = this.guard(i.id, i.confirmedJobIds);
        this.d.store.remove(i.id);
        this.d.jobs.refreshExcludeLinks();
        for (const u of users) this.d.compare.invalidate(u.jobId);
        this.d.logger.info(`공용 제외 패턴 삭제: id=${i.id} jobs=${users.length}`);
    }

    /** 확인 목록·실행 중 검사. 통과하면 사용 작업 */
    private guard(id: string, confirmedJobIds: readonly string[]): itfExcludeUser[] {
        if (!this.d.store.list().some((p) => p.id === id)) {
            throw new clsAppError(
                "NOT_FOUND",
                "제외 패턴을 찾을 수 없습니다. 목록을 새로 고치세요.",
            );
        }
        const users = this.users(id);
        const ids = users.map((u) => u.jobId);
        if (ids.length > 0 && !f_SameSet(ids, confirmedJobIds)) {
            throw new clsAppError("CONFIRM_REQUIRED");
        }
        const cur = this.d.activity.current();
        if (cur && ids.includes(cur.jobId)) {
            throw new clsAppError("BUSY", busyMessageFor(cur, this.d.jobs));
        }
        return users;
    }

    private users(id: string): itfExcludeUser[] {
        const jobs = this.d.jobs.list();
        return this.d.store
            .usageJobIds(id)
            .map((jobId): itfExcludeUser => {
                const job = jobs.find((j) => j.id === jobId);
                return job
                    ? { jobId, jobName: job.name, mode: job.mode, auto: job.autoSync.enabled }
                    : { jobId, jobName: UNKNOWN_JOB_NAME, mode: "sync", auto: false };
            })
            .toSorted((a, b) => a.jobName.localeCompare(b.jobName, "ko", { sensitivity: "base" }));
    }
}
