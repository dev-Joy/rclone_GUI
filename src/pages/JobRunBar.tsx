/**
 * 작업 화면 하단 고정 실행 막대. 활동이 없으면 일어날 일 문장(예: "대상에 6개 복사, 1개 덮어씀")·보조 줄·
 * 막힌 이유와 ‘다시 비교’·‘미리보기’·실행 버튼을 둔다. 이 작업의 비교·미리보기·실행이 진행 중이면 버튼 대신
 * 공통 중지 막대(JobActivityBar: 진행 문구·진행률 + 중지 하나)를 보인다.
 * 버튼 가능 여부와 이유는 부모(JobWorkView)가 canStartCompare·canStartRun으로 정해 넘긴다.
 *
 * @author dev-Joy 2026-11-08
 */

// ========== External imports ==========
import { useEffect, useRef } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import type { itfRunBarText } from "@/lib/job-steps";
import { activityStop } from "@/lib/run-view";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { useRunStore } from "@/stores/run-store";
import JobActivityBar from "./JobActivityBar";
import styles from "./JobRunBar.module.css";

// ========== Props & Types ==========
export interface itfRunBarAction {
    label: string;
    disabled: boolean;
    title: string;
}

export interface itfJobRunBarProps {
    jobId: string;
    text: itfRunBarText;
    /** 막힌 이유. 없으면 "" */
    reason?: string;
    compare: itfRunBarAction;
    preview: itfRunBarAction;
    run: itfRunBarAction;
    onCompare: () => void;
    onPreview: () => void;
    onRun: () => void;
}

/** 실행 막대 위쪽과 토스트 사이 여백(px) */
const TOAST_GAP_PX = 12;

const propsDefault = {
    reason: "",
} satisfies Partial<itfJobRunBarProps>;

export default function JobRunBar(props: itfJobRunBarProps) {
    const {
        jobId,
        text,
        reason = propsDefault.reason,
        compare,
        preview,
        run,
        onCompare,
        onPreview,
        onRun,
    } = props;

    // ========== hook & state 변수 선언 ==========
    const compareActive = useCompareStore((s) => s.active);
    const compareRunningJobId = useCompareStore((s) => s.runningJobId);
    const runActive = useRunStore((s) => s.active);
    const barRef = useRef<HTMLElement>(null);

    // ========== Effect (부수 효과) ==========
    // 저장 토스트(ZBCToast, 화면 오른쪽 아래 고정)가 이 막대의 버튼을 덮지 않도록,
    // 막대가 있는 동안 막대 높이 + 여백만큼 토스트를 올린다. 막대가 사라지면 기본 위치로 돌린다.
    useEffect(() => {
        const bar = barRef.current;
        if (!bar) return;
        const root = document.documentElement;
        const f_Apply = (): void => {
            root.style.setProperty("--zbc-toast-bottom", `${bar.offsetHeight + TOAST_GAP_PX}px`);
        };
        f_Apply();
        const observer = new ResizeObserver(f_Apply);
        observer.observe(bar);
        return () => {
            observer.disconnect();
            root.style.removeProperty("--zbc-toast-bottom");
        };
    }, []);

    // ========== 내부 변수 (_V) ==========
    const busy =
        activityStop({
            jobId,
            compare: runningCompare(compareActive, compareRunningJobId),
            run: runActive,
        }) !== null;

    return (
        <section ref={barRef} className={styles.JobRunBar} aria-label="실행">
            {busy ? (
                <div className={styles.activity}>
                    <JobActivityBar jobId={jobId} />
                </div>
            ) : (
                <>
                    <div className={styles.summary}>
                        <p className={styles.headline}>{text.headline}</p>
                        <p className={styles.detail} title={text.detail}>
                            {text.detail}
                        </p>
                        <output id="job-run-reason" className={styles.reason}>
                            {reason}
                        </output>
                    </div>
                    <div className={styles.buttons}>
                        <ZBCButton
                            id="job-compare"
                            onClick={onCompare}
                            disabled={compare.disabled}
                            title={compare.title}
                        >
                            {compare.label}
                        </ZBCButton>
                        <ZBCButton
                            id="job-preview"
                            onClick={onPreview}
                            disabled={preview.disabled}
                            title={preview.title}
                        >
                            {preview.label}
                        </ZBCButton>
                        <ZBCButton
                            id="job-run"
                            variant="primary"
                            onClick={onRun}
                            disabled={run.disabled}
                            title={run.title}
                            aria-describedby="job-run-reason"
                        >
                            {run.label}
                        </ZBCButton>
                    </div>
                </>
            )}
        </section>
    );
}
