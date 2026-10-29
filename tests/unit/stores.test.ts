// ========== External imports ==========
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

// ========== Internal imports ==========
import { redactSecrets } from "@/main/lib/logger";
import { migrateSchema } from "@/main/store/db-schema";
import { clsHistoryStore } from "@/main/store/history-store";
import { clsJobStore, COPY_SUFFIX, MAX_JOB_NAME } from "@/main/store/job-store";
import { clsSettingsStore, deepMerge } from "@/main/store/settings-store";
import { clsSqliteDb } from "@/main/store/sqlite-db";
import type { itfAppNotice } from "@/shared/ipc-contract";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import type { typJobDraft } from "@/shared/schemas/job";
import type { typRunRecord } from "@/shared/schemas/run";

let dir = "";
const opened: clsSqliteDb[] = [];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-stores-"));
});

afterEach(() => {
    // Windows는 열린 DB 파일을 지울 수 없으므로 먼저 닫는다
    for (const db of opened.splice(0)) db.close();
    rmSync(dir, { recursive: true, force: true });
});

/** 같은 임시 DB 파일을 새 연결로 연다(재시작 흉내) */
function f_Db(): clsSqliteDb {
    const db = clsSqliteDb.open({ file: join(dir, "store.sqlite") });
    opened.push(db);
    migrateSchema(db, () => undefined);
    return db;
}

function f_Draft(over: Partial<typJobDraft> = {}): typJobDraft {
    return {
        ...createJobDraft(createDefaultSettings()),
        name: "작업",
        source: "C:\\tmp\\src",
        destination: "test-remote:dst",
        ...over,
    };
}

async function f_Jobs(onChange?: () => void) {
    const store = new clsJobStore({
        db: f_Db(),
        caseInsensitive: () => true,
        ...(onChange ? { onChange } : {}),
    });
    await store.load();
    return store;
}

describe("clsSettingsStore", () => {
    it("파일이 없으면 기본값", async () => {
        const s = new clsSettingsStore(f_Db());
        expect(await s.load()).toEqual(createDefaultSettings());
    });

    it("patch를 병합해 저장하고 재시작 후 유지한다", async () => {
        const s = new clsSettingsStore(f_Db());
        await s.load();
        await s.update({ ui: { theme: "dark" }, defaults: { excludes: ["a/**"] } });
        const again = new clsSettingsStore(f_Db());
        const loaded = await again.load();
        expect(loaded.ui).toEqual({ theme: "dark", minimizeToTray: true, launchAtLogin: false });
        expect(loaded.defaults.excludes).toEqual(["a/**"]);
        expect(loaded.defaults.checkers).toBe(8);
    });

    it("병합 결과가 범위를 벗어나면 거부하고 기존 값을 유지한다", async () => {
        const s = new clsSettingsStore(f_Db());
        await s.load();
        await expect(s.update({ logs: { historyLimit: 1 } })).rejects.toThrow(ZodError);
        expect(s.get().logs.historyLimit).toBe(500);
    });

    it("예전 파일에 없는 새 항목은 기본값으로 채운다", async () => {
        const old = createDefaultSettings() as unknown as Record<string, unknown>;
        delete old.scheduler;
        const db = f_Db();
        db.run("INSERT INTO settings (id, data, updated_at) VALUES (1, $data, 'x')", {
            data: JSON.stringify(old),
        });
        const loaded = await new clsSettingsStore(db).load();
        expect(loaded.scheduler).toEqual({ paused: false });
    });

    it("onChange: 저장한 뒤 새 값과 이전 값으로 부른다(실패하면 부르지 않음)", async () => {
        const calls: Array<[boolean, boolean]> = [];
        const s = new clsSettingsStore(f_Db(), undefined, (next, prev) =>
            calls.push([next.ui.minimizeToTray, prev.ui.minimizeToTray]),
        );
        await s.load();
        await s.update({ ui: { minimizeToTray: false } });
        await expect(s.update({ logs: { retentionDays: 0 } })).rejects.toBeTruthy();
        expect(calls).toEqual([[false, true]]);
    });

    it("deepMerge는 배열을 통째로 바꾸고 undefined를 무시한다", () => {
        expect(
            deepMerge({ a: [1, 2], b: { c: 1, d: 2 } }, { a: [3], b: { c: undefined, d: 5 } }),
        ).toEqual({
            a: [3],
            b: { c: 1, d: 5 },
        });
    });
});

describe("clsJobStore", () => {
    it("create: id·rev 0·관리 필드 초기화, 재시작 후 유지", async () => {
        const jobs = await f_Jobs();
        const job = await jobs.create(f_Draft());
        expect(job).toMatchObject({
            rev: 0,
            lastRun: null,
            autoSync: { nextRunAt: null, lastAutoRunAt: null },
        });
        expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
        expect((await f_Jobs()).list()).toEqual([job]);
    });

    it("create: 경로 안전 규칙 위반은 거부하고 저장하지 않는다", async () => {
        const jobs = await f_Jobs();
        await expect(
            jobs.create(f_Draft({ source: "C:\\a", destination: "c:\\A\\b" })),
        ).rejects.toMatchObject({
            code: "SAFETY_BLOCKED",
        });
        await expect(jobs.create(f_Draft({ source: "/home/x" }))).rejects.toMatchObject({
            code: "PATH_INVALID",
        });
        await expect(jobs.create(f_Draft({ destination: "remote:" }))).rejects.toMatchObject({
            code: "SAFETY_BLOCKED",
        });
        expect(jobs.list()).toEqual([]);
    });

    it("create: 스키마 위반(이름 비어 있음)은 VALIDATION(ZodError)", async () => {
        const jobs = await f_Jobs();
        await expect(jobs.create(f_Draft({ name: "" }))).rejects.toThrow(ZodError);
        expect(jobs.list()).toEqual([]);
    });

    it("update: rev +1, updatedAt 갱신, 관리 필드는 patch로 못 바꾼다", async () => {
        const jobs = await f_Jobs();
        const job = await jobs.create(
            f_Draft({ autoSync: { enabled: true, intervalMinutes: 5, allowDeletes: false } }),
        );
        await jobs.setBookkeeping(job.id, { nextRunAt: "2030-01-01T00:00:00.000Z" });
        const patch = {
            name: "새 이름",
            autoSync: { enabled: true, intervalMinutes: 5, allowDeletes: false, nextRunAt: null },
        } as unknown as Parameters<typeof jobs.update>[1];
        const updated = await jobs.update(job.id, patch);
        expect(updated).toMatchObject({ name: "새 이름", rev: 1 });
        expect(updated.autoSync).toMatchObject({
            enabled: true,
            nextRunAt: "2030-01-01T00:00:00.000Z",
        });
        expect(updated.createdAt).toBe(job.createdAt);
    });

    it("자동 실행 예약: 만들 때 켬 → now+주기, 켬·주기 변경 → now+주기, 끔 → null, 복제 켜짐 → now+주기", async () => {
        const jobs = await f_Jobs();
        const t0 = Date.now();
        const f_Mins = (iso: string | null) =>
            iso === null ? null : (Date.parse(iso) - t0) / 60_000;
        const off = await jobs.create(f_Draft());
        expect(off.autoSync.nextRunAt).toBeNull();
        const on = await jobs.update(off.id, {
            autoSync: { enabled: true, intervalMinutes: 30, allowDeletes: false },
        });
        expect(f_Mins(on.autoSync.nextRunAt)).toBeCloseTo(30, 0);
        await jobs.setBookkeeping(on.id, { nextRunAt: "2030-01-01T00:00:00.000Z" });
        const renamed = await jobs.update(on.id, { name: "이름만" });
        expect(renamed.autoSync.nextRunAt).toBe("2030-01-01T00:00:00.000Z");
        const faster = await jobs.update(on.id, {
            autoSync: { enabled: true, intervalMinutes: 2, allowDeletes: false },
        });
        expect(f_Mins(faster.autoSync.nextRunAt)).toBeCloseTo(2, 0);
        const copy = await jobs.duplicate(on.id);
        expect(f_Mins(copy.autoSync.nextRunAt)).toBeCloseTo(2, 0);
        expect(copy.autoSync.lastAutoRunAt).toBeNull();
        const disabled = await jobs.update(on.id, {
            autoSync: { enabled: false, intervalMinutes: 2, allowDeletes: false },
        });
        expect(disabled.autoSync.nextRunAt).toBeNull();
        const created = await jobs.create(
            f_Draft({ autoSync: { enabled: true, intervalMinutes: 10, allowDeletes: false } }),
        );
        expect(f_Mins(created.autoSync.nextRunAt)).toBeCloseTo(10, 0);
    });

    it("update: 알 수 없는 키·잘못된 경로·없는 id는 거부", async () => {
        const jobs = await f_Jobs();
        const job = await jobs.create(f_Draft());
        await expect(jobs.update(job.id, { rev: 5 } as never)).rejects.toThrow(ZodError);
        await expect(jobs.update(job.id, { destination: job.source })).rejects.toMatchObject({
            code: "SAFETY_BLOCKED",
        });
        await expect(
            jobs.update("00000000-0000-4000-8000-000000000000", { name: "x" }),
        ).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
        expect(jobs.get(job.id).rev).toBe(0);
    });

    it("setBookkeeping은 rev/updatedAt을 바꾸지 않는다", async () => {
        const jobs = await f_Jobs();
        const job = await jobs.create(f_Draft());
        const after = await jobs.setBookkeeping(job.id, {
            lastRun: { runId: null, at: "2026-10-28T00:00:00.000Z", status: "noop" },
            lastAutoRunAt: "2026-10-28T00:00:00.000Z",
        });
        expect(after).toMatchObject({
            rev: 0,
            updatedAt: job.updatedAt,
            lastRun: { status: "noop" },
        });
    });

    it("duplicate: 새 id·rev 0·이력 초기화, 이름 80자 제한", async () => {
        const jobs = await f_Jobs();
        const long = await jobs.create(f_Draft({ name: "가".repeat(MAX_JOB_NAME) }));
        await jobs.setBookkeeping(long.id, {
            lastRun: { runId: null, at: long.createdAt, status: "success" },
        });
        const copy = await jobs.duplicate(long.id);
        expect(copy.id).not.toBe(long.id);
        expect(copy).toMatchObject({ rev: 0, lastRun: null });
        expect(copy.name.length).toBe(MAX_JOB_NAME);
        expect(copy.name.endsWith(COPY_SUFFIX)).toBe(true);
    });

    it("remove와 변경 알림", async () => {
        let changes = 0;
        const jobs = await f_Jobs(() => {
            changes += 1;
        });
        const job = await jobs.create(f_Draft());
        await jobs.remove(job.id);
        expect(jobs.list()).toEqual([]);
        expect(changes).toBe(2);
        await expect(jobs.remove(job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
});

function f_Record(id: string, status: typRunRecord["status"] = "success"): typRunRecord {
    return {
        id,
        jobId: "11111111-1111-4111-8111-111111111111",
        jobName: "작업",
        mode: "copy",
        dryRun: false,
        trigger: "manual",
        status,
        phase: "finalizing",
        startedAt: "2026-10-28T00:00:00.000Z",
        finishedAt: null,
        durationMs: null,
        plan: null,
        preflight: null,
        stats: null,
        exitCode: null,
        pid: 1234,
        error: null,
        logFile: null,
    };
}

function f_Uuid(n: number): string {
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

describe("clsHistoryStore", () => {
    it("최신순 저장, limit 초과분 삭제하되 running은 남긴다", async () => {
        const h = new clsHistoryStore(f_Db(), () => 2);
        await h.load();
        await h.begin(f_Record(f_Uuid(1), "running"));
        for (let i = 2; i <= 5; i += 1) await h.begin(f_Record(f_Uuid(i)));
        expect(h.list().map((r) => r.id)).toEqual([f_Uuid(5), f_Uuid(4), f_Uuid(1)]);
    });

    it("앱 재시작 시 running → interrupted", async () => {
        const h = new clsHistoryStore(f_Db(), () => 500);
        await h.load();
        await h.begin(f_Record(f_Uuid(1), "running"));
        const again = new clsHistoryStore(f_Db(), () => 500);
        await again.load();
        const changed = await again.markInterrupted();
        expect(changed).toHaveLength(1);
        expect(again.get(f_Uuid(1))).toMatchObject({ status: "interrupted" });
        expect(again.get(f_Uuid(1))?.finishedAt).not.toBeNull();
    });

    it("patch·clear·jobId 필터", async () => {
        const h = new clsHistoryStore(f_Db(), () => 500);
        await h.load();
        await h.begin(f_Record(f_Uuid(1), "running"));
        await h.begin(f_Record(f_Uuid(2)));
        await h.patch(f_Uuid(1), { status: "success", exitCode: 0 });
        expect(h.get(f_Uuid(1))).toMatchObject({ status: "success", exitCode: 0 });
        expect(h.list({ jobId: "11111111-1111-4111-8111-111111111111", limit: 1 })).toHaveLength(1);
        await h.begin(f_Record(f_Uuid(3), "running"));
        await h.clear();
        expect(h.list().map((r) => r.id)).toEqual([f_Uuid(3)]);
        await expect(h.begin(f_Record(f_Uuid(3)))).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("clear는 지운 레코드의 로그 파일 이름을 돌려주고 running(과 그 로그)은 남긴다", async () => {
        const h = new clsHistoryStore(f_Db(), () => 500);
        await h.load();
        await h.begin({ ...f_Record(f_Uuid(1)), logFile: "run-a.log" });
        await h.begin(f_Record(f_Uuid(2)));
        await h.begin({ ...f_Record(f_Uuid(3), "running"), logFile: "run-c.log" });
        expect(h.runningLogFiles()).toEqual(new Set(["run-c.log"]));
        expect(await h.clear()).toEqual({ removed: 2, logFiles: ["run-a.log"] });
        expect(h.list().map((r) => r.id)).toEqual([f_Uuid(3)]);
    });

    it("prune: 보관 수를 줄이면 지금 적용한다(running 보존)", async () => {
        let limit = 500;
        const h = new clsHistoryStore(f_Db(), () => limit);
        await h.load();
        await h.begin(f_Record(f_Uuid(1), "running"));
        for (let i = 2; i <= 6; i += 1) await h.begin(f_Record(f_Uuid(i)));
        expect(await h.prune()).toBe(0);
        limit = 2;
        expect(await h.prune()).toBe(3);
        expect(h.list().map((r) => r.id)).toEqual([f_Uuid(6), f_Uuid(5), f_Uuid(1)]);
    });
});

describe("로그 비밀값 가리기", () => {
    it("토큰·비밀번호 값을 가린다", () => {
        const out = redactSecrets('token = {"access_token":"ya29.abc"} password=hunter2 pass: x');
        expect(out).not.toContain("ya29");
        expect(out).not.toContain("hunter2");
    });

    it("저장소 DB에는 rclone.conf 내용이 들어가지 않는다 (경로만)", async () => {
        const conf = join(dir, "rclone.conf");
        writeFileSync(conf, "[test-remote]\ntype = alias\npass = SECRET-CONF-VALUE\n");
        const db = f_Db();
        const s = new clsSettingsStore(db);
        await s.load();
        await s.update({ configPath: conf });
        const jobs = new clsJobStore({ db, caseInsensitive: () => true });
        await jobs.load();
        await jobs.create(f_Draft({ configPathOverride: conf }));
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        const row = db.get("SELECT data FROM settings WHERE id = 1");
        expect(String(row?.data)).toContain("rclone.conf");
        const bytes = readFileSync(join(dir, "store.sqlite")).toString("latin1");
        expect(bytes).toContain("rclone.conf");
        expect(bytes).not.toContain("SECRET-CONF-VALUE");
    });
});

describe("SQLite 저장소 동작 (INT-002 T-01)", () => {
    it("작업: 재시작(새 연결) 후 순서·내용 유지, 수정·삭제 반영", async () => {
        const jobs = await f_Jobs();
        const a = await jobs.create(f_Draft({ name: "가" }));
        const b = await jobs.create(f_Draft({ name: "나" }));
        const c = await jobs.duplicate(a.id);
        const a2 = await jobs.update(a.id, { name: "가2" });
        await jobs.remove(b.id);
        const again = await f_Jobs();
        expect(again.list()).toEqual([a2, c]);
    });

    it("작업: 읽을 수 없는 행은 건너뛰고 알리되 지우지 않는다", async () => {
        const db = f_Db();
        const notices: itfAppNotice[] = [];
        const jobs = new clsJobStore({ db, caseInsensitive: () => true });
        await jobs.load();
        const ok = await jobs.create(f_Draft());
        db.run(
            "INSERT INTO jobs (id, name, rev, created_at, updated_at, data) VALUES ('bad', 'x', 0, 'x', 'x', $data)",
            { data: JSON.stringify({ id: "bad" }) },
        );
        const again = new clsJobStore({
            db,
            caseInsensitive: () => true,
            onNotice: (n) => notices.push(n),
        });
        expect(await again.load()).toEqual([ok]);
        expect(notices).toHaveLength(1);
        expect(notices[0]?.message).toContain("1개");
        expect(db.get("SELECT COUNT(*) AS n FROM jobs")).toEqual({ n: 2 });
    });

    it("작업: DB 쓰기가 실패하면 캐시와 onChange는 그대로다", async () => {
        let changes = 0;
        const jobs = await f_Jobs(() => {
            changes += 1;
        });
        const job = await jobs.create(f_Draft());
        opened[opened.length - 1]?.close();
        await expect(jobs.update(job.id, { name: "바뀜" })).rejects.toMatchObject({
            code: "STORE_ERROR",
        });
        expect(jobs.get(job.id).name).toBe("작업");
        expect(changes).toBe(1);
    });

    it("설정: 저장된 값이 깨졌으면 알리고 기본값으로 시작한다", async () => {
        const db = f_Db();
        db.run("INSERT INTO settings (id, data, updated_at) VALUES (1, $data, 'x')", {
            data: JSON.stringify({ logs: { historyLimit: "많이" } }),
        });
        const notices: itfAppNotice[] = [];
        const s = new clsSettingsStore(db, (n) => notices.push(n));
        expect(await s.load()).toEqual(createDefaultSettings());
        expect(notices).toHaveLength(1);
    });

    it("이력: offset 페이지, jobId 필터, 최신순", async () => {
        const h = new clsHistoryStore(f_Db(), () => 500);
        await h.load();
        for (let i = 1; i <= 5; i += 1) {
            const rec = f_Record(f_Uuid(i));
            await h.begin(
                i % 2 === 0 ? { ...rec, jobId: "22222222-2222-4222-8222-222222222222" } : rec,
            );
        }
        expect(h.list({ limit: 2 }).map((r) => r.id)).toEqual([f_Uuid(5), f_Uuid(4)]);
        expect(h.list({ limit: 2, offset: 2 }).map((r) => r.id)).toEqual([f_Uuid(3), f_Uuid(2)]);
        expect(h.list({ offset: 4 }).map((r) => r.id)).toEqual([f_Uuid(1)]);
        expect(h.list({ limit: 2, offset: 10 })).toEqual([]);
        expect(
            h.list({ jobId: "22222222-2222-4222-8222-222222222222", offset: 1 }).map((r) => r.id),
        ).toEqual([f_Uuid(2)]);
    });

    it("이력: patch는 상태 열도 갱신해 running 조회·정리에 반영한다", async () => {
        const db = f_Db();
        const h = new clsHistoryStore(db, () => 500);
        await h.begin({ ...f_Record(f_Uuid(1), "running"), logFile: "run-a.log" });
        expect(h.runningLogFiles()).toEqual(new Set(["run-a.log"]));
        await h.patch(f_Uuid(1), { status: "success" });
        expect(h.runningLogFiles()).toEqual(new Set());
        expect(db.get("SELECT status FROM run_records WHERE id = $id", { id: f_Uuid(1) })).toEqual({
            status: "success",
        });
        await expect(h.patch(f_Uuid(9), { status: "success" })).rejects.toMatchObject({
            code: "NOT_FOUND",
        });
    });

    it("이력: 읽을 수 없는 행은 목록에서 빼고 시작 때 한 번 알린다", async () => {
        const db = f_Db();
        const h = new clsHistoryStore(db, () => 500);
        await h.begin(f_Record(f_Uuid(1)));
        db.run(
            "INSERT INTO run_records (id, job_id, status, started_at, data) VALUES ('bad', 'j', 'success', 'x', '{}')",
        );
        const notices: itfAppNotice[] = [];
        const again = new clsHistoryStore(
            db,
            () => 500,
            (n) => notices.push(n),
        );
        expect((await again.load()).map((r) => r.id)).toEqual([f_Uuid(1)]);
        expect(again.list().map((r) => r.id)).toEqual([f_Uuid(1)]);
        expect(notices).toHaveLength(1);
    });
});
