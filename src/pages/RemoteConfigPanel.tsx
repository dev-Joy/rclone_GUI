/**
 * 설정 화면의 rclone remote 관리 (INT-006 T-03~T-05).
 * 기본 rclone.conf의 remote를 나열하고 추가·수정·삭제·재인증·연결 테스트를 제공한다.
 * 추가·수정·삭제 뒤에는 rclone 환경을 다시 감지해 북마크 편집기·remote 고르기가 새 목록을 쓴다.
 * OAuth 진행 상태는 remoteConfig:authProgress 이벤트로 받아 모달에 보여 준다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { useEffect, useState } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import { errorText, getApi } from "@/lib/api";
import { isDriveLetterRemoteName } from "@/shared/remote-name";
import type { itfPathProbe } from "@/shared/ipc-contract";
import type { typApiResult } from "@/shared/schemas/common";
import type {
    typRemoteConfigCreateInput,
    typRemoteConfigUpdateInput,
} from "@/shared/schemas/remote-config";
import type { itfRemoteConfigView, itfRemoteUsage } from "@/shared/types/remote-config";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useRemoteConfigStore } from "@/stores/remote-config-store";
import { useToastStore } from "@/stores/toast-store";
import RemoteAuthModal from "./RemoteAuthModal";
import RemoteConfigEditor from "./RemoteConfigEditor";
import RemoteDeleteModal from "./RemoteDeleteModal";
import styles from "./RemoteConfigPanel.module.css";

export default function RemoteConfigPanel() {
    // ========== hook & state 변수 선언 ==========
    const env = useRcloneEnvStore((s) => s.env);
    const detect = useRcloneEnvStore((s) => s.detect);
    const providers = useRemoteConfigStore((s) => s.providers);
    const providersError = useRemoteConfigStore((s) => s.providersError);
    const providersLoading = useRemoteConfigStore((s) => s.providersLoading);
    const loadProviders = useRemoteConfigStore((s) => s.loadProviders);
    const auth = useRemoteConfigStore((s) => s.auth);
    const subscribe = useRemoteConfigStore((s) => s.subscribe);
    const clearAuth = useRemoteConfigStore((s) => s.clearAuth);
    const cancelAuth = useRemoteConfigStore((s) => s.cancelAuth);
    const answer = useRemoteConfigStore((s) => s.answer);
    const pushToast = useToastStore((s) => s.push);

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
    const [editorInitial, setEditorInitial] = useState<itfRemoteConfigView | null>(null);
    const [editorLoading, setEditorLoading] = useState(false);
    const [deleteName, setDeleteName] = useState<string | null>(null);
    const [deleteUsage, setDeleteUsage] = useState<itfRemoteUsage | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [testingName, setTestingName] = useState<string | null>(null);
    const [tests, setTests] = useState<Record<string, typApiResult<itfPathProbe>>>({});

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        if (env === null) void detect();
    }, [env, detect]);
    useEffect(() => {
        if (env !== null && env.problem === null) void loadProviders();
    }, [env, loadProviders]);
    useEffect(() => subscribe(), [subscribe]);

    // ========== 내부 변수 (_V) ==========
    const remotes = env?.remotes ?? [];
    const remoteTypes = env?.remoteTypes ?? {};
    const canManage = env !== null && env.problem === null && providers !== null;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const f_RefreshEnv = async () => {
        await detect(false);
    };

    const h_Add = () => {
        setEditorMode("create");
        setEditorInitial(null);
        setEditorLoading(false);
        setEditorOpen(true);
    };
    const h_Edit = async (name: string) => {
        setEditorMode("edit");
        setEditorInitial(null);
        setEditorLoading(true);
        setEditorOpen(true);
        const r = await useRemoteConfigStore.getState().get(name);
        setEditorLoading(false);
        if (r.ok) setEditorInitial(r.data);
        else {
            setEditorOpen(false);
            pushToast("error", r.error.message);
        }
    };
    const h_CloseEditor = () => setEditorOpen(false);

    const f_SubmitEditor = async (
        input: typRemoteConfigCreateInput | typRemoteConfigUpdateInput,
    ): Promise<typApiResult<unknown>> => {
        if ("type" in input) {
            const provider = providers?.find((p) => p.type === input.type);
            const r = await useRemoteConfigStore.getState().create(input, provider?.oauth ?? false);
            if (r.ok) {
                pushToast("success", `remote ‘${r.data.name}’을 추가했습니다.`);
                await f_RefreshEnv();
            }
            return r;
        }
        const r = await useRemoteConfigStore.getState().update(input);
        if (r.ok) {
            pushToast(
                "success",
                r.data.reauthSuggested
                    ? "리모트 설정을 저장했습니다. client_id·client_secret을 바꿨으니 재인증하세요."
                    : "리모트 설정을 저장했습니다.",
            );
            await f_RefreshEnv();
        }
        return r;
    };

    const h_Reconnect = async (name: string) => {
        const r = await useRemoteConfigStore.getState().reconnect(name);
        if (!r.ok) pushToast("error", r.error.message);
    };

    const h_AskDelete = async (name: string) => {
        setDeleteName(name);
        setDeleteUsage(null);
        const r = await useRemoteConfigStore.getState().usage(name);
        if (r.ok) setDeleteUsage(r.data);
        else {
            setDeleteName(null);
            pushToast("error", r.error.message);
        }
    };
    const h_CloseDelete = () => {
        if (!deleting) {
            setDeleteName(null);
            setDeleteUsage(null);
        }
    };
    const f_Delete = async (disableSchedules: boolean) => {
        if (!deleteName) return;
        setDeleting(true);
        const r = await useRemoteConfigStore.getState().remove({
            name: deleteName,
            disableSchedules,
        });
        setDeleting(false);
        if (!r.ok) {
            pushToast("error", r.error.message);
            return;
        }
        const off = r.data.disabledJobIds.length;
        pushToast(
            "success",
            off > 0
                ? `remote ‘${r.data.name}’ 삭제, 작업 ${off}개의 자동 실행을 껐습니다.`
                : `remote ‘${r.data.name}’을 삭제했습니다.`,
        );
        setDeleteName(null);
        setDeleteUsage(null);
        setTests((t) => {
            const next = { ...t };
            delete next[deleteName];
            return next;
        });
        await f_RefreshEnv();
    };

    const f_Test = async (name: string) => {
        setTestingName(name);
        try {
            const r = await getApi().rclone.testPath(`${name}:`);
            setTests((t) => ({ ...t, [name]: r }));
        } catch (e) {
            setTests((t) => ({
                ...t,
                [name]: { ok: false, error: { code: "RCLONE_FAILED", message: errorText(e) } },
            }));
        }
        setTestingName(null);
    };
    const h_Test = (name: string) => () => void f_Test(name);

    const f_TestResult = (name: string) => {
        const r = tests[name];
        if (!r) return null;
        if (!r.ok) {
            return (
                <p className={styles.testError} role="alert">
                    {r.error.message}
                </p>
            );
        }
        const ok = r.data.exists && r.data.isDirectory;
        return (
            <div className={styles.testResult} data-state={ok ? "ok" : "error"}>
                <p>{r.data.message}</p>
            </div>
        );
    };

    const h_CloseAuth = () => {
        const phase = auth?.phase;
        clearAuth();
        if (phase === "done") {
            pushToast("success", "리모트 인증을 마쳤습니다.");
            void f_RefreshEnv();
        }
    };

    return (
        <section className={styles.RemoteConfigPanel} aria-labelledby="remote-config-title">
            <div className={styles.header}>
                <h2 id="remote-config-title" className={styles.title}>
                    rclone 리모트
                </h2>
                <ZBCButton
                    id="remote-config-add"
                    variant="primary"
                    onClick={h_Add}
                    disabled={!canManage}
                    title={
                        canManage
                            ? undefined
                            : (env?.problem?.message ?? "rclone 설정을 먼저 확인하세요.")
                    }
                >
                    리모트 추가
                </ZBCButton>
            </div>
            <p className={styles.hint}>
                rclone.conf에 있는 리모트를 앱에서 추가·수정·삭제·재인증합니다. 비밀 값은 rclone에만
                넘기고 앱은 저장하지 않습니다.
            </p>
            {env?.problem && (
                <p className={styles.error} role="alert">
                    {env.problem.message}
                </p>
            )}
            {providersError && (
                <p className={styles.error} role="alert">
                    {providersError}
                </p>
            )}
            {providersLoading && <p className={styles.muted}>리모트 종류를 불러오는 중…</p>}
            {!providersLoading && env !== null && remotes.length === 0 && (
                <p className={styles.muted}>아직 rclone.conf에 리모트가 없습니다.</p>
            )}
            {remotes.length > 0 && (
                <ul className={styles.list}>
                    {remotes.map((name) => {
                        const provider = providers?.find((p) => p.type === remoteTypes[name]);
                        const oneLetter = isDriveLetterRemoteName(name);
                        return (
                            <li key={name} className={styles.item}>
                                <div className={styles.row}>
                                    <div className={styles.info}>
                                        <p className={styles.name}>
                                            {name}:
                                            {oneLetter && (
                                                <ZBCBadge tone="warning">사용 불가</ZBCBadge>
                                            )}
                                        </p>
                                        <ZBCBadge tone="neutral">
                                            {remoteTypes[name] ?? "종류 미확인"}
                                        </ZBCBadge>
                                    </div>
                                    <div className={styles.actions}>
                                        <ZBCButton
                                            onClick={h_Test(name)}
                                            disabled={testingName !== null || oneLetter}
                                            aria-label={`${name} 연결 테스트`}
                                        >
                                            {testingName === name ? "확인 중…" : "연결 테스트"}
                                        </ZBCButton>
                                        <ZBCButton
                                            onClick={() => void h_Edit(name)}
                                            disabled={oneLetter}
                                            aria-label={`${name} 수정`}
                                        >
                                            수정
                                        </ZBCButton>
                                        {provider?.oauth && (
                                            <ZBCButton
                                                onClick={() => void h_Reconnect(name)}
                                                aria-label={`${name} 재인증`}
                                            >
                                                재인증
                                            </ZBCButton>
                                        )}
                                        <ZBCButton
                                            variant="danger"
                                            onClick={() => void h_AskDelete(name)}
                                            aria-label={`${name} 삭제`}
                                        >
                                            삭제
                                        </ZBCButton>
                                    </div>
                                </div>
                                {oneLetter && (
                                    <p className={styles.warning}>
                                        영문 한 글자 이름은 Windows에서 드라이브 문자로 해석되어
                                        앱에서 쓸 수 없습니다. 삭제만 할 수 있습니다.
                                    </p>
                                )}
                                {f_TestResult(name)}
                            </li>
                        );
                    })}
                </ul>
            )}
            <RemoteConfigEditor
                open={editorOpen}
                mode={editorMode}
                providers={providers ?? []}
                initial={editorInitial}
                existingNames={remotes}
                loading={editorLoading}
                onClose={h_CloseEditor}
                onSubmit={f_SubmitEditor}
            />
            <RemoteDeleteModal
                open={deleteName !== null}
                name={deleteName ?? ""}
                usage={deleteUsage}
                busy={deleting}
                onClose={h_CloseDelete}
                onConfirm={(disableSchedules) => void f_Delete(disableSchedules)}
            />
            <RemoteAuthModal
                auth={auth}
                onClose={h_CloseAuth}
                onCancel={() => void cancelAuth()}
                onAnswer={(state, result) => void answer(state, result)}
            />
        </section>
    );
}
