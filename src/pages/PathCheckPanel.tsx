/**
 * 경로 접근 확인 도구. 로컬·UNC·remote 경로를 입력(또는 폴더 선택)해 main의 rclone:testPath로
 * 실제로 열 수 있는지 확인한다. WSL 도우미는 배포판과 리눅스 경로로 UNC 경로를 만들어 준다
 * (`/mnt/<드라이브>/...` 는 Windows 경로를 권장).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useState, type ChangeEvent, type FormEvent } from "react";

// ========== Internal imports ==========
import { errorText, getApi, unwrap } from "@/lib/api";
import type { itfPathProbe } from "@/shared/ipc-contract";
import {
    linuxPathToWslUnc,
    mntPathToWindows,
    parsePath,
    type typPathKind,
} from "@/shared/path-utils";
import { createLatestGate } from "@/shared/latest-request";
import { useRcloneEnvStore } from "@/stores/rclone-env-store";
import { useToastStore } from "@/stores/toast-store";
import styles from "./PathCheckPanel.module.css";

const KIND_LABEL: Record<typPathKind, string> = {
    local: "로컬",
    unc: "UNC",
    remote: "remote",
};

/** 입력 경로의 종류 배지 문구 */
function f_KindText(raw: string): string {
    if (raw.trim() === "") return "";
    const r = parsePath(raw);
    return r.ok ? KIND_LABEL[r.path.kind] : "형식 오류";
}

export default function PathCheckPanel() {
    // ========== hook & state 변수 선언 ==========
    const [path, setPath] = useState("");
    /** 마지막 확인 결과. 경로를 고치면 지운다 */
    const [probe, setProbe] = useState<itfPathProbe | null>(null);
    const [probeError, setProbeError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [distro, setDistro] = useState("");
    const [linuxPath, setLinuxPath] = useState("/home/");
    /** 확인 중 경로가 바뀌거나 다시 누르면 이전 결과를 버린다 */
    const [checkGate] = useState(createLatestGate);
    const remotes = useRcloneEnvStore((s) => s.env?.remotes ?? null);
    const distros = useRcloneEnvStore((s) => s.distros);
    const wslError = useRcloneEnvStore((s) => s.wslError);
    const loadDistros = useRcloneEnvStore((s) => s.loadDistros);
    const pushToast = useToastStore((s) => s.push);

    // ========== 내부 변수 (_V) ==========
    const kindText = f_KindText(path);
    const selectedDistro = distro || distros?.[0] || "";
    const uncPreview = selectedDistro ? linuxPathToWslUnc(selectedDistro, linuxPath.trim()) : null;
    const windowsAlt = mntPathToWindows(linuxPath.trim());

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    function f_SetPath(next: string) {
        checkGate.invalidate();
        setChecking(false);
        setPath(next);
        setProbe(null);
        setProbeError(null);
    }

    const h_PathChange = (e: ChangeEvent<HTMLInputElement>) => f_SetPath(e.target.value);

    const h_Check = async (e?: FormEvent) => {
        e?.preventDefault();
        const isLatest = checkGate.next();
        setChecking(true);
        try {
            const result = await unwrap(getApi().rclone.testPath(path));
            if (!isLatest()) return;
            setProbe(result);
            setProbeError(null);
        } catch (err) {
            if (!isLatest()) return;
            setProbe(null);
            setProbeError(errorText(err));
        } finally {
            if (isLatest()) setChecking(false);
        }
    };

    const h_Submit = (e: FormEvent) => void h_Check(e);

    const h_PickDir = async () => {
        try {
            const picked = await unwrap(
                getApi().dialog.pickDirectory({ title: "확인할 폴더 고르기" }),
            );
            if (picked) f_SetPath(picked);
        } catch (err) {
            pushToast("error", errorText(err));
        }
    };

    const h_PickDirClick = () => void h_PickDir();

    const h_RemoteChange = (e: ChangeEvent<HTMLSelectElement>) => {
        if (e.target.value) f_SetPath(`${e.target.value}:`);
    };

    const h_LoadDistros = () => void loadDistros();
    const h_DistroChange = (e: ChangeEvent<HTMLSelectElement>) => setDistro(e.target.value);
    const h_LinuxChange = (e: ChangeEvent<HTMLInputElement>) => setLinuxPath(e.target.value);
    const h_UseUnc = () => {
        if (uncPreview) f_SetPath(uncPreview);
    };
    const h_UseWindows = () => {
        if (windowsAlt) f_SetPath(windowsAlt);
    };

    return (
        <section className={styles.PathCheckPanel} aria-labelledby="path-check-title">
            <h2 id="path-check-title" className={styles.title}>
                경로 접근 확인
            </h2>

            <form className={styles.row} onSubmit={h_Submit}>
                <label className={styles.grow}>
                    <span className={styles.label}>경로</span>
                    <input
                        className={styles.input}
                        value={path}
                        onChange={h_PathChange}
                        placeholder={
                            "예: D:\\Data, \\\\wsl.localhost\\배포판\\home\\..., remote:폴더"
                        }
                        spellCheck={false}
                    />
                </label>
                {kindText && <span className={styles.badge}>{kindText}</span>}
                <button type="button" className={styles.button} onClick={h_PickDirClick}>
                    폴더 선택
                </button>
                <button type="submit" className={styles.button} disabled={checking || !path.trim()}>
                    {checking ? "확인 중…" : "접근 확인"}
                </button>
            </form>

            {remotes && remotes.length > 0 && (
                <label className={styles.row}>
                    <span className={styles.label}>remote 빠른 입력</span>
                    <select className={styles.input} value="" onChange={h_RemoteChange}>
                        <option value="">remote 고르기</option>
                        {remotes.map((r) => (
                            <option key={r} value={r}>
                                {r}:
                            </option>
                        ))}
                    </select>
                </label>
            )}

            {probeError && (
                <p className={styles.result} data-state="error" role="alert">
                    {probeError}
                </p>
            )}
            {probe && (
                <div
                    className={styles.result}
                    data-state={probe.exists && probe.isDirectory ? "ok" : "error"}
                >
                    <p className={styles.message}>{probe.message}</p>
                    <p className={styles.mono}>{probe.normalizedPath}</p>
                    {probe.readable === false && <p>읽기 권한이 없습니다.</p>}
                    {probe.warnings.length > 0 && (
                        <ul className={styles.warnings}>
                            {probe.warnings.map((w) => (
                                <li key={w}>{w}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <div className={styles.wsl}>
                <h3 className={styles.subTitle}>WSL 경로 도우미</h3>
                <div className={styles.row}>
                    <button type="button" className={styles.button} onClick={h_LoadDistros}>
                        WSL 배포판 불러오기
                    </button>
                    {distros && distros.length > 0 && (
                        <label>
                            <span className={styles.label}>배포판</span>
                            <select
                                className={styles.input}
                                value={selectedDistro}
                                onChange={h_DistroChange}
                            >
                                {distros.map((d) => (
                                    <option key={d} value={d}>
                                        {d}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    {distros && distros.length === 0 && (
                        <span className={styles.muted}>설치된 배포판이 없습니다.</span>
                    )}
                </div>
                {wslError && (
                    <p className={styles.result} data-state="error" role="alert">
                        {wslError}
                    </p>
                )}
                <label className={styles.row}>
                    <span className={styles.label}>리눅스 경로</span>
                    <input
                        className={`${styles.input} ${styles.grow}`}
                        value={linuxPath}
                        onChange={h_LinuxChange}
                        spellCheck={false}
                    />
                </label>
                {windowsAlt ? (
                    <div className={styles.row}>
                        <span className={styles.mono}>{windowsAlt}</span>
                        <button type="button" className={styles.button} onClick={h_UseWindows}>
                            Windows 경로를 입력란에 넣기(더 빠름)
                        </button>
                    </div>
                ) : (
                    uncPreview && (
                        <div className={styles.row}>
                            <span className={styles.mono}>{uncPreview}</span>
                            <button type="button" className={styles.button} onClick={h_UseUnc}>
                                이 UNC 경로를 입력란에 넣기
                            </button>
                        </div>
                    )
                )}
            </div>
        </section>
    );
}
