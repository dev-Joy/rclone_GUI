/**
 * remote 빠른 입력과 북마크·폴더 탐색 (INT-002 T-02).
 * 작업이 쓰는 rclone.conf의 remote 목록에서 골라 "이름:"을 넣거나,
 * 저장한 북마크의 기준 경로부터 폴더를 한 단계씩 내려가며 경로를 고른다.
 * 영문 한 글자 remote는 Windows에서 드라이브 문자로 해석되므로 고를 수 없게 하고 경고를 보여 준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCSelect from "@/components/ZBCSelect";
import { browserParent, isBrowserRoot } from "@/lib/remote-browser";
import {
    driveLetterRemoteWarning,
    findDriveLetterRemotes,
    isDriveLetterRemoteName,
} from "@/shared/remote-name";
import { selectRemotesFor, useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useRemotesStore } from "@/stores/remotes-store";
import RemoteBrowser from "./RemoteBrowser";
import styles from "./RemotePicker.module.css";

// ========== Props & Types ==========
export interface itfRemotePickerProps {
    id: string;
    /** 이 작업의 rclone.conf (null = 기본) */
    configPath: string | null;
    /** 지금 입력란 값. 비어 있을 때만 북마크 하나를 자동으로 고른다 */
    value?: string;
    /** "name:" 또는 "name:base/..." 를 입력란에 넣는다 (기존 값은 교체) */
    onPick: (remoteRoot: string) => void;
}

export default function RemotePicker(props: itfRemotePickerProps) {
    const { id, configPath, value, onPick } = props;

    // ========== hook & state 변수 선언 ==========
    const list = useRcloneEnvStore(useShallow((s) => selectRemotesFor(s, configPath)));
    const loadRemotes = useRcloneEnvStore((s) => s.loadRemotes);
    const bookmarks = useRemotesStore((s) => s.items);
    const bookmarksLoaded = useRemotesStore((s) => s.loaded);
    const loadBookmarks = useRemotesStore((s) => s.load);
    const [bookmarkId, setBookmarkId] = useState("");
    const [browserOpen, setBrowserOpen] = useState(false);
    /** 북마크 목록을 처음 불러왔을 때 한 번만 자동 선택한다 */
    const autoPicked = useRef(false);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        void loadRemotes(configPath);
    }, [configPath, loadRemotes]);
    useEffect(() => {
        void loadBookmarks();
    }, [loadBookmarks]);

    // ========== 내부 변수 (_V) ==========
    const remotes = list.remotes ?? [];
    const warning = driveLetterRemoteWarning(findDriveLetterRemotes(remotes));
    const options = remotes.map((r) =>
        isDriveLetterRemoteName(r)
            ? { value: r, label: `${r}: (사용 불가 — 드라이브 문자)`, disabled: true }
            : { value: r, label: `${r}:` },
    );
    const bookmarkOptions = bookmarks.map((b) => ({
        value: b.id,
        label: `${b.alias} — ${b.path}`,
    }));
    const valueText = (value ?? "").trim();
    const only = bookmarksLoaded && bookmarks.length === 1 ? bookmarks[0]! : null;
    // remote 루트는 작업 경로로 쓸 수 없으므로 자동으로 넣지 않는다
    const autoPick = only !== null && valueText === "" && !isBrowserRoot(only.path) ? only : null;
    // 지금 입력한 경로가 유일한 북마크 안이면 그 북마크를 고른 것으로 보여 준다
    const onlyMatch =
        only !== null &&
        valueText !== "" &&
        !isBrowserRoot(only.path) &&
        (valueText === only.path || browserParent(only, valueText) !== null)
            ? only
            : null;
    const selected = bookmarks.find((b) => b.id === bookmarkId) ?? onlyMatch ?? autoPick;
    const browseTarget = selected ?? bookmarks[0] ?? null;

    useEffect(() => {
        if (!autoPick || autoPicked.current) return;
        autoPicked.current = true;
        onPick(autoPick.path);
    }, [autoPick, onPick]);
    // 지금 값이 이 북마크의 기준 경로 안이면 그 폴더부터 연다
    const initialPath =
        browseTarget &&
        value !== undefined &&
        value.trim() !== "" &&
        (value === browseTarget.path || browserParent(browseTarget, value.trim()) !== null)
            ? value.trim()
            : null;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Change = (v: string) => {
        if (v && !isDriveLetterRemoteName(v)) onPick(`${v}:`);
    };
    const h_Bookmark = (idValue: string) => {
        setBookmarkId(idValue);
        const b = bookmarks.find((x) => x.id === idValue);
        if (b) onPick(b.path);
    };
    const h_OpenBrowser = () => setBrowserOpen(true);
    const h_CloseBrowser = () => setBrowserOpen(false);
    const h_PickBrowser = (path: string) => {
        onPick(path);
        setBrowserOpen(false);
    };

    let status: string | null = null;
    if (list.loading) status = "리모트 목록을 불러오는 중…";
    else if (list.error) status = `리모트 목록을 읽지 못했습니다: ${list.error}`;
    else if (list.remotes !== null && remotes.length === 0)
        status = "설정 파일에 리모트가 없습니다.";

    return (
        <div className={styles.RemotePicker}>
            {options.length > 0 && (
                <div className={styles.row}>
                    <label className={styles.label} htmlFor={id}>
                        리모트 빠른 입력
                    </label>
                    <ZBCSelect
                        id={id}
                        value=""
                        options={options}
                        placeholder="리모트 고르기"
                        onChange={h_Change}
                    />
                </div>
            )}
            {bookmarks.length > 0 && (
                <div className={styles.row}>
                    <label className={styles.label} htmlFor={`${id}-bookmark`}>
                        북마크
                    </label>
                    <ZBCSelect
                        id={`${id}-bookmark`}
                        value={selected?.id ?? ""}
                        options={bookmarkOptions}
                        placeholder="북마크 고르기"
                        onChange={h_Bookmark}
                    />
                    <ZBCButton
                        id={`${id}-browse`}
                        onClick={h_OpenBrowser}
                        disabled={browseTarget === null}
                    >
                        폴더 찾아보기
                    </ZBCButton>
                </div>
            )}
            {status && <p className={styles.status}>{status}</p>}
            {warning && <p className={styles.warning}>주의: {warning}</p>}
            {configPath !== null && bookmarks.length > 0 && (
                <p className={styles.status}>
                    이 작업은 다른 rclone.conf를 씁니다. 북마크는 기본 rclone.conf에서 확인했고,
                    폴더 탐색은 이 작업의 설정 파일로 합니다.
                </p>
            )}
            <RemoteBrowser
                open={browserOpen}
                bookmark={browseTarget}
                initialPath={initialPath}
                configPath={configPath}
                onClose={h_CloseBrowser}
                onPick={h_PickBrowser}
            />
        </div>
    );
}
