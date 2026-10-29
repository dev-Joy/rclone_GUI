/**
 * 실행 이력 저장소 (SQLite run_records 테이블, 최신순 = seq 내림차순, INT-002 T-01).
 * 실행 시작 시 running 레코드를 먼저 남기고, 끝나면 갱신한다.
 * 앱이 비정상 종료돼 남은 running은 다음 시작 때 interrupted로 바꾼다.
 * 메모리 캐시 없이 매번 DB를 조회한다(목록은 LIMIT/OFFSET). 읽을 수 없는 행은 건너뛴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { nowIso } from "@/main/lib/time";
import type { clsSqliteDb } from "@/main/store/sqlite-db";
import type { itfAppNotice } from "@/shared/ipc-contract";
import { zRunRecord, type typRunRecord } from "@/shared/schemas/run";

const zDataRow = z.object({ data: z.string() });
const zLogFileRow = z.object({ log_file: z.string() });
const zExistsRow = z.object({ seq: z.union([z.number(), z.bigint()]) });

// SQL은 상수만 쓴다(정렬 열·조건을 입력으로 조립하지 않는다)
const SQL_LIST_ALL = "SELECT data FROM run_records ORDER BY seq DESC LIMIT $limit OFFSET $offset";
const SQL_LIST_JOB =
    "SELECT data FROM run_records WHERE job_id = $jobId ORDER BY seq DESC LIMIT $limit OFFSET $offset";
const SQL_GET = "SELECT data FROM run_records WHERE id = $id";
const SQL_EXISTS = "SELECT seq FROM run_records WHERE id = $id";
const SQL_INSERT =
    "INSERT INTO run_records (id, job_id, status, started_at, log_file, data) VALUES ($id, $jobId, $status, $startedAt, $logFile, $data)";
const SQL_UPDATE =
    "UPDATE run_records SET job_id = $jobId, status = $status, started_at = $startedAt, log_file = $logFile, data = $data WHERE id = $id";
const SQL_RUNNING = "SELECT data FROM run_records WHERE status = 'running' ORDER BY seq DESC";
const SQL_RUNNING_LOGS =
    "SELECT log_file FROM run_records WHERE status = 'running' AND log_file IS NOT NULL";
const SQL_CLEAR_LOGS =
    "SELECT log_file FROM run_records WHERE status <> 'running' AND log_file IS NOT NULL ORDER BY seq DESC";
const SQL_CLEAR = "DELETE FROM run_records WHERE status <> 'running'";
/** 최신순 limit개만 남기되 실행 중 레코드는 지우지 않는다 */
const SQL_PRUNE =
    "DELETE FROM run_records WHERE status <> 'running' AND seq NOT IN (SELECT seq FROM run_records WHERE status <> 'running' ORDER BY seq DESC LIMIT $limit)";

/** DB 행 값. 전체 레코드는 data(JSON)에, 조회용 열은 따로 둔다 */
function f_Row(r: typRunRecord): Record<string, string | null> {
    return {
        id: r.id,
        jobId: r.jobId,
        status: r.status,
        startedAt: r.startedAt,
        logFile: r.logFile,
        data: JSON.stringify(r),
    };
}

/** data 열 → 레코드. JSON·스키마가 맞지 않으면 null */
function f_ParseRow(row: unknown): typRunRecord | null {
    const r = zDataRow.safeParse(row);
    if (!r.success) return null;
    try {
        const parsed = zRunRecord.safeParse(JSON.parse(r.data.data));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

function f_ParseRows(rows: readonly unknown[]): typRunRecord[] {
    const out: typRunRecord[] = [];
    for (const row of rows) {
        const rec = f_ParseRow(row);
        if (rec) out.push(rec);
    }
    return out;
}

export class clsHistoryStore {
    private readonly db: clsSqliteDb;
    private readonly limit: () => number;
    private readonly onNotice: ((n: itfAppNotice) => void) | undefined;

    constructor(db: clsSqliteDb, limit: () => number, onNotice?: (n: itfAppNotice) => void) {
        this.db = db;
        this.limit = limit;
        this.onNotice = onNotice;
    }

    /** 시작 때 한 번: 읽을 수 없는 행이 있으면 알린다(행은 지우지 않음). 전체 목록을 돌려준다 */
    async load(): Promise<typRunRecord[]> {
        const rows = this.db.all(SQL_LIST_ALL, { limit: -1, offset: 0 });
        const records = f_ParseRows(rows);
        const skipped = rows.length - records.length;
        if (skipped > 0) {
            this.onNotice?.({
                level: "error",
                message: `실행 이력에서 읽을 수 없는 기록 ${skipped}건을 건너뛰었습니다.`,
            });
        }
        return records;
    }

    list(query: { jobId?: string; limit?: number; offset?: number } = {}): typRunRecord[] {
        const page = { limit: query.limit ?? -1, offset: query.offset ?? 0 };
        const rows = query.jobId
            ? this.db.all(SQL_LIST_JOB, { ...page, jobId: query.jobId })
            : this.db.all(SQL_LIST_ALL, page);
        return f_ParseRows(rows);
    }

    get(runId: string): typRunRecord | null {
        const row = this.db.get(SQL_GET, { id: runId });
        return row === undefined ? null : f_ParseRow(row);
    }

    /** 실행 시작 기록(status: running). 같은 id가 있으면 거부 */
    async begin(record: typRunRecord): Promise<typRunRecord> {
        const rec = zRunRecord.parse(record);
        this.db.transaction(() => {
            if (zExistsRow.safeParse(this.db.get(SQL_EXISTS, { id: rec.id })).success) {
                throw new clsAppError("VALIDATION", "이미 있는 실행 ID입니다.");
            }
            this.db.run(SQL_INSERT, f_Row(rec));
            this.db.run(SQL_PRUNE, { limit: this.limit() });
        });
        return rec;
    }

    /** 실행 기록 갱신 (종료·단계 변경) */
    async patch(
        runId: string,
        patch: Partial<Omit<typRunRecord, "id" | "jobId">>,
    ): Promise<typRunRecord> {
        return this.db.transaction(() => {
            const row = this.db.get(SQL_GET, { id: runId });
            const cur = row === undefined ? null : f_ParseRow(row);
            if (!cur) throw new clsAppError("NOT_FOUND", "실행 기록을 찾을 수 없습니다.");
            const next = zRunRecord.parse({ ...cur, ...patch });
            this.db.run(SQL_UPDATE, f_Row(next));
            return next;
        });
    }

    /** 남아 있는 running 레코드를 interrupted로 바꾼다. 바꾼 레코드를 돌려준다 */
    async markInterrupted(): Promise<typRunRecord[]> {
        const running = f_ParseRows(this.db.all(SQL_RUNNING));
        if (running.length === 0) return [];
        const finishedAt = nowIso();
        const changed = running.map((r): typRunRecord => ({
            ...r,
            status: "interrupted",
            finishedAt,
            durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(r.startedAt)),
            error: {
                code: "INTERNAL",
                message: "앱이 실행 도중 종료되어 결과를 알 수 없습니다.",
            },
        }));
        this.db.transaction(() => {
            for (const next of changed) this.db.run(SQL_UPDATE, f_Row(zRunRecord.parse(next)));
        });
        return changed;
    }

    /**
     * 이력 전체 삭제. 실행 중 레코드는 남긴다. 지운 레코드의 로그 파일 이름을 돌려준다
     * (호출하는 쪽이 원하면 지운다).
     */
    async clear(): Promise<{ removed: number; logFiles: string[] }> {
        return this.db.transaction(() => {
            const logFiles = this.db.all(SQL_CLEAR_LOGS).flatMap((row) => {
                const r = zLogFileRow.safeParse(row);
                return r.success && r.data.log_file ? [r.data.log_file] : [];
            });
            const { changes } = this.db.run(SQL_CLEAR);
            return { removed: changes, logFiles };
        });
    }

    /** 보관 수(설정)를 지금 적용한다(앱 시작·주기 정리). 지운 개수 */
    async prune(): Promise<number> {
        return this.db.run(SQL_PRUNE, { limit: this.limit() }).changes;
    }

    /** 실행 중 레코드의 로그 파일 이름(로그 보관 정리에서 지우지 않음) */
    runningLogFiles(): Set<string> {
        const out = new Set<string>();
        for (const row of this.db.all(SQL_RUNNING_LOGS)) {
            const r = zLogFileRow.safeParse(row);
            if (r.success && r.data.log_file) out.add(r.data.log_file);
        }
        return out;
    }
}
