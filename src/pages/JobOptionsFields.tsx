/**
 * rclone 실행 옵션 입력 (작업 편집과 설정의 기본값이 같이 쓴다).
 * 고급 옵션과 위험 옵션(오류 무시)은 접힌 영역에 둔다. 임의 플래그는 입력할 수 없다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useState, type SyntheticEvent } from "react";

// ========== Internal imports ==========
import ZBCCheckbox from "@/components/ZBCCheckbox";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import { numberText, toNumber } from "@/lib/form-utils";
import type { typRunMode } from "@/shared/schemas/common";
import type { typJobRunOptions } from "@/shared/schemas/job";
import styles from "./JobOptionsFields.module.css";

// ========== Props & Types ==========
export type typOptionNumberField = "checkers" | "transfers" | "modtimeToleranceMs";

export interface itfJobOptionsFieldsProps {
    /** "job" | "defaults" */
    idPrefix: string;
    value: typJobRunOptions;
    onChange: (patch: Partial<typJobRunOptions>) => void;
    errors?: Partial<Record<typOptionNumberField, string>>;
    /** 동기화 모드일 때만 위험 경고를 강조한다. 설정 화면(기본값)은 생략 */
    mode?: typRunMode;
}

const propsDefault = {
    errors: {},
} satisfies Partial<itfJobOptionsFieldsProps>;

export default function JobOptionsFields(props: itfJobOptionsFieldsProps) {
    const { idPrefix, value, onChange, mode } = props;
    const errors: NonNullable<itfJobOptionsFieldsProps["errors"]> =
        props.errors ?? propsDefault.errors;

    // ========== hook & state 변수 선언 ==========
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [dangerOpen, setDangerOpen] = useState(false);

    // ========== 내부 변수 (_V) ==========
    const id = (name: string) => `${idPrefix}-${name}`;
    // 접힌 영역 안에 오류가 있으면 펼쳐서 보여 준다
    const hasErrors = Object.values(errors).some(Boolean);
    // 동기화에서 사전 확인을 끄면 경고가 보이도록 펼친다
    const preflightOff = mode === "sync" && !value.preflightBeforeDestructive;
    const dangerActive = value.ignoreErrors;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_ToggleAdvanced = (e: SyntheticEvent<HTMLDetailsElement>) =>
        setAdvancedOpen(e.currentTarget.open);
    const h_ToggleDanger = (e: SyntheticEvent<HTMLDetailsElement>) =>
        setDangerOpen(e.currentTarget.open);
    const h_Number = (key: typOptionNumberField) => (text: string) =>
        onChange({ [key]: toNumber(text) });
    const h_Bool =
        (
            key:
                | "fastList"
                | "skipLinks"
                | "checkHashes"
                | "preflightBeforeDestructive"
                | "ignoreErrors",
        ) =>
        (checked: boolean) =>
            onChange({ [key]: checked });

    return (
        <div className={styles.JobOptionsFields}>
            <details
                className={styles.group}
                open={advancedOpen || hasErrors || preflightOff}
                onToggle={h_ToggleAdvanced}
            >
                <summary className={styles.summary}>고급 옵션</summary>
                <div className={styles.body}>
                    <div className={styles.numbers}>
                        <ZBCField
                            label="동시 비교 수 (--checkers)"
                            htmlFor={id("checkers")}
                            hint="1~64, 기본 8"
                            error={errors.checkers}
                        >
                            <ZBCInput
                                id={id("checkers")}
                                name={id("checkers")}
                                type="number"
                                min={1}
                                max={64}
                                step={1}
                                value={numberText(value.checkers)}
                                onChange={h_Number("checkers")}
                                invalid={Boolean(errors.checkers)}
                                describedBy={`${id("checkers")}-desc`}
                            />
                        </ZBCField>
                        <ZBCField
                            label="동시 전송 수 (--transfers)"
                            htmlFor={id("transfers")}
                            hint="1~32, 기본 4"
                            error={errors.transfers}
                        >
                            <ZBCInput
                                id={id("transfers")}
                                name={id("transfers")}
                                type="number"
                                min={1}
                                max={32}
                                step={1}
                                value={numberText(value.transfers)}
                                onChange={h_Number("transfers")}
                                invalid={Boolean(errors.transfers)}
                                describedBy={`${id("transfers")}-desc`}
                            />
                        </ZBCField>
                        <ZBCField
                            label="수정시간 허용 오차(ms, --modify-window)"
                            htmlFor={id("modtime")}
                            hint="0~600000, 2000 = 2초"
                            error={errors.modtimeToleranceMs}
                        >
                            <ZBCInput
                                id={id("modtime")}
                                name={id("modtime")}
                                type="number"
                                min={0}
                                max={600000}
                                step={100}
                                value={numberText(value.modtimeToleranceMs)}
                                onChange={h_Number("modtimeToleranceMs")}
                                invalid={Boolean(errors.modtimeToleranceMs)}
                                describedBy={`${id("modtime")}-desc`}
                            />
                        </ZBCField>
                    </div>
                    <ZBCCheckbox
                        id={id("fastList")}
                        checked={value.fastList}
                        onChange={h_Bool("fastList")}
                        label="목록을 한 번에 읽기 (--fast-list)"
                        description="remote 호출 수를 줄입니다. 메모리를 더 씁니다."
                    />
                    <ZBCCheckbox
                        id={id("skipLinks")}
                        checked={value.skipLinks}
                        onChange={h_Bool("skipLinks")}
                        label="심볼릭 링크 건너뛰기 (--skip-links)"
                    />
                    <ZBCCheckbox
                        id={id("checkHashes")}
                        checked={value.checkHashes}
                        onChange={h_Bool("checkHashes")}
                        label="해시로 내용 비교 (--checksum)"
                        description="크기·수정시간 대신 해시를 비교합니다. 파일이 많으면 느립니다."
                    />
                    <ZBCCheckbox
                        id={id("preflight")}
                        checked={value.preflightBeforeDestructive}
                        onChange={h_Bool("preflightBeforeDestructive")}
                        label="동기화 삭제 전에 미리보기로 다시 확인"
                        description="삭제가 있는 동기화를 실행하기 직전에 다시 확인하고, 비교한 뒤 바뀐 파일이 있으면 실행을 멈춥니다. 끄지 않는 것을 권장합니다."
                    />
                    {mode === "sync" && !value.preflightBeforeDestructive && (
                        <p className={styles.warning}>
                            주의: 사전 확인을 끄면 비교 뒤 바뀐 삭제는 삭제 한도(--max-delete)로만
                            막습니다. 한도를 넘으면 일부만 지운 채 중단될 수 있습니다.
                        </p>
                    )}
                </div>
            </details>
            <details
                className={styles.group}
                data-danger=""
                open={dangerOpen || dangerActive}
                onToggle={h_ToggleDanger}
            >
                <summary className={styles.summary}>
                    위험 옵션{dangerActive ? " (켜짐)" : ""}
                </summary>
                <div className={styles.body}>
                    <ZBCCheckbox
                        id={id("ignoreErrors")}
                        checked={value.ignoreErrors}
                        onChange={h_Bool("ignoreErrors")}
                        label="오류가 나도 계속 (--ignore-errors)"
                        description="읽기 오류가 있어도 대상에서 파일을 지울 수 있습니다."
                    />
                    {mode === "sync" && value.ignoreErrors && (
                        <p className={styles.warning}>
                            주의: 동기화 모드에서는 이 옵션으로 실행할 수 없습니다(백업 폴더
                            미지원).
                        </p>
                    )}
                </div>
            </details>
        </div>
    );
}
