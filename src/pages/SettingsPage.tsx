/**
 * 설정 화면: rclone 설정, 새 작업 기본값(제외 규칙·실행 옵션), 안전 임계값, 로그·이력, 테마, 앱 정보.
 * 아직 동작하지 않는 항목(스케줄러 일시정지·트레이·로그인 시 시작)은 보여 주지 않는다.
 * 저장은 화면에 보이는 항목만 보낸다(settingsToPatch). 기본값은 새 작업에만 적용된다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useState, type SyntheticEvent } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCCheckbox from "@/components/ZBCCheckbox";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import ZBCSelect from "@/components/ZBCSelect";
import { errorText, getApi, unwrap } from "@/lib/api";
import { numberText, toNumber } from "@/lib/form-utils";
import {
    isSettingsEqual,
    settingsToPatch,
    validateSettingsDraft,
    type typSettingsFormField,
} from "@/lib/settings-form";
import { DEFAULT_EXCLUDES } from "@/shared/defaults";
import type { itfAppInfo } from "@/shared/ipc-contract";
import type { typJobRunOptions } from "@/shared/schemas/job";
import type { typSettings, typThemeMode } from "@/shared/schemas/settings";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";
import { useUiStore } from "@/stores/ui-store";
import ExcludesEditor from "./ExcludesEditor";
import JobOptionsFields from "./JobOptionsFields";
import RcloneSetupPanel from "./RcloneSetupPanel";
import styles from "./SettingsPage.module.css";

// ========== Props & Types ==========
export interface itfSettingsPageProps {
    info: itfAppInfo | null;
}

type typNumberSpec = {
    field: typSettingsFormField;
    group: "safety" | "logs";
    key: string;
    label: string;
    hint: string;
    step?: number;
};

const THEME_OPTIONS: ReadonlyArray<{ value: typThemeMode; label: string }> = [
    { value: "system", label: "시스템 설정 따르기" },
    { value: "light", label: "라이트" },
    { value: "dark", label: "다크" },
];

const SAFETY_FIELDS: readonly typNumberSpec[] = [
    {
        field: "safety.deleteConfirmFiles",
        group: "safety",
        key: "deleteConfirmFiles",
        label: "삭제 확인 기준(개)",
        hint: "삭제할 파일이 이 수 이상이면 한 번 더 확인합니다. 0~1000000",
    },
    {
        field: "safety.deleteConfirmPercent",
        group: "safety",
        key: "deleteConfirmPercent",
        label: "삭제 확인 기준(%)",
        hint: "대상 파일 중 이 비율 이상을 지우면 한 번 더 확인합니다. 0~100",
        step: 0.1,
    },
    {
        field: "safety.autoMaxDeletes",
        group: "safety",
        key: "autoMaxDeletes",
        label: "자동 실행 최대 삭제 수",
        hint: "자동 실행이 이보다 많이 지워야 하면 멈춥니다. 0~1000000",
    },
    {
        field: "safety.compareMaxAgeMinutes",
        group: "safety",
        key: "compareMaxAgeMinutes",
        label: "비교 결과 유효 시간(분)",
        hint: "이 시간이 지난 비교 결과로는 실행할 수 없습니다. 1~1440",
    },
];

const LOG_FIELDS: readonly typNumberSpec[] = [
    {
        field: "logs.retentionDays",
        group: "logs",
        key: "retentionDays",
        label: "로그 보관 일수",
        hint: "1~365일",
    },
    {
        field: "logs.historyLimit",
        group: "logs",
        key: "historyLimit",
        label: "실행 이력 보관 수",
        hint: "100~5000개",
    },
];

export default function SettingsPage(props: itfSettingsPageProps) {
    const { info } = props;

    // ========== hook & state 변수 선언 ==========
    const settings = useSettingsStore((s) => s.settings);
    const update = useSettingsStore((s) => s.update);
    const pushToast = useToastStore((s) => s.push);
    const [draft, setDraft] = useState<typSettings | null>(() =>
        settings ? structuredClone(settings) : null,
    );
    const [prevSettings, setPrevSettings] = useState(settings);
    const [showErrors, setShowErrors] = useState(false);
    const [saving, setSaving] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const setSettingsDirty = useUiStore((s) => s.setSettingsDirty);

    // 저장소 값이 바뀌면(저장·rclone 지정 등) 고치지 않은 화면 값만 새 값으로 맞춘다
    if (settings !== prevSettings) {
        setPrevSettings(settings);
        if (settings && (!draft || !prevSettings || isSettingsEqual(draft, prevSettings))) {
            setDraft(structuredClone(settings));
        }
    }

    const dirtyNow = settings !== null && draft !== null && !isSettingsEqual(draft, settings);

    // ========== Effect (부수 효과) ==========
    // 화면을 떠나기 전 확인(ui-store.leaveSettings)이 볼 수 있게 변경 여부를 올린다
    useEffect(() => {
        setSettingsDirty(dirtyNow);
    }, [dirtyNow, setSettingsDirty]);
    useEffect(() => () => setSettingsDirty(false), [setSettingsDirty]);

    if (!settings || !draft) {
        return (
            <div className={styles.SettingsPage}>
                <RcloneSetupPanel />
                <p className={styles.muted}>설정을 불러오는 중…</p>
            </div>
        );
    }

    // ========== 내부 변수 (_V) ==========
    const check = validateSettingsDraft(draft);
    const dirty = dirtyNow;
    const err = (field: typSettingsFormField) =>
        showErrors ? (check.fieldErrors[field] ?? null) : null;
    const { excludes: defaultExcludes, ...defaultOptions } = draft.defaults;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const f_Patch = (fn: (d: typSettings) => typSettings) => setDraft((d) => (d ? fn(d) : d));
    const h_Excludes = (v: string[]) =>
        f_Patch((d) => ({ ...d, defaults: { ...d.defaults, excludes: v } }));
    const h_Options = (p: Partial<typJobRunOptions>) =>
        f_Patch((d) => ({ ...d, defaults: { ...d.defaults, ...p } }));
    const h_Number = (spec: typNumberSpec) => (text: string) =>
        f_Patch((d) => ({ ...d, [spec.group]: { ...d[spec.group], [spec.key]: toNumber(text) } }));
    const h_CaseInsensitive = (v: boolean) =>
        f_Patch((d) => ({ ...d, compare: { caseInsensitivePaths: v } }));
    const h_Theme = (v: string) =>
        f_Patch((d) => ({ ...d, ui: { ...d.ui, theme: v as typThemeMode } }));
    const h_ToggleAdvanced = (e: SyntheticEvent<HTMLDetailsElement>) =>
        setAdvancedOpen(e.currentTarget.open);
    const h_Revert = () => {
        setDraft(structuredClone(settings));
        setShowErrors(false);
    };
    const f_Save = async () => {
        if (!check.ok) {
            setShowErrors(true);
            return;
        }
        setSaving(true);
        const ok = await update(settingsToPatch(draft));
        setSaving(false);
        if (ok) {
            setShowErrors(false);
            pushToast("success", "설정을 저장했습니다. 기본값은 새로 만드는 작업부터 적용됩니다.");
        } else {
            pushToast("error", useSettingsStore.getState().error ?? "설정을 저장하지 못했습니다.");
        }
    };
    const h_Save = () => void f_Save();
    const h_OpenLogs = () => {
        unwrap(getApi().app.openLogsFolder()).catch((e: unknown) =>
            pushToast("error", errorText(e)),
        );
    };

    const f_NumberField = (spec: typNumberSpec) => {
        const id = `settings-${spec.group}-${spec.key}`;
        const group = draft[spec.group] as Record<string, number>;
        return (
            <ZBCField
                key={spec.field}
                label={spec.label}
                htmlFor={id}
                hint={spec.hint}
                error={err(spec.field)}
            >
                <ZBCInput
                    id={id}
                    name={id}
                    type="number"
                    step={spec.step ?? 1}
                    value={numberText(group[spec.key] ?? Number.NaN)}
                    onChange={h_Number(spec)}
                    invalid={Boolean(err(spec.field))}
                    describedBy={`${id}-desc`}
                />
            </ZBCField>
        );
    };

    return (
        <div className={styles.SettingsPage}>
            <h2 className={styles.pageTitle}>설정</h2>

            <RcloneSetupPanel />

            <section className={styles.section} aria-labelledby="settings-defaults-title">
                <h3 id="settings-defaults-title" className={styles.sectionTitle}>
                    새 작업 기본값
                </h3>
                <p className={styles.muted}>
                    새로 만드는 작업에만 적용됩니다. 이미 저장한 작업은 바뀌지 않습니다.
                </p>
                <ExcludesEditor
                    id="settings-excludes"
                    value={defaultExcludes}
                    onChange={h_Excludes}
                    defaults={DEFAULT_EXCLUDES}
                    defaultsLabel="초기값으로"
                    error={err("defaults.excludes")}
                />
                <JobOptionsFields
                    idPrefix="defaults"
                    value={defaultOptions}
                    onChange={h_Options}
                    errors={{
                        checkers: err("defaults.checkers") ?? undefined,
                        transfers: err("defaults.transfers") ?? undefined,
                        modtimeToleranceMs: err("defaults.modtimeToleranceMs") ?? undefined,
                    }}
                />
            </section>

            <section className={styles.section} aria-labelledby="settings-safety-title">
                <h3 id="settings-safety-title" className={styles.sectionTitle}>
                    안전
                </h3>
                <div className={styles.grid}>{SAFETY_FIELDS.map(f_NumberField)}</div>
                <details className={styles.details} open={advancedOpen} onToggle={h_ToggleAdvanced}>
                    <summary className={styles.summary}>고급</summary>
                    <div className={styles.detailsBody}>
                        <ZBCCheckbox
                            id="settings-case-insensitive"
                            checked={draft.compare.caseInsensitivePaths}
                            onChange={h_CaseInsensitive}
                            label="remote 경로의 대소문자를 무시하고 비교"
                            description="로컬·UNC 경로는 항상 대소문자를 무시합니다. 바꾸면 기존 작업은 다음에 저장할 때 다시 검사됩니다."
                        />
                    </div>
                </details>
            </section>

            <section className={styles.section} aria-labelledby="settings-logs-title">
                <h3 id="settings-logs-title" className={styles.sectionTitle}>
                    로그·이력
                </h3>
                <div className={styles.grid}>{LOG_FIELDS.map(f_NumberField)}</div>
                <div>
                    <ZBCButton onClick={h_OpenLogs}>로그 폴더 열기</ZBCButton>
                </div>
            </section>

            <section className={styles.section} aria-labelledby="settings-ui-title">
                <h3 id="settings-ui-title" className={styles.sectionTitle}>
                    화면
                </h3>
                <ZBCField label="테마" htmlFor="settings-theme">
                    <ZBCSelect
                        id="settings-theme"
                        name="theme"
                        value={draft.ui.theme}
                        options={THEME_OPTIONS}
                        onChange={h_Theme}
                    />
                </ZBCField>
            </section>

            <section className={styles.section} aria-labelledby="settings-about-title">
                <h3 id="settings-about-title" className={styles.sectionTitle}>
                    앱 정보
                </h3>
                <dl className={styles.about}>
                    <dt>버전</dt>
                    <dd>
                        {info
                            ? `v${info.appVersion} · Electron ${info.electron} · Node ${info.node} · ${info.platform}`
                            : "불러오는 중…"}
                    </dd>
                    <dt>데이터 위치</dt>
                    <dd className={styles.mono}>{info?.userDataPath ?? "-"}</dd>
                </dl>
            </section>

            <footer className={styles.footer}>
                <output className={styles.footerText}>
                    {showErrors && !check.ok
                        ? `고칠 곳이 ${Object.keys(check.fieldErrors).length || 1}개 있습니다.`
                        : dirty
                          ? "저장하지 않은 설정 변경이 있습니다."
                          : "저장됨"}
                </output>
                <ZBCButton onClick={h_Revert} disabled={!dirty || saving}>
                    되돌리기
                </ZBCButton>
                <ZBCButton variant="primary" onClick={h_Save} disabled={!dirty || saving}>
                    {saving ? "저장 중…" : "설정 저장"}
                </ZBCButton>
            </footer>
        </div>
    );
}
