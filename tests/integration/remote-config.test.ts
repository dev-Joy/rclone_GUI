/**
 * 실제 rclone으로 remote 설정 추가·수정·삭제·rcd 인증을 확인한다 (INT-006 AC-1·AC-3·AC-15).
 * 임시 폴더의 빈 rclone.conf만 쓰고, 실제 사용자 conf·remote는 건드리지 않는다.
 * rclone이 없으면 이유를 출력하고 건너뛴다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { clsRcloneEnv } from "@/main/rclone/detect";
import { runRclone } from "@/main/rclone/process";
import { clsRcSession } from "@/main/rclone/rc-session";
import { clsActivityLock } from "@/main/services/activity-lock";
import { clsRemoteConfigService } from "@/main/services/remote-config-service";
import { clsRemoteOps } from "@/main/services/remote-ops";
import { createDefaultSettings } from "@/shared/defaults";
import type { typJob } from "@/shared/schemas/job";

const RCLONE = process.env.RCLONEGUI_TEST_RCLONE ?? "rclone";
const probe = spawnSync(RCLONE, ["version"], { shell: false, windowsHide: true, encoding: "utf8" });
const HAS_RCLONE = probe.status === 0;
if (!HAS_RCLONE) {
    console.warn(
        `[test:int] rclone을 실행할 수 없어 건너뜁니다 (${RCLONE}): ${probe.error?.message ?? probe.stderr}`,
    );
}

const root = mkdtempSync(join(tmpdir(), "rclonegui-remote-config-"));
const conf = join(root, "rclone.conf");
writeFileSync(conf, "");
const LOGGER = { info: () => undefined, warn: () => undefined };
const NOW = "2026-11-03T00:00:00.000Z";

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

function f_Job(over: Partial<typJob>): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: "00000000-0000-4000-8000-000000000001",
        name: "통합",
        notes: "",
        source: "C:\\fake\\src",
        destination: "C:\\fake\\dst",
        mode: "copy",
        scope: "files",
        excludes: [...excludes],
        excludePatternIds: [],
        options,
        configPathOverride: null,
        backupDir: null,
        autoSync: {
            enabled: false,
            intervalMinutes: 60,
            allowDeletes: false,
            kind: "interval",
            timeOfDay: "09:00",
            weekdays: 127,
            backend: "app",
            nextRunAt: null,
            lastAutoRunAt: null,
        },
        rev: 0,
        createdAt: NOW,
        updatedAt: NOW,
        lastRun: null,
        ...over,
    };
}

function f_Service(jobs: typJob[] = []) {
    const rcloneEnv = new clsRcloneEnv({
        getSettings: () => ({
            rclonePath: process.env.RCLONEGUI_TEST_RCLONE ?? null,
            configPath: conf,
        }),
        logger: LOGGER,
        env: { ...process.env, RCLONE_CONFIG: undefined },
    });
    const activity = new clsActivityLock();
    const remoteOps = new clsRemoteOps({
        activity,
        jobs: { get: () => jobs[0] ?? f_Job({}) },
    });
    return new clsRemoteConfigService({
        rcloneEnv,
        remoteOps,
        jobs: {
            list: () => jobs,
            get: (id) => {
                const j = jobs.find((x) => x.id === id);
                if (!j) throw new Error("no job");
                return j;
            },
            update: async (id, patch) => {
                const i = jobs.findIndex((x) => x.id === id);
                if (i < 0) throw new Error("no job");
                const cur = jobs[i]!;
                jobs[i] = {
                    ...cur,
                    ...patch,
                    autoSync: patch.autoSync
                        ? { ...cur.autoSync, ...patch.autoSync }
                        : cur.autoSync,
                };
                return jobs[i]!;
            },
        },
        bookmarks: { list: () => [] },
        osScheduler: {
            idle: async () => undefined,
            status: () => ({ available: false, reason: "test", tasks: [] }),
        },
        logger: LOGGER,
        emit: () => undefined,
        run: runRclone,
    });
}

describe.skipIf(!HAS_RCLONE)("remote 설정 통합", () => {
    it("rcd는 loopback에만 열리고 인증 없는 요청은 401, 허용 밖 경로는 거부한다 (AC-15)", async () => {
        const session = await clsRcSession.start({ binaryPath: RCLONE, configPath: conf });
        try {
            expect(session.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
            expect(session.running).toBe(true);
            const noAuth = await fetch(new URL("/config/providers", session.url), {
                method: "POST",
            });
            expect(noAuth.status).toBe(401);
            await expect(session.post("/config/get", { name: "x" })).rejects.toThrow(/허용/);
            await expect(
                session.post("/config/create", {
                    name: "it-local",
                    type: "local",
                    parameters: {},
                    opt: { nonInteractive: true },
                }),
            ).resolves.toBeTruthy();
        } finally {
            await session.quit();
        }
        expect(session.running).toBe(false);
    });

    it("local·memory·alias를 추가하고 목록·수정 화면에 바로 보인다 (AC-1)", async () => {
        const svc = f_Service();
        await svc.create({ name: "it-local2", type: "local", values: {}, secrets: {} });
        await svc.create({ name: "it-memory", type: "memory", values: {}, secrets: {} });
        await svc.create({
            name: "it-alias2",
            type: "alias",
            values: { remote: root },
            secrets: {},
        });
        const view = await svc.get("it-alias2");
        expect(view.type).toBe("alias");
        expect(view.values.remote).toBe(root);

        const updated = await svc.update({
            name: "it-local2",
            values: { nounc: "true" },
            secrets: {},
        });
        expect(updated).toEqual({ name: "it-local2", reauthSuggested: false });

        const del = await svc.remove({ name: "it-memory" });
        expect(del.disabledJobIds).toEqual([]);
        await expect(svc.get("it-memory")).rejects.toThrow(/없습니다/);
    });

    it("비밀 값을 넣어도 수정 화면 응답에 비밀 값이 없다 (AC-3·AC-4)", async () => {
        const svc = f_Service();
        await svc.create({
            name: "it-sftp",
            type: "sftp",
            values: {},
            secrets: { host: "example.invalid", pass: "integration-secret" },
        });
        const view = await svc.get("it-sftp");
        expect(view.type).toBe("sftp");
        expect(view.secretsSet).toContain("pass");
        expect(JSON.stringify(view)).not.toContain("integration-secret");
        expect(JSON.stringify(view)).not.toContain("example.invalid");
        await svc.remove({ name: "it-sftp" });
    });

    it("예약 켜진 작업이 있으면 확인 없이 지우지 않고, 확인하면 자동 실행을 끈다 (AC-8·AC-9)", async () => {
        const jobs = [
            f_Job({
                id: "00000000-0000-4000-8000-000000000002",
                name: "예약 작업",
                source: "it-keep:x",
                autoSync: { ...f_Job({}).autoSync, enabled: true },
            }),
        ];
        const svc = f_Service(jobs);
        await svc.create({ name: "it-keep", type: "local", values: {}, secrets: {} });
        await expect(svc.remove({ name: "it-keep" })).rejects.toThrow(/자동 실행/);
        const r = await svc.remove({ name: "it-keep", disableSchedules: true });
        expect(r.disabledJobIds).toEqual([jobs[0]!.id]);
        expect(jobs[0]!.autoSync.enabled).toBe(false);
    });
});
