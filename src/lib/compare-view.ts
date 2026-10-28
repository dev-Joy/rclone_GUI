/**
 * 비교 화면의 순수 로직: 상태 라벨·색, 사유 문구, 필터·검색·정렬(인덱스 배열), 요약 카드 문구,
 * 결과가 낡았는지, 비교 버튼 가능 여부. DOM·window 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { checkRunPaths } from "@/shared/path-utils";
import type { typRunMode } from "@/shared/schemas/common";
import type { typJob } from "@/shared/schemas/job";
import type {
    itfCompareActive,
    itfCompareResult,
    itfCompareSummary,
    itfDiffEntry,
    typCompareStatus,
    typModifiedReason,
} from "@/shared/types/compare";

/** ZBCBadge의 tone과 같은 값 (컴포넌트 파일을 node 환경에 끌어오지 않으려고 따로 둔다) */
export type typCompareTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type typCompareFilterStatus =
    | "all"
    | "changes"
    | "onlySource"
    | "modified"
    | "onlyDest"
    | "typeConflict"
    | "equal";

export type typCompareSortKey = "path" | "status" | "srcSize" | "srcTime" | "dstSize" | "dstTime";
export type typSortDir = "asc" | "desc";

export interface itfCompareViewState {
    status: typCompareFilterStatus;
    query: string;
    hideEqual: boolean;
    sortKey: typCompareSortKey;
    sortDir: typSortDir;
}

export const DEFAULT_COMPARE_VIEW: itfCompareViewState = {
    status: "all",
    query: "",
    hideEqual: true,
    sortKey: "path",
    sortDir: "asc",
};

export const FILTER_LABELS: Record<typCompareFilterStatus, string> = {
    all: "전체",
    changes: "변경만(복사·덮어씀·대상만·충돌)",
    onlySource: "원본만",
    modified: "변경",
    onlyDest: "대상만",
    typeConflict: "형식 충돌",
    equal: "동일",
};

const CHANGE_STATUSES: ReadonlySet<typCompareStatus> = new Set([
    "onlySource",
    "modified",
    "onlyDest",
    "typeConflict",
]);

/** 상태 정렬 순서: 충돌 → 복사 → 덮어씀 → 대상만 → 동일 */
const STATUS_RANK: Record<typCompareStatus, number> = {
    typeConflict: 0,
    onlySource: 1,
    modified: 2,
    onlyDest: 3,
    equal: 4,
};

const REASON_TEXT: Record<typModifiedReason, string> = {
    size: "크기",
    mtime: "수정시간",
    hash: "해시",
    mtimeUnknown: "수정시간 모름",
    type: "파일↔폴더",
};

/** 상태 라벨. onlyDest: copy "대상만(유지)", sync "대상만(삭제 예정)" */
export function statusLabel(status: typCompareStatus, mode: typRunMode): string {
    switch (status) {
        case "onlySource":
            return "원본만(복사)";
        case "modified":
            return "변경(덮어씀)";
        case "onlyDest":
            return mode === "sync" ? "대상만(삭제 예정)" : "대상만(유지)";
        case "equal":
            return "동일";
        case "typeConflict":
            return "형식 충돌";
    }
}

export function statusTone(status: typCompareStatus, mode: typRunMode): typCompareTone {
    switch (status) {
        case "onlySource":
            return "accent";
        case "modified":
            return "warning";
        case "onlyDest":
            return mode === "sync" ? "danger" : "neutral";
        case "equal":
            return "neutral";
        case "typeConflict":
            return "danger";
    }
}

/** 변경 사유 문구. 예: ["size", "mtime"] → "크기, 수정시간" */
export function reasonText(reasons: readonly typModifiedReason[]): string {
    return reasons.map((r) => REASON_TEXT[r]).join(", ");
}

function f_Key(text: string): string {
    return text.normalize("NFC").toLowerCase();
}

function f_StatusMatch(entry: itfDiffEntry, v: itfCompareViewState): boolean {
    if (v.status === "equal") return entry.status === "equal";
    if (v.hideEqual && entry.status === "equal") return false;
    if (v.status === "all") return true;
    if (v.status === "changes") return CHANGE_STATUSES.has(entry.status);
    return entry.status === v.status;
}

/** 정렬 값. null은 방향과 상관없이 뒤로 보낸다 */
function f_SortValue(e: itfDiffEntry, key: typCompareSortKey): number | null {
    switch (key) {
        case "path":
            return 0;
        case "status":
            return STATUS_RANK[e.status];
        case "srcSize":
            return e.source?.size ?? null;
        case "srcTime":
            return e.source?.modTimeMs ?? null;
        case "dstSize":
            return e.dest?.size ?? null;
        case "dstTime":
            return e.dest?.modTimeMs ?? null;
    }
}

/**
 * 필터·검색(부분 일치, 대소문자 무시·NFC)·정렬 결과를 entries 인덱스 배열로 돌려준다(객체 복사 없음).
 * entries는 경로 키 오름차순이므로 보조 키(경로 오름차순)는 인덱스 순서로 대신한다.
 * status가 "equal"이면 hideEqual을 무시한다.
 */
export function selectRowIndexes(
    entries: readonly itfDiffEntry[],
    v: itfCompareViewState,
): number[] {
    const q = f_Key(v.query.trim());
    const rows: number[] = [];
    for (let i = 0; i < entries.length; i += 1) {
        const e = entries[i]!;
        if (!f_StatusMatch(e, v)) continue;
        if (q && !f_Key(e.path).includes(q) && !(e.dest && f_Key(e.dest.path).includes(q)))
            continue;
        rows.push(i);
    }
    const sign = v.sortDir === "asc" ? 1 : -1;
    if (v.sortKey === "path") return sign === 1 ? rows : rows.toReversed();
    const values = new Map<number, number | null>();
    for (const i of rows) values.set(i, f_SortValue(entries[i]!, v.sortKey));
    return rows.toSorted((a, b) => {
        const va = values.get(a) ?? null;
        const vb = values.get(b) ?? null;
        if (va === null || vb === null) {
            if (va === vb) return a - b;
            return va === null ? 1 : -1;
        }
        return va === vb ? a - b : (va - vb) * sign;
    });
}

export interface itfSummaryCard {
    filter: typCompareFilterStatus;
    label: string;
    count: number;
    /** 표시할 바이트(없으면 null) */
    bytes: number | null;
    tone: typCompareTone;
}

/** 요약 카드. 문구는 일어날 일: "대상에 12개 복사", "8개 덮어씀", sync "3개 삭제" / copy "3개 대상에만 있음(유지)" */
export function summaryCards(s: itfCompareSummary, mode: typRunMode): itfSummaryCard[] {
    const cards: itfSummaryCard[] = [
        {
            filter: "onlySource",
            label: `대상에 ${s.createFiles}개 복사`,
            count: s.createFiles,
            bytes: s.createBytes,
            tone: "accent",
        },
        {
            filter: "modified",
            label: `${s.updateFiles}개 덮어씀`,
            count: s.updateFiles,
            bytes: s.updateBytes,
            tone: "warning",
        },
        {
            filter: "onlyDest",
            label:
                mode === "sync"
                    ? `${s.deleteFiles}개 삭제`
                    : `${s.deleteFiles}개 대상에만 있음(유지)`,
            count: s.deleteFiles,
            bytes: s.deleteBytes,
            tone: mode === "sync" ? "danger" : "neutral",
        },
        {
            filter: "equal",
            label: `동일 ${s.sameFiles}개`,
            count: s.sameFiles,
            bytes: null,
            tone: "neutral",
        },
    ];
    if (s.conflictFiles > 0) {
        cards.push({
            filter: "typeConflict",
            label: `형식 충돌 ${s.conflictFiles}개`,
            count: s.conflictFiles,
            bytes: null,
            tone: "danger",
        });
    }
    return cards;
}

/**
 * 화면 배너용. 작업 rev가 바뀌었으면 "작업 설정이 바뀌었습니다. 다시 비교하세요.",
 * 나이가 넘었으면 "비교한 지 N분 지났습니다. 실행 전 다시 비교하세요.", 아니면 null.
 */
export function compareStaleReason(
    result: itfCompareResult,
    job: Pick<typJob, "rev">,
    maxAgeMinutes: number,
    nowMs: number,
): string | null {
    if (job.rev !== result.jobRev) return "작업 설정이 바뀌었습니다. 다시 비교하세요.";
    const age = nowMs - Date.parse(result.createdAt);
    if (age > maxAgeMinutes * 60_000) {
        return `비교한 지 ${Math.floor(age / 60_000)}분 지났습니다. 실행 전 다시 비교하세요.`;
    }
    return null;
}

export interface itfCanStartCompareInput {
    job: typJob | null;
    dirty: boolean;
    running: itfCompareActive | null;
    caseInsensitive: boolean;
}

/** 비교 버튼 가능 여부와 이유. 저장 안 됨 → 미저장 변경 → 경로 오류(드라이브 상대 포함) → 진행 중 */
export function canStartCompare(
    input: itfCanStartCompareInput,
): { ok: true } | { ok: false; reason: string } {
    const { job } = input;
    if (!job) return { ok: false, reason: "먼저 작업을 저장하세요." };
    if (input.dirty) {
        return {
            ok: false,
            reason: "저장하지 않은 변경이 있습니다. 저장한 뒤 비교할 수 있습니다.",
        };
    }
    const first = checkRunPaths(job.source, job.destination, input.caseInsensitive).errors[0];
    if (first) return { ok: false, reason: first.message };
    if (input.running) {
        return {
            ok: false,
            reason:
                input.running.jobId === job.id
                    ? "비교 중입니다."
                    : "다른 작업을 비교하는 중입니다.",
        };
    }
    return { ok: true };
}
