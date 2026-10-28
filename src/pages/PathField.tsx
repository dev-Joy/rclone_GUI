/**
 * 원본·대상 경로 입력란. 텍스트 입력 + 종류 배지 + 폴더 선택 + WSL 도우미 + remote 빠른 입력 + 접근 확인.
 * 접근 확인은 버튼을 눌렀을 때만 main의 rclone:testPath를 부른다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useState } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import { errorText, getApi, unwrap } from "@/lib/api";
import { pathKindBadge } from "@/lib/path-display";
import { usePathProbe } from "@/lib/use-path-probe";
import { parsePath } from "@/shared/path-utils";
import { useToastStore } from "@/stores/toast-store";
import RemotePicker from "./RemotePicker";
import WslPathHelper from "./WslPathHelper";
import styles from "./PathField.module.css";

// ========== Props & Types ==========
export interface itfPathFieldProps {
    /** "job-source" | "job-destination" */
    id: string;
    name: "source" | "destination";
    /** "원본" | "대상" */
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** 이 작업의 rclone.conf (null = 기본) */
    configPath: string | null;
    error?: string | null;
    warnings?: readonly string[];
}

const propsDefault = {
    error: null,
    warnings: [],
} satisfies Partial<itfPathFieldProps>;

const PLACEHOLDER = "예: D:\\Data, \\\\wsl.localhost\\배포판\\home\\..., remote:폴더";

export default function PathField(props: itfPathFieldProps) {
    const {
        id,
        name,
        label,
        value,
        onChange,
        configPath,
        error = propsDefault.error,
        warnings = propsDefault.warnings,
    } = props;

    // ========== hook & state 변수 선언 ==========
    const [wslOpen, setWslOpen] = useState(false);
    const { probe, error: probeError, checking, check, isFor } = usePathProbe();
    const pushToast = useToastStore((s) => s.push);

    // ========== 내부 변수 (_V) ==========
    // 값이나 설정 파일이 바뀌면(입력·되돌리기·다른 작업 열기) 지난 확인 결과는 숨긴다
    const fresh = isFor(value, configPath);
    const badge = pathKindBadge(value);
    const badgeTone =
        badge?.kind === null ? "danger" : badge?.kind === "remote" ? "accent" : "neutral";
    const parsed = parsePath(value);
    // remote를 고른 직후("name:")에는 루트라 저장할 수 없다 → 폴더를 이어 쓰라고 안내
    const hint =
        parsed.ok && parsed.path.kind === "remote" && parsed.path.segments.length === 0
            ? `remote 루트 전체는 쓸 수 없습니다. 뒤에 폴더를 이어 쓰세요 (예: ${parsed.path.root}폴더).`
            : undefined;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_PickDir = async () => {
        const defaultPath =
            parsed.ok && parsed.path.kind !== "remote" ? parsed.path.normalized : undefined;
        try {
            const picked = await unwrap(
                getApi().dialog.pickDirectory({
                    title: `${label} 폴더 고르기`,
                    ...(defaultPath ? { defaultPath } : {}),
                }),
            );
            if (picked) onChange(picked);
        } catch (e) {
            pushToast("error", errorText(e));
        }
    };
    const h_PickDirClick = () => void h_PickDir();
    const h_Check = () => void check(value, configPath);
    const h_OpenWsl = () => setWslOpen(true);
    const h_CloseWsl = () => setWslOpen(false);
    const h_ApplyWsl = (path: string) => {
        onChange(path);
        setWslOpen(false);
    };

    return (
        <div className={styles.PathField}>
            <ZBCField
                label={label}
                htmlFor={id}
                error={error}
                warnings={warnings}
                hint={hint}
                required
            >
                <div className={styles.row}>
                    <div className={styles.input}>
                        <ZBCInput
                            id={id}
                            name={name}
                            value={value}
                            onChange={onChange}
                            placeholder={PLACEHOLDER}
                            invalid={Boolean(error)}
                            describedBy={`${id}-desc`}
                            mono
                        />
                    </div>
                    {badge && <ZBCBadge tone={badgeTone}>{badge.text}</ZBCBadge>}
                </div>
            </ZBCField>
            <div className={styles.actions}>
                <ZBCButton onClick={h_PickDirClick} aria-label={`${label} 폴더 선택`}>
                    폴더 선택
                </ZBCButton>
                <ZBCButton onClick={h_OpenWsl} aria-label={`${label} WSL 도우미`}>
                    WSL 도우미
                </ZBCButton>
                <ZBCButton
                    onClick={h_Check}
                    disabled={checking || value.trim() === ""}
                    aria-label={`${label} 접근 확인`}
                >
                    {checking ? "확인 중…" : "접근 확인"}
                </ZBCButton>
            </div>
            <RemotePicker id={`${id}-remote`} configPath={configPath} onPick={onChange} />
            {fresh && probeError && (
                <p className={styles.result} data-state="error" role="alert">
                    {probeError}
                </p>
            )}
            {fresh && probe && (
                <div
                    className={styles.result}
                    data-state={probe.exists && probe.isDirectory ? "ok" : "error"}
                >
                    <p className={styles.message}>{probe.message}</p>
                    <p className={styles.mono}>{probe.normalizedPath}</p>
                    {probe.readable === false && <p>읽기 권한이 없습니다.</p>}
                    {probe.warnings.map((w) => (
                        <p key={w} className={styles.warning}>
                            주의: {w}
                        </p>
                    ))}
                </div>
            )}
            <WslPathHelper open={wslOpen} idPrefix={id} onApply={h_ApplyWsl} onClose={h_CloseWsl} />
        </div>
    );
}
