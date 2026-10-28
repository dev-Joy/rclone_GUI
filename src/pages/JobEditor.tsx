/**
 * 작업 설정 편집기. 이름·모드·원본·대상·제외 규칙·rclone.conf·고급/위험 옵션·자동 실행·메모를 고치고 저장한다.
 * 저장 전에 화면에서 검증하고(필드별 오류), main이 다시 검증해 거부하면 폼 위에 이유를 보여 준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useMemo, useState, type ChangeEvent } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCCheckbox from "@/components/ZBCCheckbox";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import ZBCTextarea from "@/components/ZBCTextarea";
import { errorText, getApi, unwrap } from "@/lib/api";
import { numberText, toNumber } from "@/lib/form-utils";
import { serverErrorToCheck, validateJobDraft, type itfJobFormCheck } from "@/lib/job-form";
import { formatLocalDateTime } from "@/shared/format";
import type { typRunMode } from "@/shared/schemas/common";
import { selectDirty, useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";
import ExcludesEditor from "./ExcludesEditor";
import JobOptionsFields from "./JobOptionsFields";
import PathField from "./PathField";
import styles from "./JobEditor.module.css";

const MODE_OPTIONS: ReadonlyArray<{ value: typRunMode; label: string; description: string }> = [
    {
        value: "copy",
        label: "복사",
        description: "원본 → 대상으로 복사합니다. 대상 파일은 지우지 않습니다.",
    },
    {
        value: "sync",
        label: "동기화",
        description: "대상을 원본과 같게 만듭니다. 대상에만 있는 파일은 삭제합니다.",
    },
];

/** 화면 검증과 main 오류를 합친다 (main 오류가 먼저) */
function f_Merge(local: itfJobFormCheck, server: itfJobFormCheck | null): itfJobFormCheck {
    if (!server) return local;
    return {
        ...local,
        fieldErrors: { ...local.fieldErrors, ...server.fieldErrors },
        formErrors: [...server.formErrors, ...local.formErrors],
        ok: false,
    };
}

export default function JobEditor() {
    // ========== hook & state 변수 선언 ==========
    const draft = useJobEditorStore((s) => s.draft);
    const jobId = useJobEditorStore((s) => s.jobId);
    const showErrors = useJobEditorStore((s) => s.showErrors);
    const saving = useJobEditorStore((s) => s.saving);
    const serverError = useJobEditorStore((s) => s.serverError);
    const externalChange = useJobEditorStore((s) => s.externalChange);
    const dirty = useJobEditorStore(selectDirty);
    const setField = useJobEditorStore((s) => s.setField);
    const setOptions = useJobEditorStore((s) => s.setOptions);
    const setAutoSync = useJobEditorStore((s) => s.setAutoSync);
    const revert = useJobEditorStore((s) => s.revert);
    const save = useJobEditorStore((s) => s.save);
    const baseline = useJobEditorStore((s) => s.baseline);
    /** "이 작업만 다른 파일"을 골랐지만 아직 파일을 고르지 않은 상태 */
    const [wantOverride, setWantOverride] = useState(false);
    const [prevBaseline, setPrevBaseline] = useState(baseline);
    // 다른 작업을 열거나 저장하면(baseline 교체) 선택 상태를 저장값 기준으로 되돌린다
    if (baseline !== prevBaseline) {
        setPrevBaseline(baseline);
        setWantOverride(false);
    }
    const job = useJobsStore((s) =>
        jobId === null ? null : (s.jobs.find((j) => j.id === jobId) ?? null),
    );
    const settings = useSettingsStore((s) => s.settings);
    const pushToast = useToastStore((s) => s.push);

    // ========== 내부 변수 (_V) ==========
    const caseInsensitive = settings?.compare.caseInsensitivePaths ?? true;
    const local = useMemo(
        () => (draft ? validateJobDraft(draft, caseInsensitive) : null),
        [draft, caseInsensitive],
    );
    const server = useMemo(
        () => (serverError ? serverErrorToCheck(serverError) : null),
        [serverError],
    );

    if (!draft || !local) return null;

    const check = f_Merge(local, server);
    const err = (field: keyof itfJobFormCheck["fieldErrors"]) =>
        showErrors ? (check.fieldErrors[field] ?? null) : null;
    const warn = (field: keyof itfJobFormCheck["fieldWarnings"]) =>
        check.fieldWarnings[field] ?? [];
    const errorCount = Object.keys(check.fieldErrors).length + check.formErrors.length;
    const canSave = !saving && (jobId === null || dirty || serverError !== null);
    const override = draft.configPathOverride;
    const otherConfig = override !== null || wantOverride;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Name = (v: string) => setField("name", v);
    const h_Mode = (e: ChangeEvent<HTMLInputElement>) =>
        setField("mode", e.target.value as typRunMode);
    const h_Source = (v: string) => setField("source", v);
    const h_Destination = (v: string) => setField("destination", v);
    const h_Excludes = (v: string[]) => setField("excludes", v);
    const h_Notes = (v: string) => setField("notes", v);
    const h_AutoEnabled = (v: boolean) => setAutoSync({ enabled: v });
    const h_AutoInterval = (t: string) => setAutoSync({ intervalMinutes: toNumber(t) });
    const h_AutoDeletes = (v: boolean) => setAutoSync({ allowDeletes: v });

    const f_PickConfig = async () => {
        try {
            const picked = await unwrap(
                getApi().dialog.pickFile({
                    title: "이 작업에 쓸 rclone.conf 고르기",
                    filters: [{ name: "rclone 설정", extensions: ["conf", "*"] }],
                }),
            );
            if (picked) setField("configPathOverride", picked);
        } catch (e) {
            pushToast("error", errorText(e));
        }
    };
    const h_UseDefaultConfig = () => {
        setWantOverride(false);
        setField("configPathOverride", null);
    };
    const h_UseOtherConfig = () => setWantOverride(true);
    const h_PickConfig = () => void f_PickConfig();

    const h_Save = async () => {
        const ok = await save(caseInsensitive);
        if (ok) pushToast("success", "작업을 저장했습니다.");
    };
    const h_SaveClick = () => void h_Save();

    return (
        <div className={styles.JobEditor}>
            <div className={styles.form}>
                {externalChange && (
                    <output className={styles.notice} data-level="warning">
                        다른 곳에서 이 작업이 바뀌었습니다. 저장하면 지금 화면의 값으로 덮어씁니다.
                    </output>
                )}
                {showErrors && check.formErrors.length > 0 && (
                    <div className={styles.notice} data-level="error" role="alert">
                        {check.formErrors.map((m) => (
                            <p key={m}>{m}</p>
                        ))}
                    </div>
                )}
                {check.formWarnings.length > 0 && (
                    <div className={styles.notice} data-level="warning">
                        {check.formWarnings.map((m) => (
                            <p key={m}>주의: {m}</p>
                        ))}
                    </div>
                )}

                <section className={styles.section} aria-labelledby="job-basic-title">
                    <h3 id="job-basic-title" className={styles.sectionTitle}>
                        기본
                    </h3>
                    <ZBCField label="이름" htmlFor="job-name" error={err("name")} required>
                        <ZBCInput
                            id="job-name"
                            name="name"
                            value={draft.name}
                            onChange={h_Name}
                            placeholder="예: 프로젝트 백업"
                            invalid={Boolean(err("name"))}
                            describedBy="job-name-desc"
                        />
                    </ZBCField>
                    <fieldset className={styles.modes}>
                        <legend className={styles.legend}>모드 (필수)</legend>
                        {MODE_OPTIONS.map((m) => (
                            <label
                                key={m.value}
                                className={styles.mode}
                                data-checked={draft.mode === m.value ? "" : undefined}
                            >
                                <input
                                    type="radio"
                                    name="mode"
                                    value={m.value}
                                    checked={draft.mode === m.value}
                                    onChange={h_Mode}
                                />
                                <span>
                                    <strong>{m.label}</strong> — {m.description}
                                </span>
                            </label>
                        ))}
                    </fieldset>
                </section>

                <section className={styles.section} aria-labelledby="job-paths-title">
                    <h3 id="job-paths-title" className={styles.sectionTitle}>
                        경로
                    </h3>
                    <PathField
                        id="job-source"
                        name="source"
                        label="원본"
                        value={draft.source}
                        onChange={h_Source}
                        configPath={override}
                        error={err("source")}
                        warnings={warn("source")}
                    />
                    <PathField
                        id="job-destination"
                        name="destination"
                        label="대상"
                        value={draft.destination}
                        onChange={h_Destination}
                        configPath={override}
                        error={err("destination")}
                        warnings={warn("destination")}
                    />
                </section>

                <section className={styles.section} aria-labelledby="job-excludes-title">
                    <h3 id="job-excludes-title" className={styles.sectionTitle}>
                        제외
                    </h3>
                    <ExcludesEditor
                        id="job-excludes"
                        value={draft.excludes}
                        onChange={h_Excludes}
                        defaults={settings?.defaults.excludes}
                        defaultsLabel="설정 기본값 불러오기"
                        error={err("excludes")}
                    />
                </section>

                <section className={styles.section} aria-labelledby="job-config-title">
                    <h3 id="job-config-title" className={styles.sectionTitle}>
                        사용할 rclone.conf
                    </h3>
                    <div
                        className={styles.configChoice}
                        role="radiogroup"
                        aria-labelledby="job-config-title"
                    >
                        <label className={styles.mode}>
                            <input
                                type="radio"
                                name="config-choice"
                                checked={!otherConfig}
                                onChange={h_UseDefaultConfig}
                            />
                            <span>기본 설정 파일 사용 (설정 화면의 rclone 설정)</span>
                        </label>
                        <label className={styles.mode}>
                            <input
                                type="radio"
                                name="config-choice"
                                checked={otherConfig}
                                onChange={h_UseOtherConfig}
                            />
                            <span>이 작업만 다른 파일 사용</span>
                        </label>
                    </div>
                    {otherConfig && (
                        <div className={styles.configPath}>
                            <span className={styles.mono} title={override ?? undefined}>
                                {override ??
                                    "아직 고르지 않음 — 고르기 전까지는 기본 설정 파일을 씁니다."}
                            </span>
                            <ZBCButton onClick={h_PickConfig}>
                                {override === null ? "rclone.conf 파일 고르기" : "다른 파일 고르기"}
                            </ZBCButton>
                        </div>
                    )}
                    {err("configPathOverride") && (
                        <p className={styles.fieldError} role="alert">
                            {err("configPathOverride")}
                        </p>
                    )}
                </section>

                <section className={styles.section} aria-labelledby="job-options-title">
                    <h3 id="job-options-title" className={styles.sectionTitle}>
                        실행 옵션
                    </h3>
                    <JobOptionsFields
                        idPrefix="job"
                        value={draft.options}
                        onChange={setOptions}
                        mode={draft.mode}
                        errors={{
                            checkers: err("options.checkers") ?? undefined,
                            transfers: err("options.transfers") ?? undefined,
                            modtimeToleranceMs: err("options.modtimeToleranceMs") ?? undefined,
                        }}
                    />
                </section>

                <section className={styles.section} aria-labelledby="job-auto-title">
                    <h3 id="job-auto-title" className={styles.sectionTitle}>
                        자동 실행
                    </h3>
                    <ZBCCheckbox
                        id="job-auto-enabled"
                        name="autoEnabled"
                        checked={draft.autoSync.enabled}
                        onChange={h_AutoEnabled}
                        label="주기적으로 자동 실행"
                        description="스케줄러는 다음 단계에서 동작합니다. 지금은 설정만 저장됩니다."
                    />
                    <ZBCField
                        label="실행 간격(분)"
                        htmlFor="job-auto-interval"
                        hint="1~10080 (최대 7일)"
                        error={err("autoSync.intervalMinutes")}
                    >
                        <ZBCInput
                            id="job-auto-interval"
                            name="autoInterval"
                            type="number"
                            min={1}
                            max={10080}
                            step={1}
                            value={numberText(draft.autoSync.intervalMinutes)}
                            onChange={h_AutoInterval}
                            invalid={Boolean(err("autoSync.intervalMinutes"))}
                            describedBy="job-auto-interval-desc"
                        />
                    </ZBCField>
                    <ZBCCheckbox
                        id="job-auto-deletes"
                        name="autoDeletes"
                        checked={draft.autoSync.allowDeletes}
                        onChange={h_AutoDeletes}
                        label="자동 실행 때 대상 파일 삭제 허용 (동기화 모드)"
                        description="끄면 삭제가 필요한 자동 실행은 멈추고 알립니다."
                    />
                    <p className={styles.muted}>
                        다음 실행: {formatLocalDateTime(job?.autoSync.nextRunAt ?? null)}
                    </p>
                </section>

                <section className={styles.section} aria-labelledby="job-notes-title">
                    <h3 id="job-notes-title" className={styles.sectionTitle}>
                        메모
                    </h3>
                    <ZBCField label="메모" htmlFor="job-notes" error={err("notes")}>
                        <ZBCTextarea
                            id="job-notes"
                            name="notes"
                            value={draft.notes}
                            onChange={h_Notes}
                            rows={3}
                            describedBy="job-notes-desc"
                        />
                    </ZBCField>
                </section>
            </div>

            <footer className={styles.footer}>
                <output className={styles.footerText}>
                    {showErrors && errorCount > 0
                        ? `고칠 곳이 ${errorCount}개 있습니다.`
                        : dirty
                          ? "저장하지 않은 변경이 있습니다."
                          : jobId === null
                            ? "아직 저장하지 않은 새 작업입니다."
                            : "저장됨"}
                </output>
                <ZBCButton onClick={revert} disabled={!dirty || saving}>
                    되돌리기
                </ZBCButton>
                <ZBCButton variant="primary" onClick={h_SaveClick} disabled={!canSave}>
                    {saving ? "저장 중…" : "저장"}
                </ZBCButton>
            </footer>
        </div>
    );
}
