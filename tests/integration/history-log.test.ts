/**
 * 실제 rclone 실행 로그를 이력 레코드의 파일 이름으로 끝부분만 읽는다(history:readLog와 같은 경로).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { readRunLogTail } from "@/main/services/log-retention";
import { HAS_RCLONE, makeEnv, makeRoot, writeFile } from "./run-harness";

const { root, conf } = makeRoot("rclonegui-history-log-");

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!HAS_RCLONE)("실행 로그 끝부분 읽기 (실제 rclone)", () => {
    it("미리보기 로그: 머리말·rclone 줄을 읽고, 작게 읽으면 잘린 첫 줄을 버린다", async () => {
        const src = join(root, "src");
        const dst = join(root, "dst");
        for (let i = 0; i < 20; i += 1) writeFile(join(src, `f${i}.txt`), `file ${i}`);
        writeFile(join(dst, "keep.txt"), "keep");
        const env = await makeEnv({ root, conf, source: src, destination: dst, mode: "copy" });
        const { runId } = await env.runs.start({ jobId: env.job.id, dryRun: true });
        const { record } = await env.waitFinished(runId);
        expect(record.logFile).toMatch(/^run-\d{8}-\d{6}-[0-9a-f]{8}-[0-9a-f]{8}\.log$/);

        const full = await readRunLogTail(env.logsDir, record.logFile!, 256 * 1024);
        expect(full).toMatchObject({ exists: true, truncated: false });
        expect(full.lines[0]!.message).toBe("# rcloneGUI 실행 로그");
        expect(full.lines.some((l) => l.message.includes("<원본>"))).toBe(true);
        expect(full.lines.some((l) => l.object?.startsWith("f"))).toBe(true);
        // 실제 경로는 머리말에 없다
        expect(full.lines.some((l) => l.message.includes(src))).toBe(false);

        const tail = await readRunLogTail(env.logsDir, record.logFile!, 300);
        expect(tail.truncated).toBe(true);
        expect(tail.lines.length).toBeGreaterThan(0);
        expect(tail.lines.length).toBeLessThan(full.lines.length);
        expect(tail.lines.at(-1)).toEqual(full.lines.at(-1));
    });
});
