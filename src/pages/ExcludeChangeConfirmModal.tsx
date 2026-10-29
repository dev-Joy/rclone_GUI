/**
 * 공용 제외 패턴 수정·삭제 확인 (INT-002 T-03). 이 패턴을 쓰는 작업을 모두 보여 주고,
 * 확인하면 보여 준 작업 목록(confirmedJobIds)과 함께 main에 보낸다.
 * - 동기화 작업: 제외에서 빠진 대상 파일이 삭제 대상이 될 수 있음을 배지로 알린다.
 * - 자동 실행 작업: 다음 자동 실행부터 확인 없이 적용됨을 강조한다.
 * - main이 CONFIRM_REQUIRED(그 사이 사용 작업이 바뀜)로 거부하면 스토어가 목록을 다시 불러 이 창을 다시 그린다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import { excludeChangeConfirmText, type typExcludeChangeKind } from "@/lib/exclude-view";
import type { itfExcludeUser } from "@/shared/schemas/excludes";
import styles from "./ExcludeChangeConfirmModal.module.css";

// ========== Props & Types ==========
export interface itfExcludeChangeConfirmModalProps {
    open: boolean;
    kind: typExcludeChangeKind;
    /** 지금 패턴 */
    pattern: string;
    /** 수정이면 새 패턴 */
    nextPattern?: string;
    users: readonly itfExcludeUser[];
    busy?: boolean;
    /** 다시 확인해야 할 때 등 안내 문구 */
    message?: string | null;
    onConfirm: () => void;
    onClose: () => void;
}

const propsDefault = {
    nextPattern: "",
    busy: false,
    message: null,
} satisfies Partial<itfExcludeChangeConfirmModalProps>;

export default function ExcludeChangeConfirmModal(props: itfExcludeChangeConfirmModalProps) {
    const {
        open,
        kind,
        pattern,
        nextPattern = propsDefault.nextPattern,
        users,
        busy = propsDefault.busy,
        message = propsDefault.message,
        onConfirm,
        onClose,
    } = props;

    // ========== 내부 변수 (_V) ==========
    const title = kind === "delete" ? "공용 제외 패턴 지우기" : "공용 제외 패턴 바꾸기";
    const hasSync = users.some((u) => u.mode === "sync");

    return (
        <ZBCModal
            open={open}
            title={title}
            onClose={onClose}
            footer={
                <>
                    <ZBCButton onClick={onClose} initialFocus>
                        취소
                    </ZBCButton>
                    <ZBCButton
                        variant={kind === "delete" ? "danger" : "primary"}
                        onClick={onConfirm}
                        disabled={busy}
                    >
                        {busy ? "처리 중…" : excludeChangeConfirmText(kind, users.length)}
                    </ZBCButton>
                </>
            }
        >
            <div className={styles.ExcludeChangeConfirmModal}>
                {message && (
                    <p className={styles.message} role="alert">
                        {message}
                    </p>
                )}
                <p>
                    {kind === "delete" ? (
                        <>
                            <code className={styles.pattern}>{pattern}</code> 패턴을 지웁니다.
                        </>
                    ) : (
                        <>
                            <code className={styles.pattern}>{pattern}</code> →{" "}
                            <code className={styles.pattern}>{nextPattern}</code> 로 바꿉니다.
                        </>
                    )}
                </p>
                {users.length === 0 ? (
                    <p className={styles.note}>이 패턴을 쓰는 작업이 없습니다.</p>
                ) : (
                    <>
                        <p>
                            이 패턴을 쓰는 작업 {users.length}개에 바로 적용되고, 그 작업들의 비교
                            결과는 버립니다(다시 비교해야 실행할 수 있음).
                        </p>
                        <ul className={styles.users} aria-label="이 패턴을 쓰는 작업">
                            {users.map((u) => (
                                <li key={u.jobId} data-auto={u.auto ? "" : undefined}>
                                    <span className={styles.name}>{u.jobName}</span>
                                    <ZBCBadge tone={u.mode === "sync" ? "warning" : "neutral"}>
                                        {u.mode === "sync" ? "동기화" : "복사"}
                                    </ZBCBadge>
                                    {u.mode === "sync" && (
                                        <ZBCBadge tone="danger">
                                            대상 파일이 삭제 대상이 될 수 있음
                                        </ZBCBadge>
                                    )}
                                    {u.auto && (
                                        <strong className={styles.auto}>
                                            자동 실행 — 다음 자동 실행부터 확인 없이 적용
                                        </strong>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {hasSync && (
                            <p className={styles.note}>
                                동기화 작업은 제외에서 빠진 파일이 대상에만 있으면 다음 실행에서
                                지울 수 있습니다. 실행 전에 다시 비교해 삭제 목록을 확인하세요.
                            </p>
                        )}
                    </>
                )}
            </div>
        </ZBCModal>
    );
}
