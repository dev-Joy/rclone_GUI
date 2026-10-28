/**
 * 앱 전체 틀: 상단 막대, 왼쪽 작업 목록, 오른쪽 본문(위에 알림·배너). 각 영역은 따로 스크롤된다.
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
    /** 본문 위 알림·온보딩 배너 */
    banner?: ReactNode;
    children: ReactNode;
}

export default function AppLayout(props: itfAppLayoutProps) {
    const { topBar, sidebar, banner, children } = props;

    return (
        <div className={styles.AppLayout}>
            <div className={styles.top}>{topBar}</div>
            <aside className={styles.sidebar}>{sidebar}</aside>
            <main className={styles.main}>
                {banner && <div className={styles.banner}>{banner}</div>}
                <div className={styles.content}>{children}</div>
            </main>
        </div>
    );
}
