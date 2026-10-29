/**
 * 작업(Job) 편집 폼의 순수 로직: 화면 검증(스키마 + 경로 안전 규칙), 필드별 오류·경고 매핑,
 * main 오류 envelope 매핑, 제외 규칙 문자열 변환, 변경 여부 비교, 목록 정렬.
 * DOM·window 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { z } from "zod";

// ========== Internal imports ==========
import {
    excludesIssueText,
    numberIssueText,
    stableStringify,
    type itfNumberRange,
} from "@/lib/form-utils";
import { checkPathPair } from "@/shared/path-utils";
import { driveLetterRemoteWarning, looksLikeDriveLetterRemotePath } from "@/shared/remote-name";
import type { typAppErrorPayload } from "@/shared/schemas/common";
import { zJobDraft, type typJob, type typJobDraft } from "@/shared/schemas/job";

export type typJobFormField =
    | "name"
    | "notes"
    | "source"
    | "destination"
    | "mode"
    | "excludes"
    | "configPathOverride"
    | "options.checkers"
    | "options.transfers"
    | "options.modtimeToleranceMs"
    | "autoSync.intervalMinutes";

export interface itfJobFormCheck {
    /** 필드별 첫 오류 문구 */
    fieldErrors: Partial<Record<typJobFormField, string>>;
    /** 필드에 붙일 수 없는 오류(원본=대상, 중첩 등) */
    formErrors: string[];
    /** 차단하지 않는 경고 (필드별) */
    fieldWarnings: Partial<Record<typJobFormField, string[]>>;
    /** 차단하지 않는 경고 (전체) */
    formWarnings: string[];
    /** fieldErrors·formErrors가 비었는지 */
    ok: boolean;
}

export const JOB_NUMBER_RANGES = {
    "options.checkers": { min: 1, max: 64, int: true },
    "options.transfers": { min: 1, max: 32, int: true },
    "options.modtimeToleranceMs": { min: 0, max: 600_000, int: true },
    "autoSync.intervalMinutes": { min: 1, max: 10_080, int: true },
} as const satisfies Record<string, itfNumberRange>;

type typNumberField = keyof typeof JOB_NUMBER_RANGES;

const PAIR_FIELD = { "원본: ": "source", "대상: ": "destination" } as const;
const PAIR_ERROR_HIGHLIGHT = "원본과 대상 경로를 확인하세요.";

const WARN_SYNC_IGNORE_ERRORS =
    "동기화 모드에서는 ‘오류 무시’로 실행할 수 없습니다(백업 폴더 미지원). 끄거나 복사 모드를 쓰세요.";
const WARN_SYNC_NO_PREFLIGHT =
    "실행 직전 사전 확인을 끄면 비교 뒤 바뀐 삭제는 삭제 한도(--max-delete)로만 막습니다.";
const WARN_COPY_ALLOW_DELETES =
    "복사 모드에서는 삭제가 일어나지 않으므로 ‘자동 실행 때 삭제 허용’은 쓰이지 않습니다.";
const WARN_AUTO_DELETES =
    "자동 실행이 대상에만 있는 파일을 지울 수 있습니다(설정의 ‘자동 실행 최대 삭제 수’까지).";

function f_Empty(): itfJobFormCheck {
    return { fieldErrors: {}, formErrors: [], fieldWarnings: {}, formWarnings: [], ok: true };
}

function f_Finish(c: itfJobFormCheck): itfJobFormCheck {
    c.ok = Object.keys(c.fieldErrors).length === 0 && c.formErrors.length === 0;
    return c;
}

function f_SetError(c: itfJobFormCheck, field: typJobFormField, message: string): void {
    if (c.fieldErrors[field] === undefined) c.fieldErrors[field] = message;
}

function f_AddWarning(c: itfJobFormCheck, field: typJobFormField, message: string): void {
    const list = c.fieldWarnings[field] ?? [];
    if (!list.includes(message)) list.push(message);
    c.fieldWarnings[field] = list;
}

/** "원본: …" / "대상: …" 접두사가 있으면 필드와 나머지 문구 */
function f_SplitPairPrefix(message: string): { field: typJobFormField; text: string } | null {
    for (const [prefix, field] of Object.entries(PAIR_FIELD)) {
        if (message.startsWith(prefix)) return { field, text: message.slice(prefix.length) };
    }
    return null;
}

function f_StringIssueText(field: typJobFormField, issue: z.core.$ZodIssue): string {
    const big = issue.code === "too_big";
    switch (field) {
        case "name":
            return big ? "이름은 80자 이내로 입력하세요." : "이름을 입력하세요.";
        case "notes":
            return "메모는 4000자 이내로 입력하세요.";
        case "source":
        case "destination":
            return big ? "경로는 4096자 이내로 입력하세요." : "경로를 입력하세요.";
        case "configPathOverride":
            return big ? "경로는 4096자 이내로 입력하세요." : "rclone.conf 파일을 고르세요.";
        case "mode":
            return "복사 또는 동기화를 고르세요.";
        default:
            return issue.message;
    }
}

/** zod 오류 하나를 필드와 한국어 문구로 */
function f_MapIssue(
    issue: z.core.$ZodIssue,
    draft: typJobDraft,
): { field: typJobFormField; text: string } | null {
    const [head, sub, ...rest] = issue.path;
    if (head === "excludes") {
        return {
            field: "excludes",
            text: excludesIssueText(issue, sub === undefined ? [] : [sub, ...rest]),
        };
    }
    if (head === "options" || head === "autoSync") {
        const key = `${head}.${String(sub)}`;
        if (!(key in JOB_NUMBER_RANGES)) return null; // 불리언 필드는 화면에서 잘못될 수 없다
        const field = key as typNumberField;
        const group = draft[head] as unknown as Record<string, unknown>;
        return { field, text: numberIssueText(group[String(sub)], JOB_NUMBER_RANGES[field]) };
    }
    if (
        head === "name" ||
        head === "notes" ||
        head === "source" ||
        head === "destination" ||
        head === "mode" ||
        head === "configPathOverride"
    ) {
        // 제어문자 등 custom 메시지는 이미 한국어
        if (issue.code === "custom") return { field: head, text: issue.message };
        return { field: head, text: f_StringIssueText(head, issue) };
    }
    return null;
}

/** 저장된 Job에서 편집 가능한 필드만 뽑는다 (id·rev·lastRun·nextRunAt 등 제외) */
export function jobToDraft(job: typJob): typJobDraft {
    return {
        name: job.name,
        notes: job.notes,
        source: job.source,
        destination: job.destination,
        mode: job.mode,
        excludes: [...job.excludes],
        options: { ...job.options },
        configPathOverride: job.configPathOverride,
        autoSync: {
            enabled: job.autoSync.enabled,
            intervalMinutes: job.autoSync.intervalMinutes,
            allowDeletes: job.autoSync.allowDeletes,
        },
    };
}

/** 편집 가능한 값이 같은지 (dirty 판정). excludes 순서까지 비교 */
export function isDraftEqual(a: typJobDraft, b: typJobDraft): boolean {
    return stableStringify(a) === stableStringify(b);
}

/** 화면 검증: zJobDraft.safeParse + checkPathPair + 경고 규칙 */
export function validateJobDraft(draft: typJobDraft, caseInsensitive: boolean): itfJobFormCheck {
    const c = f_Empty();

    const parsed = zJobDraft.safeParse(draft);
    if (!parsed.success) {
        for (const issue of parsed.error.issues) {
            const mapped = f_MapIssue(issue, draft);
            if (mapped) f_SetError(c, mapped.field, mapped.text);
            else c.formErrors.push(issue.message);
        }
    }

    const pair = checkPathPair(draft.source, draft.destination, caseInsensitive);
    let pairError = false;
    for (const e of pair.errors) {
        const split = f_SplitPairPrefix(e.message);
        if (split) f_SetError(c, split.field, split.text);
        else {
            c.formErrors.push(e.message);
            pairError = true;
        }
    }
    if (pairError) {
        f_SetError(c, "source", PAIR_ERROR_HIGHLIGHT);
        f_SetError(c, "destination", PAIR_ERROR_HIGHLIGHT);
    }
    for (const w of pair.warnings) {
        const split = f_SplitPairPrefix(w);
        if (split) f_AddWarning(c, split.field, split.text);
        else c.formWarnings.push(w);
    }

    for (const field of ["source", "destination"] as const) {
        const raw = draft[field];
        if (looksLikeDriveLetterRemotePath(raw)) {
            const text = driveLetterRemoteWarning([raw.trim().charAt(0)]);
            if (text) f_AddWarning(c, field, text);
        }
    }

    if (draft.mode === "sync" && draft.options.ignoreErrors)
        c.formWarnings.push(WARN_SYNC_IGNORE_ERRORS);
    if (draft.mode === "sync" && !draft.options.preflightBeforeDestructive)
        c.formWarnings.push(WARN_SYNC_NO_PREFLIGHT);
    if (draft.mode === "copy" && draft.autoSync.allowDeletes)
        c.formWarnings.push(WARN_COPY_ALLOW_DELETES);
    if (draft.mode === "sync" && draft.autoSync.enabled && draft.autoSync.allowDeletes)
        c.formWarnings.push(WARN_AUTO_DELETES);

    return f_Finish(c);
}

/**
 * main 오류 envelope를 폼 오류로.
 * SAFETY_BLOCKED/PATH_INVALID 메시지의 "원본:"/"대상:" 접두사는 해당 필드로, 나머지는 formErrors
 */
export function serverErrorToCheck(error: typAppErrorPayload): itfJobFormCheck {
    const c = f_Empty();
    const split = f_SplitPairPrefix(error.message);
    if (split) f_SetError(c, split.field, split.text);
    else c.formErrors.push(error.message);
    return f_Finish(c);
}

/** textarea 문자열 → excludes (trim, 빈 줄 제거, 순서 유지) */
export function parseExcludesText(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
}

export function excludesToText(excludes: readonly string[]): string {
    return excludes.join("\n");
}

/** 사이드바 정렬: 이름(ko, base) → createdAt */
export function sortJobs(jobs: readonly typJob[]): typJob[] {
    return jobs.toSorted(
        (a, b) =>
            a.name.localeCompare(b.name, "ko", { sensitivity: "base" }) ||
            a.createdAt.localeCompare(b.createdAt),
    );
}

/** 삭제 후 선택할 id (정렬 순서의 다음 → 이전 → null) */
export function nextSelectionAfterRemove(
    sorted: readonly typJob[],
    removedId: string,
): string | null {
    const i = sorted.findIndex((j) => j.id === removedId);
    if (i < 0) return sorted[0]?.id ?? null;
    return sorted[i + 1]?.id ?? sorted[i - 1]?.id ?? null;
}
