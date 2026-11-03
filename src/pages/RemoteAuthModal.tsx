/**
 * OAuth 대기·질문 모달 (INT-006 T-04, FR-9·FR-15a).
 * 대기 중에는 남은 시간·취소·인증 주소를, rclone이 질문을 돌려주면 질문 하나짜리 폼을 보여 준다.
 * Drive의 공용 client_id 질문에는 직접 만든 client_id 권장 안내를 붙인다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import { useEffect, useState } from "react";

// ========== Internal imports ==========
import ZBCCheckbox from "@/components/ZBCCheckbox";
import ZBCButton from "@/components/ZBCButton";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import ZBCModal from "@/components/ZBCModal";
import ZBCSelect from "@/components/ZBCSelect";
import { getApi } from "@/lib/api";
import type {
    itfRemoteAuthProgress,
    itfRemoteOption,
    itfRemoteQuestion,
} from "@/shared/types/remote-config";
import styles from "./RemoteAuthModal.module.css";

export interface itfRemoteAuthModalProps {
    /** null이면 닫힘 */
    auth: itfRemoteAuthProgress | null;
    onClose: () => void;
    onCancel: () => void;
    onAnswer: (state: string, result: string) => void;
}

function f_Remaining(expiresAt: string | undefined, now: number): string {
    if (!expiresAt) return "";
    const ms = new Date(expiresAt).getTime() - now;
    if (!Number.isFinite(ms) || ms <= 0) return "0:00";
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

/** 질문 하나짜리 폼. 질문(state)이 바뀌면 key로 새로 마운트해 답을 비운다 */
function RemoteQuestionForm(props: {
    question: itfRemoteQuestion;
    disabled: boolean;
    onSubmit: (state: string, result: string) => void;
}) {
    const { question, disabled, onSubmit } = props;

    // ========== hook & state 변수 선언 ==========
    const option: itfRemoteOption | null = question.option;
    const [value, setValue] = useState(option?.defaultText ?? "");
    const [error, setError] = useState<string | null>(null);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Submit = () => {
        if (option?.required && value.trim() === "") {
            setError("값을 입력하세요.");
            return;
        }
        setError(null);
        onSubmit(question.state, value);
    };

    if (!option) return null;
    const id = "remote-auth-answer";
    const driveClientIdHelp =
        option.name === "config_shared_client_id" || option.name === "client_id";

    return (
        <>
            <p>rclone이 추가 정보를 묻습니다. 답을 입력하면 계속합니다.</p>
            {option.kind === "bool" ? (
                <ZBCCheckbox
                    id={id}
                    checked={value === "true"}
                    onChange={(v) => setValue(v ? "true" : "false")}
                    label={option.name}
                    description={option.help}
                    disabled={disabled}
                />
            ) : option.kind === "enum" ? (
                <ZBCField
                    label={option.name}
                    htmlFor={id}
                    hint={option.help}
                    error={error}
                    required={option.required}
                >
                    <ZBCSelect
                        id={id}
                        value={value}
                        options={option.choices.map((c) => ({
                            value: c.value,
                            label: c.help === "" ? c.value : `${c.value} — ${c.help}`,
                        }))}
                        placeholder={
                            option.defaultText !== "" ? `기본값: ${option.defaultText}` : "고르세요"
                        }
                        onChange={setValue}
                        disabled={disabled}
                        describedBy={`${id}-desc`}
                    />
                </ZBCField>
            ) : (
                <ZBCField
                    label={option.name}
                    htmlFor={id}
                    hint={option.help}
                    error={error}
                    required={option.required}
                >
                    <ZBCInput
                        id={id}
                        type={option.secret ? "password" : "text"}
                        value={value}
                        onChange={setValue}
                        placeholder={
                            option.defaultText !== "" ? `기본값: ${option.defaultText}` : ""
                        }
                        invalid={Boolean(error)}
                        disabled={disabled}
                        describedBy={`${id}-desc`}
                    />
                </ZBCField>
            )}
            {driveClientIdHelp && (
                <p className={styles.note}>
                    공용 client_id는 2026년 중 중단될 예정입니다. 직접 만든 client_id를 쓰는 것이
                    좋습니다.{" "}
                    <a
                        href="https://rclone.org/drive/#making-your-own-client-id"
                        onClick={(e) => {
                            e.preventDefault();
                            void getApi()
                                .system.openExternal(
                                    "https://rclone.org/drive/#making-your-own-client-id",
                                )
                                .catch(() => undefined);
                        }}
                    >
                        rclone 문서
                    </a>
                </p>
            )}
            <div className={styles.questionActions}>
                <ZBCButton variant="primary" onClick={h_Submit} disabled={disabled} initialFocus>
                    확인
                </ZBCButton>
            </div>
        </>
    );
}

export default function RemoteAuthModal(props: itfRemoteAuthModalProps) {
    const { auth, onClose, onCancel, onAnswer } = props;

    // ========== hook & state 변수 선언 ==========
    const [now, setNow] = useState(() => Date.now());
    const [copied, setCopied] = useState(false);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        if (!auth || auth.phase !== "waiting") return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [auth]);

    if (!auth) return null;

    // ========== 내부 변수 (_V) ==========
    const terminal =
        auth.phase === "done" ||
        auth.phase === "failed" ||
        auth.phase === "canceled" ||
        auth.phase === "timeout";
    const remaining = f_Remaining(auth.expiresAt, now);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_OpenUrl = () => {
        if (auth.authUrl) {
            void getApi()
                .system.openExternal(auth.authUrl)
                .catch(() => undefined);
        }
    };
    const h_Copy = () => {
        if (!auth.authUrl) return;
        void navigator.clipboard
            .writeText(auth.authUrl)
            .then(() => setCopied(true))
            .catch(() => undefined);
    };

    const title =
        auth.phase === "question"
            ? "리모트 인증 질문"
            : auth.phase === "done"
              ? "인증 완료"
              : auth.phase === "failed"
                ? "인증 실패"
                : auth.phase === "canceled" || auth.phase === "timeout"
                  ? "인증 취소"
                  : "리모트 인증";

    const footer = terminal ? (
        <ZBCButton variant="primary" onClick={onClose} initialFocus>
            닫기
        </ZBCButton>
    ) : auth.phase === "question" ? (
        <ZBCButton onClick={onCancel}>취소</ZBCButton>
    ) : (
        <ZBCButton onClick={onCancel}>취소</ZBCButton>
    );

    return (
        <ZBCModal
            open={auth !== null}
            title={title}
            onClose={terminal ? onClose : onCancel}
            footer={footer}
        >
            <div className={styles.RemoteAuthModal}>
                <p className={styles.remoteName}>리모트 ‘{auth.name}’</p>
                {auth.phase === "starting" && <p>rclone 인증을 준비하는 중…</p>}
                {auth.phase === "waiting" && (
                    <>
                        <p>브라우저에서 로그인하고 권한을 허용하세요. 끝나면 결과를 보여 줍니다.</p>
                        <p className={styles.timer}>
                            남은 시간 <strong>{remaining}</strong>
                        </p>
                        {auth.authUrl && (
                            <div className={styles.urlBox}>
                                <p>브라우저가 열리지 않으면 이 주소를 여세요.</p>
                                <code className={styles.url}>{auth.authUrl}</code>
                                <div className={styles.urlActions}>
                                    <ZBCButton onClick={h_OpenUrl}>브라우저 열기</ZBCButton>
                                    <ZBCButton onClick={h_Copy}>
                                        {copied ? "복사됨" : "주소 복사"}
                                    </ZBCButton>
                                </div>
                            </div>
                        )}
                    </>
                )}
                {auth.phase === "question" && auth.question && (
                    <RemoteQuestionForm
                        key={auth.question.state}
                        question={auth.question}
                        disabled={false}
                        onSubmit={onAnswer}
                    />
                )}
                {auth.phase === "done" && <p>인증을 마쳤습니다.</p>}
                {auth.phase === "failed" && (
                    <p className={styles.error} role="alert">
                        {auth.message ?? "인증에 실패했습니다."}
                    </p>
                )}
                {(auth.phase === "canceled" || auth.phase === "timeout") && (
                    <output className={styles.warning}>
                        {auth.message ??
                            (auth.phase === "timeout"
                                ? "인증 대기 시간이 지났습니다."
                                : "인증을 취소했습니다.")}
                    </output>
                )}
            </div>
        </ZBCModal>
    );
}
