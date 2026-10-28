// ========== External imports ==========
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z, ZodError } from "zod";

// ========== Internal imports ==========
import { clsMutex } from "@/main/lib/mutex";
import { clsJsonStore, writeJsonAtomic } from "@/main/store/json-store";
import type { itfAppNotice } from "@/shared/ipc-contract";

const zFile = z.object({ version: z.literal(1), n: z.number() });
type typFile = z.infer<typeof zFile>;

let dir = "";
let file = "";
let notices: itfAppNotice[] = [];

function f_Store() {
    return new clsJsonStore<typFile>({
        file,
        label: "테스트",
        schema: zFile,
        createDefault: () => ({ version: 1, n: 0 }),
        onNotice: (n) => notices.push(n),
    });
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rclonegui-store-"));
    file = join(dir, "data.json");
    notices = [];
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("writeJsonAtomic", () => {
    it("파일을 쓰고 이전 내용을 .bak으로 남기며 tmp를 남기지 않는다", async () => {
        await writeJsonAtomic(file, { version: 1, n: 1 });
        await writeJsonAtomic(file, { version: 1, n: 2 });
        expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, n: 2 });
        expect(JSON.parse(readFileSync(`${file}.bak`, "utf8"))).toEqual({ version: 1, n: 1 });
        expect(readdirSync(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
    });

    it("쓸 수 없는 위치면 STORE_ERROR", async () => {
        writeFileSync(join(dir, "blocker"), "x");
        await expect(writeJsonAtomic(join(dir, "blocker", "x.json"), {})).rejects.toMatchObject({
            code: "STORE_ERROR",
        });
    });
});

describe("clsJsonStore 읽기·복구", () => {
    it("파일이 없으면 기본값, 알림 없음", async () => {
        expect(await f_Store().load()).toEqual({ version: 1, n: 0 });
        expect(notices).toEqual([]);
    });

    it("본 파일이 손상되면 .bak으로 복구하고 알린다", async () => {
        writeFileSync(file, "{ broken");
        writeFileSync(`${file}.bak`, JSON.stringify({ version: 1, n: 7 }));
        expect(await f_Store().load()).toEqual({ version: 1, n: 7 });
        expect(notices).toHaveLength(1);
        expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, n: 7 });
        expect(readdirSync(dir).some((f) => f.includes(".corrupt-"))).toBe(true);
    });

    it("본 파일·백업 모두 손상이면 .corrupt로 옮기고 기본값 + 오류 알림", async () => {
        writeFileSync(file, "nope");
        writeFileSync(`${file}.bak`, JSON.stringify({ version: 1, n: "x" }));
        expect(await f_Store().load()).toEqual({ version: 1, n: 0 });
        expect(notices[0]?.level).toBe("error");
        expect(readdirSync(dir).filter((f) => f.startsWith("data.json.corrupt-"))).toHaveLength(1);
    });

    it("다른 버전이면 지우지 않고 보관 후 기본값", async () => {
        writeFileSync(file, JSON.stringify({ version: 2, n: 5 }));
        expect(await f_Store().load()).toEqual({ version: 1, n: 0 });
        expect(readdirSync(dir).filter((f) => f.startsWith("data.json.unsupported-"))).toHaveLength(
            1,
        );
        expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 2, n: 5 });
    });

    it("BOM이 있어도 읽는다", async () => {
        writeFileSync(file, `\uFEFF${JSON.stringify({ version: 1, n: 3 })}`);
        expect((await f_Store().load()).n).toBe(3);
    });
});

describe("clsJsonStore 쓰기", () => {
    it("동시 update를 직렬화해 lost update가 없다", async () => {
        const store = f_Store();
        await store.load();
        await Promise.all(
            Array.from({ length: 20 }, () => store.update((cur) => ({ ...cur, n: cur.n + 1 }))),
        );
        expect(store.get().n).toBe(20);
        expect(JSON.parse(readFileSync(file, "utf8")).n).toBe(20);
    });

    it("검증 실패면 저장하지 않고 이전 값을 유지한다", async () => {
        const store = f_Store();
        await store.load();
        await store.update(() => ({ version: 1, n: 1 }));
        await expect(store.update(() => ({ version: 1, n: "bad" }) as never)).rejects.toThrow(
            ZodError,
        );
        expect(store.get().n).toBe(1);
        expect(JSON.parse(readFileSync(file, "utf8")).n).toBe(1);
    });
});

describe("clsMutex", () => {
    it("앞 작업이 실패해도 다음 작업은 실행된다", async () => {
        const m = new clsMutex();
        const order: number[] = [];
        const a = m.runExclusive(async () => {
            order.push(1);
            throw new Error("x");
        });
        const b = m.runExclusive(() => order.push(2));
        await expect(a).rejects.toThrow("x");
        await b;
        expect(order).toEqual([1, 2]);
    });
});
