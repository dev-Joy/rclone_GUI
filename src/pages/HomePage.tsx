/**
 * 첫 화면. 앱·런타임 정보, 시작 알림(저장 파일 복구 등), rclone 온보딩 배너, 저장된 작업 목록,
 * rclone 설정·경로 접근 확인 도구를 보여준다.
 * 작업 편집·비교·실행 화면은 이후 단계(Phase 4~)에서 붙인다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useState } from "react";

// ========== Internal imports ==========
import ZBCToast from "@/components/ZBCToast";
import { errorText, getApi, unwrap } from "@/lib/api";
import type { itfAppInfo, itfAppNotice } from "@/shared/ipc-contract";
import { useJobsStore } from "@/stores/jobs-store";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";
import styles from "./HomePage.module.css";
import OnboardingBanner from "./OnboardingBanner";
import PathCheckPanel from "./PathCheckPanel";
import RcloneSetupPanel from "./RcloneSetupPanel";

// ========== Props & Types ==========
export interface itfHomePageProps {
    title?: string;
}

const propsDefault = {
    title: "rcloneGUI",
} satisfies Partial<itfHomePageProps>;

const MODE_LABEL = { copy: "복사", sync: "동기화(삭제 포함)" } as const;

export default function HomePage(props: itfHomePageProps) {
    const { title = propsDefault.title } = props;

    // ========== hook & state 변수 선언 ==========
    const [info, setInfo] = useState<itfAppInfo | null>(null);
    const [notices, setNotices] = useState<itfAppNotice[]>([]);
    const jobs = useJobsStore((s) => s.jobs);
    const jobsError = useJobsStore((s) => s.error);
    const loadJobs = useJobsStore((s) => s.load);
    const subscribeJobs = useJobsStore((s) => s.subscribe);
    const settings = useSettingsStore((s) => s.settings);
    const loadSettings = useSettingsStore((s) => s.load);
    const toasts = useToastStore((s) => s.toasts);
    const pushToast = useToastStore((s) => s.push);
    const dismissToast = useToastStore((s) => s.dismiss);
    const detectRclone = useRcloneEnvStore((s) => s.detect);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        const api = getApi();
        unwrap(api.app.getInfo())
            .then(setInfo)
            .catch((e: unknown) => pushToast("error", errorText(e)));
        unwrap(api.app.getNotices())
            .then(setNotices)
            .catch((e: unknown) => pushToast("error", errorText(e)));
        void loadSettings();
        void loadJobs();
        return subscribeJobs();
    }, [loadJobs, loadSettings, pushToast, subscribeJobs]);

    // rclone 감지는 화면이 뜬 뒤 비동기로 한다(main 시작을 늦추지 않음)
    useEffect(() => {
        void detectRclone();
    }, [detectRclone]);

    useEffect(() => {
        const theme = settings?.ui.theme ?? "system";
        if (theme === "system") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = theme;
    }, [settings?.ui.theme]);

    // ========== 내부 변수 (_V) ==========
    const metaText = info
        ? `v${info.appVersion} · Electron ${info.electron} · Node ${info.node} · ${info.platform}`
        : "불러오는 중…";

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_OpenLogs = () => {
        unwrap(getApi().app.openLogsFolder()).catch((e: unknown) =>
            pushToast("error", errorText(e)),
        );
    };

    return (
        <main className={styles.HomePage}>
            <header className={styles.header}>
                <h1 className={styles.title}>{title}</h1>
                <span className={styles.meta}>{metaText}</span>
            </header>

            {notices.map((n, i) => (
                <p key={i} className={styles.notice} data-level={n.level} role="alert">
                    {n.message}
                </p>
            ))}

            <OnboardingBanner />

            <section className={styles.panel} aria-labelledby="jobs-title">
                <h2 id="jobs-title" className={styles.panelTitle}>
                    저장된 작업 {jobs.length}개
                </h2>
                {jobsError && (
                    <p className={styles.notice} data-level="error">
                        {jobsError}
                    </p>
                )}
                {jobs.length === 0 ? (
                    <p className={styles.empty}>아직 저장된 작업이 없습니다.</p>
                ) : (
                    <ul className={styles.jobList}>
                        {jobs.map((job) => (
                            <li key={job.id} className={styles.jobItem}>
                                <strong>{job.name}</strong>
                                <span
                                    className={styles.jobPaths}
                                    title={`${job.source} → ${job.destination}`}
                                >
                                    {job.source} → {job.destination}
                                </span>
                                <span>{MODE_LABEL[job.mode]}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <RcloneSetupPanel />
            <PathCheckPanel />

            <section className={styles.panel} aria-labelledby="data-title">
                <h2 id="data-title" className={styles.panelTitle}>
                    데이터 위치
                </h2>
                <p className={styles.meta}>{info?.userDataPath ?? "-"}</p>
                <button type="button" className={styles.linkButton} onClick={h_OpenLogs}>
                    로그 폴더 열기
                </button>
            </section>

            <ZBCToast toasts={toasts} onDismiss={dismissToast} />
        </main>
    );
}
