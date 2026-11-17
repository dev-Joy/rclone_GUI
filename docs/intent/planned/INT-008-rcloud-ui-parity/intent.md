---
id: INT-008
title: 화면 모양과 구조를 1세대 구현(rcloud)과 같게 되돌리기
status: planned
priority: P2
created: 2026-11-17
updated: 2026-11-17
updated_at: 2026-11-17T15:33:49+09:00
---

# Intent: 화면 모양과 구조를 1세대 구현(rcloud)과 같게 되돌리기

## 문제 (Problem)
- 지금 rcloneGUI 화면은 1세대 구현(`D:\dev-Joy\rcloud`)보다 정보 밀도가 낮다. 본문 14px에 여백이 넓어 한 화면에 보이는 작업·파일 수가 적다.
- 조작 동선이 길다. 작업 편집은 pane 전환, 설정은 전체 화면 전환, 비교·실행은 단계 막대 워크벤치(f35b6be)를 거친다. rcloud에서는 탭 하나와 모달로 끝났다.
- 사용자는 rcloud 모양에 익숙하다. 그곳에 있던 작업 그룹·비교 결과 파일 줄 우클릭 메뉴·파일 트리 보기가 지금 앱에는 없다.
- 영향 사용자: 앱을 매일 쓰는 단일 사용자(작성자 본인).

## 제안 결과 (Proposed outcome)
- **시각 스타일**: rcloud `default.css`의 색 의미(add/change/delete/same)·글꼴(본문 13px, mono `Consolas, "D2Coding"`)·간격·radius·배지/버튼/토스트 모양과 같게 보인다. `docs/DESIGN.md`의 금지 8항(글래스모피즘·과한 radius·전부 카드화·그라디언트 등)을 따른다.
- **화면 구조**
  - 상단 막대: 브랜드 + rclone 상태 알약
  - 왼쪽: 250px 고정 작업 목록. 상태 점, 이름, `원본 → 대상`, 하위 문구, 선택 시 왼쪽 accent 막대
  - 오른쪽 작업 화면: header(제목·mode 배지·편집/복제/삭제·경로 줄·용량 줄) → toolbar(비교·동기화·중지) → 실행 배너·진행 글 → 밑줄 탭 `compare | history`
  - 작업 편집과 설정은 모달로 연다.
  - 실측 요소: 비교 뒤 색 칩 필터(추가·변경·삭제·오류·같음)+`보기: 상태별` 선택+트리/평면 토글+모두 펼치기/접기, 표 열(항목·원본 크기·원본 수정 시각·할 일·대상 수정 시각·대상 크기), 동기화 단추 문구(`동기화: 대상에 1개 복사, 1개 덮어씀, 1개 삭제`), 하단 요약 줄, 기록 탭 표(시작·종류·결과·건수·걸린 시간·내용 + 목록·정보·로그 링크), ⋯ 메뉴(비교·동기화 명령 복사), 목록 하단 `+ 새 작업`·`+ 새 그룹`
- **가져올 rcloud 기능 UI**: 작업 그룹(만들기·이름 바꾸기·지우기·접기/펼치기), 비교 결과 파일 줄 우클릭 메뉴(`경로 복사`만), 비교 결과 트리/목록 전환(가상 스크롤).
- **rcloneGUI에만 있는 기능은 모두 유지**하고 rcloud 문법으로 편입한다(예: 설정 모달 안 섹션). 대상은 remote 설정 추가·수정·삭제·재인증, 리모트 북마크, rclone 설정, OS 예약 배지, 온보딩, 사전 확인 요약, 수동 테마 선택(라이트·다크·시스템).
- 실행·비교·삭제 확인 등 동작과 안전 게이트는 그대로다. 사용자에게 보이는 것은 모양과 배치만 바뀐다.

## 영향 사용자 및 시스템 (Affected users and systems)
- 테마: `src/components/themes/default.css`(토큰 체계 교체 또는 매핑), `src/components/ZBC*.tsx`·`*.css`(Button `small`, Badge tone, ZBCDot·ZBCTreeTable 신규)
- 레이아웃·화면: `src/pages/AppLayout.tsx`, `HomePage.tsx`, `TopBar.tsx`, `JobSidebar`, `JobWorkspace.tsx`, `JobWorkView.tsx`(JobStepBar·ComparePlanPanel·JobRunBar), `SettingsPage.tsx`, `JobEditor`, `CompareTable`, `HistoryView`
- 상태: `src/stores/ui-store.ts`(`view`·`pane` → 탭·모달 상태), `src/lib/job-steps.ts`와 그 단위 테스트
- 작업 그룹: SQLite 스키마·store·IPC 계약(`src/shared/ipc-contract.ts`)·preload
- 테스트: E2E 선택자(`#job-back`, `#job-run-panel`, 단계 막대), 단위 테스트
- 의존성: 트리 보기 가상 스크롤에 `@tanstack/react-virtual`(MIT) 추가 시 `package.json`·`THIRD_PARTY_NOTICES.md`
- 문서: `docs/specs/MVP_SPEC.md` §13, `docs/CHANGELOG.md`, README

## 제약 (Constraints)
- AGENTS.md 안전 규칙 1~6은 그대로 둔다. 특히 실제 전송은 `spawnTransfer` 한 곳에서만 시작하고, 비교 계획 토큰·삭제 수 확인 흐름은 바뀌지 않는다.
- rcloud 코드를 복사하더라도 rcloneGUI 컨벤션에 맞춰 다시 쓴다. 기준은 `docs/guide` 형식, `typ`/`itf`/`cls`·`f_`/`h_` 접두사, `@/` import, `@layer`다(rcloud의 `/** External imports */` 주석 형식은 쓰지 않는다).
- 수동 테마 선택과 `[data-theme]`은 유지한다. rcloud의 `prefers-color-scheme` 단독 방식으로 줄이지 않는다.
- renderer Node API 금지, `contextIsolation`·`sandbox` 유지.
- 작업 그룹 DB 변경은 기존 사용자 데이터(`%APPDATA%\rcloneGUI`)를 잃지 않는 마이그레이션으로 한다.
- 새 외부 의존성은 `THIRD_PARTY_NOTICES.md`에 기록한다. rcloud UI에는 외부 폰트·아이콘이 없다.
- 완료 기준: `pnpm run check`·`format:check`·`test:e2e`(콘솔 오류 0)·`build:win`, CHANGELOG 한 줄.

## 배경 · 결정 · 참조 (Context handoff)
- 원 요구: "D:\dev-Joy\rcloud에서 UI만 똑같이 하고 싶은데" (출처: 2026-11-17 대화 요청). 인터뷰 결과 범위는 모양+화면 구조, rcloud 전용 기능 3종 포함, 신규 화면은 rcloud 문법으로 편입한다.
- D-01: rcloud는 별개 앱이 아니라 rcloneGUI 1세대 구현이다(`package.json` name `rclonegui`, 마지막 커밋 7d054be 2026-10-27). 기준선은 rcloud main 7d054be로 한다. 근거: 현행 src. 폐기 대안: worktree `wonderful-hertz-86a637`(cabfbef, WSL에서 git 불가).
- D-02: f35b6be "탭 없는 워크벤치"(단계 막대·하단 실행 막대)는 rcloud의 탭+toolbar 구조로 되돌린다. 설정·작업 편집은 모달로 바꾼다. 근거: 사용자가 '모양+화면 구조' 범위를 선택했다. 폐기 대안: 시각 스타일만 맞추기.
- D-03: 요구 분해는 1개로 병합한다. 근거: 그룹·메뉴·트리는 새 레이아웃(왼쪽 목록·compare 탭)에 의존해 5기준 중 ④를 충족하지 않는다. 분해 후보는 미해결 질문에 적었다.
- 참조: `rcloud/src/pages/AppLayout.tsx:119-171` 상단 막대+250px 목록 / `JobPage.tsx:457-790` header·toolbar·탭 / `JobListPane.tsx:258-273` 그룹 / `themes/default.css:6-53` `--zbc-*` 토큰 / `docs/DESIGN.md:1-10` 금지 8항 / rcloneGUI `src/stores/ui-store.ts:13-20` view·pane / `src/pages/JobWorkView.tsx:117-134` 워크벤치
- 범위 밖·전제: rcloud의 용량 줄·연쇄 실행 표시·건너뛴 항목 목록과 파일 줄 메뉴의 `이번 동기화에서 빼기`(작업 skip을 바꾸는 동작 기능)는 가져오지 않는다. 화면 뒤 동작(rclone 실행·파서·스케줄러)은 바꾸지 않는다. 비교 기준은 2026-11-17 rcloud 빌드본 실측 캡처 7장(메인·비교 트리·평면·기록 탭·⋯ 메뉴·편집 모달·설정 모달)이다. 실제 사용자 경로·remote 이름이 찍혀 있어 저장소에 넣지 않는다.
- 환경·재현: Windows PowerShell에서 `$env:RCLONEGUI_DEV_PORT="9444"; $env:RCLONEGUI_DEV_DIR="$env:TEMP\rcloud-ui-ref"` 후 `D:\dev-Joy\rcloud`에서 `node scripts/dev/drive-app.mjs launch|seed|click 비교|shot <이름>|stop`(임시 프로필, 캡처는 `%TEMP%\rcloud-ui-ref\shots\`). rcloneGUI 확인은 같은 이름의 자체 drive-app, E2E는 Windows PowerShell.
- 인계 지시: 미해결 질문 확정 → `z_skill_intent_to_specplan`으로 spec·plan 작성. spec에서 화면별 rcloud↔rcloneGUI 대응 표와 토큰 매핑 표를 먼저 만들고, Tier 3(전역 UI·DB 마이그레이션)로 산정한다.

## 미해결 질문 (Open questions)
- [x] 분해 여부 — 작업 그룹(DB 마이그레이션)과 파일 트리 보기(새 의존성)를 별도 intent로 나눌지, 이 intent 하나에서 Phase로 나눌지 → 답변: 한 intent, Phase 분리(Phase 1 시각 스타일·레이아웃 → Phase 2 우클릭 메뉴·트리 보기 → Phase 3 작업 그룹 DB) (2026-11-17)
- [x] 우클릭 메뉴 범위 — rcloud ItemMenu는 작업 목록이 아니라 비교 파일 줄 메뉴(`rcloud/src/pages/ItemMenu.tsx:6`)였다 → 답변: 파일 줄 메뉴에 `경로 복사`만, `빼기`는 제외 (2026-11-17)

## 작업 (Tasks)
- [x] T-01 [P2] 기준 화면·미해결 질문 확정 (Phase 1, plan Step 0) — §10 Q-1~Q-4 결정, rcloud 빌드본 캡처 7장(라이트·다크)을 비교 기준으로 확보
- [x] T-02 [P2] 테마 값·공용 컴포넌트 모양 (Phase 1, Step 1~2) — 토큰 이름은 두고 값을 rcloud와 같게, 본문 13px·mono `Consolas, "D2Coding", monospace`, Button `small`, Badge 4px/11px, `ZBCDot` 신규, 토스트를 위쪽 가운데 notice로
- [x] T-03 [P2] 화면 상태·셸·작업 화면 (Phase 1, Step 3~5) — `ui-store` `tab`·`editor`·`settingsOpen`, 상단 막대 + 250px 작업 목록(상태 점·경로·하위 문구·선택 accent·`+ 새 작업`), header·경로 줄·toolbar·안내 줄·실행 배너·밑줄 탭·footer, 단계 막대·계획 패널·하단 실행 막대(워크벤치) 제거
- [x] T-04 [P2] 파일 목록·기록 탭·모달·E2E (Phase 1, Step 6~8) — 상태 칩 5종(같음 기본 꺼짐)·`상태별` 보기·6열 표, 기록 표와 행마다 목록·정보·로그, 작업 편집·설정 모달(바깥 클릭으로 닫히지 않고 저장 안 한 변경은 확인), `⋯` 메뉴(미리보기 실행·비교/동기화 명령 복사), E2E 갱신·`build:win`
- [x] T-05 [P2] 트리 보기·파일 줄 메뉴 (Phase 2, Step 9~10) — 폴더 트리 빌드·평탄화 후 `useVirtualRows`, 모두 펼치기/접기, 트리|평면 토글, 파일 행 우클릭·메뉴 키 `경로 복사`
- [x] T-06 [P2] 작업 그룹 DB·UI (Phase 3, Step 11~12) — DB v3 `groups` 테이블·마이그레이션·백업, `groups:*` IPC, 목록 그룹 머리글(접기·이름 바꾸기·지우기)·`+ 새 그룹`, 편집 모달 그룹 select
- [ ] T-07 [P2] 문서·전체 검증 (마감, Step 13) — CHANGELOG·MVP_SPEC §13·README·`docs/works` 갱신, Phase 1~3 전체 검증과 정합성 게이트
