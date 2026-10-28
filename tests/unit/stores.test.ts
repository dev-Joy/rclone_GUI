// ========== External imports ==========
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

// ========== Internal imports ==========
import { redactSecrets } from "@/main/lib/logger";
import { clsHistoryStore } from "@/main/store/history-store";
import { clsJobStore, COPY_SUFFIX, MAX_JOB_NAME } from "@/main/store/job-store";
import { clsSettingsStore, deepMerge } from "@/main/store/settings-store";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import type { typJobDraft } from "@/shared/schemas/job";
import type { typRunRecord } from "@/shared/schemas/run";

let dir = "";

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-stores-"));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

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
        userDataDir: dir,
        caseInsensitive: () => true,
        ...(onChange ? { onChange } : {}),
    });
    await store.load();
    return store;
}

describe("clsSettingsStore", () => {
    it("파일이 없으면 기본값", async () => {
        const s = new clsSettingsStore(dir);
        expect(await s.load()).toEqual(createDefaultSettings());
    });

    it("patch를 병합해 저장하고 재시작 후 유지한다", async () => {
        const s = new clsSettingsStore(dir);
        await s.load();
        await s.update({ ui: { theme: "dark" }, defaults: { excludes: ["a/**"] } });
        const again = new clsSettingsStore(dir);
        const loaded = await again.load();
        expect(loaded.ui).toEqual({ theme: "dark", minimizeToTray: true, launchAtLogin: false });
        expect(loaded.defaults.excludes).toEqual(["a/**"]);
        expect(loaded.defaults.checkers).toBe(8);
    });

    it("병합 결과가 범위를 벗어나면 거부하고 기존 값을 유지한다", async () => {
        const s = new clsSettingsStore(dir);
        await s.load();
        await expect(s.update({ logs: { historyLimit: 1 } })).rejects.toThrow(ZodError);
        expect(s.get().logs.historyLimit).toBe(500);
    });

    it("예전 파일에 없는 새 항목은 기본값으로 채운다", async () => {
        const old = createDefaultSettings() as unknown as Record<string, unknown>;
        delete old.scheduler;
        writeFileSync(join(dir, "settings.json"), JSON.stringify(old));
        const loaded = await new clsSettingsStore(dir).load();
        expect(loaded.scheduler).toEqual({ paused: false });
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
        const job = await jobs.create(f_Draft());
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
        const h = new clsHistoryStore(dir, () => 2);
        await h.load();
        await h.begin(f_Record(f_Uuid(1), "running"));
        for (let i = 2; i <= 5; i += 1) await h.begin(f_Record(f_Uuid(i)));
        expect(h.list().map((r) => r.id)).toEqual([f_Uuid(5), f_Uuid(4), f_Uuid(1)]);
    });

    it("앱 재시작 시 running → interrupted", async () => {
        const h = new clsHistoryStore(dir, () => 500);
        await h.load();
        await h.begin(f_Record(f_Uuid(1), "running"));
        const again = new clsHistoryStore(dir, () => 500);
        await again.load();
        const changed = await again.markInterrupted();
        expect(changed).toHaveLength(1);
        expect(again.get(f_Uuid(1))).toMatchObject({ status: "interrupted" });
        expect(again.get(f_Uuid(1))?.finishedAt).not.toBeNull();
    });

    it("patch·clear·jobId 필터", async () => {
        const h = new clsHistoryStore(dir, () => 500);
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
});

describe("로그 비밀값 가리기", () => {
    it("토큰·비밀번호 값을 가린다", () => {
        const out = redactSecrets('token = {"access_token":"ya29.abc"} password=hunter2 pass: x');
        expect(out).not.toContain("ya29");
        expect(out).not.toContain("hunter2");
    });

    it("settings.json 에는 rclone.conf 내용이 들어가지 않는다 (경로만)", async () => {
        const s = new clsSettingsStore(dir);
        await s.load();
        await s.update({ configPath: "C:\\tmp\\rclone.conf" });
        expect(readFileSync(join(dir, "settings.json"), "utf8")).toContain("rclone.conf");
    });
});
