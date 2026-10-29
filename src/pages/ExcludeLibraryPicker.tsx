/**
 * 공용 제외 패턴 고르기 (INT-002 T-03). 라이브러리의 패턴을 체크로 고르고, 새 패턴을 추가·수정·삭제한다.
 *
 * - 추가하면 바로 고른 상태가 된다. 같은 패턴이 이미 있으면 그 패턴을 고른다("이미 있는 패턴을 골랐습니다").
 * - 수정·삭제는 이 패턴을 쓰는 작업이 있으면 확인 창(ExcludeChangeConfirmModal)을 거친다.
 * - 편집기를 연 동안 다른 곳에서 지워진 패턴은 선택에서 빼고 알린다(저장 전에 정리).
 * - 선택 id는 정렬해 넘긴다(저장소가 정렬해 돌려주므로 변경 여부 비교가 맞게).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== External imports ==========
import { useEffect, useRef, useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCCheckbox from "@/components/ZBCCheckbox";
import ZBCInput from "@/components/ZBCInput";
import { missingPatternIds, togglePatternId, type typExcludeChangeKind } from "@/lib/exclude-view";
import { libraryPatternIssue, normalizeExcludePattern } from "@/shared/exclude-patterns";
import { useExcludesStore } from "@/stores/excludes-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useToastStore } from "@/stores/toast-store";
import ExcludeChangeConfirmModal from "./ExcludeChangeConfirmModal";
import styles from "./ExcludeLibraryPicker.module.css";

// ========== Props & Types ==========
export interface itfExcludeLibraryPickerProps {
    id: string;
    /** 고른 공용 패턴 id */
    value: readonly string[];
    onChange: (ids: string[]) => void;
}

interface itfPending {
    kind: typExcludeChangeKind;
    id: string;
    nextPattern: string;
}

const RECONFIRM_MESSAGE = "이 패턴을 쓰는 작업이 바뀌었습니다. 아래 목록을 다시 확인하세요.";

export default function ExcludeLibraryPicker(props: itfExcludeLibraryPickerProps) {
    const { id, value, onChange } = props;

    // ========== hook & state 변수 선언 ==========
    const items = useExcludesStore((s) => s.items);
    const loaded = useExcludesStore((s) => s.loaded);
    const loadError = useExcludesStore((s) => s.error);
    const load = useExcludesStore((s) => s.load);
    const createPattern = useExcludesStore((s) => s.create);
    const updatePattern = useExcludesStore((s) => s.update);
    const removePattern = useExcludesStore((s) => s.remove);
    const pushToast = useToastStore((s) => s.push);
    const [newText, setNewText] = useState("");
    const [newError, setNewError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState("");
    const [editError, setEditError] = useState<string | null>(null);
    const [pending, setPending] = useState<itfPending | null>(null);
    const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    /** 이 화면에서 직접 지운 id(지워진 패턴 안내를 다시 띄우지 않는다) */
    const selfRemoved = useRef(new Set<string>());

    // ========== Effect (부수 효과) ==========
    // 처음 한 번, 그리고 작업 목록이 바뀌면(jobs:changed) 사용 작업 수를 다시 맞춘다
    useEffect(() => {
        void load();
        return useJobsStore.subscribe((s, prev) => {
            if (s.jobs !== prev.jobs) void load();
        });
    }, [load]);

    // 편집 중 지워진 공용 패턴은 선택에서 뺀다
    useEffect(() => {
        if (!loaded) return;
        const missing = missingPatternIds(value, items);
        if (missing.length === 0) return;
        onChange(value.filter((x) => !missing.includes(x)));
        const notSelf = missing.filter((x) => !selfRemoved.current.has(x));
        if (notSelf.length > 0) {
            pushToast(
                "warning",
                `지워진 공용 제외 패턴 ${notSelf.length}개를 이 작업의 선택에서 뺐습니다. 저장하면 반영됩니다.`,
            );
        }
    }, [loaded, items, value, onChange, pushToast]);

    // ========== 내부 변수 (_V) ==========
    const pendingItem = pending ? (items.find((i) => i.id === pending.id) ?? null) : null;
    const users = pendingItem?.usedBy ?? [];

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Toggle = (patternId: string) => (on: boolean) =>
        onChange(togglePatternId(value, patternId, on));

    const f_Add = async () => {
        const pattern = normalizeExcludePattern(newText);
        const issue = libraryPatternIssue(pattern);
        if (issue) {
            setNewError(issue);
            return;
        }
        setBusy(true);
        const r = await createPattern(pattern);
        setBusy(false);
        if (!r.ok) {
            setNewError(r.error.message);
            return;
        }
        setNewText("");
        setNewError(null);
        onChange(togglePatternId(value, r.data.item.id, true));
        if (!r.data.created) pushToast("info", "이미 있는 패턴을 골랐습니다.");
    };
    const h_Add = () => void f_Add();
    const h_NewText = (v: string) => {
        setNewText(v);
        setNewError(null);
    };

    const h_StartEdit = (patternId: string, pattern: string) => () => {
        setEditingId(patternId);
        setEditText(pattern);
        setEditError(null);
    };
    const h_CancelEdit = () => {
        setEditingId(null);
        setEditError(null);
    };
    const h_EditText = (v: string) => {
        setEditText(v);
        setEditError(null);
    };

    /** 확인 창 없이(쓰는 작업 없음) 또는 확인 창에서 실제로 바꾼다 */
    const f_Apply = async (p: itfPending, confirmedJobIds: string[]) => {
        setBusy(true);
        if (p.kind === "delete") selfRemoved.current.add(p.id);
        const r =
            p.kind === "delete"
                ? await removePattern(p.id, confirmedJobIds)
                : await updatePattern(p.id, p.nextPattern, confirmedJobIds);
        setBusy(false);
        if (r.ok) {
            setPending(null);
            setConfirmMessage(null);
            setEditingId(null);
            if (p.kind === "delete") onChange(value.filter((x) => x !== p.id));
            pushToast(
                "success",
                p.kind === "delete"
                    ? "공용 제외 패턴을 지웠습니다."
                    : "공용 제외 패턴을 바꿨습니다.",
            );
            return;
        }
        if (p.kind === "delete") selfRemoved.current.delete(p.id);
        if (r.error.code === "CONFIRM_REQUIRED") {
            // 스토어가 목록을 다시 불렀다: 새 사용 작업으로 확인 창을 다시 그린다
            setPending(p);
            setConfirmMessage(RECONFIRM_MESSAGE);
            return;
        }
        setPending(null);
        setConfirmMessage(null);
        if (p.kind === "update") setEditError(r.error.message);
        else pushToast("error", r.error.message);
    };

    const h_SaveEdit = (patternId: string, current: string, usedBy: number) => () => {
        const next = normalizeExcludePattern(editText);
        const issue = libraryPatternIssue(next);
        if (issue) {
            setEditError(issue);
            return;
        }
        if (next === current) {
            h_CancelEdit();
            return;
        }
        const p: itfPending = { kind: "update", id: patternId, nextPattern: next };
        if (usedBy === 0) void f_Apply(p, []);
        else setPending(p);
    };
    const h_Remove = (patternId: string) => () =>
        setPending({ kind: "delete", id: patternId, nextPattern: "" });
    const h_Confirm = () => {
        if (!pending) return;
        void f_Apply(
            pending,
            users.map((u) => u.jobId),
        );
    };
    const h_CloseConfirm = () => {
        setPending(null);
        setConfirmMessage(null);
    };

    return (
        <fieldset id={id} className={styles.ExcludeLibraryPicker}>
            <legend className={styles.legend}>공용 제외 패턴 ({value.length}개 선택)</legend>
            <p className={styles.hint}>
                여러 작업이 함께 쓰는 패턴입니다. 패턴을 바꾸거나 지우면 그 패턴을 고른 모든 작업에
                바로 적용됩니다.
            </p>
            {loadError && (
                <p className={styles.error} role="alert">
                    {loadError}
                </p>
            )}
            {loaded && items.length === 0 && (
                <p className={styles.hint}>아직 공용 제외 패턴이 없습니다. 아래에서 추가하세요.</p>
            )}
            <ul className={styles.list}>
                {items.map((item) => (
                    <li key={item.id} className={styles.item}>
                        {editingId === item.id ? (
                            <div className={styles.edit}>
                                <ZBCInput
                                    id={`${id}-edit`}
                                    name="excludeLibraryEdit"
                                    value={editText}
                                    onChange={h_EditText}
                                    invalid={editError !== null}
                                    describedBy={`${id}-edit-error`}
                                    mono
                                />
                                <ZBCButton
                                    variant="primary"
                                    onClick={h_SaveEdit(item.id, item.pattern, item.usedBy.length)}
                                    disabled={busy}
                                >
                                    바꾸기
                                </ZBCButton>
                                <ZBCButton onClick={h_CancelEdit}>취소</ZBCButton>
                                {editError && (
                                    <p
                                        id={`${id}-edit-error`}
                                        className={styles.error}
                                        role="alert"
                                    >
                                        {editError}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <>
                                <ZBCCheckbox
                                    id={`${id}-${item.id}`}
                                    name="excludeLibrary"
                                    checked={value.includes(item.id)}
                                    onChange={h_Toggle(item.id)}
                                    label={<code className={styles.pattern}>{item.pattern}</code>}
                                    description={
                                        item.usedBy.length > 0
                                            ? `작업 ${item.usedBy.length}개에서 사용`
                                            : "쓰는 작업 없음"
                                    }
                                />
                                <div className={styles.actions}>
                                    <ZBCButton
                                        variant="ghost"
                                        onClick={h_StartEdit(item.id, item.pattern)}
                                        aria-label={`${item.pattern} 패턴 수정`}
                                    >
                                        수정
                                    </ZBCButton>
                                    <ZBCButton
                                        variant="ghost"
                                        onClick={h_Remove(item.id)}
                                        aria-label={`${item.pattern} 패턴 삭제`}
                                    >
                                        삭제
                                    </ZBCButton>
                                </div>
                            </>
                        )}
                    </li>
                ))}
            </ul>
            <div className={styles.add}>
                <ZBCInput
                    id={`${id}-new`}
                    name="excludeLibraryNew"
                    value={newText}
                    onChange={h_NewText}
                    placeholder="새 공용 패턴 (예: node_modules/**)"
                    invalid={newError !== null}
                    describedBy={`${id}-new-error`}
                    mono
                />
                <ZBCButton onClick={h_Add} disabled={busy || newText.trim() === ""}>
                    공용 패턴 추가
                </ZBCButton>
            </div>
            {newError && (
                <p id={`${id}-new-error`} className={styles.error} role="alert">
                    {newError}
                </p>
            )}
            <ExcludeChangeConfirmModal
                open={pending !== null && pendingItem !== null}
                kind={pending?.kind ?? "delete"}
                pattern={pendingItem?.pattern ?? ""}
                nextPattern={pending?.nextPattern ?? ""}
                users={users}
                busy={busy}
                message={confirmMessage}
                onConfirm={h_Confirm}
                onClose={h_CloseConfirm}
            />
        </fieldset>
    );
}
