/**
 * 앱 전체 틀: 상단 막대, 왼쪽 작업 목록, 오른쪽 본문. 각 영역은 따로 스크롤된다.
 * INT-008 FR-4·FR-5: grid를 flex column으로 바꿔 상단 막대를 고정하고 본문을 250px 목록 + 작업 화면으로 나눈다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import type { ReactNode } from "react";

// ========== Internal imports ==========
import styles from "./AppLayout.module.css";

// ========== Props & Types ==========
export interface itfAppLayoutProps {
    topBar: ReactNode;
    sidebar: ReactNode;
    children: ReactNode;
}

export default function AppLayout(props: itfAppLayoutProps) {
    const { topBar, sidebar, children } = props;

    return (
        <div className={styles.AppLayout}>
            <header className={styles.topbar}>{topBar}</header>
            <div className={styles.body}>
                <aside className={styles.sidebar}>{sidebar}</aside>
                <main className={styles.main}>
                    <div className={styles.content}>{children}</div>
                </main>
            </div>
        </div>
    );
}
