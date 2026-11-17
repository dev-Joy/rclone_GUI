/**
 * commandPreview(INT-008 FR-7): 표시용 비교·동기화 명령 문자열. 실행하지 않는다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { commandPreview } from "@/main/services/command-preview";
import { createDefaultSettings, createJobDraft } from "@/shared/defaults";
import type { typJob } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";

function f_Job(over: Partial<typJob> = {}): typJob {
    const draft = createJobDraft(createDefaultSettings());
    return {
        ...draft,
        name: "작업",
        source: "C:\\tmp\\src",
        destination: "D:\\tmp\\dst",
        id: "00000000-0000-4000-8000-000000000001",
        autoSync: { ...draft.autoSync, nextRunAt: null, lastAutoRunAt: null },
        rev: 0,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        lastRun: null,
        ...over,
    };
}

function f_Settings(over: Partial<typSettings> = {}): typSettings {
    return { ...createDefaultSettings(), ...over };
}

describe("commandPreview", () => {
    it("동기화 명령은 --dry-run 없이 copy/sync 실제 인자를 만든다", () => {
        const job = f_Job({ mode: "sync" });
        const { sync } = commandPreview(job, f_Settings());

        expect(sync.startsWith("rclone sync ")).toBe(true);
        expect(sync).not.toContain("--dry-run");
        expect(sync).toContain("--max-delete 0");
        expect(sync).toContain(job.source);
        expect(sync).toContain(job.destination);
    });

    it("복사 명령에는 --max-delete를 넣지 않는다", () => {
        const { sync } = commandPreview(f_Job({ mode: "copy" }), f_Settings());

        expect(sync.startsWith("rclone copy ")).toBe(true);
        expect(sync).not.toContain("--max-delete");
    });

    it("비교 명령은 원본·대상 lsjson 2줄이다", () => {
        const { compare } = commandPreview(f_Job(), f_Settings());
        const lines = compare.split("\n");

        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain("lsjson --recursive");
        expect(lines[0]).toContain("C:\\tmp\\src");
        expect(lines[1]).toContain("D:\\tmp\\dst");
    });

    it("설정 경로가 있으면 --config를 넣고, 실행 파일 경로는 설정 값을 쓴다", () => {
        const settings = f_Settings({
            rclonePath: "C:\\Program Files\\rclone\\rclone.exe",
            configPath: "C:\\tmp\\rclone.conf",
        });
        const { sync } = commandPreview(f_Job(), settings);

        expect(sync.startsWith('"C:\\Program Files\\rclone\\rclone.exe" ')).toBe(true);
        expect(sync).toContain("--config C:\\tmp\\rclone.conf");
    });

    it("공백이 있는 경로는 따옴표로 감싼다", () => {
        const { sync } = commandPreview(
            f_Job({ source: "C:\\my folder\\src", destination: "D:\\dst" }),
            f_Settings(),
        );

        expect(sync).toContain('"C:\\my folder\\src"');
    });
});
