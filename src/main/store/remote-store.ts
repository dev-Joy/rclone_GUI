/**
 * remote 북마크 저장소 (SQLite remotes, INT-002 T-02).
 *
 * - 목록은 메모리 캐시로 동기 조회한다. 쓰기는 커밋에 성공한 뒤에만 캐시를 바꾼다.
 * - DB에는 별칭·remote 이름·기준 경로만 둔다. 화면용 전체 경로는 composeRemotePath로 만든다.
 * - 별칭은 대소문자를 구분해 유일해야 하고, 정렬은 SQLite BINARY(코드포인트) 순서를 따른다.
 * - rclone.conf는 경로로만 넘기며 여기서 읽지 않는다. remote 이름은 호출부가 목록으로 확인한다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== External imports ==========
import { randomUUID } from "node:crypto";
import { z } from "zod";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { nowIso } from "@/main/lib/time";
import type { clsSqliteDb } from "@/main/store/sqlite-db";
import { REMOTE_ALIAS_MAX, REMOTE_BOOKMARKS_MAX, REMOTE_NAME_MAX } from "@/shared/option-limits";
import { parsePath } from "@/shared/path-utils";
import { isDriveLetterRemoteName } from "@/shared/remote-name";
import { composeRemotePath, normalizeRemoteBasePath } from "@/shared/remote-path";
import type { typRemoteCreateInput, typRemoteUpdateInput } from "@/shared/schemas/remotes";
import type { itfRemoteBookmark } from "@/shared/types/remotes";

const zRow = z.object({
    id: z.string(),
    alias: z.string(),
    remote_name: z.string(),
    base_path: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
});

const SQL_SELECT_ALL =
    "SELECT id, alias, remote_name, base_path, created_at, updated_at FROM remotes ORDER BY alias";
const SQL_INSERT =
    "INSERT INTO remotes (id, alias, remote_name, base_path, created_at, updated_at) VALUES ($id, $alias, $remoteName, $basePath, $createdAt, $updatedAt)";
const SQL_UPDATE =
    "UPDATE remotes SET alias = $alias, remote_name = $remoteName, base_path = $basePath, updated_at = $updatedAt WHERE id = $id";
const SQL_DELETE = "DELETE FROM remotes WHERE id = $id";

function f_Compare(a: itfRemoteBookmark, b: itfRemoteBookmark): number {
    return a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0;
}

/** 저장 전 검사(IPC 스키마를 거치지 않은 호출 대비) */
function f_Alias(raw: string): string {
    const alias = raw.trim();
    if (alias === "") throw new clsAppError("VALIDATION", "별칭을 입력하세요.");
    if (alias.length > REMOTE_ALIAS_MAX) {
        throw new clsAppError("VALIDATION", `별칭은 ${REMOTE_ALIAS_MAX}자 이내로 입력하세요.`);
    }
    // oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
    if (/[\u0000-\u001f]/.test(alias)) {
        throw new clsAppError("VALIDATION", "별칭에 제어문자(줄바꿈 포함)는 쓸 수 없습니다.");
    }
    return alias;
}

function f_RemoteName(raw: string): string {
    const name = raw.trim();
    if (name === "") throw new clsAppError("VALIDATION", "리모트를 고르세요.");
    if (name.length > REMOTE_NAME_MAX) {
        throw new clsAppError("VALIDATION", `리모트 이름은 ${REMOTE_NAME_MAX}자 이내여야 합니다.`);
    }
    if (isDriveLetterRemoteName(name)) {
        throw new clsAppError(
            "VALIDATION",
            "영문 한 글자 리모트는 Windows에서 드라이브 문자로 해석되어 쓸 수 없습니다.",
        );
    }
    const parsed = parsePath(`${name}:`);
    if (!parsed.ok || parsed.path.kind !== "remote" || parsed.path.root !== `${name}:`) {
        throw new clsAppError("VALIDATION", "리모트 이름 형식이 올바르지 않습니다.");
    }
    if (parsed.path.segments.length !== 0 || parsed.path.normalized !== parsed.path.root) {
        throw new clsAppError("VALIDATION", "리모트 이름에는 경로를 넣을 수 없습니다.");
    }
    return name;
}

function f_BasePath(remoteName: string, raw: string): string {
    const r = normalizeRemoteBasePath(remoteName, raw);
    if (!r.ok) throw new clsAppError("VALIDATION", r.message);
    return r.basePath;
}

export class clsRemoteStore {
    private readonly db: clsSqliteDb;
    private items: itfRemoteBookmark[] = [];

    constructor(o: { db: clsSqliteDb }) {
        this.db = o.db;
    }

    load(): itfRemoteBookmark[] {
        const items: itfRemoteBookmark[] = [];
        for (const row of this.db.all(SQL_SELECT_ALL)) {
            const r = zRow.safeParse(row);
            if (!r.success) continue;
            const d = r.data;
            items.push({
                id: d.id,
                alias: d.alias,
                remoteName: d.remote_name,
                basePath: d.base_path,
                path: composeRemotePath(d.remote_name, d.base_path),
                createdAt: d.created_at,
                updatedAt: d.updated_at,
            });
        }
        this.items = items;
        return this.items;
    }

    /** 별칭 순(코드포인트) */
    list(): itfRemoteBookmark[] {
        return this.items;
    }

    get(id: string): itfRemoteBookmark {
        const item = this.items.find((x) => x.id === id);
        if (!item) throw new clsAppError("NOT_FOUND", "리모트 북마크를 찾을 수 없습니다.");
        return item;
    }

    create(input: typRemoteCreateInput): itfRemoteBookmark {
        const alias = f_Alias(input.alias);
        const remoteName = f_RemoteName(input.remoteName);
        const basePath = f_BasePath(remoteName, input.basePath);
        if (this.items.some((x) => x.alias === alias)) {
            throw new clsAppError("VALIDATION", "이미 있는 별칭입니다. 다른 별칭을 쓰세요.");
        }
        if (this.items.length >= REMOTE_BOOKMARKS_MAX) {
            throw new clsAppError(
                "VALIDATION",
                `리모트 북마크는 ${REMOTE_BOOKMARKS_MAX}개까지 저장할 수 있습니다.`,
            );
        }
        const now = nowIso();
        const item: itfRemoteBookmark = {
            id: randomUUID(),
            alias,
            remoteName,
            basePath,
            path: composeRemotePath(remoteName, basePath),
            createdAt: now,
            updatedAt: now,
        };
        this.db.run(SQL_INSERT, {
            id: item.id,
            alias: item.alias,
            remoteName: item.remoteName,
            basePath: item.basePath,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        });
        this.items = [...this.items, item].toSorted(f_Compare);
        return item;
    }

    update(input: typRemoteUpdateInput): itfRemoteBookmark {
        const cur = this.get(input.id);
        const alias = f_Alias(input.alias);
        const remoteName = f_RemoteName(input.remoteName);
        const basePath = f_BasePath(remoteName, input.basePath);
        if (this.items.some((x) => x.id !== input.id && x.alias === alias)) {
            throw new clsAppError("VALIDATION", "이미 있는 별칭입니다. 다른 별칭을 쓰세요.");
        }
        if (cur.alias === alias && cur.remoteName === remoteName && cur.basePath === basePath) {
            return cur;
        }
        const next: itfRemoteBookmark = {
            ...cur,
            alias,
            remoteName,
            basePath,
            path: composeRemotePath(remoteName, basePath),
            updatedAt: nowIso(),
        };
        const { changes } = this.db.run(SQL_UPDATE, {
            id: next.id,
            alias: next.alias,
            remoteName: next.remoteName,
            basePath: next.basePath,
            updatedAt: next.updatedAt,
        });
        if (changes === 0) throw new clsAppError("NOT_FOUND", "리모트 북마크를 찾을 수 없습니다.");
        this.items = this.items.map((x) => (x.id === next.id ? next : x)).toSorted(f_Compare);
        return next;
    }

    remove(id: string): void {
        this.get(id);
        const { changes } = this.db.run(SQL_DELETE, { id });
        if (changes === 0) throw new clsAppError("NOT_FOUND", "리모트 북마크를 찾을 수 없습니다.");
        this.items = this.items.filter((x) => x.id !== id);
    }
}
