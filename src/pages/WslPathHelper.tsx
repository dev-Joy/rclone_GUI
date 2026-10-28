/**
 * WSL 경로 도우미 (모달). 배포판과 리눅스 경로로 `\\wsl.localhost\<배포판>\...` 경로를 만들어
 * 해당 입력란에 넣는다. `/mnt/<드라이브>/...` 는 Windows 경로를 권장하고 UNC는 대안으로 보여 준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useState } from "react";

// ========== Internal imports ==========
import ZBCButton from "@/components/ZBCButton";
import ZBCField from "@/components/ZBCField";
import ZBCInput from "@/components/ZBCInput";
import ZBCModal from "@/components/ZBCModal";
import ZBCSelect from "@/components/ZBCSelect";
import { linuxPathToWslUnc, mntPathToWindows } from "@/shared/path-utils";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import styles from "./WslPathHelper.module.css";

// ========== Props & Types ==========
export interface itfWslPathHelperProps {
    open: boolean;
    /** 입력란 id 접두사 (원본·대상 도우미가 동시에 있어도 id가 겹치지 않게) */
    idPrefix: string;
    onApply: (path: string) => void;
    onClose: () => void;
}

export default function WslPathHelper(props: itfWslPathHelperProps) {
    const { open, idPrefix, onApply, onClose } = props;

    // ========== hook & state 변수 선언 ==========
    const [distro, setDistro] = useState("");
    const [linuxPath, setLinuxPath] = useState("/home/");
    const [loading, setLoading] = useState(false);
    const distros = useRcloneEnvStore((s) => s.distros);
    const wslError = useRcloneEnvStore((s) => s.wslError);
    const loadDistros = useRcloneEnvStore((s) => s.loadDistros);

    // ========== Effect (부수 효과) ==========
    // 처음 열 때 배포판 목록을 한 번 불러온다
    useEffect(() => {
        if (open && distros === null && wslError === null) void loadDistros();
    }, [open, distros, wslError, loadDistros]);

    // ========== 내부 변수 (_V) ==========
    const selectedDistro = distro || distros?.[0] || "";
    const trimmed = linuxPath.trim();
    const uncPreview = selectedDistro ? linuxPathToWslUnc(selectedDistro, trimmed) : null;
    const windowsAlt = mntPathToWindows(trimmed);
    const distroOptions = (distros ?? []).map((d) => ({ value: d, label: d }));

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Reload = () => {
        setLoading(true);
        void loadDistros().finally(() => setLoading(false));
    };
    const h_UseUnc = () => {
        if (uncPreview) onApply(uncPreview);
    };
    const h_UseWindows = () => {
        if (windowsAlt) onApply(windowsAlt);
    };

    return (
        <ZBCModal
            open={open}
            title="WSL 경로 도우미"
            onClose={onClose}
            footer={<ZBCButton onClick={onClose}>닫기</ZBCButton>}
        >
            <div className={styles.WslPathHelper}>
                <div className={styles.row}>
                    <ZBCButton onClick={h_Reload} disabled={loading}>
                        {loading ? "불러오는 중…" : "WSL 배포판 불러오기"}
                    </ZBCButton>
                    {distros && distros.length === 0 && (
                        <span className={styles.muted}>설치된 배포판이 없습니다.</span>
                    )}
                </div>
                {wslError && (
                    <p className={styles.error} role="alert">
                        {wslError}
                    </p>
                )}
                {distroOptions.length > 0 && (
                    <ZBCField label="배포판" htmlFor={`${idPrefix}-wsl-distro`}>
                        <ZBCSelect
                            id={`${idPrefix}-wsl-distro`}
                            value={selectedDistro}
                            options={distroOptions}
                            onChange={setDistro}
                        />
                    </ZBCField>
                )}
                <ZBCField
                    label="리눅스 경로"
                    htmlFor={`${idPrefix}-wsl-path`}
                    hint="예: /home/사용자/프로젝트"
                >
                    <ZBCInput
                        id={`${idPrefix}-wsl-path`}
                        value={linuxPath}
                        onChange={setLinuxPath}
                        describedBy={`${idPrefix}-wsl-path-desc`}
                        mono
                    />
                </ZBCField>
                {windowsAlt && (
                    <div className={styles.preview}>
                        <span className={styles.mono}>{windowsAlt}</span>
                        <ZBCButton variant="primary" onClick={h_UseWindows}>
                            Windows 경로를 입력란에 넣기(더 빠름)
                        </ZBCButton>
                    </div>
                )}
                {uncPreview && (
                    <div className={styles.preview}>
                        <span className={styles.mono}>{uncPreview}</span>
                        <ZBCButton
                            variant={windowsAlt ? "secondary" : "primary"}
                            onClick={h_UseUnc}
                        >
                            이 UNC 경로를 입력란에 넣기
                        </ZBCButton>
                    </div>
                )}
                {!uncPreview && !windowsAlt && trimmed !== "" && (
                    <p className={styles.muted}>
                        {selectedDistro
                            ? "/ 로 시작하는 리눅스 절대 경로를 입력하세요."
                            : "배포판을 불러온 뒤 고르세요."}
                    </p>
                )}
            </div>
        </ZBCModal>
    );
}
