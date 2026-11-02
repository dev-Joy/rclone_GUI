/**
 * remote 북마크와 폴더 탐색 서비스 (INT-002 T-02).
 *
 * - 북마크 생성·수정 전에 rclone.conf의 remote 목록에 이름이 있는지 확인한다(설정 내용은 읽지 않음).
 * - 연결 테스트는 기존 경로 확인(probe)을 그대로 쓴다.
 * - 폴더 탐색은 `lsjson --max-depth 1 --dirs-only`로 한 단계만 읽고, 탐색·테스트는 remote-ops로 직렬화한다.
 * - 탐색 결과는 이름 순 최대 LIST_DIR_MAX개. 더 있으면 truncated로 알린다.
 * - 저장소 기능(features, INT-003 FR-36): `backend features <remote 루트>`를 (rclone 경로, conf 경로, 루트) 키로
 *   앱 실행 동안 캐시한다. 실패·시간 초과는 알 수 없음(null)으로 돌려주고 캐시하지 않는다. 실행 락 안에서도
 *   부르므로 탐색 락(remote-ops)을 쓰지 않는다.
 * - 빈 폴더 가능 여부(INT-003 FR-30·FR-32): 로컬·UNC는 true, remote는 features의 canHaveEmptyDirs.
 *   어떤 실패도 던지지 않고 null(알 수 없음)로 돌려준다(비교·편집기 경고용).
 *
 * @author dev-Joy 2026-10-30
 */

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import {
    parseBackendFeatures,
    UNKNOWN_FEATURES,
    type itfBackendFeatures,
} from "@/main/parsers/backend-features-parser";
import { clsLsjsonParseError, parseLsjsonDirEntries } from "@/main/parsers/lsjson-parser";
import { hintForRcloneError, summarizeStderr } from "@/main/parsers/rclone-env-parser";
import { buildBackendFeaturesArgs, buildListDirsArgs } from "@/main/rclone/command-builder";
import { RCLONE_TIMEOUTS } from "@/main/rclone/config";
import type { clsRcloneEnv } from "@/main/rclone/detect";
import { clsProcessSpawnError, runRclone, type typRunRclone } from "@/main/rclone/process";
import type { clsPathService } from "@/main/services/path-service";
import type { clsRemoteOps } from "@/main/services/remote-ops";
import type { clsRemoteStore } from "@/main/store/remote-store";
import type { itfPathProbe } from "@/shared/ipc-contract";
import { LIST_DIR_MAX } from "@/shared/option-limits";
import { parsePath, type itfParsedPath } from "@/shared/path-utils";
import { joinRemotePath } from "@/shared/remote-path";
import type {
    typListDirInput,
    typRemoteCreateInput,
    typRemoteFeaturesInput,
    typRemoteUpdateInput,
} from "@/shared/schemas/remotes";
import type { typTestPathInput } from "@/shared/schemas/rclone";
import type { itfDirListing, itfRemoteBookmark, itfRemoteFeatures } from "@/shared/types/remotes";

export interface itfRemoteServiceDeps {
    store: clsRemoteStore;
    rcloneEnv: Pick<clsRcloneEnv, "require" | "resolveConfigFor" | "listRemotes">;
    pathService: Pick<clsPathService, "probe">;
    remoteOps: Pick<clsRemoteOps, "run">;
    /** 테스트에서 갈아끼운다. 기본은 runRclone */
    run?: typRunRclone;
}

type typResolvedDeps = Omit<itfRemoteServiceDeps, "run"> & { run: typRunRclone };

export class clsRemoteService {
    private readonly deps: typResolvedDeps;
    /** backend features 결과(성공만). 키: [rclone 경로, conf 경로, remote 루트] */
    private readonly featuresCache = new Map<string, itfBackendFeatures>();

    constructor(deps: itfRemoteServiceDeps) {
        this.deps = { ...deps, run: deps.run ?? runRclone };
    }

    list(): itfRemoteBookmark[] {
        return this.deps.store.list();
    }

    async create(input: typRemoteCreateInput): Promise<itfRemoteBookmark> {
        await this.f_AssertRemoteKnown(input.remoteName);
        return this.deps.store.create(input);
    }

    async update(input: typRemoteUpdateInput): Promise<itfRemoteBookmark> {
        await this.f_AssertRemoteKnown(input.remoteName);
        return this.deps.store.update(input);
    }

    remove(id: string): void {
        this.deps.store.remove(id);
    }

    /** 북마크 기준 경로 확인. 없는 폴더는 probe가 exists:false로 돌려준다 */
    async test(id: string): Promise<itfPathProbe> {
        const b = this.deps.store.get(id);
        return this.deps.remoteOps.run([b.remoteName], () =>
            this.deps.pathService.probe({ path: b.path, configPath: null }),
        );
    }

    /** 경로 확인. remote 경로만 탐색 락을 잡고, 로컬·UNC는 그대로 확인한다 */
    async probePath(input: typTestPathInput): Promise<itfPathProbe> {
        const parsed = parsePath(input.path);
        if (!parsed.ok) throw new clsAppError(parsed.issue.code, parsed.issue.message);
        if (parsed.path.kind !== "remote") return this.deps.pathService.probe(input);
        const name = parsed.path.root.slice(0, -1);
        return this.deps.remoteOps.run([name], () => this.deps.pathService.probe(input));
    }

    async listDir(input: typListDirInput): Promise<itfDirListing> {
        const parsed = parsePath(input.path);
        if (!parsed.ok) throw new clsAppError(parsed.issue.code, parsed.issue.message);
        const p = parsed.path;
        if (p.kind !== "remote") {
            throw new clsAppError("PATH_INVALID", "리모트 경로만 폴더를 탐색할 수 있습니다.");
        }
        const remoteName = p.root.slice(0, -1);
        return this.deps.remoteOps.run([remoteName], async () => {
            const rt = await this.deps.rcloneEnv.require();
            const configPath = await this.deps.rcloneEnv.resolveConfigFor(input.configPath);
            if (configPath === null) {
                throw new clsAppError(
                    "CONFIG_REQUIRED",
                    "리모트 폴더를 탐색하려면 rclone 설정 파일이 필요합니다.",
                );
            }
            let r;
            try {
                r = await this.deps.run(
                    rt.binaryPath,
                    buildListDirsArgs({ path: p.normalized, configPath }),
                    { timeoutMs: RCLONE_TIMEOUTS.listDir },
                );
            } catch (e) {
                if (e instanceof clsProcessSpawnError) {
                    throw new clsAppError(
                        e.errno === "ENOENT" ? "RCLONE_NOT_FOUND" : "RCLONE_NOT_EXECUTABLE",
                    );
                }
                throw e;
            }
            if (r.timedOut) {
                throw new clsAppError(
                    "RCLONE_FAILED",
                    `리모트가 ${RCLONE_TIMEOUTS.listDir / 1000}초 안에 응답하지 않았습니다.`,
                );
            }
            if (r.exitCode === 3) {
                throw new clsAppError("PATH_NOT_FOUND", "폴더가 없습니다. 경로를 확인하세요.");
            }
            if (r.exitCode !== 0) {
                const hint = hintForRcloneError(r.stderrTail, remoteName);
                throw new clsAppError(
                    "RCLONE_FAILED",
                    `폴더 목록을 읽지 못했습니다(exit ${r.exitCode}).${hint ? ` ${hint}` : ""}`,
                    summarizeStderr(r.stderrTail),
                );
            }
            if (r.stdoutTruncated) {
                throw new clsAppError(
                    "RCLONE_FAILED",
                    "폴더 항목이 너무 많아 목록을 읽지 못했습니다. 하위 폴더를 직접 지정하세요.",
                );
            }
            let entries;
            try {
                entries = parseLsjsonDirEntries(r.stdout);
            } catch (e) {
                if (e instanceof clsLsjsonParseError) {
                    throw new clsAppError("RCLONE_PARSE_ERROR", e.message);
                }
                throw e;
            }
            const basePath = p.normalized.slice(p.root.length);
            const dirs = entries
                .filter((e) => e.name !== "")
                .map((e) => ({ name: e.name, path: joinRemotePath(remoteName, basePath, e.name) }))
                .toSorted((a, b) => a.name.localeCompare(b.name));
            return {
                path: p.normalized,
                entries: dirs.slice(0, LIST_DIR_MAX),
                total: dirs.length,
                truncated: dirs.length > LIST_DIR_MAX,
            };
        });
    }

    /**
     * remote 루트("name:")의 저장소 기능. 실패(시작 실패·시간 초과·0이 아닌 exit·해석 실패)는 모두 null 값이다.
     * rclone 실행 파일이 없으면 RCLONE_* 오류를 던진다.
     */
    async features(root: string, configPath: string | null): Promise<itfBackendFeatures> {
        const rt = await this.deps.rcloneEnv.require();
        const key = JSON.stringify([rt.binaryPath, configPath, root]);
        const hit = this.featuresCache.get(key);
        if (hit) return { ...hit };
        let r;
        try {
            r = await this.deps.run(rt.binaryPath, buildBackendFeaturesArgs(root, configPath), {
                timeoutMs: RCLONE_TIMEOUTS.features,
            });
        } catch (e) {
            if (e instanceof clsProcessSpawnError) return { ...UNKNOWN_FEATURES };
            throw e;
        }
        if (r.timedOut || r.exitCode !== 0 || r.stdoutTruncated) return { ...UNKNOWN_FEATURES };
        const f = parseBackendFeatures(r.stdout);
        if (f.canMove !== null || f.canHaveEmptyDirs !== null) this.featuresCache.set(key, f);
        return { ...f };
    }

    /**
     * 대상이 빈 폴더를 만들 수 있는지(INT-003 FR-30). 로컬·UNC는 조회하지 않고 true.
     * remote는 features(dst.root)의 canHaveEmptyDirs. 어떤 실패(rclone 없음 포함)도 던지지 않고 null(E-12)
     */
    async canHaveEmptyDirs(dst: itfParsedPath, configPath: string | null): Promise<boolean | null> {
        if (dst.kind !== "remote") return true;
        try {
            return (await this.features(dst.root, configPath)).canHaveEmptyDirs;
        } catch {
            return null;
        }
    }

    /**
     * remotes:features. 경로를 해석하지 못하면(입력 중) null, 로컬·UNC는 true,
     * remote는 이 작업의 conf를 찾지 못하거나 실패하면 null
     */
    async emptyDirSupport(input: typRemoteFeaturesInput): Promise<itfRemoteFeatures> {
        const parsed = parsePath(input.path);
        if (!parsed.ok) return { canHaveEmptyDirs: null };
        if (parsed.path.kind !== "remote") return { canHaveEmptyDirs: true };
        let configPath: string | null;
        try {
            configPath = await this.deps.rcloneEnv.resolveConfigFor(input.configPath);
        } catch {
            return { canHaveEmptyDirs: null };
        }
        if (configPath === null) return { canHaveEmptyDirs: null };
        return { canHaveEmptyDirs: await this.canHaveEmptyDirs(parsed.path, configPath) };
    }

    /** rclone.conf에 없는 remote는 북마크로 저장하지 않는다 */
    private async f_AssertRemoteKnown(remoteName: string): Promise<void> {
        const configPath = await this.deps.rcloneEnv.resolveConfigFor(null);
        if (configPath === null) {
            throw new clsAppError(
                "CONFIG_REQUIRED",
                "리모트 북마크를 쓰려면 rclone 설정 파일이 필요합니다.",
            );
        }
        const names = await this.deps.rcloneEnv.listRemotes(null);
        if (!names.includes(remoteName)) {
            throw new clsAppError(
                "VALIDATION",
                `rclone.conf에 ‘${remoteName}:’ 리모트가 없습니다. 리모트 이름을 확인하세요.`,
            );
        }
    }
}
