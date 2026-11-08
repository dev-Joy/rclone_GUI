/**
 * 작업 화면의 주 화면(pane="work"): 위쪽 단계 막대(① 비교 → ② 미리보기 → ③ 실행), 왼쪽 ‘대상에 일어날 일’ 패널,
 * 오른쪽 파일 목록(CompareView) 또는 실제 실행 진행·결과(RunView kind="real"), 하단 고정 실행 막대.
 * 비교·미리보기·실행 버튼의 가능 여부와 이유는 여기서 canStartCompare·canStartRun으로 정한다(실행 중이면 비교도 막음).
 * 실제 실행은 확인 창(onAskRun → useRunFlow.ask)을 거친다. 확인 창·사전 확인 불일치 안내는 JobWorkspace에 있다.
 *
 * @author dev-Joy 2026-11-08
 */

// ========== Internal imports ==========
import { canStartCompare, compareStaleReason } from "@/lib/compare-view";
import { jobSteps, runBarText, workMainPanel } from "@/lib/job-steps";
import { canStartRun, RUN_LABEL } from "@/lib/run-view";
import type { typJob } from "@/shared/schemas/job";
import { runningCompare, useCompareStore } from "@/stores/compare-store";
import { selectDirty, useJobEditorStore } from "@/stores/job-editor-store";
import { useRunStore } from "@/stores/run-store";
import { useSettingsStore } from "@/stores/settings-store";
import ComparePlanPanel from "./ComparePlanPanel";
import CompareView from "./CompareView";
import JobRunBar from "./JobRunBar";
import JobStepBar from "./JobStepBar";
import RunView from "./RunView";
import styles from "./JobWorkView.module.css";

// ========== Props & Types ==========
export interface itfJobWorkViewProps {
    job: typJob;
    /** 낡음 판정 기준 시각(JobWorkspace의 30초 tick) */
    nowMs: number;
    /** 실제 실행 확인 창 열기(useRunFlow.ask) */
    onAskRun: (jobId: string) => void;
}

export default function JobWorkView(props: itfJobWorkViewProps) {
    const { job, nowMs, onAskRun } = props;

    // ========== hook & state 변수 선언 ==========
    const dirty = useJobEditorStore(selectDirty);
    const compareActive = useCompareStore((s) => s.active);
    const compareRunningJobId = useCompareStore((s) => s.runningJobId);
    const compareResult = useCompareStore((s) => s.result);
    const runCompare = useCompareStore((s) => s.run);
    const runActive = useRunStore((s) => s.active);
    const runStartingJobId = useRunStore((s) => s.startingJobId);
    const last = useRunStore((s) => s.last);
    const runError = useRunStore((s) => s.error);
    const startRun = useRunStore((s) => s.start);
    const caseInsensitive = useSettingsStore(
        (s) => s.settings?.compare.caseInsensitivePaths ?? true,
    );
    const maxAgeMinutes = useSettingsStore((s) => s.settings?.safety.compareMaxAgeMinutes ?? 10);

    // ========== 내부 변수 (_V) ==========
    const running = runningCompare(compareActive, compareRunningJobId);
    const comparing = running?.jobId === job.id;
    const runningJobId = runActive?.jobId ?? runStartingJobId;
    const baseCompareCheck = canStartCompare({ job, dirty, running, caseInsensitive });
    const compareCheck =
        baseCompareCheck.ok && runningJobId !== null
            ? { ok: false as const, reason: "실행 중에는 비교할 수 없습니다." }
            : baseCompareCheck;
    const compareReason = compareCheck.ok ? null : compareCheck.reason;
    const runInput = {
        job,
        dirty,
        caseInsensitive,
        comparing: running,
        runningJobId,
        compare: compareResult,
        maxAgeMinutes,
        nowMs,
    };
    const dryCheck = canStartRun({ ...runInput, dryRun: true });
    const realCheck = canStartRun({ ...runInput, dryRun: false });
    const dryReason = dryCheck.ok ? null : dryCheck.reason;
    const realReason = realCheck.ok ? null : realCheck.reason;
    const reasonText = compareReason ?? realReason ?? "";
    const shown = compareResult?.jobId === job.id ? compareResult : null;
    const stale = shown ? compareStaleReason(shown, job, maxAgeMinutes, nowMs) : null;
    const lastReal = last && last.record.jobId === job.id && !last.record.dryRun ? last : null;
    const steps = jobSteps({
        jobId: job.id,
        mode: job.mode,
        comparing,
        compare: shown,
        staleReason: stale,
        run: runActive,
        last,
        realReady: realCheck.ok,
        nowMs,
    });
    const barText = runBarText({
        job,
        compare: shown,
        staleReason: stale,
        maxAgeMinutes,
        nowMs,
        lastReal,
    });
    const main = workMainPanel({
        jobId: job.id,
        run: runActive,
        comparing,
        compareCreatedAt: shown?.createdAt ?? null,
        startError: runError,
        last,
    });

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Compare = () => void runCompare(job.id);
    const h_Preview = () => void startRun(job.id, true);
    const h_Run = () => onAskRun(job.id);

    return (
        <div className={styles.JobWorkView}>
            <JobStepBar steps={steps} />
            <div className={styles.body}>
                <ComparePlanPanel job={job} nowMs={nowMs} />
                <div className={styles.main}>
                    {main === "run" ? (
                        <section
                            id="job-run-panel"
                            className={styles.runPanel}
                            aria-label="실행 진행·결과"
                        >
                            <RunView job={job} kind="real" />
                        </section>
                    ) : (
                        <CompareView job={job} />
                    )}
                </div>
            </div>
            <JobRunBar
                jobId={job.id}
                text={barText}
                reason={reasonText}
                compare={{
                    label: comparing ? "비교 중…" : shown ? "다시 비교" : "비교",
                    disabled: !compareCheck.ok,
                    title:
                        compareReason ?? "원본·대상 목록을 읽어 차이를 봅니다(파일은 바꾸지 않음).",
                }}
                preview={{
                    label: "미리보기",
                    disabled: !dryCheck.ok,
                    title: dryReason ?? "rclone이 할 일을 미리 봅니다(파일은 바꾸지 않음).",
                }}
                run={{
                    label: RUN_LABEL[job.mode],
                    disabled: !realCheck.ok,
                    title:
                        realReason ??
                        (job.mode === "sync"
                            ? "비교 결과대로 대상을 원본과 같게 만듭니다(삭제 포함)."
                            : "비교 결과대로 대상에 복사합니다."),
                }}
                onCompare={h_Compare}
                onPreview={h_Preview}
                onRun={h_Run}
            />
        </div>
    );
}
