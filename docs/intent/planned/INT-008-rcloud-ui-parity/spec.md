# Spec: 화면 모양과 구조를 1세대 구현(rcloud)과 같게 되돌리기
- Intent: [INT-008](intent.md) | Status: planned | 작성일: 2026-11-17
- Intent updated_at: 2026-11-17T15:33:49+09:00

> 표기: `rcloud/…`는 `D:\dev-Joy\rcloud`(= `/mnt/d/dev-Joy/rcloud`, HEAD `7d054be`) 기준 경로다. 접두사가 없는 경로는 rcloneGUI 저장소 기준이다.

## 1. 개요
- 원 요구: "D:\dev-Joy\rcloud에서 UI만 똑같이 하고 싶은데"(2026-11-17). rcloud는 별개 앱이 아니라 rcloneGUI 1세대 구현이다.
- 문제: 현재 화면은 본문 14px·넓은 여백이라 정보 밀도가 낮다. 작업 편집(pane)·설정(전체 화면)·단계 막대 워크벤치(f35b6be)로 조작 동선이 길다. rcloud에 있던 작업 그룹·파일 줄 메뉴·트리 보기가 없다.
- 목표: rcloneGUI의 동작·안전 게이트는 그대로 두고, 화면 모양과 구조를 rcloud와 같게 만든다. rcloneGUI에만 있는 기능은 rcloud 문법으로 편입한다.
- 진행: Phase 1(시각 스타일·레이아웃·탭·모달) → Phase 2(파일 줄 우클릭 메뉴·트리 보기) → Phase 3(작업 그룹 DB) 순서다. 한 intent 안에서 Phase로 나눈다(intent 미해결 질문 답변).
- 다음 세션 첫 행동: §10 미해결 질문을 확정한 뒤 plan.md Step 1부터 진행한다.

## 2. 범위 (In-scope / Out-of-scope)
- In-scope
  - 테마: rcloud 색·글꼴·간격·radius 값(`rcloud/src/components/themes/default.css:7`, 다크 `:32`). 본문 13px(`rcloud/src/components/ZBC.css:31`), mono `Consolas, "D2Coding", monospace`
  - 공용 컴포넌트 모양: Button `small`, Badge tone, ZBCDot 신규, 토스트를 위쪽 가운데 notice 모양으로(`rcloud/src/pages/AppLayout.module.css:59`)
  - 레이아웃: 상단 막대(브랜드 + rclone 상태 알약 + 설정) → [왼쪽 250px 작업 목록 | 작업 화면](`rcloud/src/pages/JobListPane.module.css:10`)
  - 작업 화면: header(제목·mode 배지·편집/복제/삭제/⋯·경로 줄) → toolbar(비교·동기화) → 실행 배너·진행 글 → 밑줄 탭 `파일 목록 | 기록`(`rcloud/src/pages/JobPage.tsx:603`) → 칩 필터·트리/평면 토글·표 → footer 요약(`rcloud/src/pages/JobPage.tsx:729`)
  - 작업 편집·설정을 모달로 바꾼다(`rcloud/src/pages/AppLayout.tsx:170`, `:171`)
  - 파일 줄 우클릭 메뉴: `경로 복사`만(`rcloud/src/pages/ItemMenu.tsx:6`)
  - 비교 결과 트리 보기·모두 펼치기/접기(`rcloud/src/lib/file-tree.ts:102`, `rcloud/src/pages/JobFileTree.tsx:236`)
  - 작업 그룹: 만들기·이름 바꾸기·지우기·접기/펼치기, 편집 모달의 그룹 선택(`rcloud/src/pages/JobEditorDialog.tsx:428`), 목록 하단 `+ 새 작업`·`+ 새 그룹`(`rcloud/src/pages/JobListPane.tsx:274`)
  - rcloneGUI 전용 화면 편입: remote 설정·북마크·rclone 설정·제외 패턴 라이브러리·기본 옵션·기록 지우기·테마 선택은 설정 모달의 섹션으로, OS 예약·remote 없음·저장 안 됨 배지는 header 배지로, 온보딩은 작업 화면 위 안내로 옮긴다.
- Out-of-scope
  - rcloud 용량 줄(`rcloud/src/pages/JobPage.tsx:500`). rcloneGUI에 용량 IPC가 없다.
  - 연쇄 실행 표시, 건너뛴 항목 목록, 파일 줄 `이번 동기화에서 빼기`(`rcloud/src/pages/JobPage.tsx:416`, 작업 skip을 바꾸는 동작 기능)
  - rcloud 보기 선택지 중 `상태별`을 뺀 4종(`rcloud/src/pages/JobPage.tsx:85`). 대응 데이터가 없다.
  - rclone 실행·파서·스케줄러·OS 예약·계획 토큰 등 화면 뒤 동작. 사용자에게 보이는 문구는 지금 의미를 유지한다.
  - rcloud 코드 형식(`/** External imports */` 주석). rcloneGUI `docs/guide`를 따른다.

## 3. 영향 시스템 · 모듈 · 데이터
| 영역 | 경로:라인 | 현재 사실 | 변경 |
| :--- | :--- | :--- | :--- |
| 테마 | `src/components/themes/default.css:7` / `:29` / `:47` | 라이트 `:root`, `[data-theme="dark"]`, 미디어 쿼리 3블록 | 3블록 구조를 유지하고 값을 rcloud 값으로 바꾼다 |
| 본문 크기 | `src/components/themes/default.css:84` | `font-size: 14px` | 13px |
| 수동 테마 | `src/pages/HomePage.tsx:113` | `settings.ui.theme`를 `dataset.theme`에 적용 | 유지 |
| Button | `src/components/ZBCButton.tsx:11` | `primary/secondary/danger/ghost`, small 없음 | `small` 추가, 모양만 rcloud |
| Badge | `src/components/ZBCBadge.tsx:11` | `neutral/accent/success/warning/danger` | tone 집합 유지, 색 값만 rcloud |
| 화면 상태 | `src/stores/ui-store.ts:13`, `:15` | `typAppView`, `typJobPane` | `tab: "files"\|"history"`, `editorOpen`, `settingsOpen`으로 바꾼다 |
| 레이아웃 | `src/pages/AppLayout.module.css:13` | grid `minmax(220px, 280px)` | 상단 막대 + 250px 고정 flex |
| 셸 | `src/pages/HomePage.tsx:156` | settings·편집 분기 | 모달 분기 |
| 작업 화면 | `src/pages/JobWorkspace.tsx:195`(`#job-back`), `:205`(⋯ `<details>`) | pane 전환 | header·toolbar·탭 구조 |
| 워크벤치 | `src/pages/JobWorkView.tsx:123`(`#job-run-panel`), `src/pages/JobStepBar.tsx:30`(`#job-steps`) | 단계 막대·계획 패널·하단 실행 막대 | 제거. 문구 함수는 재사용 |
| 문구 함수 | `src/lib/job-steps.ts:262` `previewNotice`, `:299` `runBarText` | 368행, 테스트 592행 | 동기화 단추 문구·안내 줄에 재사용. `jobSteps`(`:107`)·`workMainPanel`(`:344`)은 사용처가 없어지면 제거 |
| 설정 | `src/pages/SettingsPage.tsx:233` | 394행 전체 화면 | 설정 모달 본문 |
| 편집 | `src/pages/JobEditor.tsx:297` | 730행 pane | 작업 편집 모달 본문 |
| 비교 표 | `src/pages/CompareTable.tsx:2` | 고정 30px 행 가상 목록 | 열을 rcloud 6열로, 트리 보기 추가 |
| 가상 스크롤 | `src/lib/use-virtual-rows.ts:19` | 앱 자체 구현 | 트리 보기에도 재사용(새 의존성 없음) |
| 비교 상태 | `src/shared/types/compare.ts:11`, `:30` | `onlySource/onlyDest/modified/equal/typeConflict`, `itfDiffEntry` | 데이터 불변, 칩 매핑만 |
| 필터 | `src/lib/compare-view.ts:24` | `all/changes/…` | 칩 토글 방식으로 |
| DB | `src/main/store/db-schema.ts:32`(jobs), `:115`(MIGRATIONS), `:120`, `:126`, `:133` | user_version 마이그레이션, 높은 버전 거부, 백업 | v3: groups 테이블 + jobs 그룹 연결 |
| 작업 스키마 | `src/shared/schemas/job.ts:129` | `zJobStoredDraft`(`.default()`로 예전 데이터 수용) | `groupId` nullable default null |
| IPC | `src/shared/ipc-contract.ts:65` | `jobs:*` | `groups:list/save/delete` 추가 |
| 계획 토큰 | `src/main/services/plan-token.ts:47` | `jobRev`가 토큰 입력 | 그룹 변경과 rev 관계는 §10 Q-3 |
| 설정 스키마 | `src/shared/schemas/settings.ts:40` | `ui.theme` | 유지 |
| 고지 | `THIRD_PARTY_NOTICES.md:6`, `package.json:28` | 운영 의존성은 zod뿐 | 변경 없음(자체 가상 스크롤 재사용) |
| E2E | `tests/e2e/*.spec.ts` 10개 + `app-harness.ts` | `#job-back`·`#job-run-panel`·단계 막대·`화면 전환 > 설정` 사용 | 새 구조 선택자로 갱신 |
| 기준 화면 | rcloud 빌드본 캡처 7장(`%TEMP%\rcloud-ui-ref\shots\`) | 저장소 밖 | 비교 기준 |

## 4. 기능 요구사항 (FR-n)
- **FR-1 테마 값**: 라이트·다크 토큰 값이 rcloud `default.css`와 같다. 기존 토큰 이름(`--bg --panel --text --muted --border --accent …`)은 유지하고 값만 바꾼다. rcloud에 없는 `--warning --focus --radius --gap`은 rcloud 컴포넌트 CSS 값으로 정한다.
- **FR-2 수동 테마 유지**: 설정의 라이트·다크·시스템 선택과 `[data-theme]`이 지금처럼 동작한다.
- **FR-3 글꼴·밀도**: 본문 13px/1.5, mono `Consolas, "D2Coding", monospace`. Button 기본 padding `6px 14px`·radius 6px, `small`은 `3px 10px`·12px. Badge는 radius 4px·11px이다.
- **FR-4 상단 막대**: 브랜드 `rcloneGUI`, rclone 상태 알약(문제 있으면 위험 색, 누르면 설정 모달), `설정` 단추를 둔다. 다음 자동 실행 표시는 알약 옆 muted 글로 둔다.
- **FR-5 작업 목록**: 왼쪽 250px 고정이다. 항목은 상태 점(ZBCDot)·이름·`원본 → 대상`·mode 배지·하위 문구(마지막 결과 또는 예약)로 이루어지고, 선택 항목은 `inset 3px` accent 왼쪽 막대(`rcloud/src/pages/JobListPane.module.css:51`)다. 하단에 `+ 새 작업`·`+ 새 그룹` 단추가 있다. remote 없음·OS 예약 배지는 하위 문구 줄에 둔다.
- **FR-6 작업 header·toolbar**: 제목·mode 배지·상태 배지(저장 안 됨·OS 예약 미등록·remote 없음)와 `편집`·`복제`·`삭제`·`⋯` 단추를 둔다. 아래에 경로 줄(mono, accent 화살표)이 온다. toolbar는 `비교`·`동기화`이고 `중지`는 실행 배너에 둔다(AC-6, rcloneGUI 기존 동작). 동기화 단추 문구는 `동기화: 대상에 N개 복사, N개 덮어씀, N개 삭제`(`rcloud/src/pages/JobPage.tsx:142`)이고, 비교 전에는 `동기화 — 먼저 [비교]를 누르세요`로 꺼진다. 문구는 `runBarText`를 재사용한다.
- **FR-7 ⋯ 메뉴**: `비교 명령 복사`·`동기화 명령 복사`를 담는다. 지금 ⋯ 메뉴의 복제·삭제는 header 단추로 옮긴다.
- **FR-8 탭**: 밑줄 탭 `파일 목록 | 기록`(`role="tablist"`)이다. `기록` 탭은 표 열 `시작·종류·결과·건수·걸린 시간·내용`과 행마다 `목록·정보·로그` 링크를 둔다(`rcloud/src/pages/JobHistoryTable.tsx:57`). `정보`는 지금 HistoryDetail 모달을 연다.
- **FR-9 실행 중 표시**: 실행 중에는 toolbar 아래 실행 배너(단계·진행률·남은 시간)와 `진행 글 보기` 체크를 둔다. 배너 영역은 `#job-run-panel` id를 유지한다.
- **FR-10 사전 안내**: `previewNotice`(사전 확인·대량 삭제·빈 폴더 불가 등) 문구는 toolbar 아래 한 줄 안내로 보인다. 삭제·실행 확인 모달 흐름은 그대로다.
- **FR-11 파일 목록**: 칩 `추가·변경·삭제·오류·같음`(개수 표시, 토글, 같음 기본 꺼짐)이 있다. `상태별` 보기 select와 오른쪽 `트리 | 평면` 토글, 트리일 때 `모두 펼치기·모두 접기`를 둔다. 표 열은 `항목·원본 크기·원본 수정 시각·할 일·대상 수정 시각·대상 크기`다. 칩 매핑은 §6.2(§10 Q-1 확정 대상)를 따른다.
- **FR-12 트리 보기**: `itfDiffEntry.path`의 `/` 구분으로 폴더 노드를 만든다. 폴더는 접고 펼 수 있고, 펼친 행을 평탄화해 `useVirtualRows`로 그린다. 폴더 행에는 하위 변경 수를 표시한다.
- **FR-13 파일 줄 메뉴**: 트리·평면의 파일 행 우클릭과 키보드 메뉴 키(`ContextMenu`·Shift+F10)로 메뉴를 연다. 항목은 `경로 복사`(원본 기준 상대 경로) 하나다. Escape·바깥 클릭으로 닫힌다.
- **FR-14 footer**: `비교 MM-DD HH:mm:ss · 걸린 시간`과 계획 상태 문구(예: `이 비교 결과로 동기화할 수 있습니다`)를 보여 준다.
- **FR-15 편집 모달**: `편집`·`+ 새 작업`·`복제`가 작업 편집 모달을 연다. 본문은 지금 JobEditor 필드 전체에 그룹 select를 더한 것이다. 저장 안 한 변경이 있으면 닫을 때 DiscardChangesModal을 거친다.
- **FR-16 설정 모달**: 지금 SettingsPage 섹션 전체를 스크롤되는 모달 본문으로 옮긴다. 순서는 rclone → remote 설정 → 리모트 북마크 → 제외 패턴 → 기본 옵션 → 화면(테마) → 기록·로그 → 정보다. 저장 안 한 변경 확인은 지금처럼 동작한다.
- **FR-17 작업 그룹**: 그룹을 만들고(이름 1~50자, 대소문자 무시 중복 금지), 이름을 바꾸고, 지운다. 지울 때 확인을 거치고, 속한 작업은 `그룹 없음`으로 옮긴다. 그룹은 접고 펼 수 있고 접힘 상태는 세션 안에서만 유지한다(rcloud와 같음, `rcloud/src/pages/JobListPane.tsx:134`). 그룹이 하나도 없으면 그룹 머리글 없이 평평한 목록이다.
- **FR-18 notice 토스트**: 알림은 화면 위쪽 가운데 반전색 notice로 뜨고, 오류는 위험 색이다. 지금 ZBCToast 동작(자동 닫힘·버튼)은 유지한다.

## 5. 비기능 요구사항 (NFR-n)
- **NFR-1 안전 불변**: AGENTS.md 안전 규칙 1~6을 그대로 지킨다. `spawnTransfer` 단일 진입, 계획 토큰·삭제 수 확인, 사전 확인 dry-run 흐름에 코드 변경이 없어야 한다(`src/main/services/run-service.ts`·`plan-token.ts`·`command-builder.ts` diff 0줄. Phase 3의 store·IPC는 예외).
- **NFR-2 컨벤션**: `docs/guide` 형식, `typ`/`itf`/`cls`·`f_`/`h_` 접두사, `@/` import, CSS Module `@layer pages|layouts`, ZBC 이름 규칙(AGENTS 4.3~4.5)을 따른다.
- **NFR-3 성능**: 비교 결과 1만 행에서 트리 펼치기·스크롤이 눈에 띄게 끊기지 않는다(그리는 행은 보이는 행 + 여유분).
- **NFR-4 접근성**: 탭은 `tablist/tab`, 메뉴는 `menu/menuitem`, 모달은 `dialog` 역할과 이름을 갖고 키보드로 조작할 수 있다. 렌더러 콘솔 오류는 0건이다.
- **NFR-5 데이터 보존**: v3 마이그레이션은 기존 DB를 백업하고 한 트랜잭션에서 실행한다. 예전 작업은 `groupId=null`로 읽힌다. 낮은 버전 앱이 v3 DB를 열면 지금처럼 거부한다(`src/main/store/db-schema.ts:133`).
- **NFR-6 의존성**: 새 운영·개발 의존성을 추가하지 않는다(`@tanstack/react-virtual` 대신 `useVirtualRows`).
- **NFR-7 문서**: CHANGELOG 한 줄, `docs/specs/MVP_SPEC.md` §13 화면 구조, README 화면 설명을 갱신한다.

## 6. 인터페이스 · 데이터 스키마
### 6.1 화면 상태 (확정)
```ts
// src/stores/ui-store.ts
export type typJobTab = "files" | "history";
interface itfUiState {
    tab: typJobTab;               // 작업을 바꾸면 "files"
    editor: { mode: "new" | "edit" | "duplicate"; jobId: string | null } | null;
    settingsOpen: boolean;
    settingsDirty: boolean;       // 유지
    // pendingLeave·confirmLeave는 모달 닫기 확인으로 의미 유지
}
```
### 6.2 칩 매핑 (초안 — §10 Q-1)
| 칩 | rcloneGUI 상태 | 비고 |
| :--- | :--- | :--- |
| 추가 | `onlySource` | |
| 변경 | `modified` | |
| 삭제 | `onlyDest` | sync일 때 이름 `삭제`, copy일 때 이름 `대상만`(유지) |
| 오류 | `typeConflict` | 파일↔폴더 충돌 |
| 같음 | `equal` | 기본 꺼짐 |
### 6.3 그룹 (초안 — Phase 3)
```sql
-- v3
CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL);
ALTER TABLE jobs ADD COLUMN group_id TEXT NULL;  -- 또는 data JSON의 groupId, §10 Q-3
```
- `zGroupId = /^g-[a-z0-9-]{1,40}$/`(`rcloud/src/shared/schemas.ts:60`과 같음), `zGroupSave = { id?: string; name: string(1..50) }`
- IPC: `groups:list` → `itfGroup[]`(position 순), `groups:save`, `groups:delete`(속한 작업 `group_id=null`), 이벤트 `groups:changed`. 응답은 `{ ok, data } | { ok: false, error }`.
- 작업의 그룹 지정 경로는 §10 Q-3을 따른다.

## 7. 예외 · 엣지 케이스
- 작업이 0개면 오른쪽 영역에 빈 화면 안내와 `+ 새 작업`을 보여 준다.
- 실행 중 편집 모달 열기: 지금 편집 제한(실행 중 저장 불가 등) 규칙을 그대로 따른다.
- 실행 중 다른 작업 선택: 지금 동작을 따르고, 실행 배너는 실행 중인 작업 화면에서만 보인다.
- 설정 모달을 열어 둔 채 OS 예약 실행·알림이 오면 notice는 모달 위에 뜬다.
- 편집 모달 밖 클릭은 모달을 닫지 않는다(변경 손실 방지). 닫기는 `취소`·×·Escape이고 저장 안 한 변경이 있으면 확인을 거친다.
- 트리: 경로에 `/`가 없는 파일은 루트, 폴더만 바뀐 항목(`dirChanges`)은 지금처럼 따로 표시한다. 대소문자만 다른 경로는 별도 노드다.
- 경로 복사 실패(클립보드 거부): 오류 notice를 띄운다.
- 그룹 삭제 중 다른 창에서 작업이 저장되면 `jobs:changed`·`groups:changed`로 다시 읽는다.
- 그룹 이름 중복·빈 이름은 저장 버튼을 끄고 사유를 보여 준다.
- 낮은 버전 DB 거부·마이그레이션 실패는 지금 시작 오류 안내를 따른다.
- 다크 모드: 칩·배지·선택 막대의 대비가 라이트와 같은 의미로 보여야 한다.

## 8. 수용 기준 (AC-n)
- **AC-1** (FR-1·3): 라이트·다크에서 rcloud 캡처 01·02와 나란히 놓고 색·글꼴 크기·간격이 같다. 계산된 `body` 글꼴 크기는 13px다.
- **AC-2** (FR-2): 설정에서 테마를 라이트·다크·시스템으로 바꾸면 즉시 반영되고, 다시 시작해도 유지된다.
- **AC-3** (FR-4·5): 상단 막대와 250px 작업 목록이 있다. 선택 항목에 왼쪽 accent 막대가 있다. `+ 새 작업`·`+ 새 그룹` 단추가 목록 하단에 있다.
- **AC-4** (FR-6): 비교 전 동기화 단추가 꺼져 있고 문구가 `먼저 [비교]`를 안내한다. 비교 뒤 문구가 `동기화: 대상에 1개 복사, 1개 덮어씀, 1개 삭제` 형식이다(fixture 3파일 기준).
- **AC-5** (FR-7·8): ⋯ 메뉴에 명령 복사 2개가 있다. `기록` 탭 표 열과 `목록·정보·로그` 링크가 rcloud 캡처 04와 같다.
- **AC-6** (FR-9·10): 실행 중 `#job-run-panel` 배너에 진행률이 보이고 `중지`가 동작한다. 삭제가 있는 sync는 지금처럼 삭제 확인 모달을 거친다(E2E).
- **AC-7** (FR-11): 칩을 끄고 켜면 표 행 수가 해당 상태만큼 바뀐다. 같음은 기본 꺼짐이다.
- **AC-8** (FR-12): 중첩 폴더 fixture에서 트리가 폴더 노드로 그려지고, 모두 접기·모두 펼치기가 동작한다. 평면으로 바꾸면 같은 파일 수가 보인다.
- **AC-9** (FR-13): 파일 행 우클릭 → `경로 복사` → 클립보드에 상대 경로가 들어간다. 메뉴는 Escape로 닫힌다.
- **AC-10** (FR-15·16): `편집`·`설정`이 `getByRole("dialog")` 모달로 열린다. 저장 안 한 변경이 있으면 닫을 때 확인이 뜬다. 설정 모달에서 remote 추가·북마크·테마 변경이 지금처럼 동작한다(기존 E2E 갱신 통과).
- **AC-11** (FR-17): 그룹을 만들고 작업을 넣고 이름을 바꾸고 지우면, 지운 뒤 작업이 `그룹 없음`에 남는다. 앱을 다시 시작해도 그룹과 순서가 유지된다.
- **AC-12** (NFR-5): v2 DB fixture로 시작하면 v3로 올라가고 백업이 생기며, 기존 작업·이력이 그대로다(단위·E2E `migration.spec.ts`).
- **AC-13** (NFR-1): `git diff`에서 `src/main/services/run-service.ts`·`plan-token.ts`·`src/main/rclone/command-builder.ts` 변경이 0줄이다.
- **AC-14** (NFR-4·6): 모든 E2E에서 렌더러 콘솔 오류 0건, `package.json` 의존성 목록이 바뀌지 않는다.
- **AC-15** 완료 기준: `pnpm run check`·`format:check`·`test:e2e`·`build:win` 통과, CHANGELOG 한 줄.

## 9. 가정과 리스크
- 가정
  - rcloud 기준선은 main `7d054be` 빌드본이다. 캡처는 저장소 밖에 있고, 다시 찍는 명령은 intent `환경·재현`에 있다.
  - rcloneGUI 비교 데이터(`itfDiffEntry`)만으로 트리·칩을 만들 수 있다(새 IPC 불필요).
- 리스크
  - R-1: 워크벤치 제거로 `job-steps` 테스트(592행)와 E2E 7개 spec이 크게 바뀐다. 문구 함수는 남겨 회귀를 줄인다.
  - R-2: 설정·편집을 모달로 바꾸면 저장 안 한 변경 확인(`settingsDirty`·`pendingLeave`) 흐름이 바뀐다. 모달 닫기 확인으로 다시 연결하고 E2E로 확인한다.
  - R-3: 그룹 지정이 `jobRev`를 올리면 비교 계획이 무효가 된다(`src/main/services/plan-token.ts:47`). 이는 안전 쪽(fail-safe) 동작이지만 사용성이 나쁘다(§10 Q-3).
  - R-4: 토큰 값만 바꾸면 51개 CSS의 대비가 깨질 수 있다. 다크 모드 캡처로 확인한다.
  - R-5: 13px로 줄이면 긴 경로·배지 줄바꿈이 달라진다. 1280px 폭 캡처로 확인한다.
- 결정
  - D-04: 토큰은 이름을 유지하고 값만 rcloud로 바꾼다. 근거: CSS 51개 파일 diff를 피한다. 폐기 대안: `--zbc-*`로 이름 변경.
  - D-05: 가상 스크롤은 `useVirtualRows`를 재사용한다. 근거: 새 의존성·NOTICES 변경이 없다. 폐기 대안: `@tanstack/react-virtual`.
  - D-06: 파일 줄 메뉴는 `경로 복사`만 둔다(intent 미해결 질문 답변). `빼기`는 동작 변경이라 제외한다.
  - D-07: 단계 막대·계획 패널·하단 실행 막대는 제거하고, 그 문구는 동기화 단추·안내 줄·footer로 옮긴다.

### 인계 대조표 (11범주)
| 범주 | intent 기록 위치 | spec 반영 | plan 반영 | 판정 |
| :--- | :--- | :--- | :--- | :--- |
| ① 원 요구·출처 | 배경 `- 원 요구:` | §1 | §2 서두 | 기록 |
| ② 문제·영향 | `## 문제` | §1·§2 | §5 | 기록 |
| ③ 제안 결과 | `## 제안 결과` | §4·§8 | §3 | 기록 |
| ④ 영향 시스템·경로:라인 | `## 영향`·`- 참조:` | §3 | §2 | 기록 |
| ⑤ 제약 | `## 제약` | §5·§7 | §5 | 기록 |
| ⑥ 결정 D-n | D-01~D-03 | §9 D-04~D-07 | §5 | 기록 |
| ⑦ 범위 밖·전제 | `- 범위 밖·전제:` | §2 Out-of-scope | §5 | 기록 |
| ⑧ 용어·기각 접근 | D-01·D-02 폐기 대안 | §9 D-04·D-05 폐기 대안 | §5 | 기록 |
| ⑨ 환경·재현 | `- 환경·재현:` | §3 기준 화면·§9 가정 | §2 Step 0·§4 | 기록 |
| ⑩ 미확정·가정 | `## 미해결 질문`(2건 확정) | §9 가정·§10 | §5 | 기록 |
| ⑪ 인계 지시 | `- 인계 지시:` | §1 다음 세션 첫 행동 | §3·§6 | 기록 |
- `경로:라인` 재실존: 이 문서의 rcloneGUI·rcloud 인용 라인을 2026-11-17에 파일에서 ±0행으로 확인했다(연구 보고의 `JobPage.tsx:73`→실제 `:74`, `:84-90`→`:85-91` 드리프트는 교정해 인용).
- 원문 보존: 250px·13px·`7d054be`·`f35b6be`·캡처 7장·`Consolas, "D2Coding"`·동기화 단추 문구를 원문 그대로 옮겼다.
- 모의 독해: 새 세션이 spec·plan과 intent `환경·재현` 명령만으로 Step 0(기준 캡처)부터 시작할 수 있다 — 통과.

## 10. 미해결 질문 (Open questions)
- [x] Q-1 칩 매핑 — §6.2 초안(추가=onlySource, 변경=modified, 삭제=onlyDest(copy면 `대상만`), 오류=typeConflict, 같음=equal)으로 확정할지 → 답변: 초안대로 (2026-11-17)
- [x] Q-2 보기 select — rcloud 5개 중 `상태별`만 가능하다. select를 `상태별` 하나로 둘지(모양 유지), 아예 숨길지 → 답변: `상태별` 하나로 표시(자리·모양 rcloud와 같게) (2026-11-17)
- [x] Q-3 그룹 저장 방식 — 그룹 지정을 `jobs:update`(jobRev 증가 → 비교 계획 무효)로 할지, 별도 `jobs:setGroup`(jobRev 불변, `group_id` 컬럼)으로 할지 → 답변: 별도 저장 — v3 `jobs.group_id` 컬럼 + `jobs:setGroup`, jobRev 불변(편집 모달 그룹 select도 이 경로) (2026-11-17)
- [x] Q-4 다음 자동 실행 표시 위치 — 지금 TopBar의 다음 자동 실행 표시를 상단 알약 옆 muted 글로 둘지(FR-4 초안), 작업 목록 하위 문구에만 둘지 → 답변: 상단 알약 옆 muted 글(FR-4 초안) (자동승인: 권장안 — 근거: 표시 위치만 바꾸는 되돌릴 수 있는 선택이고 강제 질문 키워드 없음) (2026-11-17)
