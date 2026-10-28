/**
 * 제외 규칙 편집 (한 줄에 하나, rclone --exclude 형식). 입력 중 빈 줄이 사라지지 않도록
 * 입력란 문자열은 따로 두고, 바뀔 때마다 정리한 목록을 올려 보낸다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCField from "@/components/ZBCField";
import ZBCTextarea from "@/components/ZBCTextarea";
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
}

const propsDefault = {
    defaultsLabel: "기본값 불러오기",
    error: null,
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
    } = props;

    // ========== hook & state 변수 선언 ==========
    const [text, setText] = useState(() => excludesToText(value));
    const [prevValue, setPrevValue] = useState(value);

    // 밖에서 값이 바뀌면(되돌리기·다른 작업 열기·기본값 불러오기) 입력란을 다시 채운다
    if (value !== prevValue) {
        setPrevValue(value);
        if (!f_SameList(parseExcludesText(text), value)) setText(excludesToText(value));
    }

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
                label={`제외 규칙 (${value.length}개)`}
                htmlFor={id}
                error={error}
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
