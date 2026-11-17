/**
 * 파일 내용 비교 모달의 표시 판정 순수 로직 (INT-009 FR-8·FR-10·FR-11·FR-12).
 * 응답 데이터를 분기 문구·안내·좌우 행으로 바꾼다. 텍스트가 같아도 BOM·인코딩이 다르면
 * "수정 시각만 다름"이 아니라 BOM·인코딩·줄바꿈 원인별 안내를 보여 주고, 읽기 실패는 서비스 문구를 그대로 쓴다.
 * DOM·window 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-11-18
 */

// ========== Internal imports ==========
import { formatBytes } from "@/shared/format";
import type { typRunMode } from "@/shared/schemas/common";
import { diffLines, splitLines, toSideBySide, type itfSideBySideRow } from "@/shared/text-diff";
import type { itfFileDiffData, typFileSideState } from "@/shared/types/file-diff";

// ========== Props & Types ==========
export type typDiffTone = "equal" | "changed" | "delete" | "insert";

export interface itfDiffCell {
    lineNo: number;
    text: string;
    tone: typDiffTone;
}

/** 좌우 한 줄. 한쪽에 줄이 없으면 null(빈칸)이다 */
export interface itfDiffRow {
    left: itfDiffCell | null;
    right: itfDiffCell | null;
}

export interface itfDiffView {
    /** 분기 안내 문구(같은 내용·BOM/인코딩 차이·줄바꿈만 다름·상한 초과). 없으면 빈 문자열 */
    headline: string;
    /** "n줄 추가, m줄 삭제, k줄 변경". diff를 계산했을 때만 채운다 */
    counts: string;
    /** 인코딩 안내. EUC-KR로 읽은 쪽이 있을 때만 채운다 */
    encodingNote: string;
    leftNotice: string;
    rightNotice: string;
    rows: readonly itfDiffRow[];
}

// ========== 내부 상수 ==========
const SAME_TEXT = "내용은 같습니다. 수정 시각만 다립니다.";
const LINE_ENDING_PART = "줄바꿈 방식(CRLF/LF)";
const BOM_PART = "BOM";
const ENCODING_PART = "인코딩";
const TOO_MANY_TEXT = "차이가 너무 많아 줄 단위 비교를 생략함 — 양쪽 내용을 그대로 보여 줌";
const BINARY_TEXT = "바이너리 파일이라 내용 비교를 보여 줄 수 없음";
const ABSENT_DEST_TEXT = "대상에 없음 — 동기화하면 새로 복사됨";

// ========== 내부 함수 (_F) ==========
/** 줄 목록을 좌우 셀로 바꾼다. 짝짓지 않고 각자 1부터 줄 번호를 붙인다 */
function f_CellsFromLines(lines: readonly string[]): itfDiffCell[] {
    const cells: itfDiffCell[] = [];
    for (let i = 0; i < lines.length; i++) {
        cells.push({ lineNo: i + 1, text: lines[i] ?? "", tone: "equal" });
    }
    return cells;
}

/** 두 줄 목록을 같은 인덱스끼리 놓아 좌우 행으로 만든다(짝 없이 원문을 보여 줄 때) */
function f_PairRows(left: readonly itfDiffCell[], right: readonly itfDiffCell[]): itfDiffRow[] {
    const count = left.length > right.length ? left.length : right.length;
    const rows: itfDiffRow[] = [];
    for (let i = 0; i < count; i++) rows.push({ left: left[i] ?? null, right: right[i] ?? null });
    return rows;
}

/** 한쪽 상태가 내용을 보여 줄 수 없을 때 그 쪽 열에 둘 이유 문구 */
function f_SideNotice(side: typFileSideState, absentText: string): string {
    switch (side.kind) {
        case "text":
            return "";
        case "absent":
            return absentText;
        case "binary":
            return BINARY_TEXT;
        case "tooLarge":
            return side.truncated
                ? `상한(${formatBytes(side.limit)})을 넘어 잘려서 비교하지 않음`
                : `크기 ${formatBytes(side.size)}가 상한 ${formatBytes(side.limit)}를 넘음`;
        case "error":
            // 서비스가 "원본/대상 파일을 읽지 못함: …" 형태로 이미 만든 문구를 그대로 쓴다
            return side.message;
    }
}

/** "내용은 같고 …만 다릅니다." 문구를 원인 조각으로 조합한다(FR-11). 조각이 없으면 수정 시각만 다름 */
function f_DifferenceText(parts: readonly string[]): string {
    return parts.length === 0 ? SAME_TEXT : `내용은 같고 ${parts.join("·")}만 다릅니다.`;
}

/** BOM·인코딩 차이를 원인 조각으로 만든다(FR-11) */
function f_ArtifactParts(bomDiffers: boolean, encodingDiffers: boolean): string[] {
    const parts: string[] = [];
    if (bomDiffers) parts.push(BOM_PART);
    if (encodingDiffers) parts.push(ENCODING_PART);
    return parts;
}

/** 대상에 없는 원본 쪽 문구. copy는 대상을 지우지 않는다(FR-9) */
function f_AbsentLeftText(mode: typRunMode): string {
    return mode === "sync"
        ? "원본에 없음 — 동기화(sync)하면 대상에서 삭제됨"
        : "원본에 없음 — copy는 대상에서 지우지 않음";
}

/** 좌우 행에서 추가·삭제·변경 수를 센다(FR-8) */
function f_Counts(rows: readonly itfSideBySideRow[]): string {
    let insert = 0;
    let del = 0;
    let changed = 0;
    for (const row of rows) {
        if (row.kind === "insert") insert++;
        else if (row.kind === "delete") del++;
        else if (row.kind === "changed") changed++;
    }
    return `${insert}줄 추가, ${del}줄 삭제, ${changed}줄 변경`;
}

/** diff 연산 결과를 좌우 2열 행으로 바꾼다 */
function f_SideRows(
    side: readonly itfSideBySideRow[],
    a: readonly string[],
    b: readonly string[],
): itfDiffRow[] {
    const rows: itfDiffRow[] = [];
    for (const row of side) {
        rows.push({
            left:
                row.left === null
                    ? null
                    : {
                          lineNo: row.left + 1,
                          text: a[row.left] ?? "",
                          tone:
                              row.kind === "delete"
                                  ? "delete"
                                  : row.kind === "changed"
                                    ? "changed"
                                    : "equal",
                      },
            right:
                row.right === null
                    ? null
                    : {
                          lineNo: row.right + 1,
                          text: b[row.right] ?? "",
                          tone:
                              row.kind === "insert"
                                  ? "insert"
                                  : row.kind === "changed"
                                    ? "changed"
                                    : "equal",
                      },
        });
    }
    return rows;
}

/** 응답 데이터를 화면 표시 모델로 바꾼다(분기 문구·안내·행) */
export function resolveDiffView(data: itfFileDiffData): itfDiffView {
    const source = data.source;
    const dest = data.dest;
    const leftText = source.kind === "text" ? source.text : null;
    const rightText = dest.kind === "text" ? dest.text : null;
    const leftNotice = f_SideNotice(source, f_AbsentLeftText(data.mode));
    const rightNotice = f_SideNotice(dest, ABSENT_DEST_TEXT);
    const encodingNote =
        (source.kind === "text" && source.encoding === "euc-kr") ||
        (dest.kind === "text" && dest.encoding === "euc-kr")
            ? "인코딩: EUC-KR로 읽음"
            : "";
    const base = { encodingNote, leftNotice, rightNotice };

    if (source.kind === "text" && dest.kind === "text") {
        // ① BOM·인코딩 차이를 텍스트 동일 판정보다 먼저 본다(FR-11).
        //    텍스트가 같아도 이 둘이 다르면 "수정 시각만"이 아니다
        if (source.text === dest.text) {
            return {
                ...base,
                headline: f_DifferenceText(
                    f_ArtifactParts(source.bom !== dest.bom, source.encoding !== dest.encoding),
                ),
                counts: "",
                rows: [],
            };
        }
        // ② 텍스트가 다르면 줄 단위로 비교한다
        const a = splitLines(source.text);
        const b = splitLines(dest.text);
        const ops = diffLines(a, b);
        if (ops === null) {
            return {
                ...base,
                headline: TOO_MANY_TEXT,
                counts: "",
                rows: f_PairRows(f_CellsFromLines(a), f_CellsFromLines(b)),
            };
        }
        let allEqual = true;
        for (const op of ops) {
            if (op.op !== "equal") {
                allEqual = false;
                break;
            }
        }
        // ③ 줄 목록이 같으면 줄바꿈 차이가 있고, BOM·인코딩 차이가 함께 있을 수 있다(FR-11)
        if (allEqual) {
            const parts = [
                LINE_ENDING_PART,
                ...f_ArtifactParts(source.bom !== dest.bom, source.encoding !== dest.encoding),
            ];
            return { ...base, headline: f_DifferenceText(parts), counts: "", rows: [] };
        }
        const side = toSideBySide(ops);
        return { ...base, headline: "", counts: f_Counts(side), rows: f_SideRows(side, a, b) };
    }

    // 한쪽이 텍스트가 아니거나 없다: 있는 쪽 원문만 각자 줄 번호로 보여 주고 diff는 계산하지 않는다
    return {
        ...base,
        headline: "",
        counts: "",
        rows: f_PairRows(
            leftText === null ? [] : f_CellsFromLines(splitLines(leftText)),
            rightText === null ? [] : f_CellsFromLines(splitLines(rightText)),
        ),
    };
}
