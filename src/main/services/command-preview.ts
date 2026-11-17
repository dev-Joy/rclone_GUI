/**
 * 작업의 rclone 명령을 사람이 읽고 복사할 수 있는 문자열로 만든다 (INT-008 FR-7).
 *
 * - **표시 전용**이다. rclone을 실행하지 않고 프로세스를 만들지도 않는다.
 * - 인자 배열은 command-builder의 기존 빌더(buildLsjsonArgs·buildTransferArgs)만 호출해 얻는다.
 *   command-builder는 수정하지 않는다(AC-13).
 * - 비교 명령은 실제 비교와 같은 lsjson 2개(원본·대상)이고, 동기화 명령은 copy/sync 실제 인자다.
 *   --max-delete는 비교 계획이 없으므로 가장 안전한 0으로 표시한다.
 * - 제외 패턴(--filter-from)은 실행 때 임시 파일로 만들므로 표시 명령에는 넣지 않는다.
 * - 비밀 값·rclone.conf 내용은 넣지 않는다. 설정 파일은 경로 문자열만 쓴다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== Internal imports ==========
import {
    buildLsjsonArgs,
    buildTransferArgs,
    COMPARE_HASH_TYPES,
} from "@/main/rclone/command-builder";
import type { typJob } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";

export interface itfCommandPreview {
    /** 원본·대상 lsjson 2줄 */
    compare: string;
    /** copy/sync 실제 인자 1줄(--dry-run 없음) */
    sync: string;
}

/** Windows 명령줄 인자 하나를 감싼다(공백·메타 문자·빈 값) */
function f_QuoteArg(arg: string): string {
    return /[\s"&|<>^%()]/.test(arg) || arg === "" ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/** 실행 파일과 인자 배열을 한 줄 명령으로 만든다 */
function f_FormatCommand(exe: string, args: readonly string[]): string {
    return [f_QuoteArg(exe), ...args.map(f_QuoteArg)].join(" ");
}

/**
 * 작업의 비교·동기화 명령을 만든다. 표시용이며 실행하지 않는다.
 * @param job 저장된 작업
 * @param settings 지금 설정(rclone 경로·기본 rclone.conf 경로)
 */
export function commandPreview(job: typJob, settings: typSettings): itfCommandPreview {
    const exe = settings.rclonePath ?? "rclone";
    const configPath = job.configPathOverride ?? settings.configPath;
    const compare = [job.source, job.destination]
        .map((path) =>
            f_FormatCommand(
                exe,
                buildLsjsonArgs({
                    path,
                    configPath,
                    excludes: { filterFile: null },
                    withHash: job.options.checkHashes,
                    hashTypes: COMPARE_HASH_TYPES,
                    skipLinks: job.options.skipLinks,
                    fastList: job.options.fastList,
                    scope: job.scope,
                }),
            ),
        )
        .join("\n");
    const sync = f_FormatCommand(
        exe,
        buildTransferArgs({
            mode: job.mode,
            source: job.source,
            destination: job.destination,
            configPath,
            excludes: { filterFile: null },
            options: job.options,
            scope: job.scope,
            dryRun: false,
            maxDelete: 0,
            backupDir: job.mode === "sync" ? job.backupDir : null,
        }),
    );
    return { compare, sync };
}
