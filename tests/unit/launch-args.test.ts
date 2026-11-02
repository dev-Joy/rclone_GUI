// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { parseLaunchArgs } from "@/main/launch-args";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const EXE = ["C:\\app\\rcloneGUI.exe"];
const DEV = ["C:\\dev\\electron.exe", "out/main/index.js"];

describe("parseLaunchArgs", () => {
    it("인자 없음 → none", () => {
        expect(parseLaunchArgs(EXE, 1)).toEqual({ hidden: false, runJob: { kind: "none" } });
    });

    it("--hidden", () => {
        expect(parseLaunchArgs([...EXE, "--hidden"], 1).hidden).toBe(true);
    });

    it("정상 --run-job, 대문자 uuid는 소문자로", () => {
        expect(parseLaunchArgs([...EXE, "--run-job", ID], 1).runJob).toEqual({
            kind: "ok",
            jobId: ID,
        });
        expect(parseLaunchArgs([...EXE, "--run-job", ID.toUpperCase()], 1).runJob).toEqual({
            kind: "ok",
            jobId: ID,
        });
    });

    it("개발 실행은 앞 두 개를 건너뛴다", () => {
        expect(parseLaunchArgs([...DEV, "--run-job", ID], 2).runJob.kind).toBe("ok");
        // skip 1이면 스크립트 경로가 위치 인자로 보여 거부된다
        expect(parseLaunchArgs([...DEV, "--run-job", ID], 1).runJob).toEqual({
            kind: "invalid",
            reason: "positional",
        });
    });

    it("값 없음", () => {
        expect(parseLaunchArgs([...EXE, "--run-job"], 1).runJob).toEqual({
            kind: "invalid",
            reason: "missingValue",
        });
        expect(parseLaunchArgs([...EXE, "--run-job", "--hidden"], 1).runJob).toEqual({
            kind: "invalid",
            reason: "missingValue",
        });
    });

    it("uuid 아님·= 형식", () => {
        expect(parseLaunchArgs([...EXE, "--run-job", "not-a-uuid"], 1).runJob).toEqual({
            kind: "invalid",
            reason: "badUuid",
        });
        expect(parseLaunchArgs([...EXE, `--run-job=${ID}`], 1).runJob).toEqual({
            kind: "invalid",
            reason: "badUuid",
        });
    });

    it("두 번", () => {
        expect(parseLaunchArgs([...EXE, "--run-job", ID, "--run-job", ID], 1).runJob).toEqual({
            kind: "invalid",
            reason: "duplicate",
        });
    });

    it("위치 인자", () => {
        expect(parseLaunchArgs([...EXE, "--run-job", ID, "extra"], 1).runJob).toEqual({
            kind: "invalid",
            reason: "positional",
        });
    });

    it("--hidden 동반·Chromium 스위치는 무시", () => {
        const r = parseLaunchArgs(
            [...EXE, "--allow-file-access-from-files", "--run-job", ID, "--hidden", "--inspect=0"],
            1,
        );
        expect(r).toEqual({ hidden: true, runJob: { kind: "ok", jobId: ID } });
    });

    it("--run-job이 없으면 위치 인자를 보지 않는다", () => {
        expect(parseLaunchArgs([...EXE, "something"], 1).runJob).toEqual({ kind: "none" });
    });
});
