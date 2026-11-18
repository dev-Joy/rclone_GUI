# Spec: 파일 내용 비교 화면을 차이 탐색이 쉬운 좌우 비교 뷰어로 개선
- Intent: [INT-010](intent.md) | Status: planned | 작성일: 2026-11-18
- Intent updated_at: 2026-11-18T16:33:52+09:00

## 1. 개요
- INT-009의 내용 비교 모달(`FileDiffModal`)은 폭 최대 760px 모달 안에 한 표로 좌우를 나란히 놓는다. 그래서 긴 파일에서는 차이가 어디에 몇 곳 있는지 보이지 않고, 차이 사이를 이동할 수단도 없다.
- 이번 작업은 사용자에게 익숙한 좌우 비교 뷰어의 상호작용을 화면에 넣는다.
  - 창 크기에 맞춘 큰 모달
  - 맨 왼쪽의 축소 위치 막대
  - 다른 줄을 빨간 계열 하나로 표시
  - 선택 줄을 화면 아래에서 위아래로 비교(다른 글자 강조)
  - 툴바 ↑/↓와 Alt+↑/↓로 이전·다음 차이 이동
- 읽기 전용 원칙은 그대로다. 편집·좌우 복사(병합)·저장은 하지 않는다(intent D-02).
- 원 요구(출처: 2026-11-18 대화, 첨부 스크린샷)는 "왼쪽·오른쪽 파일, 다른 부분 빨간색, 맨 왼쪽 인덱스, 줄 선택 시 아래에 위아래 비교, 툴바 화살표로 다음·이전 다른 부분 이동, 편집·좌우 sync는 원본 훼손 우려로 제외"다.
- 인계: 새 세션은 이 spec과 plan.md만으로 T-01부터 착수할 수 있다. §9 대조표에서 이를 판정한다.

## 2. 범위 (In-scope / Out-of-scope)
- In-scope
  - `ZBCModal`에 창 크기 기반 크기(`full`)를 추가하고 `FileDiffModal`에서 쓴다.
  - 화면 배치: 툴바 → 좌우 패널 머리글(경로) → 위치 막대 + 좌우 줄 영역 → 하단 선택 줄 비교 영역 → 요약 상태 줄.
  - 다른 줄을 빨간 계열 하나로 표시한다. 한쪽에만 있는 줄의 빈 쪽은 빗금으로 표시한다.
  - 줄 선택(클릭, ↑/↓), 하단 2줄 비교, 문자 단위 강조.
  - 차이 묶음(hunk) 계산, 이전·다음 차이 이동(툴바·Alt+↑/↓), "차이 n곳 중 k" 표시.
  - 위치 막대: 파일 전체를 축소해 차이 위치를 표시하고, 누르면 그 위치로 스크롤한다. 현재 보이는 영역도 표시한다.
  - 단위 테스트(hunk·문자 diff·위치 막대 계산)와 E2E 갱신, CHANGELOG 한 줄.
- Out-of-scope (intent 범위 밖·전제)
  - 편집, 좌→우·우→좌 복사(병합), 저장, 3-way 비교, 바이너리·이미지 비교
  - main·preload·IPC(`compare:fileDiff`)·`command-builder.ts`·rclone 읽기 경로 변경
  - 진입 방식 변경(행 더블클릭·파일 줄 메뉴는 INT-009 그대로)
  - 별도 창(BrowserWindow)·최대화 단추
  - 2MB 상한·바이너리·인코딩 판정 변경

## 3. 영향 시스템 · 모듈 · 데이터
- `src/pages/FileDiffModal.tsx`(구조 재구성)
  - :64 `tabIndex={0}` 스크롤 컨테이너
  - :68-78 행마다 4칸 `[lineNo|cell|lineNo|cell]`
  - :121-124 `resolveDiffView` useMemo
  - :138-151 요약(`headline` :141, `counts` :145, `encodingNote` :147)
  - :152-157 머리글 "원본"/"대상"
  - :158-165 한쪽 이유 문구
  - :175 제목 `원본·대상 내용 비교: ${target.path}`
  - :178 `<ZBCModal … size="wide">`
  - 툴바·keydown 없음
- `src/pages/FileDiffModal.module.css`
  - :12 `min-width: min(720px, 80vw)`
  - :79 `max-height: min(60vh, 520px)`
  - :99-108 `.lineNo`
  - :117-127 tone 3색(changed→`--warning-weak`, delete→`--danger-weak`, insert→`--success-weak`)
- `src/lib/file-diff-view.ts`
  - 화면 모델: :17 `typDiffTone`, :19-23 `itfDiffCell`, :26-29 `itfDiffRow`, :163 `resolveDiffView`
  - 분기: 편집 상한 초과 :195-200(문구 상수 :48), 한쪽 미리보기 :222-230
  - 문구 함수: `f_Counts` :110, `f_SideNotice` :71
  - hunk 목록·위치 막대 데이터 계산을 여기에 추가한다.
- `src/lib/use-virtual-rows.ts`
  - :19-24 `useVirtualRows(count, rowHeight=30, overscan=10, resetKey=null)`, 반환 `{ ref, win }`(:14-17, :63)
  - scrollTo API가 없고, :56 resetKey가 바뀌면 `scrollTop = 0`만 한다.
  - 차이 이동은 `ref.current.scrollTop`를 직접 설정한다(A-2).
- `src/shared/text-diff.ts`
  - :13 `TEXT_DIFF_MAX_EDITS = 2000`, :15-21 `typDiffOp`, :23-29 `itfSideBySideRow`, :125-188 `diffLines`, :195-229 `toSideBySide`
  - 문자 단위 diff는 없다. 같은 파일에 순수 함수로 추가하거나 새 파일 `src/shared/char-diff.ts`로 만든다(D-04).
- `src/components/ZBCModal.tsx:30-31` `size?: "default" | "wide"`, `src/components/ZBCModal.css` :8-9(기본 560px·높이 상한 `100vh-48px`), :21-23(wide 760px)
  - ZBCModal을 쓰는 페이지는 18개다. `size="wide"`는 FileDiffModal·SettingsPage만 쓴다.
  - 새 값을 더하는 변경이라 기존 페이지는 바뀌지 않는다.
- 테마 `src/components/themes/default.css`
  - 라이트 `--danger` :18·`--danger-weak` :23
  - 다크 `[data-theme="dark"]` :33(`--danger` :44·`--danger-weak` :49)
  - 시스템 다크 :55-56(`--danger` :67·`--danger-weak` :72)
- 그대로 두는 것
  - `src/main/services/file-diff-service.ts:41` `FILE_DIFF_MAX_BYTES = 2 * 1024 * 1024`
  - IPC 응답 타입
- 키보드 패턴 참고: `src/pages/ItemMenu.tsx:82-91`(document keydown 등록·정리), `src/pages/CompareRow.tsx:110`·`src/components/ZBCTabs.tsx:74`(요소 `onKeyDown`)
- 테스트
  - 단위: `tests/unit/text-diff.test.ts`, `tests/unit/file-diff-view.test.ts`
  - E2E: `tests/e2e/compare-diff.spec.ts:49` "파일 행에서 내용 비교를 열고 한쪽 미리보기·비활성 항목을 확인한다"(머리글·`/\d+줄 추가, \d+줄 삭제, \d+줄 변경/`·줄 텍스트로 확인)
- 데이터·스키마 변경: 없음(DB·IPC·설정 무변경)

## 4. 기능 요구사항 (FR-n)
- FR-1 모달 크기
  - `ZBCModal`에 `size="full"`을 추가한다. 폭은 `calc(100vw - 32px)`, 높이는 `calc(100vh - 48px)` 기준이다.
  - `FileDiffModal`은 이 크기를 쓴다. 기존 `default`·`wide` 값과 그 동작은 바뀌지 않는다.
- FR-2 툴바
  - 모달 본문 맨 위에 툴바를 둔다.
  - 툴바에는 `이전 차이`(↑)·`다음 차이`(↓) 아이콘 단추와 "차이 n곳 중 k" 표시가 있다. 접근 이름은 각각 "이전 차이", "다음 차이"다.
  - 편집·복사·저장 단추는 두지 않는다.
- FR-3 좌우 패널
  - 왼쪽은 원본, 오른쪽은 대상이다. 각 패널 위 머리글에 "원본"/"대상"과 파일 상대 경로를 보여 준다(가정 A-1).
  - 줄 번호 열은 유지한다.
  - 두 패널은 세로 스크롤을 함께 한다. 한 컨테이너 안에 두는 현재 방식을 유지해도 된다.
- FR-4 차이 표시
  - equal이 아닌 줄(changed·delete·insert)은 빨간 계열 배경(`--danger-weak`)으로 표시한다.
  - 한쪽에만 있는 줄의 빈 쪽 칸은 빗금 배경으로 표시한다.
  - 라이트·다크 두 테마 모두 테마 변수를 쓴다(하드코딩 색 금지).
- FR-5 차이 묶음
  - equal이 아닌 연속 행을 한 묶음(hunk)으로 센다.
  - hunk 목록(시작·끝 행 인덱스)은 `file-diff-view.ts`의 순수 함수가 만든다.
- FR-6 이전·다음 차이 이동
  - `다음 차이`는 현재 선택 행 뒤의 첫 hunk로, `이전 차이`는 앞의 hunk로 이동한다.
  - 이동하면 그 hunk의 첫 행을 선택하고, 그 행이 보이도록 스크롤한다.
  - 다음 hunk가 없으면 `다음 차이`, 이전 hunk가 없으면 `이전 차이`를 비활성화한다.
  - 선택이 없을 때 `다음 차이`는 첫 hunk로 간다.
  - 모달을 열면 첫 hunk를 자동 선택한다. hunk가 0개면 선택하지 않는다.
- FR-7 키보드
  - 비교 화면에 포커스가 있을 때 아래 키가 동작한다.
    - Alt+↓: 다음 차이, Alt+↑: 이전 차이
    - ↓/↑: 선택 행 한 줄 이동(보이게 스크롤)
  - 모달 밖·다른 입력 요소에는 영향을 주지 않는다. Escape로 모달이 닫히는 기존 동작은 유지한다.
- FR-8 줄 선택
  - 행을 누르면 선택한다. 선택 행은 테두리나 배경으로 구분한다.
  - 선택 상태는 모달을 닫을 때 버린다.
- FR-9 하단 선택 줄 비교
  - 좌우 영역 아래에 고정 높이 영역을 둔다. 위 줄은 선택 행의 원본, 아래 줄은 대상이다.
  - 각 줄 앞에 줄 번호를 표시한다. 없는 쪽은 "(줄 없음)"으로 표시한다.
  - 두 줄이 모두 있고 서로 다르면 다른 글자 구간을 진하게(`--danger` 계열) 강조한다.
  - 같거나 선택이 없으면 강조 없이 보인다. 선택이 없으면 "줄을 선택하면 원본·대상을 위아래로 비교합니다"를 표시한다.
- FR-10 문자 단위 diff
  - shared 순수 함수 `diffChars(a, b)`가 양쪽 문자열을 같은 구간·다른 구간 목록으로 나눈다.
  - 공통 앞·뒤를 잘라낸 다음 가운데를 문자 LCS로 비교한다.
  - 입력 길이 합이 상한(예: 2,000자)을 넘으면 공통 앞·뒤를 뺀 가운데 전체를 다른 구간으로 처리한다.
- FR-11 위치 막대
  - 좌우 영역 맨 왼쪽에 세로 막대를 둔다.
  - 전체 행 수를 막대 높이에 비례해 축소하고, hunk 위치를 빨간 표시로 그린다.
  - 현재 보이는 영역을 반투명 사각형으로 표시한다.
  - 막대를 누르면 그 비율 위치로 스크롤하고, 그 행을 선택한다.
  - 접근 이름은 "차이 위치 막대"다.
- FR-12 기존 분기 유지
  - 다음 경우의 안내 문구와 표시 방식은 INT-009 그대로 유지한다: 한쪽 미리보기, 바이너리·2MB 초과·읽기 실패 이유, 인코딩 안내, 편집 거리 상한 초과(원문 짝짓기), 줄 목록이 같고 바이트만 다른 경우.
  - 편집 거리 상한을 넘어 원문만 짝지은 경우에는 hunk 이동·위치 막대를 비활성화하거나 숨긴다.
  - 한쪽 미리보기에서는 위치 막대·차이 이동을 숨긴다.
- FR-13 요약 상태 줄
  - "n줄 추가, n줄 삭제, n줄 변경" 문구(`f_Counts`)는 유지한다. E2E 단언 호환을 위해서다.
  - 위치는 툴바나 하단 상태 줄로 옮겨도 된다.

## 5. 비기능 요구사항 (NFR-n)
- NFR-1 읽기 전용: diff 화면에서 파일 쓰기·전송·IPC 쓰기 동작이 0건이다. `src/main`·`src/preload`·`src/shared/ipc-contract.ts`의 diff는 0줄이다.
- NFR-2 성능
  - 가상 목록(`useVirtualRows`, `ROW_HEIGHT` 22px와 CSS 행 높이 일치)을 유지한다.
  - 2MB 파일에서도 hunk·위치 막대 계산은 행 수 O(n) 한 번으로 끝낸다. 위치 막대는 hunk 수 만큼만 그린다.
  - 문자 diff는 선택 행 하나에만 계산한다.
- NFR-3 의존성 0: 새 외부 라이브러리를 들이지 않는다. `package.json`·`THIRD_PARTY_NOTICES.md`는 바뀌지 않는다.
- NFR-4 규칙
  - AGENTS.md 1.5: renderer에서 Node API를 쓰지 않는다.
  - 4.4: `ZBCModal` 크기는 `zbcModal…` 클래스 규칙을 따른다.
  - 4.5: 페이지 CSS는 `@layer pages`, 공용 클래스를 덮을 때는 `:global()`을 쓴다.
  - 4.2: 이벤트 핸들러는 `h_`, 내부 함수는 `f_`, 타입은 `typ`/`itf` 접두사를 붙인다.
  - 4.1: UI 문구는 한국어다.
- NFR-5 접근성: 툴바 단추·위치 막대에 접근 이름을 준다. 키보드만으로 차이 이동·줄 선택이 가능하다.
- NFR-6 E2E: 테스트마다 renderer 콘솔 오류 0건이다(AGENTS.md 4.7).
- NFR-7 테마: 라이트·다크(수동·시스템)에서 빨간 표시·빗금·강조 대비가 보인다.

## 6. 인터페이스 · 데이터 스키마
- 확정
  - `ZBCModal` props: `size?: "default" | "wide" | "full"`(추가만, 기본값 `default` 유지)
  - IPC·DB·설정 스키마는 변경하지 않는다.
- 초안(구현 시 이름 조정 가능, 순수 함수·단위 테스트 대상)
  - `src/lib/file-diff-view.ts`
    - `itfDiffHunk { start: number; end: number }`(행 인덱스, end 포함)
    - `listHunks(rows: itfDiffRow[]): itfDiffHunk[]`
    - `findNextHunk(hunks, fromRow): number | null` / `findPrevHunk(hunks, fromRow): number | null`(hunk 인덱스)
    - `toMarkerRatios(hunks, totalRows): { top: number; height: number }[]`(0~1 비율, 최소 높이 보정은 CSS)
  - `src/shared/text-diff.ts` 또는 `src/shared/char-diff.ts`
    - `typCharSpan { text: string; same: boolean }`
    - `diffChars(a: string, b: string): { left: typCharSpan[]; right: typCharSpan[] }`
    - `CHAR_DIFF_MAX_CHARS = 2000`
- 화면 상태(FileDiffModal 내부): `selectedRow: number | null`. 현재 hunk 표시 k는 selectedRow가 속한 hunk의 번호이고, 속한 hunk가 없으면 "-"로 표시한다.

## 7. 예외 · 엣지 케이스
- hunk 0개(내용 같음·바이트만 다름 안내)일 때
  - 이동 단추는 둘 다 비활성화하고, "차이 0곳"을 표시한다.
  - 위치 막대에는 표시가 없다. 하단은 선택 안내 문구다.
- 첫 hunk에서 `이전 차이`, 마지막 hunk에서 `다음 차이`는 비활성 상태다. 이동은 순환하지 않는다.
- 선택 행이 hunk 사이 equal 행일 때: 다음은 그 뒤 첫 hunk, 이전은 그 앞 마지막 hunk로 간다.
- 한 hunk가 여러 행일 때: Alt+↓는 다음 hunk의 시작으로 간다. hunk 안은 ↑/↓로 줄 단위 이동한다.
- 첫 행에서 ↑, 마지막 행에서 ↓는 그대로 둔다.
- 매우 긴 줄
  - 좌우 패널은 지금처럼 가로 스크롤하거나 잘라서 보인다.
  - 하단 비교는 줄바꿈하거나 가로 스크롤한다.
  - 문자 diff 상한을 넘으면 가운데 구간 전체를 강조한다.
- 탭·공백만 다를 때: 문자 diff가 그 공백 구간을 강조한다. 공백은 보이는 표시 없이 배경 강조만 한다.
- 위치 막대
  - 행 수가 막대 픽셀 수보다 많으면 여러 hunk가 같은 픽셀로 겹친다. 표시는 최소 높이(예: 2px)를 보장한다.
  - 행 수가 적어도 비율 그대로 그린다.
- 편집 거리 상한 초과(`TEXT_DIFF_MAX_EDITS=2000`), 한쪽 미리보기, 바이너리·2MB 초과·읽기 실패: §4 FR-12대로 처리한다.
- 창 크기 변경: 위치 막대와 보이는 영역 표시는 컨테이너 크기·스크롤 변화에 따라 다시 계산한다.
- Alt 키 조합이 Electron 메뉴 단축키와 겹치는지 확인한다(메뉴 막대가 없으면 충돌 없음 — R-3).

## 8. 수용 기준 (AC-n)
- AC-1 (FR-1)
  - diff 모달 폭이 창 폭 - 32px 이상이다.
  - 다른 모달(예: SettingsPage `wide`, 기본 크기 모달)의 크기는 이전과 같다. E2E·단위 테스트 기존 통과로 확인한다.
- AC-2 (FR-2·FR-6)
  - 차이 2곳 이상인 파일을 연다.
  - 모달을 열면 첫 hunk가 선택되고 "차이 n곳 중 1"이 보인다.
  - "다음 차이" 단추를 누르면 "중 2"가 되고 두 번째 차이 행이 보인다.
  - "이전 차이"를 누르면 1로 돌아간다. 첫 hunk에서 "이전 차이"는 비활성이다.
- AC-3 (FR-7): 같은 파일에서 Alt+↓/Alt+↑가 AC-2와 같은 결과를 낸다. ↓를 누르면 선택 행이 한 줄 내려간다.
- AC-4 (FR-4)
  - 변경·추가·삭제 행 셀의 배경이 같은 빨간 계열 변수(`--danger-weak`) 하나다.
  - 한쪽에만 있는 행의 빈 칸에는 빗금 클래스·데이터 속성이 붙는다.
- AC-5 (FR-9·FR-10)
  - 변경 행을 선택하면 하단 영역에 원본 줄(위)과 대상 줄(아래)이 줄 번호와 함께 보인다.
  - 다른 글자 구간만 강조 요소(예: `mark` 또는 `data-diff`)로 감싸진다.
  - 단위 테스트에서 `diffChars("abcXdef","abcYdef")`가 다른 구간 `X`/`Y`만 돌려준다.
- AC-6 (FR-11)
  - 위치 막대에 hunk 수와 같은 개수의 표시가 그려진다.
  - 막대 아래쪽을 누르면 스크롤이 파일 아래쪽으로 이동한다.
  - 단위 테스트에서 `toMarkerRatios`의 비율이 0~1 범위다.
- AC-7 (FR-5): 단위 테스트에서 `listHunks`가 연속 non-equal 행을 하나로 묶는다. `findNextHunk`/`findPrevHunk`는 경계(첫·마지막·equal 사이·선택 없음)에서 §7대로 동작한다.
- AC-8 (FR-12·FR-13)
  - 한쪽 미리보기·이유 문구·인코딩 안내 기존 E2E 단언이 통과한다(문구 유지).
  - "n줄 추가, n줄 삭제, n줄 변경" 문구가 보인다.
- AC-9 (NFR-1·NFR-3): `git diff --stat`에 `src/main`·`src/preload`·`src/shared/ipc-contract.ts`·`package.json` 변경 0줄이다.
- AC-10 (NFR-6)
  - `pnpm run check`·`pnpm run format:check`·`pnpm run test:e2e`(콘솔 오류 0)·`pnpm run build:win`이 통과한다.
  - `docs/CHANGELOG.md`에 한 줄을 남긴다.

## 9. 가정과 리스크
- 가정
  - A-1: 패널 머리글 경로는 IPC를 바꾸지 않고, renderer에 이미 있는 정보로 만든다(작업의 원본·대상 루트 + 상대 경로, 없으면 상대 경로만). 응답 타입(`itfFileDiffData`)에 루트가 있는지는 착수 때 확인한다. 루트를 얻으려면 IPC 변경이 필요한 경우 상대 경로만 보이고 범위를 늘리지 않는다.
  - A-2: 차이 이동은 `useVirtualRows`의 `ref`로 `scrollTop = 행 인덱스 × ROW_HEIGHT`를 직접 설정해 구현한다. 훅에 함수를 더하는 확장도 허용한다.
- 리스크
  - R-1 E2E 회귀: `compare-diff.spec.ts:49`는 머리글 "원본"/"대상"·줄 수 문구·줄 텍스트로 단언한다. 구조를 바꾸면 깨질 수 있다. 문구는 유지하고, 단언은 role/name 기반으로 갱신한다.
  - R-2 성능: 위치 막대를 행마다 그리면 2MB 파일에서 느려진다. 그래서 hunk 단위로만 그린다(NFR-2).
  - R-3 단축키 충돌: Alt+↑/↓가 Windows·Electron 기본 동작(메뉴 접근 키)과 겹치지 않는지 E2E에서 확인한다. 겹치면 `preventDefault`를 쓴다.
  - R-4 공용 컴포넌트: `ZBCModal`에 값을 하나 더하는 것뿐이지만, 18개 페이지가 쓴다. CSS 선택자는 `full` 전용 클래스로 한정한다.
- 결정(intent D-n 승계 + spec 결정)
  - D-01(intent): 분해는 1개다(5기준 ③·④ 미충족).
  - D-02(intent): 편집·좌우 복사는 넣지 않는다. 폐기 대안은 참고 도구처럼 편집·복사 단추를 두는 것이었다.
  - D-03(intent): 특정 상용 도구를 복제하지 않고 상호작용만 따른다. 색은 앱 테마를 쓴다.
  - D-04(spec): 문자 diff는 shared 순수 함수로 직접 작성한다. 의존성은 0이다. 폐기 대안은 외부 diff 라이브러리였다.
  - D-05(spec): 이동은 순환하지 않고 끝에서 비활성화한다. 폐기 대안은 마지막에서 처음으로 순환하는 방식이었다.
- 인계 대조표 (11범주)

| 범주 | intent 기록 위치 | spec 반영 | plan 반영 | 판정 |
| :--- | :--- | :--- | :--- | :--- |
| ① 원 요구·출처 | 배경 `- 원 요구:` | §1 | §2 Step 0 | 기록 |
| ② 문제·영향 | `## 문제` | §1·§2 | §5 | 기록 |
| ③ 제안 결과 | `## 제안 결과` + 미해결 질문 답변 4건 | §4 FR-1~13·§8 | §3 | 기록 |
| ④ 영향 시스템·`경로:라인` | `## 영향`·`- 참조:` | §3(±0 재확인, file-diff-view 상한 분기 :195-200로 정정) | §2 | 기록 |
| ⑤ 제약·불변 계약 | `## 제약` | §5 NFR-1~7·§7 | §5 | 기록 |
| ⑥ 결정 D-n | D-01~D-03 | §9 결정 D-01~05 | §5 | 기록 |
| ⑦ 범위 밖·전제 | `- 범위 밖·전제:` | §2 Out-of-scope | §5 | 기록 |
| ⑧ 용어·기각 접근 | D-02 폐기 대안, 미해결 질문(BrowserWindow·F8·종류별 색 기각) | §2·§9 D-04·D-05 | §5 | 기록 |
| ⑨ 환경·재현 | `- 환경·재현:` | §5·§9 A-1 | §2·§4 | 기록 |
| ⑩ 미확정·가정 | 미해결 질문(전부 확정) | §9 A-1·A-2, §10 | §5 | 기록 |
| ⑪ 인계 지시 | `- 인계 지시:` (Tier 2, ZBCModal 영향 목록) | §1·§3·§9 R-4 | §1·§3·§6 | 기록 |

- 충실성 판정
  - 재실존: 인용 `경로:라인`은 researcher가 ±0으로 실측했다. intent 참조의 file-diff-view 상한 분기 라인은 :195-200으로 정정했다.
  - 원문 보존: 수치를 원문 그대로 옮겼다(2MB, 2000, 22px, 760px, 18개 페이지).
  - 모의 독해: 새 세션이 spec·plan만으로 T-01부터 착수할 수 있다 — 통과.

## 10. 미해결 질문 (Open questions)
- 없음
