/**
 * 상단 막대: 브랜드, rclone 상태 알약(누르면 설정), 설정 단추, 다음 자동 실행 글, 일시정지 토글.
 * INT-008 FR-4: 화면 전환(navigation)을 없애고 상단 막대 자체에 필요한 동작만 둔다.
 * 설정을 닫을 때 저장하지 않은 변경이 있으면 먼저 확인한다(guard·leaveSettings).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import { nextAutoRunText } from "@/lib/history-view";
import { formatLocalDateTime } from "@/shared/format";
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useSchedulerStore } from "@/stores/scheduler-store";
import { useUiStore } from "@/stores/ui-store";
import styles from "./TopBar.module.css";

// ========== Props & Types ==========
export interface itfTopBarProps {
    title?: string;
}

const propsDefault = {
    title: "rcloneGUI",
} satisfies Partial<itfTopBarProps>;

export default function TopBar(props: itfTopBarProps) {
    const { title = propsDefault.title } = props;

    // ========== hook & state 변수 선언 ==========
    const env = useRcloneEnvStore((s) => s.env);
    const envError = useRcloneEnvStore((s) => s.error);
    const settingsOpen = useUiStore((s) => s.settingsOpen);
    const openSettings = useUiStore((s) => s.openSettings);
    const closeSettings = useUiStore((s) => s.closeSettings);
    const leaveSettings = useUiStore((s) => s.leaveSettings);
    const guard = useJobEditorStore((s) => s.guard);
    const scheduler = useSchedulerStore((s) => s.state);
    const pausePending = useSchedulerStore((s) => s.pending);
    const setPaused = useSchedulerStore((s) => s.setPaused);

    // ========== 내부 변수 (_V) ==========
    const statusBad = envError !== null || (env !== null && env.problem !== null);
    const statusText =
        envError !== null
            ? "rclone 확인 실패"
            : env === null
              ? "rclone 확인 중…"
              : env.problem
                ? "rclone 문제 있음"
                : `rclone 사용 가능 ${env.versionText ?? ""}`.trim();
    const statusTitle = env?.problem?.message ?? envError ?? undefined;
    const paused = scheduler?.paused ?? false;
    const autoText = nextAutoRunText(scheduler, formatLocalDateTime);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    /** 설정 화면을 연다(이미 열려 있으면 닫는다: 화면 전환 단추가 없어진 자리를 대신한다) */
    const h_Settings = () => {
        if (settingsOpen) leaveSettings(closeSettings);
        else guard(openSettings);
    };
    const h_TogglePause = () => void setPaused(!paused);

    return (
        <>
            <h1 className={styles.brand}>{title}</h1>
            <button
                type="button"
                className={styles.pill}
                data-tone={statusBad ? "danger" : undefined}
                title={statusTitle}
                onClick={h_Settings}
            >
                {statusText}
            </button>
            <ZBCButton
                small
                onClick={h_Settings}
                title={settingsOpen ? "설정 화면을 닫습니다." : undefined}
            >
                설정
            </ZBCButton>
            <span className={styles.spacer} />
            {scheduler && (
                <div className={styles.auto}>
                    <output className={styles.autoText}>{autoText}</output>
                    <ZBCButton
                        small
                        onClick={h_TogglePause}
                        disabled={pausePending}
                        title={
                            paused
                                ? "자동 실행을 다시 시작합니다(지난 예약은 30초 뒤)."
                                : "새 자동 실행을 멈춥니다(진행 중인 실행은 계속)."
                        }
                    >
                        {paused ? "자동 실행 재개" : "자동 실행 일시정지"}
                    </ZBCButton>
                </div>
            )}
        </>
    );
}
