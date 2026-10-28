// ========== External imports ==========
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    ACTIVE_RUN_FILE,
    clsActiveRunStore,
    recoverActiveRun,
    type typQueryTasks,
} from "@/main/services/run-recovery";
import type { typActiveRunFile } from "@/shared/schemas/run";

const root = mkdtempSync(join(tmpdir(), "rclonegui-recover-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function f_Dir(): string {
    n += 1;
    return mkdtempSync(join(root, `c${n}-`));
}

const REC: typActiveRunFile = {
    version: 1,
    runId: "00000000-0000-4000-8000-0000000000a1",
    jobId: "00000000-0000-4000-8000-0000000000b1",
    pid: 4321,
    startedAt: "2026-10-28T00:00:00.000Z",
    imageName: "rclone.exe",
};

const LOGGER = { info: () => undefined, warn: () => undefined };

async function f_Run(query: typQueryTasks) {
    const dir = f_Dir();
    const store = new clsActiveRunStore(dir);
    await store.write(REC);
    const killed: number[] = [];
    const r = await recoverActiveRun({
        store,
        logger: LOGGER,
        queryTasks: query,
        kill: async (pid) => {
            killed.push(pid);
        },
    });
    return { r, killed, exists: existsSync(join(dir, ACTIVE_RUN_FILE)) };
}

describe("clsActiveRunStore", () => {
    it("쓰기 → 읽기 → 지우기(.bak 포함), 쓰기 직후 지우기도 순서대로", async () => {
        const dir = f_Dir();
        const s = new clsActiveRunStore(dir);
        expect(await s.read()).toBeNull();
        await s.write(REC);
        await s.write({ ...REC, pid: 5 });
        expect(await s.read()).toEqual({ ...REC, pid: 5 });
        expect(existsSync(join(dir, `${ACTIVE_RUN_FILE}.bak`))).toBe(true);
        void s.write(REC);
        await s.clear();
        expect(await s.read()).toBeNull();
        expect(existsSync(join(dir, `${ACTIVE_RUN_FILE}.bak`))).toBe(false);
    });

    it("형식이 맞지 않으면 null", async () => {
        const dir = f_Dir();
        writeFileSync(join(dir, ACTIVE_RUN_FILE), '{"version":1,"pid":"x"}');
        expect(await new clsActiveRunStore(dir).read()).toBeNull();
        writeFileSync(join(dir, ACTIVE_RUN_FILE), "{broken");
        expect(await new clsActiveRunStore(dir).read()).toBeNull();
    });
});

describe("recoverActiveRun", () => {
    it("파일이 없으면 아무것도 하지 않는다", async () => {
        const store = new clsActiveRunStore(f_Dir());
        let queried = false;
        const r = await recoverActiveRun({
            store,
            logger: LOGGER,
            queryTasks: async () => {
                queried = true;
                return "";
            },
        });
        expect(r).toEqual({ kind: "none" });
        expect(queried).toBe(false);
    });

    it("같은 이미지 이름(대소문자 무시)이면 종료하고 안내, 파일 삭제", async () => {
        const { r, killed, exists } = await f_Run(
            async (pid) => `"RCLONE.EXE","${pid}","Console","1","12,345 K"\r\n`,
        );
        expect(r.kind).toBe("killed");
        expect(killed).toEqual([4321]);
        expect(exists).toBe(false);
        expect(r).toMatchObject({ notice: { message: expect.stringContaining("PID 4321") } });
    });

    it("프로세스가 없으면 종료하지 않음(gone)", async () => {
        const { r, killed, exists } = await f_Run(
            async () => "정보: 지정된 조건에 일치하는 작업이 실행되고 있지 않습니다.\r\n",
        );
        expect(r.kind).toBe("gone");
        expect(killed).toEqual([]);
        expect(exists).toBe(false);
    });

    it("같은 PID를 다른 프로그램이 쓰면 종료하지 않음(reused)", async () => {
        const { r, killed } = await f_Run(
            async (pid) => `"notepad.exe","${pid}","Console","1","1 K"`,
        );
        expect(r.kind).toBe("reused");
        expect(killed).toEqual([]);
    });

    it("확인하지 못하면 종료하지 않고 PID를 안내(unknown)", async () => {
        const { r, killed } = await f_Run(async () => null);
        expect(r.kind).toBe("unknown");
        expect(killed).toEqual([]);
        expect(r).toMatchObject({ notice: { message: expect.stringContaining("PID 4321") } });
        const thrown = await f_Run(async () => {
            throw new Error("tasklist 실패");
        });
        expect(thrown.r.kind).toBe("unknown");
    });
});
