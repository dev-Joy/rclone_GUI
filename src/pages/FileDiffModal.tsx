/**
 * 원본·대상 파일 내용 비교 모달 (INT-009 FR-1·FR-2·FR-8~FR-12·FR-14).
 * 파일 행 더블클릭·파일 줄 메뉴에서 열리고, renderer는 `{ jobId, path }`만 main에 보낸다.
 * 받은 두 쪽 내용을 줄 단위로 비교해 좌우 2열로 보여 주며, 추가·삭제·변경 색과 줄 번호를 붙인다.
 * 한쪽만 있거나 바이너리·크기 초과·읽기 실패면 그 쪽 이유만 보여 주고, 줄바꿈·BOM만 다르거나
 * 차이가 상한을 넘으면 diff 대신 안내 문구를 보인다. 읽기 전용이며 닫기만 있다.
 * 닫힌 뒤 도착한 응답은 요청 번호로 버린다. 행은 가상 목록(useVirtualRows)으로 그린다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { useEffect, useMemo, useRef, useState } from "react";

// ========== Internal imports ==========
import ZBCModal from "@/components/ZBCModal";
import { clsApiError, errorText, getApi, unwrap } from "@/lib/api";
import { useVirtualRows } from "@/lib/use-virtual-rows";
import { formatBytes } from "@/shared/format";
import type { typRunMode } from "@/shared/schemas/common";
import { diffLines, splitLines, toSideBySide, type itfSideBySideRow } from "@/shared/text-diff";
import type {
    itfFileDiffData,
    itfFileDiffTarget,
    typFileSideState,
} from "@/shared/types/file-diff";
import styles from "./FileDiffModal.module.css";

// ========== Props & Types ==========
export interface itfFileDiffModalProps {
    jobId: string;
    /** null이면 닫힌 상태다 */
    target: itfFileDiffTarget | null;
    onClose: () => void;
}

type typRequestState =
    | { kind: "loading" }
    | { kind: "ready"; data: itfFileDiffData }
    | { kind: "error"; message: string };

type typDiffTone = "equal" | "changed" | "delete" | "insert";

interface itfDiffCell {
    lineNo: number;
    text: string;
    tone: typDiffTone;
}

/** 좌우 한 줄. 한쪽에 줄이 없으면 null(빈칸)이다 */
interface itfDiffRow {
    left: itfDiffCell | null;
    right: itfDiffCell | null;
}

interface itfDiffView {
    /** 분기 안내 문구(같은 내용·줄바꿈만 다름·상한 초과). 없으면 빈 문자열 */
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
/** CSS `.row` 높이와 맞춘다 */
const ROW_HEIGHT = 22;
const OVERSCAN = 10;

const LOADING_TEXT = "불러오는 중…";
const STALE_TEXT = "비교 결과가 바뀌었음 — 다시 비교한 뒤 열어 주세요.";
const SAME_TEXT = "내용은 같습니다. 수정 시각만 다릅니다.";
const LINE_ENDING_TEXT = "내용은 같고 줄바꿈 방식(CRLF/LF)이나 BOM만 다릅니다.";
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
                ? `상한 ${formatBytes(side.limit)}을 넘어 잘려서 비교하지 않음`
                : `크기 ${formatBytes(side.size)}가 상한 ${formatBytes(side.limit)}를 넘음`;
        case "error":
            return `파일을 읽지 못함: ${side.message}`;
    }
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
function f_BuildView(data: itfFileDiffData): itfDiffView {
    const leftText = data.source.kind === "text" ? data.source.text : null;
    const rightText = data.dest.kind === "text" ? data.dest.text : null;
    const leftNotice = f_SideNotice(data.source, f_AbsentLeftText(data.mode));
    const rightNotice = f_SideNotice(data.dest, ABSENT_DEST_TEXT);
    const encodingNote =
        (data.source.kind === "text" && data.source.encoding === "euc-kr") ||
        (data.dest.kind === "text" && data.dest.encoding === "euc-kr")
            ? "인코딩: EUC-KR로 읽음"
            : "";
    const base = { encodingNote, leftNotice, rightNotice };

    if (leftText !== null && rightText !== null) {
        if (leftText === rightText) {
            return { ...base, headline: SAME_TEXT, counts: "", rows: [] };
        }
        const a = splitLines(leftText);
        const b = splitLines(rightText);
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
        if (allEqual) return { ...base, headline: LINE_ENDING_TEXT, counts: "", rows: [] };
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

/**
 * 좌우 2열 가상 목록. 모달이 열려 있을 때만 마운트되므로 스크롤 리스너가 이 시점에 붙는다.
 * resetKey(파일 경로)가 바뀌면 맨 위로 돌아간다.
 */
function DiffRows(iProps: { rows: readonly itfDiffRow[]; resetKey: string }) {
    const { rows, resetKey } = iProps;
    const { ref, win } = useVirtualRows<HTMLDivElement>(
        rows.length,
        ROW_HEIGHT,
        OVERSCAN,
        resetKey,
    );
    const visible = rows.slice(win.start, win.end);

    return (
        <div
            ref={ref}
            className={styles.rows}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 스크롤 가능한 영역은 포커스할 수 있어야 한다
            tabIndex={0}
            aria-label="줄 비교"
        >
            {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden="true" />}
            {visible.map((row, k) => (
                <div className={styles.row} key={win.start + k}>
                    <span className={styles.lineNo}>{row.left?.lineNo ?? ""}</span>
                    <span className={styles.cell} data-tone={row.left?.tone ?? "empty"}>
                        {row.left?.text ?? ""}
                    </span>
                    <span className={styles.lineNo}>{row.right?.lineNo ?? ""}</span>
                    <span className={styles.cell} data-tone={row.right?.tone ?? "empty"}>
                        {row.right?.text ?? ""}
                    </span>
                </div>
            ))}
            {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden="true" />}
        </div>
    );
}

/**
 * 모달이 열릴 때마다 새로 마운트되어 요청·표시 상태를 처음부터 가진다.
 * 요청 번호로 늦게 도착한 이전 응답과 닫힌 뒤 응답을 버린다(FR-14).
 */
function FileDiffBody(iProps: { jobId: string; target: itfFileDiffTarget }) {
    const { jobId, target } = iProps;

    // ========== hook & state 변수 선언 ==========
    const [state, setState] = useState<typRequestState>({ kind: "loading" });
    const reqSeq = useRef(0);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        const seq = reqSeq.current + 1;
        reqSeq.current = seq;
        void (async () => {
            try {
                const data = await unwrap(getApi().compare.fileDiff(jobId, target.path));
                if (reqSeq.current !== seq) return;
                setState({ kind: "ready", data });
            } catch (error) {
                if (reqSeq.current !== seq) return;
                const message =
                    error instanceof clsApiError && error.payload.code === "PLAN_STALE"
                        ? STALE_TEXT
                        : errorText(error);
                setState({ kind: "error", message });
            }
        })();
        return () => {
            // 닫히거나 다른 파일로 바뀌면 이후 도착하는 응답을 버린다
            if (reqSeq.current === seq) reqSeq.current = seq + 1;
        };
    }, [jobId, target]);

    // ========== 내부 변수 (_V) ==========
    const view = useMemo(() => (state.kind === "ready" ? f_BuildView(state.data) : null), [state]);
    const hasSummary =
        view !== null && (view.headline !== "" || view.counts !== "" || view.encodingNote !== "");

    return (
        <div className={styles.FileDiffModal}>
            {state.kind === "loading" && <p className={styles.loading}>{LOADING_TEXT}</p>}
            {state.kind === "error" && (
                <p className={styles.error} role="alert">
                    {state.message}
                </p>
            )}
            {view !== null && (
                <>
                    {hasSummary && (
                        <div className={styles.summary}>
                            {view.headline !== "" && (
                                <p className={styles.headline}>{view.headline}</p>
                            )}
                            {(view.counts !== "" || view.encodingNote !== "") && (
                                <p className={styles.meta}>
                                    {view.counts}
                                    {view.counts !== "" && view.encodingNote !== "" && " · "}
                                    {view.encodingNote}
                                </p>
                            )}
                        </div>
                    )}
                    <div className={styles.headers}>
                        <span className={styles.gutter} aria-hidden="true" />
                        <span className={styles.columnTitle}>원본</span>
                        <span className={styles.gutter} aria-hidden="true" />
                        <span className={styles.columnTitle}>대상</span>
                    </div>
                    {(view.leftNotice !== "" || view.rightNotice !== "") && (
                        <div className={styles.notices}>
                            <span className={styles.gutter} aria-hidden="true" />
                            <p className={styles.notice}>{view.leftNotice}</p>
                            <span className={styles.gutter} aria-hidden="true" />
                            <p className={styles.notice}>{view.rightNotice}</p>
                        </div>
                    )}
                    {view.rows.length > 0 && <DiffRows rows={view.rows} resetKey={target.path} />}
                </>
            )}
        </div>
    );
}

export default function FileDiffModal(props: itfFileDiffModalProps) {
    const { jobId, target, onClose } = props;
    const title = target ? `원본·대상 내용 비교: ${target.path}` : "원본·대상 내용 비교";

    return (
        <ZBCModal open={target !== null} title={title} onClose={onClose} size="wide">
            {target !== null && (
                <FileDiffBody key={`${jobId}:${target.path}`} jobId={jobId} target={target} />
            )}
        </ZBCModal>
    );
}
