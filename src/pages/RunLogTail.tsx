/**
 * 실행 로그 최근 줄(최대 200줄). 새 줄이 오면 맨 아래로 스크롤한다(사용자가 위로 올려 보는 중이면 그대로).
 * 전체 원문은 실행 로그 파일(logs/)에 있다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { useEffect, useRef } from "react";

// ========== Internal imports ==========
import type { itfRunLogLine } from "@/shared/types/run";
import styles from "./RunLogTail.module.css";

// ========== Props & Types ==========
export interface itfRunLogTailProps {
    lines: readonly itfRunLogLine[];
    /** 화면으로 보내지 않은 줄 수 */
    dropped: number;
    logFile: string | null;
}

/** 맨 아래에서 이 거리 안이면 따라 내려간다 */
const STICK_PX = 24;

function f_Time(at: string): string {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ko-KR", { hour12: false });
}

export default function RunLogTail(props: itfRunLogTailProps) {
    const { lines, dropped, logFile } = props;

    // ========== hook & state 변수 선언 ==========
    const ref = useRef<HTMLOListElement>(null);
    const stick = useRef(true);

    // ========== Effect (부수 효과) ==========
    useEffect(() => {
        const el = ref.current;
        if (!el || !stick.current || lines.length === 0) return;
        el.scrollTop = el.scrollHeight;
    }, [lines]);

    // ========== 이벤트 핸들러 및 내부 함수 ==========
    const h_Scroll = () => {
        const el = ref.current;
        if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    };

    return (
        <section className={styles.RunLogTail} aria-label="실행 로그">
            <header className={styles.head}>
                <span>최근 로그 {lines.length}줄</span>
                {dropped > 0 && <span>(화면에 표시하지 않은 {dropped}줄은 로그 파일에 있음)</span>}
                {logFile && <span className={styles.file}>{logFile}</span>}
            </header>
            {lines.length === 0 ? (
                <p className={styles.empty}>아직 로그가 없습니다.</p>
            ) : (
                <ol ref={ref} className={styles.lines} onScroll={h_Scroll}>
                    {lines.map((l, i) => (
                        <li key={`${i}-${l.at}`} className={styles.line} data-level={l.level}>
                            <span className={styles.time}>{f_Time(l.at)}</span>
                            <span className={styles.message}>
                                {l.message}
                                {l.object ? `: ${l.object}` : ""}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
