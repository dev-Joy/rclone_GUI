/**
 * 실행 문맥의 remote 존재 확인 테스트 (INT-006 FR-24, AC-12).
 * 비교·수동·자동·헤드리스가 모두 resolveJobContext를 지나므로 여기서 막으면 전 경로가 막힌다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { resolveJobContext } from "@/main/services/job-context";
import { createDefaultSettings } from "@/shared/defaults";
import type { typJob } from "@/shared/schemas/job";

const NOW = "2026-11-03T00:00:00.000Z";
const CONF = "C:\\fake\\rclone.conf";

function f_Job(over: Partial<typJob> = {}): typJob {
    const { excludes, ...options } = createDefaultSettings().defaults;
    return {
        id: "00000000-0000-4000-8000-000000000001",
        name: "작업",
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

function f_Deps(remotes: string[]) {
    const calls: string[][] = [];
    return {
        calls,
        deps: {
            settings: { get: () => createDefaultSettings() },
            rcloneEnv: {
                require: async () => ({ binaryPath: "C:\\fake\\rclone.exe", configPath: CONF }),
                resolveConfigFor: async () => CONF,
                listRemotesAt: async (configPath: string | null) => {
                    calls.push([configPath ?? "null"]);
                    return remotes;
                },
            },
            excludes: { patternsFor: () => [] },
        },
    };
}

describe("resolveJobContext remote 존재 확인", () => {
    it("conf에 없는 remote는 REMOTE_NOT_FOUND로 막는다 (AC-12)", async () => {
        const h = f_Deps(["r1"]);
        await expect(resolveJobContext(f_Job({ source: "gone:x" }), h.deps)).rejects.toMatchObject({
            code: "REMOTE_NOT_FOUND",
        });
        expect(h.calls).toEqual([[CONF]]);
    });

    it("conf에 있으면 문맥을 만든다", async () => {
        const h = f_Deps(["r1"]);
        const ctx = await resolveJobContext(
            f_Job({ source: "r1:x", destination: "C:\\fake\\dst" }),
            h.deps,
        );
        expect(ctx.configPath).toBe(CONF);
        expect(ctx.src.kind).toBe("remote");
    });

    it("로컬 경로만 쓰면 remote 목록을 부르지 않는다", async () => {
        const h = f_Deps([]);
        await resolveJobContext(f_Job(), h.deps);
        expect(h.calls).toEqual([]);
    });
});
