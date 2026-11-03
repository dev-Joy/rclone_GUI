/**
 * remote 설정 추가·수정 모달 (INT-006 T-03·T-05).
 * 추가는 종류 고르기(검색·OAuth 표시) → 동적 폼, 수정은 이름 읽기 전용 + 비밀 아닌 값 채우기 + 바뀐 칸만 저장.
 * 이름 규칙(FR-5)과 필수 칸은 저장 전에 화면에서 먼저 막고, main이 한 번 더 검사한다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { useState } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import ZBCModal from "@/components/ZBCModal";
import { validateNewRemoteName } from "@/shared/remote-name";
import type { typApiResult } from "@/shared/schemas/common";
import type {
    typRemoteConfigCreateInput,
    typRemoteConfigUpdateInput,
} from "@/shared/schemas/remote-config";
import type { itfRemoteConfigView, itfRemoteProvider } from "@/shared/types/remote-config";
import RemoteConfigForm from "./RemoteConfigForm";
import styles from "./RemoteConfigEditor.module.css";

export interface itfRemoteConfigEditorProps {
    open: boolean;
    mode: "create" | "edit";
    providers: readonly itfRemoteProvider[];
    /** 수정 대상(불러온 값). create면 null */
    initial: itfRemoteConfigView | null;
    existingNames: readonly string[];
    loading: boolean;
    onClose: () => void;
    onSubmit: (
        input: typRemoteConfigCreateInput | typRemoteConfigUpdateInput,
    ) => Promise<typApiResult<unknown>>;
}

export default function RemoteConfigEditor(props: itfRemoteConfigEditorProps) {
    if (!props.open) return null;
    // 열 때마다 새로 마운트해 이전 입력이 남지 않게 한다
    return <RemoteConfigEditorBody key={props.initial?.name ?? "new"} {...props} />;
}

function f_Defaults(provider: itfRemoteProvider): Record<string, string> {
    const out: Record<string, string> = {};
    for (const o of provider.options) {
        if (o.secret || o.defaultText === "") continue;
        out[o.name] = o.defaultText;
    }
    return out;
}

function RemoteConfigEditorBody(props: itfRemoteConfigEditorProps) {
    const { open, mode, providers, initial, existingNames, loading, onClose, onSubmit } = props;

    // ========== hook & state 변수 선언 ==========
    const [name, setName] = useState(initial?.name ?? "");
    const [type, setType] = useState(initial?.type ?? "");
    const [values, setValues] = useState<Record<string, string>>(
        initial ? { ...initial.values } : {},
    );
    const [secrets, setSecrets] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [general, setGeneral] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState("");

    // ========== 내부 변수 (_V) ==========
    const provider = providers.find((p) => p.type === type) ?? null;
    const secretsSet = initial?.secretsSet ?? [];
    const filtered = providers.filter((p) => {
        const q = search.trim().toLowerCase();
        if (q === "") return true;
        return p.type.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    });

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Close = () => {
        if (!busy) onClose();
    };
    const h_ChooseProvider = (p: itfRemoteProvider) => {
        setType(p.type);
        setValues(f_Defaults(p));
        setSecrets({});
        setErrors({});
        setGeneral(null);
    };
    const h_ChangeType = () => {
        setType("");
        setValues({});
        setSecrets({});
        setErrors({});
        setGeneral(null);
    };
    const h_Value = (key: string, value: string) => {
        setValues((v) => ({ ...v, [key]: value }));
        setErrors((e) => {
            const next = { ...e };
            delete next[key];
            return next;
        });
    };
    const h_Secret = (key: string, value: string) => {
        setSecrets((v) => ({ ...v, [key]: value }));
        setErrors((e) => {
            const next = { ...e };
            delete next[key];
            return next;
        });
    };

    const f_Validate = (): Record<string, string> => {
        const next: Record<string, string> = {};
        if (mode === "create") {
            const issue = validateNewRemoteName(name, existingNames);
            if (issue) next["@name"] = issue;
        }
        if (!provider) {
            next["@type"] = "리모트 종류를 고르세요.";
            return next;
        }
        for (const o of provider.options) {
            if (!o.required || o.defaultText !== "") continue;
            const value = o.secret ? (secrets[o.name] ?? "") : (values[o.name] ?? "");
            if (value !== "") continue;
            if (o.secret && secretsSet.includes(o.name)) continue;
            next[o.name] = "필수 값입니다.";
        }
        return next;
    };

    const f_Save = async () => {
        const next = f_Validate();
        setErrors(next);
        setGeneral(null);
        if (Object.keys(next).length > 0 || !provider) return;

        let input: typRemoteConfigCreateInput | typRemoteConfigUpdateInput;
        if (mode === "create") {
            const sendValues: Record<string, string> = {};
            const sendSecrets: Record<string, string> = {};
            for (const [k, v] of Object.entries(values)) if (v !== "") sendValues[k] = v;
            for (const [k, v] of Object.entries(secrets)) if (v !== "") sendSecrets[k] = v;
            input = { name, type: provider.type, values: sendValues, secrets: sendSecrets };
        } else {
            const changedValues: Record<string, string> = {};
            const changedSecrets: Record<string, string> = {};
            for (const [k, v] of Object.entries(values)) {
                if (v !== (initial?.values[k] ?? "")) changedValues[k] = v;
            }
            for (const [k, v] of Object.entries(secrets)) if (v !== "") changedSecrets[k] = v;
            if (
                Object.keys(changedValues).length === 0 &&
                Object.keys(changedSecrets).length === 0
            ) {
                setGeneral("바꾼 값이 없습니다.");
                return;
            }
            input = { name: initial?.name ?? name, values: changedValues, secrets: changedSecrets };
        }

        setBusy(true);
        const r = await onSubmit(input);
        setBusy(false);
        if (r.ok) {
            onClose();
            return;
        }
        setGeneral(r.error.message);
    };
    const h_Save = () => void f_Save();

    const title = mode === "create" ? "리모트 추가" : "리모트 수정";

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
                        id="remote-config-save"
                        onClick={h_Save}
                        disabled={busy || loading || provider === null}
                        initialFocus={provider === null}
                    >
                        {busy ? "저장 중…" : mode === "create" ? "리모트 추가" : "수정 저장"}
                    </ZBCButton>
                </>
            }
        >
            <div className={styles.RemoteConfigEditor}>
                {general && (
                    <p className={styles.error} role="alert">
                        {general}
                    </p>
                )}
                {loading ? (
                    <p className={styles.muted}>리모트 설정을 불러오는 중…</p>
                ) : (
                    <>
                        {mode === "create" && provider === null && (
                            <div className={styles.picker}>
                                <ZBCField
                                    label="리모트 종류"
                                    htmlFor="remote-config-search"
                                    error={errors["@type"]}
                                    hint="rclone이 지원하는 모든 종류입니다. OAuth 표시가 있는 종류는 브라우저 로그인이 필요합니다."
                                    required
                                >
                                    <ZBCInput
                                        id="remote-config-search"
                                        name="remoteConfigSearch"
                                        value={search}
                                        onChange={setSearch}
                                        placeholder="종류 이름·설명 검색 (예: drive, sftp)"
                                        describedBy="remote-config-search-desc"
                                    />
                                </ZBCField>
                                <ul className={styles.providerList}>
                                    {filtered.map((p) => (
                                        <li key={p.type}>
                                            <button
                                                type="button"
                                                className={styles.providerItem}
                                                onClick={() => h_ChooseProvider(p)}
                                            >
                                                <span className={styles.providerType}>
                                                    {p.type}
                                                </span>
                                                <span className={styles.providerDesc}>
                                                    {p.description}
                                                </span>
                                                {p.oauth && (
                                                    <ZBCBadge tone="accent">OAuth</ZBCBadge>
                                                )}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                                {filtered.length === 0 && (
                                    <p className={styles.muted}>검색과 맞는 종류가 없습니다.</p>
                                )}
                            </div>
                        )}

                        {mode === "create" && provider !== null && (
                            <div className={styles.selectedProvider}>
                                <p>
                                    <strong>{provider.type}</strong> · {provider.description}
                                    {provider.oauth && <ZBCBadge tone="accent">OAuth</ZBCBadge>}
                                </p>
                                <ZBCButton onClick={h_ChangeType} disabled={busy}>
                                    종류 바꾸기
                                </ZBCButton>
                            </div>
                        )}

                        {(mode === "edit" || provider !== null) && (
                            <>
                                {mode === "create" ? (
                                    <ZBCField
                                        label="이름"
                                        htmlFor="remote-config-name"
                                        error={errors["@name"]}
                                        hint="두 글자 이상, 공백·-로 시작·끝 금지. 기존 이름과 대소문자만 다른 이름도 쓸 수 없습니다."
                                        required
                                    >
                                        <ZBCInput
                                            id="remote-config-name"
                                            name="remoteConfigName"
                                            value={name}
                                            onChange={(v) => {
                                                setName(v);
                                                setErrors((e) => {
                                                    const next = { ...e };
                                                    delete next["@name"];
                                                    return next;
                                                });
                                            }}
                                            placeholder="예: gdrive"
                                            invalid={Boolean(errors["@name"])}
                                            disabled={busy}
                                            describedBy="remote-config-name-desc"
                                        />
                                    </ZBCField>
                                ) : (
                                    <p className={styles.nameReadonly}>
                                        이름 <code>{initial?.name}</code>{" "}
                                        <span className={styles.muted}>
                                            (이름은 바꿀 수 없습니다. 새 이름으로 추가한 뒤 기존
                                            리모트를 지우세요.)
                                        </span>
                                    </p>
                                )}
                                {initial?.redactedUnavailable && (
                                    <output className={styles.warning}>
                                        이 rclone 버전에서는 기존 값을 읽지 못했습니다. 바꿀 칸만
                                        입력하세요.
                                    </output>
                                )}
                                {provider && (
                                    <RemoteConfigForm
                                        provider={provider}
                                        values={values}
                                        secrets={secrets}
                                        secretsSet={secretsSet}
                                        errors={errors}
                                        disabled={busy}
                                        onChangeValue={h_Value}
                                        onChangeSecret={h_Secret}
                                    />
                                )}
                                {provider?.oauth && mode === "edit" && (
                                    <p className={styles.note}>
                                        client_id·client_secret을 바꾸면 저장한 뒤 재인증이
                                        필요합니다.
                                    </p>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
        </ZBCModal>
    );
}
