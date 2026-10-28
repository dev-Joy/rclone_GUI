/**
 * 첫 화면(앱 셸). 앱 정보·시작 알림·설정·작업 목록을 불러오고 rclone을 감지한 뒤
 * 상단 막대 + 작업 목록 + [작업 화면 | 설정 화면]을 조립한다.
 * 작업 선택이 바뀌면 편집기를 그 작업으로 열고, 목록이 바뀌면 편집기에 알린다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCToast from "@/components/ZBCToast";
import { errorText, getApi, unwrap } from "@/lib/api";
import type { itfAppInfo, itfAppNotice } from "@/shared/ipc-contract";
import { useCompareStore } from "@/stores/compare-store";
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/stores/toast-store";
import { useUiStore } from "@/stores/ui-store";
import AppLayout from "./AppLayout";
import DiscardChangesModal from "./DiscardChangesModal";
import JobSidebar from "./JobSidebar";
import JobWorkspace from "./JobWorkspace";
import OnboardingBanner from "./OnboardingBanner";
import SettingsPage from "./SettingsPage";
import TopBar from "./TopBar";
import styles from "./HomePage.module.css";

// ========== Props & Types ==========
export interface itfHomePageProps {
    title?: string;
}

const propsDefault = {
    title: "rcloneGUI",
} satisfies Partial<itfHomePageProps>;

export default function HomePage(props: itfHomePageProps) {
    const { title = propsDefault.title } = props;

    // ========== hook & state 변수 선언 ==========
    const [info, setInfo] = useState<itfAppInfo | null>(null);
    const [notices, setNotices] = useState<itfAppNotice[]>([]);
    const jobs = useJobsStore((s) => s.jobs);
    const jobsLoading = useJobsStore((s) => s.loading);
    const selectedJobId = useJobsStore((s) => s.selectedJobId);
    const loadJobs = useJobsStore((s) => s.load);
    const subscribeJobs = useJobsStore((s) => s.subscribe);
    const settings = useSettingsStore((s) => s.settings);
    const loadSettings = useSettingsStore((s) => s.load);
    const toasts = useToastStore((s) => s.toasts);
    const pushToast = useToastStore((s) => s.push);
    const dismissToast = useToastStore((s) => s.dismiss);
    const detectRclone = useRcloneEnvStore((s) => s.detect);
    const editorOpen = useJobEditorStore((s) => s.open);
    const openNew = useJobEditorStore((s) => s.openNew);
    const view = useUiStore((s) => s.view);
    const subscribeCompare = useCompareStore((s) => s.subscribe);
    const showCompare = useCompareStore((s) => s.show);

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

    // 비교 진행 이벤트 구독(진행 중인 비교는 getActive로 복구)
    useEffect(() => subscribeCompare(), [subscribeCompare]);

    // 선택한 작업의 마지막 비교 결과를 main에서 받는다(화면에는 작업 1개 결과만 둔다)
    useEffect(() => {
        void showCompare(selectedJobId);
    }, [selectedJobId, showCompare]);

    // rclone 감지는 화면이 뜬 뒤 비동기로 한다(main 시작을 늦추지 않음)
    useEffect(() => {
        void detectRclone();
    }, [detectRclone]);

    useEffect(() => {
        const theme = settings?.ui.theme ?? "system";
        if (theme === "system") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = theme;
    }, [settings?.ui.theme]);

    // 목록이 바뀌면 편집기에 알린다(외부 변경·삭제)
    useEffect(() => {
        useJobEditorStore.getState().syncFromJobs(jobs);
    }, [jobs]);

    // 선택한 작업을 편집기로 연다 (null은 새 작업 편집 또는 빈 상태라 편집기가 직접 처리)
    useEffect(() => {
        if (selectedJobId === null) return;
        const job = jobs.find((j) => j.id === selectedJobId);
        const editor = useJobEditorStore.getState();
        if (job && (!editor.open || editor.jobId !== job.id)) editor.openJob(job);
    }, [selectedJobId, jobs]);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_New = () => {
        if (settings) openNew(settings);
    };

    let content;
    if (view === "settings") content = <SettingsPage info={info} />;
    else if (editorOpen) content = <JobWorkspace />;
    else {
        content = (
            <div className={styles.empty}>
                <p>
                    {jobsLoading
                        ? "작업 목록을 불러오는 중…"
                        : "아직 저장된 작업이 없습니다. 원본·대상 폴더를 정해 첫 작업을 만드세요."}
                </p>
                <ZBCButton variant="primary" onClick={h_New} disabled={!settings}>
                    새 작업 만들기
                </ZBCButton>
            </div>
        );
    }

    return (
        <div className={styles.HomePage}>
            <AppLayout
                topBar={<TopBar title={title} />}
                sidebar={<JobSidebar />}
                banner={
                    <>
                        {notices.map((n, i) => (
                            <p key={i} className={styles.notice} data-level={n.level} role="alert">
                                {n.message}
                            </p>
                        ))}
                        <OnboardingBanner />
                    </>
                }
            >
                {content}
            </AppLayout>
            <DiscardChangesModal />
            <ZBCToast toasts={toasts} onDismiss={dismissToast} />
        </div>
    );
}
