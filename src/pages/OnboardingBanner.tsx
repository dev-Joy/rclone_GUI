/**
 * rclone 온보딩 배너. rclone을 못 찾았거나 버전이 낮거나 지정한 rclone.conf가 없을 때
 * 무엇을 할 수 없는지와 바로 할 수 있는 조치(직접 지정·다시 찾기·설치 안내)를 보여준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import type { typErrorCode } from "@/shared/errors";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useToastStore } from "@/stores/toast-store";
import styles from "./OnboardingBanner.module.css";

const INSTALL_URL = "https://rclone.org/install/";

const PROBLEM_TITLE: Partial<Record<typErrorCode, string>> = {
    RCLONE_NOT_FOUND: "rclone을 찾지 못해 비교·동기화를 할 수 없습니다.",
    RCLONE_NOT_EXECUTABLE: "rclone을 실행하지 못해 비교·동기화를 할 수 없습니다.",
    RCLONE_VERSION_UNSUPPORTED: "이 rclone 버전으로는 비교·동기화를 할 수 없습니다.",
    CONFIG_NOT_FOUND: "지정한 rclone.conf가 없어 remote 경로를 쓸 수 없습니다.",
};

export default function OnboardingBanner() {
    // ========== hook & state 변수 선언 ==========
    const env = useRcloneEnvStore((s) => s.env);
    const error = useRcloneEnvStore((s) => s.error);
    const detecting = useRcloneEnvStore((s) => s.detecting);
    const detect = useRcloneEnvStore((s) => s.detect);
    const pickRclone = useRcloneEnvStore((s) => s.pickRclone);
    const pickConfig = useRcloneEnvStore((s) => s.pickConfig);
    const resetToAuto = useRcloneEnvStore((s) => s.resetToAuto);
    const pushToast = useToastStore((s) => s.push);

    // ========== 내부 변수 (_V) ==========
    const problem = env?.problem ?? null;
    const isConfigProblem = problem?.code === "CONFIG_NOT_FOUND";
    const noConfig = env !== null && problem === null && env.configSource === "none";

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Redetect = () => void detect(true);
    const h_PickRclone = () => void pickRclone();
    const h_PickConfig = () => void pickConfig();
    const h_AutoConfig = () => void resetToAuto("configPath");
    const h_OpenInstall = () => {
        unwrap(getApi().system.openExternal(INSTALL_URL)).catch((e: unknown) =>
            pushToast("error", errorText(e)),
        );
    };

    if (error) {
        return (
            <section className={styles.OnboardingBanner} data-level="error" role="alert">
                <p className={styles.title}>rclone 상태를 확인하지 못했습니다.</p>
                <p className={styles.detail}>{error}</p>
                <div className={styles.actions}>
                    <button type="button" className={styles.button} onClick={h_Redetect}>
                        다시 확인
                    </button>
                </div>
            </section>
        );
    }

    if (noConfig) {
        return (
            <section className={styles.OnboardingBanner} data-level="info">
                <p className={styles.title}>
                    rclone 설정 파일이 없어 로컬·UNC 경로만 쓸 수 있습니다.
                </p>
                <div className={styles.actions}>
                    <button type="button" className={styles.button} onClick={h_PickConfig}>
                        rclone.conf 파일 고르기
                    </button>
                </div>
            </section>
        );
    }

    if (!problem) return null;

    return (
        <section className={styles.OnboardingBanner} data-level="error" role="alert">
            <p className={styles.title}>{PROBLEM_TITLE[problem.code] ?? problem.message}</p>
            <p className={styles.detail}>{problem.message}</p>
            <div className={styles.actions}>
                {isConfigProblem ? (
                    <>
                        <button type="button" className={styles.button} onClick={h_PickConfig}>
                            rclone.conf 다시 고르기
                        </button>
                        <button type="button" className={styles.button} onClick={h_AutoConfig}>
                            설정 파일 자동으로 찾기
                        </button>
                    </>
                ) : (
                    <>
                        <button type="button" className={styles.button} onClick={h_PickRclone}>
                            rclone.exe 직접 지정
                        </button>
                        <button
                            type="button"
                            className={styles.button}
                            onClick={h_Redetect}
                            disabled={detecting}
                        >
                            {detecting ? "찾는 중…" : "rclone 다시 찾기"}
                        </button>
                        <button type="button" className={styles.button} onClick={h_OpenInstall}>
                            설치 안내 열기(rclone.org)
                        </button>
                    </>
                )}
            </div>
        </section>
    );
}
