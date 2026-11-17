/**
 * 작업 그룹 저장소 (SQLite groups, INT-008 T-06 / FR-17).
 *
 * - 목록은 position → 이름 순으로 메모리 캐시에서 동기 조회한다. 쓰기는 커밋 뒤에만 캐시를 바꾼다.
 * - 이름은 대소문자 없이 중복을 막는다(COLLATE NOCASE UNIQUE). 저장 전에 캐시로도 확인해 사유를 돌려준다.
 * - id는 `g-<난수>`(1세대와 같은 형식). 새 그룹은 맨 뒤(position = 최대 + 1), 이름을 바꿔도 순서는 그대로다.
 * - 삭제는 속한 작업의 group_id를 NULL로 바꾸고 그룹을 지운다(한 트랜잭션). 작업 캐시 갱신은 job-store가 한다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { randomUUID } from "node:crypto";
import { z } from "zod";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { nowIso } from "@/main/lib/time";
import type { clsSqliteDb } from "@/main/store/sqlite-db";
import { zGroupSave, type itfGroup, type typGroupSaveInput } from "@/shared/schemas/group";

export interface itfGroupStoreOptions {
    db: clsSqliteDb;
    onChange?: (groups: itfGroup[]) => void;
}

const zRow = z.object({
    id: z.string(),
    name: z.string(),
    position: z.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
});

const SQL_SELECT_ALL =
    "SELECT id, name, position, created_at, updated_at FROM groups ORDER BY position, name";
const SQL_INSERT =
    "INSERT INTO groups (id, name, position, created_at, updated_at) VALUES ($id, $name, $position, $createdAt, $updatedAt)";
const SQL_UPDATE_NAME = "UPDATE groups SET name = $name, updated_at = $updatedAt WHERE id = $id";
const SQL_NEXT_POSITION = "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM groups";
const SQL_DETACH_JOBS = "UPDATE jobs SET group_id = NULL WHERE group_id = $id";
const SQL_DELETE = "DELETE FROM groups WHERE id = $id";

/** 이름 비교(대소문자 무시). DB의 COLLATE NOCASE와 같은 규칙으로 미리 확인한다 */
function f_NameKey(name: string): string {
    return name.toLowerCase();
}

function f_Sort(groups: readonly itfGroup[]): itfGroup[] {
    return groups.toSorted((a, b) => a.position - b.position || a.name.localeCompare(b.name, "ko"));
}

export class clsGroupStore {
    private readonly db: clsSqliteDb;
    private readonly opts: itfGroupStoreOptions;
    private items: itfGroup[] = [];

    constructor(opts: itfGroupStoreOptions) {
        this.opts = opts;
        this.db = opts.db;
    }

    load(): itfGroup[] {
        const items: itfGroup[] = [];
        for (const row of this.db.all(SQL_SELECT_ALL)) {
            const r = zRow.safeParse(row);
            if (!r.success) continue;
            items.push({
                id: r.data.id,
                name: r.data.name,
                position: r.data.position,
                createdAt: r.data.created_at,
                updatedAt: r.data.updated_at,
            });
        }
        this.items = f_Sort(items);
        return this.items;
    }

    /** position → 이름 순 */
    list(): itfGroup[] {
        return this.items;
    }

    get(id: string): itfGroup {
        const item = this.items.find((g) => g.id === id);
        if (!item) throw new clsAppError("NOT_FOUND", "그룹을 찾을 수 없습니다.");
        return item;
    }

    /** 새 그룹(id 없음) 또는 이름 바꾸기. 이름이 대소문자 없이 겹치면 VALIDATION */
    save(input: typGroupSaveInput): itfGroup {
        const { id, name } = zGroupSave.parse(input);
        if (id === undefined) return this.insert(name);
        const cur = this.get(id);
        if (cur.name === name) return cur;
        this.assertUnique(name, id);
        const now = nowIso();
        const { changes } = this.db.run(SQL_UPDATE_NAME, { id, name, updatedAt: now });
        if (changes === 0) throw new clsAppError("NOT_FOUND", "그룹을 찾을 수 없습니다.");
        const next: itfGroup = { ...cur, name, updatedAt: now };
        this.items = f_Sort(this.items.map((g) => (g.id === id ? next : g)));
        this.opts.onChange?.(this.items);
        return next;
    }

    /** 속한 작업을 그룹 없음으로 옮긴 뒤 그룹을 지운다(한 트랜잭션) */
    remove(id: string): void {
        this.get(id);
        this.db.transaction(() => {
            this.db.run(SQL_DETACH_JOBS, { id });
            const { changes } = this.db.run(SQL_DELETE, { id });
            if (changes === 0) throw new clsAppError("NOT_FOUND", "그룹을 찾을 수 없습니다.");
        });
        this.items = this.items.filter((g) => g.id !== id);
        this.opts.onChange?.(this.items);
    }

    private insert(name: string): itfGroup {
        this.assertUnique(name);
        const now = nowIso();
        const item: itfGroup = {
            id: `g-${randomUUID()}`,
            name,
            position: 0,
            createdAt: now,
            updatedAt: now,
        };
        this.db.transaction(() => {
            const row = this.db.get(SQL_NEXT_POSITION);
            item.position = Number(row?.next ?? 0);
            this.db.run(SQL_INSERT, {
                id: item.id,
                name: item.name,
                position: item.position,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
            });
        });
        this.items = f_Sort([...this.items, item]);
        this.opts.onChange?.(this.items);
        return item;
    }

    private assertUnique(name: string, exceptId?: string): void {
        const key = f_NameKey(name);
        const dup = this.items.some((g) => g.id !== exceptId && f_NameKey(g.name) === key);
        if (dup) {
            throw new clsAppError(
                "VALIDATION",
                "같은 이름의 그룹이 이미 있습니다. 다른 이름을 쓰세요.",
            );
        }
    }
}
