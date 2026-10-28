// ========== External imports ==========
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    clsRunLogFile,
    maskArgsForLog,
    MASK_CONFIG,
    MASK_DEST,
    MASK_SOURCE,
    runLogFileName,
} from "@/main/services/run-log-file";

const root = mkdtempSync(join(tmpdir(), "rclonegui-runlog-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const JOB = "1a2b3c4d-0000-4000-8000-000000000001";
const RUN = "5e6f7a8b-0000-4000-8000-000000000002";

describe("runLogFileName", () => {
    it("run-YYYYMMDD-HHmmss-<job8>-<run8>.log (로컬 시각)", () => {
        const name = runLogFileName(new Date(2026, 9, 28, 17, 35, 0), JOB, RUN);
        expect(name).toBe("run-20261028-173500-1a2b3c4d-5e6f7a8b.log");
    });
});

describe("maskArgsForLog", () => {
    it('"--" 뒤의 원본·대상과 --config 값을 가린다. 제외 패턴은 그대로', () => {
        const args = [
            "copy",
            "--config",
            "C:\\tmp\\rclone.conf",
            "--exclude",
            "*.tmp",
            "--dry-run",
            "--",
            "C:\\tmp\\src",
            "r:dst",
        ];
        expect(
            maskArgsForLog(args, {
                source: "C:\\tmp\\src",
                destination: "r:dst",
                configPath: "C:\\tmp\\rclone.conf",
            }),
        ).toEqual([
            "copy",
            "--config",
            MASK_CONFIG,
            "--exclude",
            "*.tmp",
            "--dry-run",
            "--",
            MASK_SOURCE,
            MASK_DEST,
        ]);
        expect(
            maskArgsForLog(["copy", "--config=x"], {
                source: "a",
                destination: "b",
                configPath: "x",
            }),
        ).toEqual(["copy", `--config=${MASK_CONFIG}`]);
    });
});

describe("clsRunLogFile", () => {
    it("머리말과 줄을 쓰고 비밀값을 가린다", async () => {
        const f = new clsRunLogFile(join(root, "logs"), "run-a.log");
        f.open({ runId: RUN, jobId: JOB, mode: "copy", dryRun: true, args: ["copy", "--dry-run"] });
        f.write('{"msg":"token = abc123"}');
        f.write("일반 줄");
        await f.close();
        const text = readFileSync(join(root, "logs", "run-a.log"), "utf8");
        expect(text).toContain(`# run=${RUN} job=${JOB} mode=copy dryRun=true`);
        expect(text).toContain("# args: copy --dry-run");
        expect(text).toContain("token = ***");
        expect(text).not.toContain("abc123");
        expect(text.endsWith("일반 줄\n")).toBe(true);
        expect(f.hasFailed).toBe(false);
    });

    it("폴더를 만들 수 없으면 쓰기를 건너뛰고 예외를 던지지 않는다", async () => {
        const blocker = join(root, "file-not-dir");
        writeFileSync(blocker, "x");
        const f = new clsRunLogFile(join(blocker, "logs"), "run-b.log");
        expect(() =>
            f.open({ runId: RUN, jobId: JOB, mode: "copy", dryRun: false, args: [] }),
        ).not.toThrow();
        f.write("줄");
        await f.close();
        expect(f.hasFailed).toBe(true);
    });

    it("열지 않고 닫아도 된다", async () => {
        await expect(new clsRunLogFile(root, "never.log").close()).resolves.toBeUndefined();
    });
});
