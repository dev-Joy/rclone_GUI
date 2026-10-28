/**
 * remote 빠른 입력. 작업이 쓰는 rclone.conf의 remote 목록에서 골라 "이름:"을 입력란에 넣는다.
 * 영문 한 글자 remote는 Windows에서 드라이브 문자로 해석되므로 고를 수 없게 하고 경고를 보여 준다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

// ========== Internal imports ==========
import ZBCSelect from "@/components/ZBCSelect";
import {
    driveLetterRemoteWarning,
    findDriveLetterRemotes,
    isDriveLetterRemoteName,
} from "@/shared/remote-name";
import { selectRemotesFor, useRcloneEnvStore } from "@/stores/rclone-env-store";
import styles from "./RemotePicker.module.css";

// ========== Props & Types ==========
export interface itfRemotePickerProps {
    id: string;
    /** 이 작업의 rclone.conf (null = 기본) */
    configPath: string | null;
    /** "name:" 을 입력란에 넣는다 (기존 값은 교체) */
    onPick: (remoteRoot: string) => void;
}

export default function RemotePicker(props: itfRemotePickerProps) {
    const { id, configPath, onPick } = props;

    // ========== hook & state 변수 선언 ==========
    const list = useRcloneEnvStore(useShallow((s) => selectRemotesFor(s, configPath)));
    const loadRemotes = useRcloneEnvStore((s) => s.loadRemotes);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        void loadRemotes(configPath);
    }, [configPath, loadRemotes]);

    // ========== 내부 변수 (_V) ==========
    const remotes = list.remotes ?? [];
    const warning = driveLetterRemoteWarning(findDriveLetterRemotes(remotes));
    const options = remotes.map((r) =>
        isDriveLetterRemoteName(r)
            ? { value: r, label: `${r}: (사용 불가 — 드라이브 문자)`, disabled: true }
            : { value: r, label: `${r}:` },
    );

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Change = (value: string) => {
        if (value && !isDriveLetterRemoteName(value)) onPick(`${value}:`);
    };

    let status: string | null = null;
    if (list.loading) status = "remote 목록을 불러오는 중…";
    else if (list.error) status = `remote 목록을 읽지 못했습니다: ${list.error}`;
    else if (list.remotes !== null && remotes.length === 0)
        status = "설정 파일에 remote가 없습니다.";

    return (
        <div className={styles.RemotePicker}>
            {options.length > 0 && (
                <div className={styles.row}>
                    <label className={styles.label} htmlFor={id}>
                        remote 빠른 입력
                    </label>
                    <ZBCSelect
                        id={id}
                        value=""
                        options={options}
                        placeholder="remote 고르기"
                        onChange={h_Change}
                    />
                </div>
            )}
            {status && <p className={styles.status}>{status}</p>}
            {warning && <p className={styles.warning}>주의: {warning}</p>}
        </div>
    );
}
