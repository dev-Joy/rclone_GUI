/**
 * 파일 내용 비교용 읽기 서비스 (INT-009 FR-3~FR-6·FR-10·FR-13). 읽기 전용이다.
 *
 * - renderer는 { jobId, path }만 보내고, 읽을 파일은 유효한 비교 결과(compare.get)의 항목에서만 고른다.
 *   파일 경로는 항목의 각 쪽 상대 경로(entry.source.path·entry.dest.path)를 루트에 결합해 만든다
 *   (renderer가 보낸 경로를 파일 시스템 경로로 쓰지 않는다 — NFR-5).
 * - 파일당 2MB 상한: 비교할 때의 크기(size)로 먼저 막고, 실행은 maxStdoutBytes = 상한 + 1로 잘림을 감지한다.
 * - 앞 8000바이트에 NUL이 있으면 바이너리로 보고 내용을 보내지 않는다.
 * - UTF-8 BOM은 떼고 엄격 디코딩하고, 실패하면 EUC-KR로 다시 읽는다(spec §10 Q-1).
 * - 한쪽 읽기 실패는 전체 실패가 아니라 그 쪽 error 상태로 담는다. 오류 문구에 경로·stderr 원문을 넣지 않는다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import { hintForRcloneError, summarizeStderr } from "@/main/parsers/rclone-env-parser";
import { buildCatArgs } from "@/main/rclone/command-builder";
import { RCLONE_TIMEOUTS } from "@/main/rclone/config";
import type { clsRcloneEnv } from "@/main/rclone/detect";
import {
    clsProcessSpawnError,
    runRclone,
    type itfProcessResult,
    type typRunRclone,
} from "@/main/rclone/process";
import { resolveJobContext } from "@/main/services/job-context";
import type { clsCompareService } from "@/main/services/compare-service";
import type { clsExcludeStore } from "@/main/store/exclude-store";
import type { clsJobStore } from "@/main/store/job-store";
import { joinRootRelative, type itfParsedPath } from "@/shared/path-utils";
import type { typSettings } from "@/shared/schemas/settings";
import type { itfDiffEntry, itfDiffSide, typCompareStatus } from "@/shared/types/compare";
import type {
    itfFileDiffData,
    typFileDiffStatus,
    typFileSideState,
} from "@/shared/types/file-diff";

/** 파일 하나의 내용 상한(바이트). 넘으면 cat을 실행하지 않는다 */
export const FILE_DIFF_MAX_BYTES = 2 * 1024 * 1024;
/** 바이너리 판정을 위해 보는 앞쪽 바이트 수 */
export const BINARY_SNIFF_BYTES = 8000;

export interface itfFileDiffServiceDeps {
    jobs: Pick<clsJobStore, "get">;
    settings: { get(): typSettings };
    rcloneEnv: Pick<clsRcloneEnv, "require" | "resolveConfigFor" | "listRemotesAt">;
    /** 공용 제외 패턴 조회(resolveJobContext가 쓴다) */
    excludes: Pick<clsExcludeStore, "patternsFor">;
    /** 유효한 비교 결과(캐시) 조회 */
    compare: Pick<clsCompareService, "get">;
    /** 기본 runRclone. 단위 테스트가 주입한다 */
    run?: typRunRclone;
}

type typSideLabel = "원본" | "대상";

/** 내용을 볼 수 있는 상태만 통과. equal·typeConflict는 화면 진입 전에 막지만 main에서도 막는다 */
function f_AssertDiffable(status: typCompareStatus): typFileDiffStatus {
    if (status === "modified" || status === "onlySource" || status === "onlyDest") return status;
    throw new clsAppError(
        "VALIDATION",
        "같은 파일이거나 파일과 폴더가 섞인 항목은 내용을 비교할 수 없습니다.",
    );
}

/** 루트 + 상대 경로. 잘못된 상대 경로(..·절대 경로·NUL)는 VALIDATION */
function f_JoinSidePath(root: itfParsedPath, rel: string): string {
    try {
        return joinRootRelative(root, rel);
    } catch (e) {
        throw new clsAppError(
            "VALIDATION",
            e instanceof Error ? e.message : "경로를 만들지 못했습니다.",
        );
    }
}

/** stderr 요약에서 경로처럼 보이는 토큰을 지운다(실제 사용자 경로를 화면·로그에 남기지 않는다) */
function f_StripPaths(text: string): string {
    return text.replace(
        /(?:[A-Za-z]:\\[^\s"']+|\\\\[^\s"']+|\/(?:[^\s"':]+\/)*[^\s"':]+)/g,
        "<경로>",
    );
}

/** rclone 오류 → 그 쪽 error 상태(경로·stderr 원문 없이 요약만) */
function f_ReadFailure(label: typSideLabel, stderr: string): typFileSideState {
    const hint = hintForRcloneError(stderr, null);
    const summary = f_StripPaths(summarizeStderr(stderr, 2));
    const reason = hint ?? (summary !== "" ? summary : "rclone이 파일을 읽지 못했습니다.");
    return { kind: "error", message: `${label} 파일을 읽지 못함: ${reason}` };
}

/** 읽은 바이트 → 텍스트 상태. NUL이 앞쪽에 있으면 바이너리, UTF-8이 안 되면 EUC-KR */
function f_FromBytes(bytes: Buffer, size: number): typFileSideState {
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: "binary", size };
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const body = bom ? bytes.subarray(3) : bytes;
    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
        return { kind: "text", text, encoding: "utf-8", bom, size };
    } catch {
        const text = new TextDecoder("euc-kr").decode(body);
        return { kind: "text", text, encoding: "euc-kr", bom, size };
    }
}

interface itfReadSideInput {
    label: typSideLabel;
    side: itfDiffSide | null;
    root: itfParsedPath;
    binaryPath: string;
    configPath: string | null;
    run: typRunRclone;
}

/** 한쪽 내용 읽기. 없는 쪽은 absent, 큰 파일은 cat 없이 tooLarge */
async function f_ReadSide(o: itfReadSideInput): Promise<typFileSideState> {
    if (o.side === null) return { kind: "absent" };
    const path = f_JoinSidePath(o.root, o.side.path);
    if (o.side.size > FILE_DIFF_MAX_BYTES) {
        return {
            kind: "tooLarge",
            size: o.side.size,
            limit: FILE_DIFF_MAX_BYTES,
            truncated: false,
        };
    }

    let r: itfProcessResult;
    try {
        r = await o.run(o.binaryPath, buildCatArgs({ path, configPath: o.configPath }), {
            timeoutMs: RCLONE_TIMEOUTS.cat,
            maxStdoutBytes: FILE_DIFF_MAX_BYTES + 1,
        });
    } catch (e) {
        // 실행 파일 문제는 한쪽 문제가 아니라 전체 실패다
        if (e instanceof clsProcessSpawnError) {
            throw new clsAppError(
                e.errno === "ENOENT" ? "RCLONE_NOT_FOUND" : "RCLONE_NOT_EXECUTABLE",
            );
        }
        throw e;
    }

    if (r.timedOut) {
        return { kind: "error", message: "파일을 읽는 시간 제한(60초)을 넘었습니다." };
    }
    if (r.exitCode !== 0) return f_ReadFailure(o.label, r.stderrTail);
    if (r.stdoutTruncated || r.stdoutBytes.length > FILE_DIFF_MAX_BYTES) {
        return {
            kind: "tooLarge",
            size: r.stdoutBytes.length,
            limit: FILE_DIFF_MAX_BYTES,
            truncated: true,
        };
    }
    return f_FromBytes(r.stdoutBytes, o.side.size);
}

/** 비교 결과 항목 하나의 원본·대상 내용을 읽는다 */
export class clsFileDiffService {
    private readonly d: itfFileDiffServiceDeps;

    constructor(d: itfFileDiffServiceDeps) {
        this.d = d;
    }

    async diff(jobId: string, path: string): Promise<itfFileDiffData> {
        const result = this.d.compare.get(jobId);
        if (!result) {
            throw new clsAppError(
                "PLAN_STALE",
                "비교 결과가 바뀌었습니다. 다시 비교한 뒤 열어 주세요.",
            );
        }
        const entry = f_FindEntry(result.entries, path);
        const status = f_AssertDiffable(entry.status);

        const ctx = await resolveJobContext(this.d.jobs.get(jobId), this.d);
        const run = this.d.run ?? runRclone;
        const [source, dest] = await Promise.all([
            f_ReadSide({
                label: "원본",
                side: entry.source,
                root: ctx.src,
                binaryPath: ctx.binaryPath,
                configPath: ctx.configPath,
                run,
            }),
            f_ReadSide({
                label: "대상",
                side: entry.dest,
                root: ctx.dst,
                binaryPath: ctx.binaryPath,
                configPath: ctx.configPath,
                run,
            }),
        ]);
        return { path, status, mode: result.mode, source, dest };
    }
}

/** 요청 경로와 같은 항목. 없으면 NOT_FOUND */
function f_FindEntry(entries: readonly itfDiffEntry[], path: string): itfDiffEntry {
    const entry = entries.find((e) => e.path === path);
    if (!entry) throw new clsAppError("NOT_FOUND", "비교 결과에서 그 파일을 찾지 못했습니다.");
    return entry;
}
