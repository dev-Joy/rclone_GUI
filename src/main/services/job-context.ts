/**
 * 작업 실행 문맥 해석. 비교와 실행이 rclone을 부르기 전에 같은 순서로 확인한다.
 * 경로 형식·안전 검사(드라이브 상대 경로 포함, sync면 백업 폴더 재검사) → rclone 실행 파일 → 설정 파일(remote면 필수).
 * 백업 폴더 대상이 서버 쪽 이동을 지원하는지(assertBackupMovable)는 실행만 확인한다(비교는 rclone이 옮기지 않음).
 * 프로세스를 실행하지 않는 검사가 먼저이므로 경로 오류면 rclone 감지도 하지 않는다.
 * 제외 패턴(공용 + 작업 전용)은 마지막 await 뒤 동기 구간에서 해석한다(비교·실행은 ctx.excludes만 쓴다).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsRcloneEnv } from "@/main/rclone/detect";
import type { clsRemoteService } from "@/main/services/remote-service";
import {
    resolveEffectiveExcludes,
    type itfEffectiveExcludes,
} from "@/main/services/effective-excludes";
import type { clsExcludeStore } from "@/main/store/exclude-store";
import { checkBackupDir, checkRunPaths, parsePath, type itfParsedPath } from "@/shared/path-utils";
import type { typJob } from "@/shared/schemas/job";
import type { typSettings } from "@/shared/schemas/settings";

export interface itfJobContextDeps {
    settings: { get(): typSettings };
    rcloneEnv: Pick<clsRcloneEnv, "require" | "resolveConfigFor" | "listRemotesAt">;
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
    /** sync에서 지우거나 덮어쓸 파일을 옮길 기준 폴더(INT-003 T-03). copy이거나 없으면 null */
    backup: itfParsedPath | null;
    binaryPath: string;
    /** --config로 넘길 경로. 없으면 null */
    configPath: string | null;
    /** 적용할 제외 패턴과 필터 파일 내용(job.excludes를 직접 쓰지 않는다) */
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

/** 작업의 원본·대상이 쓰는 remote 이름(중복 제거). 로컬·UNC만 쓰면 빈 배열 */
export function remoteNamesOfJob(job: Pick<typJob, "source" | "destination">): string[] {
    const names = new Set<string>();
    for (const raw of [job.source, job.destination]) {
        const r = parsePath(raw);
        if (!r.ok || r.path.kind !== "remote") continue;
        names.add(r.path.root.slice(0, -1));
    }
    return [...names];
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
    // 저장 뒤 대소문자 설정이 바뀌었을 수 있으므로 실행 때 다시 검사한다(copy는 백업 폴더를 쓰지 않음)
    let backup: itfParsedPath | null = null;
    if (job.mode === "sync" && job.backupDir !== null) {
        const issue = checkBackupDir(job.backupDir, job.source, job.destination, caseInsensitive);
        if (issue) throw new clsAppError(issue.code, issue.message);
        backup = f_Parse(job.backupDir);
    }

    // 2) rclone·설정 파일
    const rt = await deps.rcloneEnv.require();
    const configPath = await deps.rcloneEnv.resolveConfigFor(job.configPathOverride);
    if ((src.kind === "remote" || dst.kind === "remote") && configPath === null) {
        throw new clsAppError(
            "CONFIG_REQUIRED",
            "리모트 경로를 쓰려면 rclone 설정 파일이 필요합니다.",
        );
    }
    // 2a) 작업이 쓰는 remote가 이 설정 파일에 있는지 확인한다(FR-24, CLI에서 지운 경우 등)
    if (src.kind === "remote" || dst.kind === "remote") {
        const names = await deps.rcloneEnv.listRemotesAt(configPath);
        for (const p of [src, dst]) {
            if (p.kind !== "remote") continue;
            const name = p.root.slice(0, -1);
            if (!names.includes(name)) {
                throw new clsAppError(
                    "REMOTE_NOT_FOUND",
                    `remote ‘${name}’가 rclone 설정에 없습니다. 설정 화면에서 추가하거나 작업의 경로를 바꾸세요.`,
                );
            }
        }
    }
    // 3) 제외 패턴: 마지막 await 뒤 동기로 해석해 이후 비교·실행이 같은 값을 쓴다
    const excludes = resolveEffectiveExcludes(job, deps.excludes);
    return {
        job,
        settings,
        caseInsensitive,
        src,
        dst,
        backup,
        binaryPath: rt.binaryPath,
        configPath,
        excludes,
    };
}

/** Move를 지원하지 않거나 확인하지 못한 저장소의 백업 폴더 실행 차단 문구(경로·remote 이름 없음) */
export const BACKUP_NOT_MOVABLE_TEXT =
    "이 저장소는 파일을 옮기지 못하거나(서버 쪽 이동 미지원) 지원 여부를 확인하지 못해 백업 폴더를 쓸 수 없습니다. 실행하지 않았습니다. 백업 폴더를 비우거나 다른 대상을 쓰세요.";

/**
 * 백업 폴더를 쓸 수 있는 저장소인지(INT-003 FR-36). 백업 폴더가 없으면 통과.
 * 로컬·UNC는 checkBackupDir(같은 드라이브·공유)로 충분해 조회하지 않는다.
 * remote 대상은 backend features의 Move가 true일 때만 통과하고, false·null이면 SAFETY_BLOCKED를 던진다.
 * Move가 없으면 덮어쓰기까지 삭제 한도를 써서 계획대로여도 exit 7로 멈춘다(rclone-notes #30).
 */
export async function assertBackupMovable(
    ctx: Pick<itfJobContext, "backup" | "dst" | "configPath">,
    features: Pick<clsRemoteService, "features">,
): Promise<void> {
    if (ctx.backup === null || ctx.dst.kind !== "remote") return;
    const f = await features.features(ctx.dst.root, ctx.configPath);
    if (f.canMove !== true) throw new clsAppError("SAFETY_BLOCKED", BACKUP_NOT_MOVABLE_TEXT);
}
