/**
 * 삭제가 있는 동기화 실제 실행 확인 (MVP_SPEC §9.2, S10·S11).
 * 작업·모드·원본·대상, 삭제 수·바이트·대상 대비 비율, 삭제 샘플(최대 20개), 빈 폴더 정리 안내,
 * 사전 확인이 꺼져 있으면 경고를 보여 준다. 체크박스 1은 항상, 대량 삭제면 체크박스 2도 체크해야 실행할 수 있다.
 * main은 화면 체크를 믿지 않고 삭제 수·대량 삭제 확인을 다시 검사한다.
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { useState } from "react";

// ========== Internal imports ==========
import ZBCBadge from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import ZBCCheckbox from "@/components/ZBCCheckbox";
import ZBCModal from "@/components/ZBCModal";
import { pathKindBadge } from "@/lib/path-display";
import { deleteConfirmInfo, deleteSamples, realRunConfirmText } from "@/lib/run-view";
import { formatBytes } from "@/shared/format";
import type { typDeleteThresholds } from "@/shared/run-gates";
import type { typJob } from "@/shared/schemas/job";
import type { itfCompareResult } from "@/shared/types/compare";
import type { itfRunConfirm } from "@/stores/run-store";
import styles from "./DeleteConfirmModal.module.css";

// ========== Props & Types ==========
export interface itfDeleteConfirmModalProps {
    open: boolean;
    job: typJob;
    compare: itfCompareResult;
    safety: typDeleteThresholds;
    onCancel: () => void;
    onConfirm: (confirm: itfRunConfirm) => void;
    /** 샘플 수 */
    sampleLimit?: number;
}

const propsDefault = {
    sampleLimit: 20,
} satisfies Partial<itfDeleteConfirmModalProps>;

function f_Path(label: string, path: string) {
    const badge = pathKindBadge(path);
    return (
        <div className={styles.path}>
            <span className={styles.pathLabel}>{label}</span>
            {badge && <ZBCBadge>{badge.text}</ZBCBadge>}
            <code className={styles.pathText} title={path}>
                {path}
            </code>
        </div>
    );
}

export default function DeleteConfirmModal(props: itfDeleteConfirmModalProps) {
    const { open, job, compare, safety, onCancel, onConfirm } = props;
    const sampleLimit = props.sampleLimit ?? propsDefault.sampleLimit;

    // ========== hook & state 변수 선언 ==========
    /** 체크박스 1: 삭제 대상과 동기화 동작 확인 */
    const [checked, setChecked] = useState(false);
    /** 체크박스 2: 대량 삭제 경고 확인 */
    const [checkedLarge, setCheckedLarge] = useState(false);

    // ========== 내부 변수 (_V) ==========
    const info = deleteConfirmInfo(compare.summary, job.mode, safety);
    const samples = deleteSamples(compare, sampleLimit);
    const preflightOn = job.options.preflightBeforeDestructive;
    const canConfirm = checked && (!info.large || checkedLarge);
    const count = info.deleteFiles.toLocaleString("ko-KR");

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Confirm = () => {
        if (!canConfirm) return;
        onConfirm({ largeDeletes: info.large && checkedLarge });
    };

    return (
        <ZBCModal
            open={open}
            title="동기화 실행 (삭제 포함)"
            onClose={onCancel}
            footer={
                <>
                    <ZBCButton onClick={onCancel} initialFocus>
                        취소
                    </ZBCButton>
                    <ZBCButton variant="danger" onClick={h_Confirm} disabled={!canConfirm}>
                        {count}개 삭제 포함 실행
                    </ZBCButton>
                </>
            }
        >
            <div className={styles.DeleteConfirmModal}>
                <p className={styles.job}>
                    ‘{job.name}’ <ZBCBadge tone="warning">동기화(삭제 포함)</ZBCBadge>
                </p>
                {f_Path("원본", job.source)}
                {f_Path("대상", job.destination)}
                <p className={styles.headline}>{realRunConfirmText(compare.summary, job.mode)}</p>
                <p className={styles.deletes}>
                    대상 파일 {info.destFiles.toLocaleString("ko-KR")}개 중 {count}개 삭제 (
                    {formatBytes(info.deleteBytes)}
                    {info.percentText ? `, ${info.percentText}` : ""})
                    {info.large && (
                        <>
                            {" "}
                            <ZBCBadge tone="danger">대량 삭제</ZBCBadge>
                        </>
                    )}
                </p>
                {info.large && (
                    <p className={styles.warning} role="alert">
                        삭제가 기준({safety.deleteConfirmFiles}개 또는 대상의{" "}
                        {safety.deleteConfirmPercent}%)을 넘습니다. 원본 경로가 맞는지 다시
                        확인하세요.
                    </p>
                )}
                <details className={styles.samples} open>
                    <summary>
                        삭제할 파일{" "}
                        {samples.length < info.deleteFiles
                            ? `(${samples.length}/${count}개)`
                            : `(${count}개)`}
                    </summary>
                    <ul>
                        {samples.map((s) => (
                            <li key={s.path}>
                                <span className={styles.samplePath}>{s.path}</span>
                                <span className={styles.sampleSize}>{formatBytes(s.size)}</span>
                            </li>
                        ))}
                    </ul>
                </details>
                <p className={styles.note}>
                    파일을 지운 뒤 비게 된 폴더도 정리될 수 있습니다(빈 폴더는 삭제 한도에 세지
                    않음). 취소해도 이미 복사·삭제된 파일은 되돌리지 않습니다.
                </p>
                {preflightOn ? (
                    <p className={styles.note}>
                        실행 직전에 미리보기로 다시 확인하고, 비교 결과와 다르면 실행하지 않습니다.
                    </p>
                ) : (
                    <p className={styles.warning}>
                        이 작업은 실행 직전 사전 확인이 꺼져 있습니다. 비교 뒤 바뀐 파일은 삭제 한도
                        (--max-delete {info.deleteFiles})로만 막고, 한도를 넘으면 일부만 지운 채
                        중단될 수 있습니다.
                    </p>
                )}
                <ZBCCheckbox
                    id="delete-confirm-ack"
                    checked={checked}
                    onChange={setChecked}
                    label="위 삭제 대상과 동기화 동작을 확인했습니다."
                />
                {info.large && (
                    <ZBCCheckbox
                        id="delete-confirm-large"
                        checked={checkedLarge}
                        onChange={setCheckedLarge}
                        label="대량 삭제 경고를 확인했습니다."
                    />
                )}
            </div>
        </ZBCModal>
    );
}
