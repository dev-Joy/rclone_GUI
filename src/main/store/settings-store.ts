/**
 * 앱 설정 저장소 (SQLite settings 테이블의 한 행, INT-002 T-01).
 * patch를 병합한 최종 값을 검증한 뒤에만 저장하고, 저장에 성공한 뒤에만 메모리 값을 바꾼다.
 * 저장된 값에 없는 새 설정 항목은 기본값으로 채운다. 읽을 수 없으면 알리고 기본값으로 시작한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { z } from "zod";

// ========== Internal imports ==========
import { nowIso } from "@/main/lib/time";
import type { clsSqliteDb } from "@/main/store/sqlite-db";
import { createDefaultSettings } from "@/shared/defaults";
import type { itfAppNotice } from "@/shared/ipc-contract";
import {
    zSettings,
    zSettingsPatch,
    type typSettings,
    type typSettingsPatch,
} from "@/shared/schemas/settings";

const zDataRow = z.object({ data: z.string() });

const SQL_SELECT = "SELECT data FROM settings WHERE id = 1";
const SQL_UPSERT =
    "INSERT INTO settings (id, data, updated_at) VALUES (1, $data, $updatedAt) ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at";

function f_IsPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 객체는 재귀 병합, 배열·원시값은 통째로 교체. undefined는 무시 */
export function deepMerge<T>(base: T, patch: unknown): T {
    if (!f_IsPlainObject(base) || !f_IsPlainObject(patch))
        return (patch === undefined ? base : patch) as T;
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        out[key] =
            f_IsPlainObject(value) && f_IsPlainObject(out[key])
                ? deepMerge(out[key], value)
                : value;
    }
    return out as T;
}

/** 저장된 data(JSON) → 설정. 새 항목은 기본값으로 채운다. 맞지 않으면 null */
function f_ParseRow(row: unknown): typSettings | null {
    const r = zDataRow.safeParse(row);
    if (!r.success) return null;
    try {
        const parsed = zSettings.safeParse(
            deepMerge(createDefaultSettings(), JSON.parse(r.data.data)),
        );
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export class clsSettingsStore {
    private readonly db: clsSqliteDb;
    private readonly onNotice: ((n: itfAppNotice) => void) | undefined;
    private readonly onChange: ((s: typSettings, prev: typSettings) => void) | undefined;
    private value: typSettings = createDefaultSettings();

    /** onChange: 저장에 성공한 뒤 새 값·이전 값으로 부른다(트레이·테마·로그인 항목 반영) */
    constructor(
        db: clsSqliteDb,
        onNotice?: (n: itfAppNotice) => void,
        onChange?: (s: typSettings, prev: typSettings) => void,
    ) {
        this.db = db;
        this.onNotice = onNotice;
        this.onChange = onChange;
    }

    async load(): Promise<typSettings> {
        const row = this.db.get(SQL_SELECT);
        if (row === undefined) {
            this.value = createDefaultSettings();
            return this.value;
        }
        const parsed = f_ParseRow(row);
        if (parsed) {
            this.value = parsed;
        } else {
            this.value = createDefaultSettings();
            this.onNotice?.({
                level: "error",
                message:
                    "저장된 설정을 읽을 수 없어 기본값으로 시작합니다. 설정을 바꾸면 기본값 기준으로 다시 저장합니다.",
            });
        }
        return this.value;
    }

    get(): typSettings {
        return this.value;
    }

    async update(patch: typSettingsPatch): Promise<typSettings> {
        const checked = zSettingsPatch.parse(patch);
        const prev = this.value;
        const next = zSettings.parse(deepMerge(prev, checked));
        this.db.run(SQL_UPSERT, { data: JSON.stringify(next), updatedAt: nowIso() });
        this.value = next;
        if (this.onChange) {
            try {
                this.onChange(next, prev);
            } catch {
                // 반영 실패로 저장 결과를 바꾸지 않는다
            }
        }
        return next;
    }
}
