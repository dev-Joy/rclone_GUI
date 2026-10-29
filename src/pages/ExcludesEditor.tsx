/**
 * 제외 규칙 편집 (한 줄에 하나, rclone --exclude 형식). 입력 중 빈 줄이 사라지지 않도록
 * 입력란 문자열은 따로 두고, 바뀔 때마다 정리한 목록을 올려 보낸다.
 * commentNote를 켜면 #·;로 시작하는 줄이 공용으로 둘 수 없어 이 작업 전용으로만 적용된다고 알린다(INT-002 T-03).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCField from "@/components/ZBCField";
import ZBCTextarea from "@/components/ZBCTextarea";
import { jobOnlyCommentLike } from "@/lib/exclude-view";
import { excludesToText, parseExcludesText } from "@/lib/job-form";
import styles from "./ExcludesEditor.module.css";

// ========== Props & Types ==========
export interface itfExcludesEditorProps {
    id: string;
    value: readonly string[];
    onChange: (value: string[]) => void;
    /** "기본값 불러오기" 원본. 없으면 버튼 숨김 */
    defaults?: readonly string[];
    /** "설정 기본값 불러오기" | "초기값으로" */
    defaultsLabel?: string;
    error?: string | null;
    hint?: string;
    /** 입력란 이름 앞부분. 뒤에 개수가 붙는다 */
    label?: string;
    /** #·; 시작 줄 안내 */
    commentNote?: boolean;
}

const propsDefault = {
    defaultsLabel: "기본값 불러오기",
    error: null,
    label: "제외 규칙",
    commentNote: false,
    hint: "한 줄에 하나씩, rclone --exclude 형식으로 씁니다 (예: node_modules/**). 빈 줄은 무시합니다.",
} satisfies Partial<itfExcludesEditorProps>;

function f_SameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

export default function ExcludesEditor(props: itfExcludesEditorProps) {
    const {
        id,
        value,
        onChange,
        defaults,
        defaultsLabel = propsDefault.defaultsLabel,
        error = propsDefault.error,
        hint = propsDefault.hint,
        label = propsDefault.label,
        commentNote = propsDefault.commentNote,
    } = props;

    // ========== hook & state 변수 선언 ==========
    const [text, setText] = useState(() => excludesToText(value));
    const [prevValue, setPrevValue] = useState(value);

    // 밖에서 값이 바뀌면(되돌리기·다른 작업 열기·기본값 불러오기) 입력란을 다시 채운다
    if (value !== prevValue) {
        setPrevValue(value);
        if (!f_SameList(parseExcludesText(text), value)) setText(excludesToText(value));
    }

    // ========== 내부 변수 (_V) ==========
    const commentLike = commentNote ? jobOnlyCommentLike(value).length : 0;
    const warnings =
        commentLike > 0
            ? [
                  `#·;로 시작하는 줄 ${commentLike}개는 다른 작업과 공유할 수 없어 이 작업 전용으로만 적용됩니다.`,
              ]
            : [];

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Change = (next: string) => {
        setText(next);
        onChange(parseExcludesText(next));
    };
    const h_Blur = () => setText(excludesToText(parseExcludesText(text)));
    const h_LoadDefaults = () => {
        if (!defaults) return;
        setText(excludesToText(defaults));
        onChange([...defaults]);
    };

    return (
        <div className={styles.ExcludesEditor}>
            <ZBCField
                label={`${label} (${value.length}개)`}
                htmlFor={id}
                error={error}
                warnings={warnings}
                hint={hint}
            >
                <ZBCTextarea
                    id={id}
                    name="excludes"
                    value={text}
                    onChange={h_Change}
                    onBlur={h_Blur}
                    rows={5}
                    invalid={Boolean(error)}
                    describedBy={`${id}-desc`}
                    mono
                />
            </ZBCField>
            {defaults && (
                <div className={styles.actions}>
                    <ZBCButton
                        variant="ghost"
                        onClick={h_LoadDefaults}
                        disabled={f_SameList(defaults, value)}
                    >
                        {defaultsLabel}
                    </ZBCButton>
                </div>
            )}
        </div>
    );
}
