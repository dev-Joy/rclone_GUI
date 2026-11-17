/**
 * 원본·대상 파일 내용 비교 모달 (INT-009 FR-1·FR-2·FR-8~FR-12·FR-14).
 * 파일 행 더블클릭·파일 줄 메뉴에서 열리고, renderer는 `{ jobId, path }`만 main에 보낸다.
 * 받은 두 쪽 내용을 줄 단위로 비교해 좌우 2열로 보여 주며, 추가·삭제·변경 색과 줄 번호를 붙인다.
 * 한쪽만 있거나 바이너리·크기 초과·읽기 실패면 그 쪽 이유만 보여 주고, 줄바꿈·BOM만 다르거나
 * 차이가 상한을 넘으면 diff 대신 안내 문구를 보인다. 읽기 전용이며 닫기만 있다.
 * 닫힌 뒤 도착한 응답은 요청 번호로 버린다. 행은 가상 목록(useVirtualRows)으로 그린다.
 * 표시 분기 판정은 `@/lib/file-diff-view`의 순수 함수가 맡는다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { useEffect, useMemo, useRef, useState } from "react";

// ========== Internal imports ==========
import ZBCModal from "@/components/ZBCModal";
import { clsApiError, errorText, getApi, unwrap } from "@/lib/api";
import { resolveDiffView, type itfDiffRow } from "@/lib/file-diff-view";
import { useVirtualRows } from "@/lib/use-virtual-rows";
import type { itfFileDiffData, itfFileDiffTarget } from "@/shared/types/file-diff";
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

// ========== 내부 상수 ==========
/** CSS `.row` 높이와 맞춘다 */
const ROW_HEIGHT = 22;
const OVERSCAN = 10;

const LOADING_TEXT = "불러오는 중…";
const STALE_TEXT = "비교 결과가 바뀌었음 — 다시 비교한 뒤 열어 주세요.";

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
    const view = useMemo(
        () => (state.kind === "ready" ? resolveDiffView(state.data) : null),
        [state],
    );
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
