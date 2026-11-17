# Result: 비교 결과의 변경 파일 내용 차이(diff)를 동기화 전에 앱에서 보기
- Intent: [INT-009](intent.md) | 완료일: 2026-11-18 | Tier: 3 (자동 판정) | Spec/Plan: [spec.md](spec.md) · [plan.md](plan.md)

## 결과 요약
- 비교 결과 파일 행 더블클릭(Shift+F10 메뉴 동일)으로 좌우 나란히 줄 단위 diff 모달을 열고, 추가(원본에만)·삭제(대상에만) 파일은 있는 쪽만 미리 본다. 바이너리·2MB 초과·읽기 실패는 그 열에 이유 문구를 보인다.
- main이 캐시된 비교 항목의 경로만 받아 `rclone cat`으로 읽는다(새 IPC `compare:fileDiff`). 의존성은 zod 하나 그대로이고, 전송(`spawnTransfer`)·계획 토큰·삭제 확인 흐름은 바뀌지 않았다.
- 정합성 1·2차 지적(오류 문구 접두 중복, BOM·인코딩·줄바꿈만 다를 때의 오표시)을 반영해 표시 판정을 `src/lib/file-diff-view.ts`의 순수 함수로 분리했다.

## 변경 산출물
| 경로 | 변경 | 핵심 내용 1줄 |
| :--- | :--- | :--- |
| `src/shared/text-diff.ts` | 신규 | 줄 나눔(`\r\n`·`\n`·`\r`) + Myers diff(`diffLines`)·좌우 짝짓기(`toSideBySide`), 편집 거리 상한 2000 |
| `src/shared/path-utils.ts` | 수정 | `joinRootRelative` — local·UNC(`\` 결합)·remote(`name:rel`) 결합, `..`·절대 경로·드라이브 문자·NUL 거부 |
| `src/lib/file-diff-view.ts` | 신규 | 표시 판정 `resolveDiffView` — BOM·인코딩·줄바꿈 원인을 조합해 안내 문구를 고른다(화면에서 계산 분리) |
| `src/main/rclone/command-builder.ts` | 수정 | `buildCatArgs`(`cat --ask-password=false [--config C] -- <path>`), `ALLOWED_COMMANDS`에 `cat`만 추가 |
| `src/main/rclone/config.ts` | 수정 | `RCLONE_TIMEOUTS.cat`(60초) 시간 제한 추가 |
| `src/main/services/file-diff-service.ts` | 신규 | 캐시 항목에서 경로 조회·2MB 사전 판정·앞 8000바이트 NUL 바이너리 판정·잘림 감지·UTF-8(BOM 제거)→EUC-KR 재디코딩·오류 요약에서 경로 제거 |
| `src/shared/ipc-contract.ts`·`src/shared/types/file-diff.ts`·`src/shared/schemas/compare.ts` | 수정/신규 | 채널 `compare:fileDiff`(`{ jobId, path }` 요청)와 응답 타입·zod 스키마, 기존 `ERROR_CODES`만 사용 |
| `src/main/ipc/compare.ts`·`src/main/index.ts`·`src/preload/index.ts` | 수정 | IPC 핸들러 등록과 preload 브리지(`compare.fileDiff`) |
| `src/pages/FileDiffModal.tsx`·`src/pages/FileDiffModal.module.css` | 신규 | 좌우 2열·줄 번호·추가/삭제/변경 색·요약 줄·한쪽 미리보기 문구·닫기만 있는 읽기 전용 모달, 요청 번호로 늦은 응답 폐기 |
| `src/pages/CompareRow.tsx`·`CompareView.tsx`·`CompareTable.tsx`·`CompareTree.tsx`·`FileRowMenu.tsx` | 수정 | 행 더블클릭(`modified`·`onlySource`·`onlyDest`만)·`onFileDiff` 배선·메뉴 `원본·대상 내용 비교`(`equal`·`typeConflict`는 `disabled`+이유) |
| `tests/unit/text-diff.test.ts`·`path-utils.test.ts`·`file-diff-service.test.ts`·`file-diff-view.test.ts`·`command-builder.test.ts` | 신규/수정 | diff 정답 표·경로 결합 거부·바이너리·상한·잘림·디코딩·`buildCatArgs`·차단 목록 불변(서비스 20건·표시 판정 12건 포함) |
| `tests/integration/file-diff.local.test.ts`·`tests/e2e/compare-diff.spec.ts` | 신규 | 실제 rclone `cat` 수용 2건, E2E diff 열기·메뉴·한쪽 미리보기 |
| `docs/CHANGELOG.md`·`docs/specs/MVP_SPEC.md`·`docs/knowhow/rclone-notes.md`·`docs/works/WORKS*.md` | 수정 | 사용자 변경 한 줄·구현 반영 절·`cat` 실측 기록·작업 내역([TASK_034]) |

## 검증 결과
| 항목 | 결과 | 증거(출처) |
| :--- | :--- | :--- |
| 설계 (`code-planner`) | 완료 | [plan.md](plan.md) §1~§6 — Tier 3 산정(허용 명령 추가·보안 신호·새 IPC·화면)과 단계별 원자 계획 |
| 정적 분석·린트 | Pass | `pnpm run check`(Windows PowerShell, 2026-11-18 00:50:53): `tsc -p tsconfig.node.json`·`tsc -p tsconfig.web.json` 통과, `oxlint --deny-warnings && eslint --max-warnings=0 .` → "Found 0 warnings and 0 errors."(335파일·240룰), 종료 코드 0 |
| 단위·통합 테스트 | Pass | 같은 `check` 실행: `vitest run` 86파일 1,459 통과(종료 코드 0). `pnpm run test:int` 16파일 — 79 passed / 19 skipped(실제 rclone 수용 2건 통과, skip은 환경 변수 미설정·rclone 부재 사유 출력), 68.27s, 종료 코드 0 |
| 브라우저 검증(ego→Aside→Playwright) | Pass | `pnpm run test:e2e` 13 spec 22건 통과(51.0s), 렌더러 콘솔 오류 0건, `compare-diff.spec.ts` 포함, 종료 코드 0 |
| 전역 배포(sync/Status)·인코딩 | 미수행(사유: 응용 앱 저장소 — `scripts/sync`·전역 Status 배포 경로 없음, 파일은 `.gitattributes` LF 유지·`format:check` 397파일 통과) | `pnpm run format:check` "All matched files use the correct format."(397파일, 종료 코드 0) / `pnpm run build:win` 성공 — `rcloneGUI-Setup-0.1.81.exe` 113,709,319 B(2026-11-18 00:53), 종료 코드 0 |
| 정합성 게이트 | 필수(하드) / 근거: ① Tier 3 + ② 안전 경계·새 IPC 계약 변경 / 방식: 2-pass / 미검증: 해당 없음 | 오케스트레이터 §A 판정 기록. `run-service.ts`·`plan-token.ts`·`THIRD_PARTY_NOTICES.md` diff 0줄, `package.json` dependencies zod만(AC-11) |
| conformance-reviewer | PASS_WITH_NOTES | 1차 지적(FR-10 오류 문구 접두 중복) → 8f051d4 보완, 2차 지적(FR-11 BOM·인코딩만 다를 때 "수정 시각만" 오표시, BOM+줄바꿈 조합 BOM 누락) → `2ffe93d`에서 `src/lib/file-diff-view.ts` 분리·원인 조각 조합·단위 12건 추가 후 최종 PASS_WITH_NOTES(코드 결함 0) |

## 잔여 리스크 및 후속
- 후속 intent 후보: `docs/code-asset-index/COMPONENTS.md`에 `FileDiffModal`·`file-diff-service` 자산 등재(선택, 인덱스 미갱신)
- 알려진 제약: WSL에서는 rclone 부재로 통합 2건이 skip된다(Windows 실행에서 통과). `tests/unit/path-service.test.ts` 4건은 Linux `/tmp` 경로 전제 때문에 원래부터 실패하는 기존 항목이다. 롤백: `git revert 2ffe93d 8f051d4 6af53a3 0e8812f` 또는 `git checkout acb1d9d -- src/ tests/`

## 참조
- 요구: [intent.md](intent.md) · 명세: [spec.md](spec.md) · 계획: [plan.md](plan.md)
- 워크로그: `docs/works/WORKS_HISTORY.md` `[TASK_034]` · 커밋/PR: `0e8812f` → `6af53a3` → `8f051d4` → `2ffe93d`
