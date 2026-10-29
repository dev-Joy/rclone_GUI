/**
 * 작업 실행 문맥 해석. 비교와 실행이 rclone을 부르기 전에 같은 순서로 확인한다.
 * 경로 형식·안전 검사(드라이브 상대 경로 포함) → rclone 실행 파일 → 설정 파일(remote면 필수).
 * 프로세스를 실행하지 않는 검사가 먼저이므로 경로 오류면 rclone 감지도 하지 않는다.
 * 제외 패턴(공용 + 작업 전용)은 마지막 await 뒤 동기 구간에서 해석한다(비교·실행은 ctx.excludes만 쓴다).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsRcloneEnv } from "@/main/rclone/detect";
import {
    resolveEffectiveExcludes,
    type itfEffectiveExcludes,
} from "@/main/services/effective-excludes";
import type { clsExcludeStore } from "@/main/store/exclude-store";
import { checkRunPaths, parsePath, type itfParsedPath } from "@/shared/path-utils";
import type { typJob } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";

export interface itfJobContextDeps {
    settings: { get(): typSettings };
    rcloneEnv: Pick<clsRcloneEnv, "require" | "resolveConfigFor">;
    /** 공용 제외 패턴 조회 */
    excludes: Pick<clsExcludeStore, "patternsFor">;
}

export interface itfJobContext {
    job: typJob;
    /** 해석할 때 읽은 설정(같은 값으로 계속 판단한다) */
    settings: typSettings;
    caseInsensitive: boolean;
    src: itfParsedPath;
    dst: itfParsedPath;
    binaryPath: string;
    /** --config로 넘길 경로. 없으면 null */
    configPath: string | null;
    /** 적용할 제외 패턴과 전달 방식(job.excludes를 직접 쓰지 않는다) */
    excludes: itfEffectiveExcludes;
}

function f_Parse(raw: string): itfParsedPath {
    const r = parsePath(raw);
    // checkRunPaths를 통과했으므로 실패하지 않는다
    if (!r.ok) throw new clsAppError(r.issue.code, r.issue.message);
    return r.path;
}

/** remote 경로면 remote 이름("gdrive"), 아니면 null (오류 안내 문구용) */
export function remoteNameOf(p: itfParsedPath): string | null {
    return p.kind === "remote" ? p.root.slice(0, -1) : null;
}

/**
 * 작업의 경로·rclone·설정 파일을 확인해 실행 문맥을 만든다.
 * 실패: 경로 오류(PATH_INVALID·SAFETY_BLOCKED 등), RCLONE_*, CONFIG_REQUIRED.
 */
export async function resolveJobContext(
    job: typJob,
    deps: itfJobContextDeps,
): Promise<itfJobContext> {
    const settings = deps.settings.get();
    const caseInsensitive = settings.compare.caseInsensitivePaths;

    // 1) 경로 형식·안전 검사(프로세스 실행 전)
    const check = checkRunPaths(job.source, job.destination, caseInsensitive);
    const first = check.errors[0];
    if (first) {
        throw new clsAppError(
            first.code,
            first.message,
            check.errors.length > 1 ? check.errors.map((e) => e.message).join("\n") : undefined,
        );
    }
    const src = f_Parse(job.source);
    const dst = f_Parse(job.destination);

    // 2) rclone·설정 파일
    const rt = await deps.rcloneEnv.require();
    const configPath = await deps.rcloneEnv.resolveConfigFor(job.configPathOverride);
    if ((src.kind === "remote" || dst.kind === "remote") && configPath === null) {
        throw new clsAppError(
            "CONFIG_REQUIRED",
            "remote 경로를 쓰려면 rclone 설정 파일이 필요합니다.",
        );
    }
    // 3) 제외 패턴: 마지막 await 뒤 동기로 해석해 이후 비교·실행이 같은 값을 쓴다
    const excludes = resolveEffectiveExcludes(job, deps.excludes);
    return {
        job,
        settings,
        caseInsensitive,
        src,
        dst,
        binaryPath: rt.binaryPath,
        configPath,
        excludes,
    };
}
