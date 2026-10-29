/**
 * 작업에 실제로 적용할 제외 패턴 해석 (INT-002 T-03·T-09).
 *
 * 공용(연결된 라이브러리 패턴) + 작업 전용을 합치고(mergeExcludePatterns), 전달 방식
 * (--exclude 인자 / --exclude-from 파일)을 정한다(planExcludeTransport). 결과의 snapshotHash로
 * 비교 결과와 실행 시점의 패턴이 같은지 확인한다(파일 사용 여부 포함).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { createHash } from "node:crypto";

// ========== Internal imports ==========
import type { clsExcludeStore } from "@/main/store/exclude-store";
import { mergeExcludePatterns, planExcludeTransport } from "@/shared/exclude-patterns";
import type { typJob } from "@/shared/schemas/job";

export interface itfEffectiveExcludes {
    /** 적용 순서대로 모든 패턴 */
    patterns: readonly string[];
    /** --exclude 인자로 넘길 패턴 */
    argPatterns: readonly string[];
    /** --exclude-from 파일에 넣을 패턴 */
    filePatterns: readonly string[];
    /** 파일 내용(BOM 없음, LF, 빈 줄 없음). 파일을 쓰지 않으면 null */
    fileContent: string | null;
    /** 패턴·전달 방식 해시(hex 32자) */
    snapshotHash: string;
}

const HASH_VERSION = 1;

export function resolveEffectiveExcludes(
    job: Pick<typJob, "excludes" | "excludePatternIds">,
    lib: Pick<clsExcludeStore, "patternsFor">,
): itfEffectiveExcludes {
    const patterns = mergeExcludePatterns(lib.patternsFor(job.excludePatternIds), job.excludes);
    const { argPatterns, filePatterns } = planExcludeTransport(patterns);
    const fileContent = filePatterns.length > 0 ? `${filePatterns.join("\n")}\n` : null;
    const snapshotHash = createHash("sha256")
        .update(
            JSON.stringify([
                HASH_VERSION,
                patterns,
                argPatterns,
                filePatterns,
                fileContent !== null,
            ]),
        )
        .digest("hex")
        .slice(0, 32);
    return { patterns, argPatterns, filePatterns, fileContent, snapshotHash };
}
