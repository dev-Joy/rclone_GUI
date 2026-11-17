---
id: INT-009
title: 비교 결과의 변경 파일 내용 차이(diff)를 동기화 전에 앱에서 보기
status: done
priority: P2
created: 2026-11-17
updated: 2026-11-18
updated_at: 2026-11-18T01:05:41+09:00
---

# Intent: 비교 결과의 변경 파일 내용 차이(diff)를 동기화 전에 앱에서 보기

## 문제 (Problem)
- 비교 결과는 파일이 '변경(modified)'됐다는 사실과 사유(크기·수정 시각·해시)만 보여 준다. 무엇이 바뀌었는지는 원본과 대상 파일을 각각 열어 봐야 알 수 있다.
- 그래서 동기화(덮어쓰기) 전에 "이 변경을 대상에 반영해도 되는지" 판단하기 어렵다. 잘못 덮어쓰면 대상 쪽 수정이 사라진다.
- 영향 사용자: 동기화 전에 비교 결과를 검토하는 앱 사용자(작성자 본인).

## 제안 결과 (Proposed outcome)
- 비교 결과에서 '변경' 파일 줄을 골라 원본과 대상 내용의 차이를 앱 안에서 본다. 줄 단위로 추가·삭제·변경이 색으로 구분된다.
- 추가(원본에만)·삭제(대상에만) 파일도 같은 화면에서 있는 쪽 내용만 미리 본다. 삭제될 파일을 동기화 전에 확인할 수 있다.
- 원본·대상이 로컬, UNC(WSL 포함), remote(`remote:path`) 중 어느 쪽이어도 같은 방식으로 볼 수 있다.
- 바이너리 파일이나 너무 큰 파일은 diff 대신 이유를 알려 주는 문구(예: "바이너리 파일이라 내용 비교를 보여 줄 수 없음", "크기 n MB가 상한 m MB를 넘음")를 보여 준다.
- diff 보기는 읽기 전용이다. 파일을 고치거나 전송하지 않고, 비교 계획 토큰·삭제 수 확인 흐름도 바뀌지 않는다.

## 영향 사용자 및 시스템 (Affected users and systems)
- 비교 결과 화면: `src/pages/CompareTable.tsx`(행에 동작 없음), 메뉴 `src/pages/ItemMenu.tsx`(미사용 상태), 새 diff 보기 화면(모달 또는 패널)
- main: `src/main/rclone/command-builder.ts`(읽기 전용 `rclone cat` 빌더 추가), `src/main/rclone/process.ts`(stdout 상한), 새 서비스(파일 내용 가져오기·바이너리/크기 판정)
- IPC: `src/shared/ipc-contract.ts`·`src/preload/index.ts`에 새 채널(예: `compare:fileDiff`), 응답 `{ ok, data } | { ok: false, error }`
- 비교 결과 타입: `src/shared/types/compare.ts`(`itfDiffEntry`·`itfCompareResult`, 루트 경로 없음 → job에서 다시 조회)
- 의존성: diff 알고리즘을 직접 쓰거나 라이브러리를 들이면 `package.json`·`THIRD_PARTY_NOTICES.md`
- 테스트·문서: 단위(빌더·판정·diff), 통합(실제 rclone cat), E2E(diff 보기 열기·콘솔 오류 0), `docs/CHANGELOG.md`

## 제약 (Constraints)
- AGENTS.md 1.1: `rclone cat`도 `spawn`/`execFile(args[], { shell: false })`로만 실행한다. 1.3: 새 빌더는 `command-builder.ts` 차단 목록 체계를 따른다.
- AGENTS.md 1.4·1.6: 파일 내용과 실제 경로를 로그·테스트·fixture에 남기지 않는다. rclone.conf는 `--config` 경로로만 넘긴다.
- AGENTS.md 1.5: 파일 읽기는 main에서 하고 renderer는 IPC로만 받는다(`contextIsolation`·`sandbox` 유지).
- AGENTS.md 1.2: 실제 전송 경로(`spawnTransfer`)·계획 토큰은 건드리지 않는다. diff 기능은 쓰기 동작이 없어야 한다.
- 새 외부 의존성은 `THIRD_PARTY_NOTICES.md`에 기록한다(현재 운영 의존성은 zod 하나).
- 완료 기준: `pnpm run check`·`format:check`·`test:int`·`test:e2e`(콘솔 오류 0)·`build:win`, CHANGELOG 한 줄.

## 배경 · 결정 · 참조 (Context handoff)
- 원 요구: "변경된 파일을 diff해 볼 수 있는 기능이 필요해. 변경이라고 나오기는 하는데 각각 열어보지 않으면 뭐가 변경됐는지 알 수가 없어서 동기화 전에 비교해보려는데 비교가 어려워." (출처: 2026-11-17 대화 요청)
- D-01: 요구 분해는 1개다. 근거: 내용 가져오기(main·IPC)와 diff 보기(화면)는 서로 없으면 가치가 없어 5기준 중 ②·④를 충족하지 않는다.
- D-02: INT-008과 별도 intent로 둔다. 근거: INT-008은 새 IPC 없음·`command-builder` diff 0줄(NFR-1)·메뉴는 `경로 복사`만(D-06)이 전제인데, 이 기능은 cat 빌더와 새 IPC가 필요하다. 폐기 대안: INT-008 범위 확장.
- D-03: 두 파일의 줄 목록이 같고 바이트만 다르면(BOM·인코딩·줄바꿈) diff 대신 원인만 문구로 알린다. 근거: 2ffe93d 정합성 지적 — BOM/인코딩만 다를 때 "수정 시각만 다름"으로 오표시되고 BOM+줄바꿈 조합에서 BOM이 누락됐다. 폐기 대안: 바이트 차이를 무조건 줄 diff로 표시.
- 참조: `src/shared/diff-engine.ts:128-151` modified 판정(size→hash→mtime) / `src/shared/types/compare.ts:24-42,79-106` 항목·결과 타입(해시 값·루트 경로 없음) / `src/main/services/compare-service.ts:571-583` lsjson 나열 비교 / `src/pages/CompareTable.tsx:75,144` 행 동작 없음 / `src/pages/ItemMenu.tsx:1-35` 미사용 메뉴 / `src/shared/path-utils.ts:15` local·unc·remote / `src/main/rclone/process.ts:86` stdout 16MB 상한 / `package.json:28-30` 의존성 zod뿐 / INT-008 `spec.md:74,164` 우클릭 메뉴 FR-13·D-06
- 범위 밖·전제: 파일 편집·병합(3-way merge)·선택 반영, 이미지·바이너리 내용 비교, 같음(equal)·종류 충돌(typeConflict) 항목 보기는 하지 않는다. rclone 비교 방식(lsjson 나열)은 바꾸지 않는다.
- 환경·재현: Windows 데스크톱 앱(Electron), 원본·대상은 로컬·`\\wsl.localhost\…`·`remote:path` 모두 가능. 재현은 아무 작업에서 비교 → '변경' 줄 확인(현재 줄에 동작 없음).
- 인계 지시: 미해결 질문 확정 → `z_skill_intent_to_specplan`. spec에서 진입 방식이 INT-008 FR-13 메뉴와 어떻게 이어지는지(선후·공유)를 먼저 정하고, Tier 2~3(새 IPC·빌더)으로 산정한다.

## 미해결 질문 (Open questions)
- [x] 진입 방식 — '변경' 줄 더블클릭, 우클릭 메뉴(`ItemMenu`, INT-008 FR-13과 공유), 줄 끝 단추 중 무엇으로 diff를 여는가 → 답변: 더블클릭 + 우클릭 메뉴 둘 다(INT-008 FR-13 메뉴에 'diff 보기' 추가, 키보드는 Shift+F10 메뉴) (2026-11-17)
- [x] diff 구현 — 직접 작성한 줄 단위 diff(LCS/Myers, 의존성 0) vs 외부 라이브러리(`diff`/jsdiff 등, NOTICES 기록) → 답변: 직접 작성(Myers/LCS 줄 diff를 shared 순수 함수로, 의존성 추가 없음) (2026-11-17)
- [x] 표시 형식과 상한 — 좌우 나란히(side-by-side) vs 통합(unified), 파일 크기 상한 값과 바이너리 판정 기준(NUL 바이트 등) → 답변: 좌우 나란히(왼쪽 원본·오른쪽 대상), 파일당 2MB 상한, 바이너리는 앞부분 NUL 바이트로 판정 (2026-11-17)
- [x] 대상 범위 — '변경'만인가, 추가·삭제 파일의 내용 미리보기도 포함하는가 → 답변: 변경은 좌우 diff, 추가(원본에만)·삭제(대상에만)는 같은 화면에서 한쪽만 미리보기 (2026-11-17)

## 결과 (Outcome)
- 2026-11-18 완료: 비교 결과 파일 행 더블클릭·파일 줄 메뉴로 좌우 나란히 줄 단위 diff 모달을 연다. 추가·삭제 파일은 있는 쪽만 미리보기, 바이너리·2MB 초과·읽기 실패는 이유 문구. main은 캐시된 비교 항목만 `rclone cat`으로 읽고(새 IPC `compare:fileDiff`) 의존성은 늘리지 않았다. 전송·계획 토큰·삭제 확인 흐름은 그대로다.
- 상세: [result.md](result.md)

## 작업 (Tasks)
- [x] T-01 [P2] 준비 — spec §10 Q-1 확정(A: UTF-8 실패 시 EUC-KR 재디코딩), 미커밋 변경 확인(R-5), 태스크 분해 (2026-11-17)
- [x] T-02 [P2] shared 순수 함수 — 줄 단위 diff(`text-diff.ts`)·루트+상대 경로 결합(`joinRootRelative`) 및 단위 테스트 (2026-11-17)
- [x] T-03 [P2] 읽기 경로 — `buildCatArgs`·허용 명령·`cat` 시간 제한·`file-diff-service`·IPC `compare:fileDiff`·preload·단위/통합 테스트 (2026-11-17)
- [x] T-04 [P2] 화면 — `FileDiffModal`(좌우 diff·한쪽 미리보기·이유 문구), 더블클릭·파일 줄 메뉴 진입, E2E (2026-11-17)
- [x] T-05 [P2] 마감 — CHANGELOG 한 줄·rclone cat 동작 기록·작업 내역·전체 검증(2-pass) (2026-11-18)
