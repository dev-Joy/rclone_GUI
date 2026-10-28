/**
 * rclone 설정 영역. 감지 상태·버전·rclone 경로·설정 파일·remote 목록·경고를 보여주고
 * 다시 감지, rclone.exe·rclone.conf 직접 지정과 자동 감지로 되돌리기를 제공한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type { typBinarySource, typConfigSource } from "@/shared/ipc-contract";
import { driveLetterRemoteWarning, findDriveLetterRemotes } from "@/shared/remote-name";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import styles from "./RcloneSetupPanel.module.css";

const BINARY_SOURCE_LABEL: Record<typBinarySource, string> = {
    manual: "직접 지정",
    path: "PATH에서 찾음",
    common: "설치 위치에서 찾음",
};

const CONFIG_SOURCE_LABEL: Record<typConfigSource, string> = {
    manual: "직접 지정",
    env: "환경 변수 RCLONE_CONFIG",
    auto: "rclone 기본 위치",
    none: "없음",
};

export default function RcloneSetupPanel() {
    // ========== hook & state 변수 선언 ==========
    const env = useRcloneEnvStore((s) => s.env);
    const detecting = useRcloneEnvStore((s) => s.detecting);
    const detect = useRcloneEnvStore((s) => s.detect);
    const pickRclone = useRcloneEnvStore((s) => s.pickRclone);
    const pickConfig = useRcloneEnvStore((s) => s.pickConfig);
    const resetToAuto = useRcloneEnvStore((s) => s.resetToAuto);

    // ========== 내부 변수 (_V) ==========
    const ok = env !== null && env.problem === null;
    const statusText = env === null ? "확인 중…" : ok ? "사용 가능" : "문제 있음";
    const versionText = env?.versionText
        ? `${env.versionText}${env.os ? ` (${env.os}/${env.arch ?? "?"})` : ""}`
        : "-";
    const binaryText = env?.binaryPath
        ? `${env.binaryPath} · ${env.binarySource ? BINARY_SOURCE_LABEL[env.binarySource] : ""}`
        : "-";
    const configText = env
        ? `${env.configPath ?? "-"} · ${CONFIG_SOURCE_LABEL[env.configSource]}`
        : "-";
    const remotesText =
        env && env.remotes.length > 0 ? env.remotes.map((r) => `${r}:`).join(", ") : "없음";
    const driveLetterWarning = env
        ? driveLetterRemoteWarning(findDriveLetterRemotes(env.remotes))
        : null;

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Detect = () => void detect(true);
    const h_PickRclone = () => void pickRclone();
    const h_AutoRclone = () => void resetToAuto("rclonePath");
    const h_PickConfig = () => void pickConfig();
    const h_AutoConfig = () => void resetToAuto("configPath");

    return (
        <section className={styles.RcloneSetupPanel} aria-labelledby="rclone-setup-title">
            <h2 id="rclone-setup-title" className={styles.title}>
                rclone 설정
            </h2>
            <dl className={styles.table}>
                <dt>상태</dt>
                <dd data-state={env === null ? "pending" : ok ? "ok" : "problem"}>
                    {statusText}
                    {env?.problem ? ` — ${env.problem.message}` : ""}
                </dd>
                <dt>버전</dt>
                <dd>{versionText}</dd>
                <dt>rclone 경로</dt>
                <dd className={styles.path} title={env?.binaryPath ?? ""}>
                    {binaryText}
                </dd>
                <dt>설정 파일</dt>
                <dd className={styles.path} title={env?.configPath ?? ""}>
                    {configText}
                </dd>
                <dt>remote</dt>
                <dd>{remotesText}</dd>
            </dl>
            {env && (env.warnings.length > 0 || driveLetterWarning) && (
                <ul className={styles.warnings}>
                    {env.warnings.map((w) => (
                        <li key={w}>{w}</li>
                    ))}
                    {driveLetterWarning && <li>{driveLetterWarning}</li>}
                </ul>
            )}
            <div className={styles.actions}>
                <button
                    type="button"
                    className={styles.button}
                    onClick={h_Detect}
                    disabled={detecting}
                >
                    {detecting ? "찾는 중…" : "rclone 다시 찾기"}
                </button>
                <button type="button" className={styles.button} onClick={h_PickRclone}>
                    rclone.exe 직접 지정
                </button>
                <button
                    type="button"
                    className={styles.button}
                    onClick={h_AutoRclone}
                    disabled={env?.binarySource !== "manual"}
                >
                    rclone 자동 감지로 되돌리기
                </button>
                <button type="button" className={styles.button} onClick={h_PickConfig}>
                    rclone.conf 파일 고르기
                </button>
                <button
                    type="button"
                    className={styles.button}
                    onClick={h_AutoConfig}
                    disabled={env?.configSource !== "manual"}
                >
                    설정 파일 자동으로 찾기
                </button>
            </div>
        </section>
    );
}
