/**
 * 공용 제외 패턴 라이브러리 저장소 (SQLite exclude_patterns, INT-002 T-03).
 *
 * - 목록은 메모리 캐시로 동기 조회한다(비교·실행 문맥 해석이 동기). 쓰기는 커밋에 성공한 뒤에만 캐시를 바꾼다.
 * - 같은 패턴은 한 번만 저장한다: create는 이미 있으면 기존 행을 돌려준다(created:false).
 * - 작업과의 연결은 job_exclude_patterns(job-store가 씀). 패턴 삭제는 연결 → 패턴 순서로 한 트랜잭션.
 * - 정렬은 SQLite BINARY(UTF-8 바이트 = 코드포인트 순서).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { randomUUID } from "node:crypto";
import { z } from "zod";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { nowIso } from "@/main/lib/time";
import type { clsSqliteDb } from "@/main/store/sqlite-db";
import { libraryPatternIssue, normalizeExcludePattern } from "@/shared/exclude-patterns";
import { EXCLUDE_LIBRARY_MAX } from "@/shared/option-limits";
import type { typExcludePattern } from "@/shared/schemas/excludes";

const zRow = z.object({
    id: z.string(),
    pattern: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
});
const zJobIdRow = z.object({ job_id: z.string() });

const SQL_SELECT_ALL =
    "SELECT id, pattern, created_at, updated_at FROM exclude_patterns ORDER BY pattern";
const SQL_INSERT =
    "INSERT INTO exclude_patterns (id, pattern, created_at, updated_at) VALUES ($id, $pattern, $createdAt, $updatedAt)";
const SQL_UPDATE =
    "UPDATE exclude_patterns SET pattern = $pattern, updated_at = $updatedAt WHERE id = $id";
const SQL_DELETE_LINKS = "DELETE FROM job_exclude_patterns WHERE pattern_id = $id";
const SQL_DELETE = "DELETE FROM exclude_patterns WHERE id = $id";
const SQL_USAGE = "SELECT job_id FROM job_exclude_patterns WHERE pattern_id = $id ORDER BY job_id";

function f_Compare(a: typExcludePattern, b: typExcludePattern): number {
    return a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0;
}

/** 저장 전 검사(IPC 스키마를 거치지 않은 호출 대비) */
function f_Checked(raw: string): string {
    const pattern = normalizeExcludePattern(raw);
    const issue = libraryPatternIssue(pattern);
    if (issue) throw new clsAppError("VALIDATION", issue);
    return pattern;
}

export class clsExcludeStore {
    private readonly db: clsSqliteDb;
    private items: typExcludePattern[] = [];

    constructor(o: { db: clsSqliteDb }) {
        this.db = o.db;
    }

    load(): typExcludePattern[] {
        const items: typExcludePattern[] = [];
        for (const row of this.db.all(SQL_SELECT_ALL)) {
            const r = zRow.safeParse(row);
            if (!r.success) continue;
            items.push({
                id: r.data.id,
                pattern: r.data.pattern,
                createdAt: r.data.created_at,
                updatedAt: r.data.updated_at,
            });
        }
        this.items = items;
        return this.items;
    }

    /** 패턴 순(코드포인트) */
    list(): typExcludePattern[] {
        return this.items;
    }

    /** id → 패턴 문자열(입력 순서). 없는 id가 있으면 VALIDATION */
    patternsFor(ids: readonly string[]): string[] {
        return ids.map((id) => {
            const item = this.items.find((p) => p.id === id);
            if (!item) {
                throw new clsAppError(
                    "VALIDATION",
                    "없는 제외 패턴이 연결되어 있습니다. 작업을 열어 공용 제외 패턴을 다시 고른 뒤 저장하세요.",
                );
            }
            return item.pattern;
        });
    }

    /** 이 패턴을 쓰는 작업 id(정렬) */
    usageJobIds(id: string): string[] {
        return this.db
            .all(SQL_USAGE, { id })
            .map((row) => zJobIdRow.safeParse(row))
            .filter((r) => r.success)
            .map((r) => r.data.job_id);
    }

    /** 새 패턴. 같은 패턴이 이미 있으면 그 행을 돌려준다(created:false) */
    create(raw: string): { item: typExcludePattern; created: boolean } {
        const pattern = f_Checked(raw);
        const existing = this.items.find((p) => p.pattern === pattern);
        if (existing) return { item: existing, created: false };
        if (this.items.length >= EXCLUDE_LIBRARY_MAX) {
            throw new clsAppError(
                "VALIDATION",
                `공용 제외 패턴은 ${EXCLUDE_LIBRARY_MAX}개까지 저장할 수 있습니다.`,
            );
        }
        const now = nowIso();
        const item: typExcludePattern = {
            id: randomUUID(),
            pattern,
            createdAt: now,
            updatedAt: now,
        };
        this.db.run(SQL_INSERT, {
            id: item.id,
            pattern: item.pattern,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        });
        this.items = [...this.items, item].toSorted(f_Compare);
        return { item, created: true };
    }

    /** 패턴 문자열 바꾸기. 다른 행과 같으면 VALIDATION */
    update(id: string, raw: string): typExcludePattern {
        const pattern = f_Checked(raw);
        const cur = this.getItem(id);
        if (cur.pattern === pattern) return cur;
        if (this.items.some((p) => p.id !== id && p.pattern === pattern)) {
            throw new clsAppError("VALIDATION", "이미 있는 패턴입니다. 그 패턴을 고르세요.");
        }
        const next: typExcludePattern = { ...cur, pattern, updatedAt: nowIso() };
        const { changes } = this.db.run(SQL_UPDATE, {
            id,
            pattern: next.pattern,
            updatedAt: next.updatedAt,
        });
        if (changes === 0) throw new clsAppError("NOT_FOUND", "제외 패턴을 찾을 수 없습니다.");
        this.items = this.items.map((p) => (p.id === id ? next : p)).toSorted(f_Compare);
        return next;
    }

    /** 연결을 지운 뒤 패턴을 지운다(한 트랜잭션) */
    remove(id: string): void {
        this.getItem(id);
        this.db.transaction(() => {
            this.db.run(SQL_DELETE_LINKS, { id });
            const { changes } = this.db.run(SQL_DELETE, { id });
            if (changes === 0) throw new clsAppError("NOT_FOUND", "제외 패턴을 찾을 수 없습니다.");
        });
        this.items = this.items.filter((p) => p.id !== id);
    }

    private getItem(id: string): typExcludePattern {
        const item = this.items.find((p) => p.id === id);
        if (!item) throw new clsAppError("NOT_FOUND", "제외 패턴을 찾을 수 없습니다.");
        return item;
    }
}
