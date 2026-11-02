/**
 * 외부 remote 수용 테스트 공용 도우미. 실행별 고유 경로 생성·정리 가드·원격 목록·backend features·계획 실행.
 * 모든 rclone 호출은 셸 없이 인자 배열로 하고, 경로 앞에 `--`, `--ask-password=false`를 준다.
 * 출력·오류 문구에 remote 이름·경로·stderr를 넣지 않는다(exit 코드만).
 *
 * @author dev-Joy 2026-11-02
 */

// ========== External imports ==========
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// ========== Internal imports ==========
import type { typRunRecord } from "@/shared/schemas/run";
import type { itfCompareResult } from "@/shared/types/compare";
import type { itfDryRunSummary } from "@/shared/types/run";

import { makeEnv, RCLONE } from "./run-harness";

export interface itfRcloneResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

/** `backend features` 중 이름이 들어가지 않는 값만 */
export interface itfRemoteFeatures {
    /** Features 객체(값은 검사하지 않음) */
    features: Record<string, unknown>;
    /** 최상위 Precision(ns). 없거나 숫자가 아니면 null */
    precision: number | null;
    /** 최상위 Hashes. 문자열이 아닌 값은 뺀다 */
    hashes: string[];
}

/** 실행별 폴더 이름 형식(정리 가드와 생성이 같은 원본을 쓴다) */
export const RUN_DIR_PATTERN = "rclonegui-it-[0-9]{14}-[0-9a-f]{8}";

/** rclonegui-it-<YYYYMMDDHHmmss(UTC)>-<uuid 앞 8자> */
export function makeRunDirName(now: Date = new Date(), uuid: string = randomUUID()): string {
    const stamp = now.toISOString().replaceAll(/[-:T]/g, "").slice(0, 14);
    return `rclonegui-it-${stamp}-${uuid.slice(0, 8)}`;
}

/** 정규식 특수문자 이스케이프 */
export function escapeRegExp(s: string): string {
    return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * path가 정확히 `<parent>/<RUN_DIR_PATTERN>`인지. parent 자체·그 위·더 깊은 경로·
 * `..`·다른 parent는 false. parent는 "remote:폴더" 형태 그대로 받아 이스케이프한다
 */
export function isExactRunPath(path: string, parent: string): boolean {
    return new RegExp(`^${escapeRegExp(parent)}/${RUN_DIR_PATTERN}$`).test(path);
}

/** rclone 실행: [...args, "--ask-password=false", "--config", conf, "--", ...paths] */
export function rcloneSync(
    conf: string,
    args: readonly string[],
    paths: readonly string[] = [],
): itfRcloneResult {
    const full = [...args, "--ask-password=false", "--config", conf];
    if (paths.length > 0) full.push("--", ...paths);
    const r = spawnSync(RCLONE, full, { shell: false, windowsHide: true, encoding: "utf8" });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** lsjson 결과의 항목 배열. 형식이 틀리면 throw */
function f_ParseItems(stdout: string): Array<Record<string, unknown>> {
    const data: unknown = JSON.parse(stdout);
    if (!Array.isArray(data)) throw new Error("lsjson 출력이 배열이 아닙니다");
    return data.filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null);
}

/** lsjson -R --files-only --no-mimetype [extra] → "상대경로:크기" 정렬. 없으면(exit 3) 빈 목록 */
export function remoteFiles(conf: string, path: string, extra: readonly string[] = []): string[] {
    const r = rcloneSync(conf, ["lsjson", "-R", "--files-only", "--no-mimetype", ...extra], [path]);
    if (r.status === 3) return [];
    if (r.status !== 0) throw new Error(`원격 목록 실패(exit ${r.status})`);
    return f_ParseItems(r.stdout)
        .map((i) => `${String(i.Path)}:${String(i.Size)}`)
        .toSorted();
}

/** lsjson -R --dirs-only --no-mimetype → 상대경로 정렬. 없으면(exit 3) 빈 목록 */
export function remoteDirs(conf: string, path: string): string[] {
    const r = rcloneSync(conf, ["lsjson", "-R", "--dirs-only", "--no-mimetype"], [path]);
    if (r.status === 3) return [];
    if (r.status !== 0) throw new Error(`원격 폴더 목록 실패(exit ${r.status})`);
    return f_ParseItems(r.stdout)
        .map((i) => String(i.Path))
        .toSorted();
}

/** path가 없는지(lsjson --max-depth 1이 exit 3). 그 외 실패는 throw */
export function remoteMissing(conf: string, path: string): boolean {
    const r = rcloneSync(conf, ["lsjson", "--max-depth", "1", "--no-mimetype"], [path]);
    if (r.status === 3) return true;
    if (r.status !== 0) throw new Error(`원격 존재 확인 실패(exit ${r.status})`);
    return false;
}

/** backend features target. Name·Root·String처럼 이름이 든 필드는 돌려주지 않는다 */
export function remoteFeatures(conf: string, target: string): itfRemoteFeatures {
    const r = rcloneSync(conf, ["backend", "features"], [target]);
    if (r.status !== 0) throw new Error(`backend features 실패(exit ${r.status})`);
    const data: unknown = JSON.parse(r.stdout);
    if (typeof data !== "object" || data === null) {
        throw new Error("backend features 출력이 객체가 아닙니다");
    }
    const o = data as Record<string, unknown>;
    const features =
        typeof o.Features === "object" && o.Features !== null
            ? (o.Features as Record<string, unknown>)
            : {};
    return {
        features,
        precision: typeof o.Precision === "number" ? o.Precision : null,
        hashes: Array.isArray(o.Hashes)
            ? o.Hashes.filter((h): h is string => typeof h === "string")
            : [],
    };
}

/** Features에서 boolean 하나. 없거나 boolean이 아니면 throw */
export function featureFlag(features: Record<string, unknown>, name: string): boolean {
    const v = features[name];
    if (typeof v !== "boolean") throw new Error(`${name} 값이 없습니다`);
    return v;
}

/** { 상대경로: 내용 } → "상대경로:바이트" 정렬 (원격 목록 비교용) */
export function localFiles(files: Record<string, string>): string[] {
    return Object.entries(files)
        .map(([p, t]) => `${p}:${Buffer.byteLength(t)}`)
        .toSorted();
}

/** 비교 → 확인 수를 넣어 실제 실행 → 끝날 때까지 기다린다 */
export async function runPlan(
    env: Awaited<ReturnType<typeof makeEnv>>,
    waitMs: number,
    expectDeletes = 0,
    expectDeleteDirs = 0,
): Promise<{
    cmp: itfCompareResult;
    record: typRunRecord;
    dryRunSummary: itfDryRunSummary | null;
}> {
    const cmp = await env.compare.run(env.job.id);
    const { runId } = await env.runs.start({
        jobId: env.job.id,
        dryRun: false,
        planToken: cmp.planToken,
        confirmedDeletes: expectDeletes,
        confirmedDeleteDirs: expectDeleteDirs,
        // 수용 시나리오는 대상 파일이 적어 삭제 1개도 대량 삭제가 되므로, 삭제를 확인한 실행은 대량 삭제 경고도 확인한다
        confirmLargeDeletes: expectDeletes + expectDeleteDirs > 0,
    });
    return { cmp, ...(await env.waitFinished(runId, waitMs)) };
}

/**
 * 실행 폴더 정리. 정확히 `<parent>/<RUN_DIR_PATTERN>`이 아니면 지우지 않고 throw한다.
 * purge가 exit 0이 아니거나 뒤에 경로가 남아 있으면 throw. extraFlags는 backend 플래그 추가용
 */
export function purgeRunPath(
    conf: string,
    path: string,
    parent: string,
    extraFlags: readonly string[] = [],
): void {
    if (!isExactRunPath(path, parent)) {
        throw new Error("정리 경로가 형식과 다릅니다. 지우지 않습니다.");
    }
    const r = rcloneSync(conf, ["purge", ...extraFlags], [path]);
    if (r.status !== 0) throw new Error(`정리 실패(exit ${r.status})`);
    if (!remoteMissing(conf, path)) throw new Error("정리 뒤에도 실행 폴더가 남았습니다");
}
