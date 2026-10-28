/**
 * 화면 진입점. 공용 스타일을 올리고 첫 페이지를 렌더링한다.
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// ========== Internal imports ==========
import "@/components/ZBC.css";
import HomePage from "@/pages/HomePage";

const container = document.getElementById("root");
if (!container) throw new Error("#root 요소가 없습니다.");

createRoot(container).render(
    <StrictMode>
        <HomePage />
    </StrictMode>,
);
