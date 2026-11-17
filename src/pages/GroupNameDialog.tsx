/**
 * 그룹 이름 대화상자 (INT-008 FR-17). 새 그룹과 이름 바꾸기에 함께 쓴다.
 * 이름은 1~50자(앞뒤 공백 제거)이고, 대소문자 없이 같은 이름이 있으면 저장을 끄고 사유를 보여 준다.
 * Escape·취소로 닫는다. 저장은 groups-store를 거쳐 main(groups:save)에 맡긴다.
 *
 * @author dev-Joy 2026-11-17
 */

// ========== External imports ==========
import { useId, useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import ZBCModal from "@/components/ZBCModal";
import type { itfGroup } from "@/shared/schemas/group";
import { useGroupsStore } from "@/stores/groups-store";
import styles from "./GroupNameDialog.module.css";

// ========== Props & Types ==========
export interface itfGroupNameDialogProps {
    /** 이름을 바꿀 그룹. 없으면 새 그룹 */
    group?: itfGroup;
    onClose: () => void;
}

const GROUP_NAME_MAX = 50;

/** 넘어온 값이 없는 항목만 쓰는 기본값(새 그룹) */
const propsDefault = {
    group: undefined,
} satisfies Partial<itfGroupNameDialogProps>;

export default function GroupNameDialog(props: itfGroupNameDialogProps) {
    const { group = propsDefault.group, onClose } = props;

    // ========== hook & state 변수 선언 ==========
    const groups = useGroupsStore((s) => s.groups);
    const saveGroup = useGroupsStore((s) => s.save);
    const [name, setName] = useState(group?.name ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputId = useId();

    // ========== 내부 변수 (_V) ==========
    const trimmed = name.trim();
    const duplicate = groups.some(
        (g) => g.id !== group?.id && g.name.toLowerCase() === trimmed.toLowerCase(),
    );
    const reason =
        trimmed === ""
            ? "그룹 이름을 입력하세요."
            : trimmed.length > GROUP_NAME_MAX
              ? `그룹 이름은 ${GROUP_NAME_MAX}자까지 쓸 수 있습니다.`
              : duplicate
                ? "같은 이름의 그룹이 이미 있습니다."
                : null;
    const title = group ? "그룹 이름 바꾸기" : "새 그룹";

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Save = async () => {
        if (reason !== null || saving) return;
        setSaving(true);
        setError(null);
        const r = await saveGroup(group ? { id: group.id, name: trimmed } : { name: trimmed });
        setSaving(false);
        if (!r.ok) {
            setError(r.error.message);
            return;
        }
        onClose();
    };
    const h_SaveClick = () => void h_Save();

    return (
        <ZBCModal
            open
            title={title}
            onClose={onClose}
            footer={
                <>
                    <ZBCButton onClick={onClose} disabled={saving}>
                        취소
                    </ZBCButton>
                    <ZBCButton
                        variant="primary"
                        onClick={h_SaveClick}
                        disabled={saving || reason !== null}
                    >
                        {saving ? "저장 중…" : "저장"}
                    </ZBCButton>
                </>
            }
        >
            <div className={styles.GroupNameDialog}>
                <ZBCField
                    label="그룹 이름"
                    htmlFor={inputId}
                    hint="작업 목록을 묶어 보는 이름입니다. 실행에는 영향이 없습니다."
                    error={error ?? reason}
                >
                    <ZBCInput
                        id={inputId}
                        name="groupName"
                        value={name}
                        onChange={setName}
                        placeholder="예: 백업"
                        spellCheck={false}
                        invalid={reason !== null || error !== null}
                        describedBy={`${inputId}-desc`}
                    />
                </ZBCField>
            </div>
        </ZBCModal>
    );
}
