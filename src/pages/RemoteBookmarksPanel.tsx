/**
 * 설정 화면의 remote 북마크 관리 (INT-002 T-02).
 * 북마크 목록을 보여 주고 추가·수정·삭제·연결 테스트를 제공한다.
 * 연결 테스트는 저장된 기준 경로에 lsjson --max-depth 1만 실행하며 파일은 바꾸지 않는다.
 *
 * @author dev-Joy 2026-10-30
 */

// ========== External imports ==========
import { useEffect, useState } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import type { itfPathProbe } from "@/shared/ipc-contract";
import type { typApiResult } from "@/shared/schemas/common";
import type { typRemoteCreateInput, typRemoteUpdateInput } from "@/shared/schemas/remotes";
import type { itfRemoteBookmark } from "@/shared/types/remotes";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useRemotesStore } from "@/stores/remotes-store";
import { useToastStore } from "@/stores/toast-store";
import RemoteBookmarkEditor from "./RemoteBookmarkEditor";
import styles from "./RemoteBookmarksPanel.module.css";

export default function RemoteBookmarksPanel() {
    // ========== hook & state 변수 선언 ==========
    const items = useRemotesStore((s) => s.items);
    const loaded = useRemotesStore((s) => s.loaded);
    const loading = useRemotesStore((s) => s.loading);
    const loadError = useRemotesStore((s) => s.error);
    const load = useRemotesStore((s) => s.load);
    const create = useRemotesStore((s) => s.create);
    const update = useRemotesStore((s) => s.update);
    const remove = useRemotesStore((s) => s.remove);
    const test = useRemotesStore((s) => s.test);
    const env = useRcloneEnvStore((s) => s.env);
    const detect = useRcloneEnvStore((s) => s.detect);
    const pushToast = useToastStore((s) => s.push);

    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<itfRemoteBookmark | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<itfRemoteBookmark | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [tests, setTests] = useState<Record<string, typApiResult<itfPathProbe>>>({});

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        void load();
    }, [load]);
    useEffect(() => {
        if (env === null) void detect();
    }, [env, detect]);

    // ========== 내부 변수 (_V) ==========
    const remotes = env?.remotes ?? [];
    const remoteTypes = env?.remoteTypes ?? {};
    const canAdd = env === null || env.problem === null;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Add = () => {
        setEditing(null);
        setEditorOpen(true);
    };
    const h_Edit = (b: itfRemoteBookmark) => {
        setEditing(b);
        setEditorOpen(true);
    };
    const h_CloseEditor = () => {
        setEditorOpen(false);
        setEditing(null);
    };
    const f_Submit = async (input: typRemoteCreateInput | typRemoteUpdateInput) => {
        const isUpdate = "id" in input;
        const r = isUpdate ? await update(input) : await create(input);
        if (r.ok) {
            const id = r.data.id;
            // 수정하면 지난 연결 테스트는 다른 경로의 결과다
            setTests((t) => {
                const next = { ...t };
                delete next[id];
                return next;
            });
            pushToast(
                "success",
                isUpdate ? "remote 북마크를 수정했습니다." : "remote 북마크를 추가했습니다.",
            );
        }
        return r;
    };

    const f_Test = async (b: itfRemoteBookmark) => {
        setTestingId(b.id);
        const r = await test({ id: b.id });
        setTestingId(null);
        setTests((t) => ({ ...t, [b.id]: r }));
    };
    const h_Test = (b: itfRemoteBookmark) => () => void f_Test(b);

    const h_AskDelete = (b: itfRemoteBookmark) => setDeleteTarget(b);
    const h_CloseDelete = () => {
        if (!deleting) setDeleteTarget(null);
    };
    const f_Delete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        const r = await remove({ id: deleteTarget.id });
        setDeleting(false);
        if (!r.ok) {
            pushToast("error", r.error.message);
            return;
        }
        setDeleteTarget(null);
        setTests((t) => {
            const next = { ...t };
            delete next[deleteTarget.id];
            return next;
        });
        pushToast("success", "remote 북마크를 지웠습니다.");
    };
    const h_Delete = () => void f_Delete();

    const f_TestResult = (b: itfRemoteBookmark) => {
        const r = tests[b.id];
        if (!r) return null;
        if (!r.ok) {
            return (
                <p className={styles.testError} role="alert">
                    {r.error.message}
                </p>
            );
        }
        const probe = r.data;
        const ok = probe.exists && probe.isDirectory;
        return (
            <div className={styles.testResult} data-state={ok ? "ok" : "error"}>
                <p className={styles.testMessage}>{probe.message}</p>
                <p className={styles.testPath}>{probe.normalizedPath}</p>
                {probe.readable === false && <p>읽기 권한이 없습니다.</p>}
                {probe.warnings.map((w) => (
                    <p key={w} className={styles.testWarning}>
                        주의: {w}
                    </p>
                ))}
            </div>
        );
    };

    return (
        <section className={styles.RemoteBookmarksPanel} aria-labelledby="remote-bookmarks-title">
            <div className={styles.header}>
                <h2 id="remote-bookmarks-title" className={styles.title}>
                    remote 북마크
                </h2>
                <ZBCButton
                    id="remote-bookmark-add"
                    variant="primary"
                    onClick={h_Add}
                    disabled={!canAdd}
                    title={canAdd ? undefined : "rclone 설정을 먼저 확인하세요."}
                >
                    remote 북마크 추가
                </ZBCButton>
            </div>
            <p className={styles.hint}>
                rclone.conf의 remote와 그 안의 폴더를 별칭으로 저장합니다. 작업 편집기의 경로
                입력에서 북마크를 고르거나 폴더를 찾아볼 수 있습니다. 북마크는 기본 rclone.conf에서
                remote 이름을 확인합니다.
            </p>
            {loadError && (
                <p className={styles.error} role="alert">
                    remote 북마크를 불러오지 못했습니다: {loadError}
                </p>
            )}
            {!loaded && loading && <p className={styles.hint}>remote 북마크를 불러오는 중…</p>}
            {loaded && items.length === 0 && (
                <p className={styles.hint}>아직 저장한 remote 북마크가 없습니다.</p>
            )}
            {items.length > 0 && (
                <ul className={styles.list}>
                    {items.map((b) => {
                        const type = remoteTypes[b.remoteName];
                        return (
                            <li key={b.id} className={styles.item}>
                                <div className={styles.row}>
                                    <div className={styles.info}>
                                        <p className={styles.alias}>{b.alias}</p>
                                        <code className={styles.path} title={b.path}>
                                            {b.path}
                                        </code>
                                    </div>
                                    <ZBCBadge tone="neutral">
                                        {type === undefined ? "종류 미확인" : type}
                                    </ZBCBadge>
                                    <div className={styles.actions}>
                                        <ZBCButton
                                            onClick={h_Test(b)}
                                            disabled={testingId !== null}
                                            aria-label={`${b.alias} 연결 테스트`}
                                        >
                                            {testingId === b.id ? "확인 중…" : "연결 테스트"}
                                        </ZBCButton>
                                        <ZBCButton
                                            onClick={() => h_Edit(b)}
                                            aria-label={`${b.alias} 수정`}
                                        >
                                            수정
                                        </ZBCButton>
                                        <ZBCButton
                                            variant="danger"
                                            onClick={() => h_AskDelete(b)}
                                            aria-label={`${b.alias} 삭제`}
                                        >
                                            삭제
                                        </ZBCButton>
                                    </div>
                                </div>
                                {f_TestResult(b)}
                            </li>
                        );
                    })}
                </ul>
            )}
            <RemoteBookmarkEditor
                open={editorOpen}
                bookmark={editing}
                remotes={remotes}
                remoteTypes={remoteTypes}
                onClose={h_CloseEditor}
                onSubmit={f_Submit}
            />
            <ZBCModal
                open={deleteTarget !== null}
                title="remote 북마크 삭제"
                onClose={h_CloseDelete}
                footer={
                    <>
                        <ZBCButton onClick={h_CloseDelete} disabled={deleting} initialFocus>
                            취소
                        </ZBCButton>
                        <ZBCButton variant="danger" onClick={h_Delete} disabled={deleting}>
                            {deleting ? "지우는 중…" : "북마크 지우기"}
                        </ZBCButton>
                    </>
                }
            >
                <p>
                    {deleteTarget
                        ? `‘${deleteTarget.alias}’ 북마크를 지웁니다. 작업에 이미 입력한 경로와 파일은 바뀌지 않습니다.`
                        : ""}
                </p>
            </ZBCModal>
        </section>
    );
}
