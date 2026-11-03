/**
 * providers 정의로 만드는 remote 옵션 입력 폼 (INT-006 T-02, FR-3).
 * - 선택지(Exclusive)는 고르기, 불리언은 체크, 비밀은 가림 입력, 나머지는 글자 입력.
 * - 고급 옵션은 접어 둔다. 필수 칸이 비면 저장 전에 부모가 막는다.
 * - 수정 화면에서 값이 있는 비밀 칸은 "설정됨 — 바꿀 때만 입력"으로 비워 둔다(FR-17).
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import ZBCCheckbox from "@/components/ZBCCheckbox";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import ZBCSelect from "@/components/ZBCSelect";
import type { itfRemoteOption, itfRemoteProvider } from "@/shared/types/remote-config";
import styles from "./RemoteConfigForm.module.css";

export interface itfRemoteConfigFormProps {
    provider: itfRemoteProvider;
    values: Record<string, string>;
    secrets: Record<string, string>;
    /** 값이 있는 비밀 옵션 이름(수정 화면) */
    secretsSet: readonly string[];
    errors: Readonly<Record<string, string>>;
    disabled?: boolean;
    onChangeValue: (name: string, value: string) => void;
    onChangeSecret: (name: string, value: string) => void;
}

export default function RemoteConfigForm(props: itfRemoteConfigFormProps) {
    const {
        provider,
        values,
        secrets,
        secretsSet,
        errors,
        disabled = false,
        onChangeValue,
        onChangeSecret,
    } = props;

    // ========== 내부 변수 (_V) ==========
    const basic = provider.options.filter((o) => !o.advanced);
    const advanced = provider.options.filter((o) => o.advanced);

    const f_Field = (o: itfRemoteOption) => {
        const id = `remote-option-${o.name}`;
        const error = errors[o.name] ?? null;
        const hint = o.help.split("\n")[0] ?? "";
        const secret = o.secret;
        const value = secret ? (secrets[o.name] ?? "") : (values[o.name] ?? "");
        const placeholder = secret
            ? secretsSet.includes(o.name)
                ? "설정됨 — 바꿀 때만 입력"
                : o.required
                  ? "값을 입력하세요"
                  : "바꿀 때만 입력"
            : o.defaultText !== ""
              ? `기본값: ${o.defaultText}`
              : o.required
                ? "값을 입력하세요"
                : "";
        const onChange = (v: string) => {
            if (secret) onChangeSecret(o.name, v);
            else onChangeValue(o.name, v);
        };

        if (o.kind === "bool") {
            return (
                <ZBCCheckbox
                    key={o.name}
                    id={id}
                    name={o.name}
                    checked={value === "true"}
                    onChange={(v) => onChange(v ? "true" : "false")}
                    label={o.name}
                    description={hint}
                    disabled={disabled}
                />
            );
        }
        if (o.kind === "enum") {
            const options = o.choices.map((c) => ({
                value: c.value,
                label: c.help === "" ? c.value : `${c.value} — ${c.help}`,
            }));
            return (
                <ZBCField
                    key={o.name}
                    label={o.name}
                    htmlFor={id}
                    hint={hint}
                    error={error}
                    required={o.required}
                >
                    <ZBCSelect
                        id={id}
                        name={o.name}
                        value={value}
                        options={options}
                        placeholder={o.defaultText !== "" ? `기본값: ${o.defaultText}` : "고르세요"}
                        onChange={onChange}
                        disabled={disabled}
                        describedBy={`${id}-desc`}
                    />
                </ZBCField>
            );
        }
        return (
            <ZBCField
                key={o.name}
                label={o.name}
                htmlFor={id}
                hint={hint}
                error={error}
                required={o.required}
            >
                <ZBCInput
                    id={id}
                    name={o.name}
                    type={secret ? "password" : "text"}
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    invalid={Boolean(error)}
                    disabled={disabled}
                    describedBy={`${id}-desc`}
                    mono={o.kind === "duration" || o.kind === "size"}
                />
            </ZBCField>
        );
    };

    if (provider.options.length === 0) {
        return <p className={styles.empty}>이 종류는 입력할 값이 없습니다.</p>;
    }

    return (
        <div className={styles.RemoteConfigForm}>
            {basic.map(f_Field)}
            {advanced.length > 0 && (
                <details className={styles.advanced}>
                    <summary className={styles.summary}>고급 옵션 {advanced.length}개</summary>
                    <div className={styles.advancedBody}>{advanced.map(f_Field)}</div>
                </details>
            )}
        </div>
    );
}
