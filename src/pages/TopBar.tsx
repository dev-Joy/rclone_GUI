/**
 * 상단 막대: 앱 제목, rclone 상태(글자로 표시), 작업·설정 화면 전환.
 * 설정으로 옮길 때 저장하지 않은 작업 변경이 있으면 먼저 확인한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import ZBCBadge, { type typZBCBadgeTone } from "@/components/ZBCBadge";
import ZBCButton from "@/components/ZBCButton";
import { useJobEditorStore } from "@/stores/job-editor-store";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
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
    const view = useUiStore((s) => s.view);
    const setView = useUiStore((s) => s.setView);
    const leaveSettings = useUiStore((s) => s.leaveSettings);
    const guard = useJobEditorStore((s) => s.guard);

    // ========== 내부 변수 (_V) ==========
    const status: { tone: typZBCBadgeTone; text: string } =
        envError !== null
            ? { tone: "danger", text: "rclone 확인 실패" }
            : env === null
              ? { tone: "neutral", text: "rclone 확인 중…" }
              : env.problem
                ? { tone: "danger", text: "rclone 문제 있음" }
                : { tone: "success", text: `rclone 사용 가능 ${env.versionText ?? ""}`.trim() };

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Jobs = () => leaveSettings(() => setView("job"));
    const h_Settings = () => {
        if (view !== "settings") guard(() => setView("settings"));
    };

    return (
        <header className={styles.TopBar}>
            <h1 className={styles.title}>{title}</h1>
            <ZBCBadge tone={status.tone} title={env?.problem?.message}>
                {status.text}
            </ZBCBadge>
            <span className={styles.spacer} />
            <nav className={styles.nav} aria-label="화면 전환">
                <ZBCButton variant={view === "job" ? "primary" : "secondary"} onClick={h_Jobs}>
                    작업
                </ZBCButton>
                <ZBCButton
                    variant={view === "settings" ? "primary" : "secondary"}
                    onClick={h_Settings}
                >
                    설정
                </ZBCButton>
            </nav>
        </header>
    );
}
