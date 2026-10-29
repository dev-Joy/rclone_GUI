/**
 * 실행 이력 저장소 (history.json, 최신순).
 * 실행 시작 시 running 레코드를 먼저 남기고, 끝나면 갱신한다.
 * 앱이 비정상 종료돼 남은 running은 다음 시작 때 interrupted로 바꾼다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { join } from "node:path";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { nowIso } from "@/main/lib/time";
import { clsJsonStore } from "@/main/store/json-store";
import type { itfAppNotice } from "@/shared/ipc-contract";
import {
    zHistoryFile,
    zRunRecord,
    type typHistoryFile,
    type typRunRecord,
} from "@/shared/schemas/run";

export class clsHistoryStore {
    private readonly store: clsJsonStore<typHistoryFile>;
    private readonly limit: () => number;

    constructor(userDataDir: string, limit: () => number, onNotice?: (n: itfAppNotice) => void) {
        this.limit = limit;
        this.store = new clsJsonStore({
            file: join(userDataDir, "history.json"),
            label: "실행 이력",
            schema: zHistoryFile,
            createDefault: () => ({ version: 1, records: [] }),
            ...(onNotice ? { onNotice } : {}),
        });
    }

    async load(): Promise<typRunRecord[]> {
        return (await this.store.load()).records;
    }

    list(query: { jobId?: string; limit?: number } = {}): typRunRecord[] {
        const all = this.store.get().records;
        const filtered = query.jobId ? all.filter((r) => r.jobId === query.jobId) : all;
        return query.limit ? filtered.slice(0, query.limit) : filtered;
    }

    get(runId: string): typRunRecord | null {
        return this.store.get().records.find((r) => r.id === runId) ?? null;
    }

    /** 실행 시작 기록(status: running). 같은 id가 있으면 거부 */
    async begin(record: typRunRecord): Promise<typRunRecord> {
        const rec = zRunRecord.parse(record);
        await this.store.update((cur) => {
            if (cur.records.some((r) => r.id === rec.id)) {
                throw new clsAppError("VALIDATION", "이미 있는 실행 ID입니다.");
            }
            return { version: 1, records: this.pruneList([rec, ...cur.records]) };
        });
        return rec;
    }

    /** 실행 기록 갱신 (종료·단계 변경) */
    async patch(
        runId: string,
        patch: Partial<Omit<typRunRecord, "id" | "jobId">>,
    ): Promise<typRunRecord> {
        let updated: typRunRecord | undefined;
        await this.store.update((cur) => ({
            version: 1,
            records: cur.records.map((r) => {
                if (r.id !== runId) return r;
                updated = { ...r, ...patch };
                return updated;
            }),
        }));
        if (!updated) throw new clsAppError("NOT_FOUND", "실행 기록을 찾을 수 없습니다.");
        return updated;
    }

    /** 남아 있는 running 레코드를 interrupted로 바꾼다. 바꾼 레코드를 돌려준다 */
    async markInterrupted(): Promise<typRunRecord[]> {
        const changed: typRunRecord[] = [];
        if (!this.store.get().records.some((r) => r.status === "running")) return changed;
        const finishedAt = nowIso();
        await this.store.update((cur) => ({
            version: 1,
            records: cur.records.map((r) => {
                if (r.status !== "running") return r;
                const next: typRunRecord = {
                    ...r,
                    status: "interrupted",
                    finishedAt,
                    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(r.startedAt)),
                    error: {
                        code: "INTERNAL",
                        message: "앱이 실행 도중 종료되어 결과를 알 수 없습니다.",
                    },
                };
                changed.push(next);
                return next;
            }),
        }));
        return changed;
    }

    /**
     * 이력 전체 삭제. 실행 중 레코드는 남긴다. 지운 레코드의 로그 파일 이름을 돌려준다
     * (호출하는 쪽이 원하면 지운다).
     */
    async clear(): Promise<{ removed: number; logFiles: string[] }> {
        const logFiles: string[] = [];
        let removed = 0;
        await this.store.update((cur) => ({
            version: 1,
            records: cur.records.filter((r) => {
                if (r.status === "running") return true;
                removed += 1;
                if (r.logFile) logFiles.push(r.logFile);
                return false;
            }),
        }));
        return { removed, logFiles };
    }

    /** 보관 수(설정)를 지금 적용한다(앱 시작·주기 정리). 지운 개수 */
    async prune(): Promise<number> {
        const before = this.store.get().records;
        const kept = this.pruneList(before);
        if (kept.length === before.length) return 0;
        let removed = 0;
        await this.store.update((cur) => {
            const next = this.pruneList(cur.records);
            removed = cur.records.length - next.length;
            return { version: 1, records: next };
        });
        return removed;
    }

    /** 실행 중 레코드의 로그 파일 이름(로그 보관 정리에서 지우지 않음) */
    runningLogFiles(): Set<string> {
        const out = new Set<string>();
        for (const r of this.store.get().records) {
            if (r.status === "running" && r.logFile) out.add(r.logFile);
        }
        return out;
    }

    /** 최신순 limit개만 남기되, 실행 중 레코드는 지우지 않는다 */
    private pruneList(records: typRunRecord[]): typRunRecord[] {
        const limit = this.limit();
        let kept = 0;
        return records.filter((r) => {
            if (r.status === "running") return true;
            kept += 1;
            return kept <= limit;
        });
    }
}
