/**
 * remote 북마크 추가·수정 모달 (INT-002 T-02).
 * 별칭·remote·기준 경로를 받고, 저장 전에 IPC 스키마와 경로 정규화로 검사한다.
 * remote는 rclone listremotes 결과에서만 고르며 영문 한 글자 remote는 Windows 드라이브 문자와 겹쳐 막는다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== External imports ==========
import { useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import ZBCModal from "@/components/ZBCModal";
import ZBCSelect from "@/components/ZBCSelect";
import { isDriveLetterRemoteName } from "@/shared/remote-name";
import { normalizeRemoteBasePath } from "@/shared/remote-path";
import {
    zRemoteCreateInput,
    type typRemoteCreateInput,
    type typRemoteUpdateInput,
} from "@/shared/schemas/remotes";
import type { typApiResult } from "@/shared/schemas/common";
import type { itfRemoteBookmark } from "@/shared/types/remotes";
import styles from "./RemoteBookmarkEditor.module.css";

// ========== Props & Types ==========
export interface itfRemoteBookmarkEditorProps {
    open: boolean;
    /** null이면 새로 추가, 있으면 수정 */
    bookmark: itfRemoteBookmark | null;
    /** rclone.conf의 remote 이름 목록 */
    remotes: readonly string[];
    /** remote 이름 → 종류(local·crypt 등). 없으면 표시하지 않는다 */
    remoteTypes: Readonly<Record<string, string>>;
    onClose: () => void;
    /** 성공하면 화면이 목록을 다시 부른다. 실패 envelope는 그대로 돌려준다 */
    onSubmit: (
        input: typRemoteCreateInput | typRemoteUpdateInput,
    ) => Promise<typApiResult<itfRemoteBookmark>>;
}

interface itfFieldErrors {
    alias?: string;
    remote?: string;
    base?: string;
    general?: string;
}

export default function RemoteBookmarkEditor(props: itfRemoteBookmarkEditorProps) {
    if (!props.open) return null;
    // 열 때마다 새로 마운트해 이전 입력이 남지 않게 한다(수정 대상이 바뀌면 key도 바뀐다)
    return <RemoteBookmarkEditorBody key={props.bookmark?.id ?? "new"} {...props} />;
}

function RemoteBookmarkEditorBody(props: itfRemoteBookmarkEditorProps) {
    const { open, bookmark, remotes, remoteTypes, onClose, onSubmit } = props;

    // ========== hook & state 변수 선언 ==========
    const [alias, setAlias] = useState(bookmark?.alias ?? "");
    const [remote, setRemote] = useState(bookmark?.remoteName ?? "");
    const [base, setBase] = useState(bookmark?.basePath ?? "");
    const [errors, setErrors] = useState<itfFieldErrors>({});
    const [busy, setBusy] = useState(false);

    // ========== 내부 변수 (_V) ==========
    // rclone.conf에서 사라진 remote를 수정할 때도 현재 값을 보여 준다
    const names = remote !== "" && !remotes.includes(remote) ? [...remotes, remote] : [...remotes];
    const options = names.map((r) => {
        const type = remoteTypes[r];
        const label = type ? `${r}: · ${type}` : `${r}:`;
        return isDriveLetterRemoteName(r)
            ? { value: r, label: `${label} (사용 불가 — 드라이브 문자)`, disabled: true }
            : { value: r, label };
    });
    const title = bookmark ? "remote 북마크 수정" : "remote 북마크 추가";

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Alias = (v: string) => {
        setAlias(v);
        setErrors((e) => ({ ...e, alias: undefined, general: undefined }));
    };
    const h_Remote = (v: string) => {
        setRemote(v);
        setErrors((e) => ({ ...e, remote: undefined, base: undefined, general: undefined }));
    };
    const h_Base = (v: string) => {
        setBase(v);
        setErrors((e) => ({ ...e, base: undefined, general: undefined }));
    };

    const f_Save = async () => {
        const next: itfFieldErrors = {};
        const parsed = zRemoteCreateInput.safeParse({
            alias,
            remoteName: remote,
            basePath: base,
        });
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                const field = issue.path[0];
                if (field === "alias" && !next.alias) next.alias = issue.message;
                else if (field === "remoteName" && !next.remote) next.remote = issue.message;
                else if (field === "basePath" && !next.base) next.base = issue.message;
            }
        }
        if (remote === "") next.remote = "remote를 고르세요.";
        else if (isDriveLetterRemoteName(remote)) {
            next.remote =
                "영문 한 글자 remote는 Windows에서 드라이브 문자로 해석되어 쓸 수 없습니다.";
        }

        let input: typRemoteCreateInput | null = null;
        if (parsed.success) {
            const normalized = normalizeRemoteBasePath(
                parsed.data.remoteName,
                parsed.data.basePath,
            );
            if (!normalized.ok) next.base = normalized.message;
            else {
                input = {
                    alias: parsed.data.alias,
                    remoteName: parsed.data.remoteName,
                    basePath: normalized.basePath,
                };
            }
        }
        if (/[\\/]/.test(remote)) next.remote = "remote 이름에는 경로를 넣을 수 없습니다.";

        setErrors(next);
        if (!input || next.alias || next.remote || next.base) return;

        setBusy(true);
        const r = await onSubmit(bookmark ? { id: bookmark.id, ...input } : input);
        setBusy(false);
        if (r.ok) {
            onClose();
            return;
        }
        setErrors({ general: r.error.message });
    };
    const h_Save = () => void f_Save();
    const h_Close = () => {
        if (!busy) onClose();
    };

    return (
        <ZBCModal
            open={open}
            title={title}
            onClose={h_Close}
            footer={
                <>
                    <ZBCButton onClick={h_Close} disabled={busy}>
                        취소
                    </ZBCButton>
                    <ZBCButton
                        variant="primary"
                        id="remote-bookmark-save"
                        onClick={h_Save}
                        disabled={busy}
                        initialFocus
                    >
                        {busy ? "저장 중…" : bookmark ? "수정 저장" : "북마크 추가"}
                    </ZBCButton>
                </>
            }
        >
            <div className={styles.RemoteBookmarkEditor}>
                {errors.general && (
                    <p className={styles.error} role="alert">
                        {errors.general}
                    </p>
                )}
                <ZBCField
                    label="별칭"
                    htmlFor="remote-bookmark-alias"
                    error={errors.alias}
                    required
                >
                    <ZBCInput
                        id="remote-bookmark-alias"
                        name="remoteBookmarkAlias"
                        value={alias}
                        onChange={h_Alias}
                        placeholder="예: 작업용 사진"
                        invalid={Boolean(errors.alias)}
                        describedBy="remote-bookmark-alias-desc"
                    />
                </ZBCField>
                <ZBCField
                    label="remote"
                    htmlFor="remote-bookmark-remote"
                    error={errors.remote}
                    hint="rclone.conf에 있는 remote만 고를 수 있습니다."
                    required
                >
                    <ZBCSelect
                        id="remote-bookmark-remote"
                        name="remoteBookmarkRemote"
                        value={remote}
                        options={options}
                        placeholder="remote 고르기"
                        onChange={h_Remote}
                        disabled={busy}
                        describedBy="remote-bookmark-remote-desc"
                    />
                </ZBCField>
                <ZBCField
                    label="기준 경로"
                    htmlFor="remote-bookmark-base"
                    error={errors.base}
                    hint="remote 안의 폴더입니다. 비워 두면 remote 루트부터 탐색합니다. 선두 / 는 그대로 둡니다."
                >
                    <ZBCInput
                        id="remote-bookmark-base"
                        name="remoteBookmarkBase"
                        value={base}
                        onChange={h_Base}
                        placeholder="예: base/a (없으면 remote 루트)"
                        invalid={Boolean(errors.base)}
                        describedBy="remote-bookmark-base-desc"
                        mono
                        disabled={busy}
                    />
                </ZBCField>
                <p className={styles.note}>
                    북마크는 기본 rclone.conf에서 remote 이름을 확인합니다. 작업에 다른 설정 파일을
                    지정해도 북마크 목록은 그대로 보입니다.
                </p>
            </div>
        </ZBCModal>
    );
}
