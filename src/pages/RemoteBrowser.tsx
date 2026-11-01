/**
 * remote 폴더 탐색 모달 (INT-002 T-02). 북마크 기준 경로부터 한 단계씩 내려가며 폴더를 고른다.
 * 목록은 rclone:listDir(lsjson --max-depth 1 --dirs-only)로 읽고, 기준 경로 위로는 올라가지 않는다.
 * 항목이 많으면 LIST_DIR_PAGE개씩 보여 주고 "더 보기"로 늘린다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== External imports ==========
import { useCallback, useEffect, useRef, useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import { errorText, getApi, unwrap } from "@/lib/api";
import {
    browserChild,
    browserParent,
    isBrowserRoot,
    visibleDirEntries,
} from "@/lib/remote-browser";
import { LIST_DIR_PAGE } from "@/shared/option-limits";
import type { itfDirListing, itfRemoteBookmark } from "@/shared/types/remotes";
import styles from "./RemoteBrowser.module.css";

// ========== Props & Types ==========
export interface itfRemoteBrowserProps {
    open: boolean;
    /** null이면 열지 않는다 */
    bookmark: itfRemoteBookmark | null;
    /** 열 때 시작할 경로. 없으면 북마크 기준 경로 */
    initialPath?: string | null;
    /** 이 작업의 rclone.conf (null = 기본). 탐색은 이 설정 파일로 한다 */
    configPath?: string | null;
    onClose: () => void;
    onPick: (path: string) => void;
}

export default function RemoteBrowser(props: itfRemoteBrowserProps) {
    const { open, bookmark, initialPath, configPath = null, onClose, onPick } = props;
    if (!open || !bookmark) return null;
    // 열 때마다 새로 마운트해 이전 경로·목록이 남지 않게 한다
    const key = `${bookmark.id}:${initialPath ?? bookmark.path}:${configPath ?? ""}`;
    return (
        <RemoteBrowserBody
            key={key}
            bookmark={bookmark}
            initialPath={initialPath}
            configPath={configPath}
            onClose={onClose}
            onPick={onPick}
        />
    );
}

interface itfRemoteBrowserBodyProps {
    bookmark: itfRemoteBookmark;
    initialPath?: string | null;
    configPath?: string | null;
    onClose: () => void;
    onPick: (path: string) => void;
}

function RemoteBrowserBody(props: itfRemoteBrowserBodyProps) {
    const { bookmark, initialPath, configPath = null, onClose, onPick } = props;

    // ========== hook & state 변수 선언 ==========
    const [path, setPath] = useState(initialPath ?? bookmark.path);
    const [listing, setListing] = useState<itfDirListing | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [shown, setShown] = useState(LIST_DIR_PAGE);
    /** 늦게 온 이전 요청이 현재 경로 목록을 덮지 않게 한다 */
    const request = useRef(0);

    /** 경로 하나의 폴더 목록을 읽는다. 마지막 요청의 결과만 화면에 반영한다 */
    const f_Load = useCallback(
        async (target: string) => {
            const seq = request.current + 1;
            request.current = seq;
            try {
                const data = await unwrap(getApi().rclone.listDir({ path: target, configPath }));
                if (request.current === seq) {
                    setListing(data);
                    setError(null);
                }
            } catch (e) {
                if (request.current === seq) {
                    setListing(null);
                    setError(errorText(e));
                }
            } finally {
                if (request.current === seq) setLoading(false);
            }
        },
        [configPath],
    );

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        if (path === "") return;
        // f_Load의 setState는 listDir 응답을 기다린 뒤에만 실행된다(연쇄 렌더 없음)
        // oxlint-disable-next-line react/set-state-in-effect -- 응답 뒤 setState만 한다
        void f_Load(path);
    }, [path, f_Load]);

    // ========== 내부 변수 (_V) ==========
    const up = browserParent(bookmark, path);
    const entries = listing ? visibleDirEntries(listing.entries, shown) : [];
    const canPick = path !== "" && !isBrowserRoot(path);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const f_Goto = (next: string) => {
        setLoading(true);
        setError(null);
        setPath(next);
        setShown(LIST_DIR_PAGE);
    };
    const h_Up = () => {
        if (up) f_Goto(up);
    };
    const h_Refresh = () => {
        if (path === "") return;
        setLoading(true);
        setError(null);
        void f_Load(path);
    };
    const h_Open = (name: string) => {
        const next = browserChild(bookmark, path, name);
        if (next) f_Goto(next);
    };
    const h_More = () => setShown((n) => n + LIST_DIR_PAGE);
    const h_Pick = () => {
        if (!canPick) return;
        onPick(path);
        onClose();
    };

    const footer = (
        <>
            <ZBCButton onClick={onClose}>취소</ZBCButton>
            <ZBCButton
                variant="primary"
                onClick={h_Pick}
                disabled={!canPick}
                title={canPick ? undefined : "remote 루트는 작업 경로로 쓸 수 없습니다."}
            >
                이 폴더 선택
            </ZBCButton>
        </>
    );

    return (
        <ZBCModal open title="remote 폴더 찾아보기" onClose={onClose} footer={footer}>
            <div className={styles.RemoteBrowser}>
                <p className={styles.bookmark}>{bookmark.alias}</p>
                <div className={styles.location}>
                    <code id="remote-browser-current" className={styles.current} title={path}>
                        {path}
                    </code>
                    <div className={styles.actions}>
                        <ZBCButton
                            id="remote-browser-up"
                            onClick={h_Up}
                            disabled={up === null || loading}
                            title={up === null ? "기준 경로 위로는 올라갈 수 없습니다." : undefined}
                        >
                            상위
                        </ZBCButton>
                        <ZBCButton
                            id="remote-browser-refresh"
                            onClick={h_Refresh}
                            disabled={loading}
                        >
                            새로고침
                        </ZBCButton>
                    </div>
                </div>
                {loading && <p className={styles.status}>폴더 목록을 불러오는 중…</p>}
                {error && (
                    <p className={styles.error} role="alert">
                        {error}
                    </p>
                )}
                {!loading && !error && listing && entries.length === 0 && (
                    <p className={styles.status}>이 폴더에는 하위 폴더가 없습니다.</p>
                )}
                {entries.length > 0 && (
                    <ul className={styles.list}>
                        {entries.map((e) => (
                            <li key={e.path}>
                                <button
                                    type="button"
                                    className={styles.entry}
                                    onClick={() => h_Open(e.name)}
                                    title={e.path}
                                >
                                    {e.name}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {listing && shown < listing.entries.length && (
                    <ZBCButton id="remote-browser-more" onClick={h_More}>
                        더 보기 ({listing.entries.length - shown}개)
                    </ZBCButton>
                )}
                {listing?.truncated && (
                    <p className={styles.warning}>
                        폴더가 너무 많아 {listing.total}개 중 앞부분만 보여 줍니다. 하위 폴더를 직접
                        지정하세요.
                    </p>
                )}
            </div>
        </ZBCModal>
    );
}
