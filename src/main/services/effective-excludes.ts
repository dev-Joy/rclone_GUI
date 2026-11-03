/**
 * 작업에 실제로 적용할 제외 패턴 해석 (INT-002 T-03·T-09, INT-007).
 *
 * 공용(연결된 라이브러리 패턴) + 작업 전용을 합치고(mergeExcludePatterns), --filter-from 파일 내용을
 * 만든다(buildFilterFileContent). 결과의 snapshotHash로 비교 결과와 실행 시점의 패턴·파일 내용이
 * 같은지 확인한다. 줄 주입을 막기 위해 제어문자가 든 패턴은 여기서 거부한다(shared 순수 함수는
 * clsAppError를 쓸 수 없다).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { createHash } from "node:crypto";

// ========== Internal imports ==========
import { clsAppError } from "@/main/lib/app-error";
import type { clsExcludeStore } from "@/main/store/exclude-store";
import { buildFilterFileContent, mergeExcludePatterns } from "@/shared/exclude-patterns";
import type { typJob } from "@/shared/schemas/job";

export interface itfEffectiveExcludes {
    /** 적용 순서대로 모든 패턴 */
    patterns: readonly string[];
    /** --filter-from 파일 내용(BOM 없음, LF, 빈 줄 없음). 패턴이 없으면 null */
    fileContent: string | null;
    /** 패턴·파일 내용 해시(hex 32자) */
    snapshotHash: string;
}

const HASH_VERSION = 2;

// oxlint-disable-next-line no-control-regex -- 제어문자를 찾아 거부하기 위한 정규식
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function resolveEffectiveExcludes(
    job: Pick<typJob, "excludes" | "excludePatternIds">,
    lib: Pick<clsExcludeStore, "patternsFor">,
): itfEffectiveExcludes {
    const patterns = mergeExcludePatterns(lib.patternsFor(job.excludePatternIds), job.excludes);
    // 작업 패턴 zod는 U+007F를 통과시키므로 shared CONTROL_RE로 한 번 더 막는다(필터 파일 줄 주입 방어)
    if (patterns.some((p) => CONTROL_RE.test(p))) {
        throw new clsAppError("VALIDATION", "제외 패턴에 제어문자가 있습니다.");
    }
    const fileContent = buildFilterFileContent(patterns);
    const snapshotHash = createHash("sha256")
        .update(JSON.stringify([HASH_VERSION, patterns, fileContent]))
        .digest("hex")
        .slice(0, 32);
    return { patterns, fileContent, snapshotHash };
}
