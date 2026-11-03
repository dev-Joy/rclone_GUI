/**
 * remote 삭제 확인 모달 (INT-006 T-05, FR-21).
 * 참조 작업·자동 실행·북마크 수를 보여 주고, 예약 켜진 작업이 있으면 자동 실행을 끄고 지우는 버튼으로 바꾼다.
 * 작업·북마크는 지우지 않고 "remote 없음"으로 표시된다는 점을 알린다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== External imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCModal from "@/components/ZBCModal";
import type { itfRemoteUsage } from "@/shared/types/remote-config";
import styles from "./RemoteDeleteModal.module.css";

export interface itfRemoteDeleteModalProps {
    open: boolean;
    name: string;
    /** 아직 못 읽었으면 null */
    usage: itfRemoteUsage | null;
    busy: boolean;
    onClose: () => void;
    /** disableSchedules: 예약 켜진 작업의 자동 실행을 끄고 지우는 데 동의 */
    onConfirm: (disableSchedules: boolean) => void;
}

export default function RemoteDeleteModal(props: itfRemoteDeleteModalProps) {
    const { open, name, usage, busy, onClose, onConfirm } = props;

    // ========== 내부 변수 (_V) ==========
    const autoCount = usage?.jobs.filter((j) => j.autoSync !== "off").length ?? 0;
    const jobCount = usage?.jobs.length ?? 0;
    const bookmarkCount = usage?.bookmarks.length ?? 0;
    const otherConfigJobs = usage?.otherConfigJobs ?? 0;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Confirm = () => onConfirm(autoCount > 0);

    return (
        <ZBCModal
            open={open}
            title="리모트 삭제"
            onClose={busy ? () => undefined : onClose}
            footer={
                <>
                    <ZBCButton onClick={onClose} disabled={busy} initialFocus>
                        취소
                    </ZBCButton>
                    <ZBCButton
                        variant="danger"
                        onClick={h_Confirm}
                        disabled={busy || usage === null}
                    >
                        {busy
                            ? "지우는 중…"
                            : autoCount > 0
                              ? `작업 ${autoCount}개의 자동 실행을 끄고 삭제`
                              : "리모트 삭제"}
                    </ZBCButton>
                </>
            }
        >
            <div className={styles.RemoteDeleteModal}>
                {usage === null ? (
                    <p>이 리모트를 쓰는 작업과 북마크를 확인하는 중…</p>
                ) : (
                    <>
                        <p>
                            remote <code>{name}:</code>를 rclone 설정에서 지웁니다.
                        </p>
                        <ul className={styles.counts}>
                            <li>작업 {jobCount}개</li>
                            <li>자동 실행 {autoCount}개</li>
                            <li>북마크 {bookmarkCount}개</li>
                        </ul>
                        {usage.jobs.length > 0 && (
                            <ul className={styles.list}>
                                {usage.jobs.map((j) => (
                                    <li key={j.id}>
                                        {j.name}
                                        {j.autoSync !== "off" && (
                                            <span className={styles.badge}>
                                                {j.autoSync === "os" ? "Windows 예약" : "앱 예약"}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {autoCount > 0 ? (
                            <p className={styles.warning}>
                                작업 {autoCount}개의 자동 실행을 끄고 Windows 예약도 지운 뒤
                                삭제합니다. 다시 켜는 것은 직접 해야 합니다.
                            </p>
                        ) : (
                            <p className={styles.note}>
                                작업과 북마크는 지우지 않습니다. 이 리모트를 가리키는 작업은 “remote
                                없음”으로 표시되고, 실행하면 멈춥니다.
                            </p>
                        )}
                        {otherConfigJobs > 0 && (
                            <p className={styles.note}>
                                다른 rclone.conf를 쓰는 작업 {otherConfigJobs}개는 확인하지
                                않았습니다.
                            </p>
                        )}
                    </>
                )}
            </div>
        </ZBCModal>
    );
}
