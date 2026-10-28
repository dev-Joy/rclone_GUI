/**
 * 실제 rclone으로 환경 감지·remote 목록·경로 확인을 확인한다.
 * 임시 폴더와 임시 rclone.conf(alias remote)만 쓰고, 사용자 설정·경로는 출력하거나 단언하지 않는다.
 * rclone이 없으면 이유를 출력하고 건너뛴다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { compareVersions, MIN_RCLONE_VERSION } from "@/main/parsers/rclone-env-parser";
import { clsRcloneEnv } from "@/main/rclone/detect";
import { clsPathService } from "@/main/services/path-service";
import { clsWslService } from "@/main/services/wsl";

const RCLONE = process.env.RCLONEGUI_TEST_RCLONE ?? "rclone";
const probe = spawnSync(RCLONE, ["version"], { shell: false, windowsHide: true, encoding: "utf8" });
const HAS_RCLONE = probe.status === 0;
if (!HAS_RCLONE) {
    console.warn(
        `[test:int] rclone을 실행할 수 없어 건너뜁니다 (${RCLONE}): ${probe.error?.message ?? probe.stderr}`,
    );
}

const root = mkdtempSync(join(tmpdir(), "rclonegui-env-int-"));
const data = join(root, "data");
mkdirSync(join(data, "folder"), { recursive: true });
writeFileSync(join(data, "file.txt"), "x");
const conf = join(root, "rclone.conf");
// 테스트 준비용 설정 파일. 앱 코드는 이 파일을 읽지 않고 경로만 --config로 넘긴다
writeFileSync(conf, `[it-alias]\ntype = alias\nremote = ${data}\n`);

const LOGGER = { info: () => undefined, warn: () => undefined };
const MANUAL_BIN = process.env.RCLONEGUI_TEST_RCLONE ?? null;

function f_Env(over: { configPath: string | null; env?: Record<string, string | undefined> }) {
    const env = { ...process.env, ...over.env };
    if (!over.env || !("RCLONE_CONFIG" in over.env)) delete env.RCLONE_CONFIG;
    return new clsRcloneEnv({
        getSettings: () => ({ rclonePath: MANUAL_BIN, configPath: over.configPath }),
        logger: LOGGER,
        env,
    });
}

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!HAS_RCLONE)("rclone 환경 감지 (실제 rclone, 임시 설정)", () => {
    it("버전 ≥ 1.65.0, 수동 설정 파일, alias remote 목록", async () => {
        const r = await f_Env({ configPath: conf }).detect();
        expect(r.problem).toBeNull();
        expect(compareVersions(r.version ?? "", MIN_RCLONE_VERSION)).toBeGreaterThanOrEqual(0);
        expect(r).toMatchObject({
            configPath: conf,
            configExists: true,
            configSource: "manual",
            remotes: ["it-alias"],
        });
    });

    it("RCLONE_CONFIG 환경 변수 → configSource env", async () => {
        const r = await f_Env({ configPath: null, env: { RCLONE_CONFIG: conf } }).detect();
        expect(r).toMatchObject({ configPath: conf, configSource: "env", remotes: ["it-alias"] });
    });

    it("지정한 설정 파일이 없으면 CONFIG_NOT_FOUND", async () => {
        const r = await f_Env({ configPath: join(root, "none.conf") }).detect();
        expect(r.problem?.code).toBe("CONFIG_NOT_FOUND");
    });

    it("로컬 probe: 폴더·파일·없음", async () => {
        const svc = new clsPathService({ rcloneEnv: f_Env({ configPath: conf }) });
        expect(await svc.probe({ path: join(data, "folder") })).toMatchObject({
            exists: true,
            isDirectory: true,
            readable: true,
        });
        expect(await svc.probe({ path: join(data, "file.txt") })).toMatchObject({
            exists: true,
            isDirectory: false,
        });
        expect((await svc.probe({ path: join(data, "missing") })).exists).toBe(false);
    });

    it("remote probe(alias, --ask-password=false 포함): 폴더·파일·없음·부모 없음·루트", async () => {
        const svc = new clsPathService({ rcloneEnv: f_Env({ configPath: conf }) });
        expect(await svc.probe({ path: "it-alias:folder" })).toMatchObject({
            kind: "remote",
            exists: true,
            isDirectory: true,
        });
        expect(await svc.probe({ path: "it-alias:file.txt" })).toMatchObject({
            exists: true,
            isDirectory: false,
        });
        expect((await svc.probe({ path: "it-alias:missing" })).exists).toBe(false);
        expect((await svc.probe({ path: "it-alias:missing/deep" })).exists).toBe(false);
        expect(await svc.probe({ path: "it-alias:" })).toMatchObject({
            exists: true,
            isDirectory: true,
            isRoot: true,
        });
    });

    it("listRemotes(override)", async () => {
        const env = f_Env({ configPath: null });
        expect(await env.listRemotes(conf)).toEqual(["it-alias"]);
    });
});

describe.skipIf(process.env.RCLONEGUI_TEST_WSL !== "1")("WSL (RCLONEGUI_TEST_WSL=1)", () => {
    it("배포판 목록은 문자열 배열", async () => {
        const r = await new clsWslService().listDistros();
        expect(Array.isArray(r.distros)).toBe(true);
        expect(r.distros.every((d) => typeof d === "string" && d.length > 0)).toBe(true);
    });
});
