# Result: 화면 모양과 구조를 1세대 구현(rcloud)과 같게 되돌리기
- Intent: [INT-008](intent.md) | 완료일: 2026-11-17 | Tier: 3 (자동 판정) | Spec/Plan: [spec.md](spec.md) · [plan.md](plan.md)

## 결과 요약
- 테마 색·글꼴·간격·radius와 공용 컴포넌트(Button `small`·Badge·`ZBCDot`·notice 토스트)를 rcloud 값과 같게 하고, 본문 13px·mono `Consolas, "D2Coding", monospace`로 밀도를 올렸다.
- 셸과 작업 화면을 상단 막대 + 250px 작업 목록 + 작업 화면(header·toolbar·안내 줄·실행 배너·밑줄 탭·footer)으로 되돌리고, 단계 막대·계획 패널·하단 실행 막대(워크벤치)를 없앴다. 작업 편집·설정은 모달이다.
- Phase 2에서 비교 결과 트리 보기와 파일 줄 `경로 복사` 메뉴, Phase 3에서 DB v3 작업 그룹(목록 그룹 머리글·편집 모달 그룹 select)을 더했다. 실행·비교·삭제 확인과 안전 게이트는 그대로다.

## 요구 대조
| 요구 | 결과 | 근거 |
| :--- | :--- | :--- |
| FR-1·3 / AC-1 (테마 값·글꼴·밀도) | 충족 | `src/components/themes/default.css`·`ZBC*.css` 값 교체, computed body 13px·Malgun Gothic 실측 확인. 시각 동등성은 저장소 밖 기준 캡처 대조(라이트·다크)로 확인 |
| FR-2 / AC-2 (수동 테마 유지) | 충족 | 설정 모달의 라이트·다크·시스템 선택과 `[data-theme]` 유지, E2E 통과 |
| FR-4·5 / AC-3 (상단 막대·250px 목록) | 충족 | `TopBar`·`AppLayout`·`JobSidebar` 재구성, 목록 하단 `+ 새 작업`·`+ 새 그룹`, 선택 accent 왼쪽 막대. 배치 동등성은 기준 캡처 대조로 확인 |
| FR-6 / AC-4 (header·toolbar·동기화 문구) | 충족 | `JobWorkspace`·`runBarText` 재사용, 비교 전 `먼저 [비교]` 안내. E2E 통과 |
| FR-7·8 / AC-5 (⋯ 메뉴·기록 탭) | 충족 | `ItemMenu`(비교·동기화 명령 복사), `HistoryView` 6열 표와 행별 목록·정보·로그 |
| FR-9·10 / AC-6 (실행 배너·사전 안내) | 충족 | `#job-run-panel` id 유지·배너 내 `중지`, 삭제 확인 모달 흐름 불변(E2E) |
| FR-11·14 / AC-7 (칩·6열 표·footer) | 충족 | `CompareToolbar`·`CompareTable`·`CompareHead`(같음 기본 꺼짐), 단위·E2E 통과 |
| FR-12 / AC-8 (트리 보기) | 충족 | `src/lib/compare-tree.ts`·`src/pages/CompareTree.tsx`, 펼침 평탄화 후 `useVirtualRows`, 모두 펼치기/접기. `compare-tree` 단위·E2E |
| FR-13 / AC-9 (파일 줄 `경로 복사`) | 충족 | `FileRowMenu`, 상대 경로 복사 본문은 `copy-text` 단위 테스트, E2E `compare-tree.spec.ts` |
| FR-15·16 / AC-10 (편집·설정 모달) | 충족 | `getByRole("dialog")` 모달, 저장 안 한 변경 확인, remote 설정·북마크·테마 동작 유지(E2E 갱신 통과) |
| FR-17 / AC-11 (작업 그룹) | 충족 | DB v3 `groups`·`group-store`·`groups:*` IPC, 목록 그룹 머리글·`+ 새 그룹`, 편집 모달 그룹 select. `group-store` 단위·`groups.spec.ts` E2E |
| NFR-1 / AC-13 (안전 불변) | 충족 | `src/main/services/run-service.ts`·`plan-token.ts`·`src/main/rclone/command-builder.ts` 전체 범위 diff 0줄 |
| NFR-3 (1만 행 성능) | 부분 확인 | 보이는 행만 그리는 가상화 구조와 `useVirtualRows` 단위 테스트로 갈음. 1만 행 실측 프레임은 미측정 |
| NFR-5 / AC-12 (데이터 보존) | 충족 | v2→v3 마이그레이션·백업·이력 보존은 `db-schema`·`migration.spec.ts` 담당 |
| NFR-6 / AC-14 (의존성·콘솔) | 충족 | `package.json` 의존성 목록 무변경(버전만 갱신), E2E 렌더러 콘솔 오류 0건 |
| NFR-7 (문서) | 충족 | `docs/CHANGELOG.md` 한 줄, `docs/specs/MVP_SPEC.md` §13, `README.md`, `docs/code-asset-index/COMPONENTS.md` |

## 변경 산출물
| 경로 | 변경 | 핵심 내용 1줄 |
| :--- | :--- | :--- |
| `src/components/themes/default.css`, `src/components/ZBC*.tsx`·`*.css` | 수정/신규 | 토큰 값 rcloud 동일·본문 13px·Button `small`·Badge 4px/11px·`ZBCDot` 신규·토스트 notice 모양 |
| `src/pages/AppLayout*`·`TopBar*`·`JobSidebar*`·`JobWorkspace*`·`HomePage*` | 수정 | 상단 막대 + 250px 작업 목록 + 작업 화면(header·경로 줄·toolbar·안내 줄·실행 배너·밑줄 탭·footer) |
| `src/pages/CompareTable.tsx`·`CompareToolbar*`·`CompareView*`·`CompareHead.tsx`·`CompareRow.tsx` | 수정/신규 | 상태 칩 5종·`상태별` 보기·6열 표·footer 요약 |
| `src/pages/CompareTree*`, `src/lib/compare-tree.ts` | 신규 | 폴더 트리 노드 빌드·펼침 평탄화·가상 스크롤·트리/평면 토글 |
| `src/pages/ItemMenu*`·`FileRowMenu.tsx`·`GroupNameDialog*`·`HistoryView*` | 신규/수정 | 파일 줄 `경로 복사` 메뉴, ⋯ 명령 복사, 그룹 이름 모달, 기록 탭 표·링크 |
| `src/pages/JobStepBar*`·`ComparePlanPanel*`·`CompareSummary*`·`JobRunBar*`·`JobWorkView*` | 삭제 | 워크벤치(단계 막대·계획 패널·하단 실행 막대) 제거 |
| `src/stores/ui-store.ts`·`groups-store.ts`·`job-editor-store.ts`·`jobs-store.ts`·`run-store.ts` | 수정/신규 | 탭·모달 상태, 그룹 상태·접힘 상태, 편집 모달 상태 |
| `src/main/store/db-schema.ts`·`group-store.ts`·`src/main/ipc/groups.ts`·`register.ts`·`src/shared/ipc-contract.ts`·`src/shared/schemas/group.ts`·`src/preload/index.ts` | 수정/신규 | DB v3 `groups`·`jobs.group_id` 마이그레이션·백업, `groups:*` IPC·preload |
| `src/main/services/command-preview.ts`, `src/main/ipc/system.ts`·`run.ts`, `src/shared/schemas/*` | 신규/수정 | 비교·동기화 명령 텍스트 생성과 복사 IPC |
| `src/lib/compare-view.ts`·`use-run-flow.ts`·`src/lib/job-steps.ts`·`src/main/index.ts` | 수정 | 새 화면 상태·탭·실행 흐름 연결, 구 단계 상태 정리 |
| `tests/unit/*`(신규 5: `command-preview`·`compare-tree`·`copy-text`·`group-store`·`renderer/groups-store`)·`tests/e2e/*`(신규 `compare-tree.spec.ts`·`groups.spec.ts`) | 수정/신규 | 단위 갱신·신규, E2E 선택자·기대값 갱신, 마이그레이션·그룹·트리 시나리오 추가 |
| `scripts/dev/drive-app.mjs` | 수정 | 개발 확인 도구의 선택자·기대값 갱신(계약·규칙 동작 변경 없음) |
| `docs/CHANGELOG.md`·`docs/specs/MVP_SPEC.md`·`README.md`·`docs/code-asset-index/COMPONENTS.md` | 수정 | 사용자에게 보이는 변경 3줄, §13 화면 구조, 화면 설명, 공통 자산 목록 |
| `package.json`·`CHANGELOG.md`·`VERSION_HISTORY.md` | 수정/신규 | 릴리스 버전만 갱신(의존성 목록 무변경) |

## 검증 결과
| 항목 | 결과 | 증거(출처) |
| :--- | :--- | :--- |
| 설계 (`code-planner`) | 완료 | spec.md·plan.md(Tier 3, 하드 게이트 후보 해당 없음) |
| 정적 분석·린트 | Pass | `pnpm run check`(typecheck + oxlint·eslint + 단위) Windows PowerShell 실행 |
| 단위·통합 테스트 | Pass(단위 1,375) / 통합 | `pnpm run check` 단위 1,375 통과. 통합 `test:int`는 이번 검증 목록에 포함되지 않음 |
| 브라우저 검증(ego→Aside→Playwright) | Pass | `test:e2e` 21/21, 렌더러 콘솔 오류 0건, `drive-app` 113건 통과 |
| 전역 배포(sync/Status)·인코딩 | 해당 없음(사유: 배포 자산 경로의 계약·규칙·스크립트 동작 변경 0건 — plan.md §1) | plan.md §1, 변경 경로 목록 |
| 정합성 게이트 | 필수(하드) / 근거: ① Tier 3, ③ DB 스키마 마이그레이션 / 방식: 2-pass + 재판정 1회 / 미검증: 해당 없음 | 1차 순방향 → 2차 반증 → 재판정 → 최종 확인 판정 |
| conformance-reviewer | PASS_WITH_NOTES (비차단 NOTE: 릴리스 버전 1줄) | 판정 리포트 요약, `bd628f6`(2차 지적 반영)·`977bb57`(잔여 문서 정리) |
| 빌드·패키징 | Pass | `build:win` NSIS x64 성공, `format:check` 통과 |
| 화면 실측 | Pass | 한글 렌더 본문 13px·Malgun Gothic 확인(기준 캡처 대조는 저장소 밖) |

## 잔여 리스크 및 후속
- 후속 intent 후보: INT-009(비교 결과 diff 보기) — 이번 FR-13 메뉴에 `diff 보기` 항목을 더하는 방향
- 알려진 제약: AC-1·AC-3 시각 동등성은 저장소 밖 기준 캡처와의 육안 대조로만 확인(자동 회귀 없음), NFR-3 1만 행 프레임은 미측정(가상화 구조·단위 테스트로 갈음), v2→v3 이력 보존은 단위 테스트 담당 / 롤백: `git revert`로 Phase 단위 되돌리기(Phase 3 롤백 시 v3 DB는 낮은 버전 앱이 거부하므로 백업 `db-backups\` 복원 필요)

## 커밋
| 커밋 | 내용 |
| :--- | :--- |
| `eaadc5a` | INT-008 intent·spec·plan 등록 |
| `018189e` | Phase 1 — 화면 모양·구조 복원 |
| `8d2ed8c` | Phase 2 — 트리 보기·파일 줄 `경로 복사` |
| `a24766e` | Phase 3 — 작업 그룹·DB v3 |
| `a830acb` | 문서 반영(Phase 2·3) |
| `1b6420d` | 복제 모달 전환·E2E 안정화 |
| `bd628f6` | 정합성 2차 지적 반영 |
| `977bb57` | 잔여 문서·자산 인덱스 정리 |

## 참조
- 요구: [intent.md](intent.md) · 명세: [spec.md](spec.md) · 계획: [plan.md](plan.md)
- 워크로그: `docs/works/WORKS_HISTORY.md`(Phase별 기록) · 커밋/PR: 위 `## 커밋`(PR 없음)
