# WORKS

[2026-10-28] : INT-001 Phase 0~2 구현 — Electron+electron-vite+React+TS 골격(pnpm, oxlint/oxfmt+ESLint 2규칙), 공유 순수 코어(스키마·경로 안전·diff·명령 빌더/차단 목록·rclone 파서), main 저장소(원자적 JSON·설정·작업·이력)와 IPC envelope/preload, 단위 191·통합 6·앱 스모크 13 통과; AGENTS.md 재구성(import 규칙 모순 수정·중복 통합·완료 기준에 format:check·작업 내역 추가·PowerShell 실행 명시); .gitattributes 추가로 줄바꿈 LF 통일; INT-001 Phase 3 구현 — rclone 실행 래퍼(spawn·줄 단위·timeout·kill tree·RCLONE_* 제거·허용 명령), 바이너리·버전·rclone.conf·remote 감지(캐시), 로컬/UNC/remote 경로 probe, WSL 배포판 목록, rclone/wsl/dialog/system IPC, 온보딩 배너·rclone 설정·경로 확인 화면, 단위 282·통합 12·앱 스모크 20 통과 (T-02 완료)
