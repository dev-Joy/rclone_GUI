# AGENTS.md — rcloneGUI

rclone을 감싼 Windows용 폴더 비교·동기화 데스크톱 앱. Electron + electron-vite + React + TypeScript.
사람과 AI 에이전트가 같은 규칙으로 작업한다.

## 0. 에이전트 지침

- 답변은 한국어로 한다.
- 같은 내용을 반복하지 않는다. 반복하게 되면 멈추고 다시 진행한다.
- 실행 환경(Windows Command, Windows PowerShell, Linux)을 확인하고 그에 맞게 실행한다. 프로젝트 명령은 2장을 따른다.

## 1. 안전 규칙 (예외 없음)

1. rclone은 `spawn`/`execFile(rcloneExe, args[], { shell: false })`로만 실행한다. 명령 문자열 조립과 `shell: true` 금지.
2. 실제 동기화(`--dry-run` 없는 sync/copy)는 한 곳에서만 시작하고, 미리보기 실행 ID와 확인한 삭제 수 없이는 부를 수 없게 유지한다.
3. 위험 옵션(`--delete-excluded`, `--no-check-dest`, `--max-delete -1`, `--dump*`, 백업 없는 `--ignore-errors`)은 `command-builder.ts`의 차단 목록을 거친다.
4. 테스트·예제·로그에 실제 사용자 경로(`E:\…`, `\\wsl.localhost\…`, `GDRIVE-…`)와 rclone.conf 내용을 넣지 않는다. 테스트는 임시 폴더만 쓴다.
5. renderer에서 Node API를 쓰지 않는다. `contextIsolation`과 `sandbox`를 끄지 않는다.
6. rclone.conf는 경로로만 넘긴다. 앱 코드에서 열어 읽거나 기록에 남기지 않는다.

## 2. 명령

- Node·pnpm은 Windows에 설치되어 있다. 아래 명령은 Windows PowerShell에서 실행한다 (WSL에는 node가 없다).
- 패키지 매니저는 pnpm이다 (`pnpm-lock.yaml`). npm · yarn · bun으로 설치하지 않는다.
- `pnpm install` — 의존성 설치. 끝나면 `postinstall`이 Electron 실행 파일을 내려받는다
- `pnpm run dev` — 개발 실행
- `pnpm run check` — typecheck + lint(oxlint, eslint) + 단위 테스트 (커밋 전 필수, 포맷 검사는 포함 안 됨)
- `pnpm run format` — oxfmt로 포맷 (`pnpm run format:check`는 검사만)
- `pnpm run test:int` — 실제 rclone으로 통합 테스트 (rclone이 없으면 이유를 출력하고 건너뜀)
- `pnpm run build` — `out/`에 빌드, `pnpm start`로 빌드본 실행
- `pnpm run dist` — Windows 설치 파일(NSIS, 사용자 단위)을 `dist/`에 만든다. 설정은 `electron-builder.yml`
- `node scripts/probes/rclone-probes.mjs` — rclone 동작 확인. 임시 폴더만 쓰고 결과를 `tests/fixtures/rclone/`에 저장 (rclone을 올릴 때마다 재실행)

설치본은 코드 서명이 없다. 설치본에는 `out/`과 운영 의존성만 들어간다 (소스 · 테스트 · 문서 · 하네스 제외).

## 3. 구조

- `src/main` — rclone 실행(`rclone/`), 출력 파서(`parsers/`), 저장소(`store/`), IPC 핸들러(`ipc/`)
- `src/preload` — contextBridge 브리지 (`window.rclonegui`)
- `src/renderer` — 화면 진입점 (`index.html`, `main.tsx`, `env.d.ts`)
- `src/components` — 공용 컴포넌트 `ZBC*`와 `ZBC.css`, `themes/`
- `src/pages` — 페이지·레이아웃 컴포넌트와 `*.module.css`
- `src/stores`, `src/lib` — 화면 상태(zustand)와 화면용 도우미
- `src/shared` — 타입·IPC 계약·zod 스키마 (Node·DOM 의존 금지)
- `tests/unit`, `tests/integration`, `tests/fixtures` — fixtures는 실험 스크립트로 받은 실제 rclone 출력
- `docs/guide` — 신규 파일 작성 가이드 (`File.tsx.guide`, `File.module.css.guide`)
- `docs/knowhow/rclone-notes.md`, `docs/CHANGELOG.md`, `docs/works/`
- `scripts/probes` — rclone 동작 실험, `scripts/dev/drive-app.mjs` — 빌드본을 임시 프로필로 띄워 조작하는 확인 도구
- `@/`는 어느 프로세스에서나 `src`를 가리킨다 (`electron.vite.config.mts`, `tsconfig.*.json`, `vitest.config.mts`)

## 4. 코드 컨벤션

### 4.1 공통

- TypeScript strict, `any` 금지. 외부 입력은 `unknown`으로 받아 zod로 파싱한다.
- 들여쓰기는 공백 4칸. 문자열은 큰따옴표("")가 기본이고, 작은따옴표('')·백틱(``)은 필요할 때만 쓴다.
- import는 `@/`를 쓴다. 같은 폴더와 하위 폴더만 `./`를 쓴다 (예: `./sub/x`). 상위 폴더 상대 경로(`../`)는 금지.
- 파일명 kebab-case, 컴포넌트 `PascalCase.tsx`, 훅 `useXxx`, 테스트 `*.test.ts`.
- 식별자와 커밋 타입은 영어, 주석·UI 문구·문서는 한국어.
- UI 문구는 일어날 일을 쓴다: "동기화" 대신 "대상에 12개 복사, 3개 삭제".

### 4.2 이름 접두사

- type은 `typ`, interface는 `itf`, class는 `cls` 접두사 (예: `typRow`, `itfProps`, `clsRunner`).
- `f_`는 파일·함수 안에서만 쓰는 함수에 붙인다 (예: `f_ParseLine()`). export하는 함수와 클래스 메서드에는 붙이지 않는다.
- 이벤트 핸들러는 `h_` 접두사 (예: `h_Submit()`).
- React 훅(`use*`)과 컴포넌트는 React 규칙을 따른다.

### 4.3 신규 파일

- TypeScript/React 파일(화면 컴포넌트와 main·preload·shared 모듈)은 `docs/guide/File.tsx.guide`, 페이지·레이아웃 CSS Module은 `docs/guide/File.module.css.guide`의 구조와 작성 스타일을 따른다.
- 상단 JSDoc에 파일·컴포넌트 설명과 `@author dev-Joy YYYY-MM-DD`를 적는다.
- import는 `External imports`, `Internal imports` 섹션으로 나눈다.
- Props가 있는 컴포넌트는 기본값을 `propsDefault` 객체로 정의한다.
- 컴포넌트 내부는 주석으로 섹션을 나눈다: `hook & state 변수 선언`, `Effect (부수 효과)`, `내부 변수 (_V)`, `이벤트 핸들러 및 내부 함수`.

### 4.4 공용 컴포넌트 (`src/components/`)

- 이름은 `ZBC` 접두사 (예: `ZBCButton`, `ZBCInput`).
- CSS는 `src/components/<ComponentName>.css`에 쓰고 `src/components/ZBC.css`에서 `@import`한다.
- 테마 변수는 `src/components/themes/`에 쓴다 (예: `default.css`).
- 최상위 className은 `zbc`(공통) + `zbc<Name>`을 함께 준다. `<Name>`은 `ZBC`를 뺀 이름이다 (예: `ZBCButton` → `className="zbc zbcButton"`).
- 내부 DOM의 className은 모두 `zbc<Name>` 접두사를 쓴다 (예: `zbcButtonIcon`). Wrapper DOM이 필요하면 `zbc<Name>Wrapper`로 만든다.

### 4.5 페이지·레이아웃 컴포넌트 (`src/pages/`)

- CSS는 컴포넌트와 같은 위치에 `<컴포넌트>.module.css`로 만든다. CSS 안에서도 중첩 블록은 들여쓴다.
- 최상위 className은 컴포넌트명과 같게 하고, 내부 DOM은 접두사 없이 쓴다 (예: `HomePage` 안의 `title`, `content`, `footer`).
- CSS Cascade Layers: 페이지는 `@layer pages { ... }`, 레이아웃은 `@layer layouts { ... }` (순서: base < components < layouts < pages). 공용 컴포넌트 클래스(`.zbcXxx`)를 덮어쓸 때는 `:global()`을 쓴다.

### 4.6 main · IPC · 파서

- IPC 채널과 타입은 `src/shared/ipc-contract.ts`에만 정의한다.
- IPC 응답은 `{ ok: true, data } | { ok: false, error: { code, message } }`. 예외를 그대로 넘기지 않는다.
- rclone 출력 파서는 순수 함수로 만들고 `tests/fixtures`의 실제 출력으로 테스트한다.

## 5. 작업 원칙

- **Surgical Changes**: 요청된 부분만 수정하고 나머지는 그대로 둔다.
- **제3자 오픈소스 고지**: 외부 오픈소스 라이브러리·폰트(무료 포함)를 새로 들이면 루트 `THIRD_PARTY_NOTICES.md`에 기록한다 (라이선스 의무 이행).

## 6. 완료 기준 (변경마다)

- [ ] `pnpm run check` 통과
- [ ] `pnpm run format:check` 통과
- [ ] 빌더·파서·안전 로직을 바꿨다면 테스트 추가, `pnpm run test:int` 통과
- [ ] 사용자에게 보이는 변경은 `docs/CHANGELOG.md`에 한 줄
- [ ] 새로 알게 된 rclone 동작은 `docs/knowhow/rclone-notes.md`에 기록
- [ ] `docs/works/` 작업 내역 기록 (7장)

## 7. 작업 내역 (`docs/works/`)

- **`WORKS.md`** — 일일 요약. 하루 작업을 `[YYYY-MM-DD] : 요약` 한 줄로 기록. 새 요청 시 **가장 먼저 읽어** 맥락을 파악한다 (답변 본문에는 출력하지 않음).
- **`WORKS_HISTORY.md`** — 상세 기록. `[TASK_NNN] : (YYYY-MM-DD) [변경 요약]` 형식. 같은 기능을 다시 고치면 이전 기록을 갱신한다.
- 오류는 `WORKS_HISTORY.md` Error 섹션에 기록하고, 해결하면 작업 ID와 연결한다. 3개 이상 쌓이면 요약해 압축한다.

## 8. 커밋

- Conventional Commits: feat, fix, test, docs, refactor, chore
- 한 커밋에 한 가지 변경. 실험용 임시 코드는 커밋하지 않는다.

## 9. 노하우 기록 형식

- `rclone-notes.md`: 날짜 · rclone 버전 · OS · 명령 · 결과 · 앱에 준 영향

## 10. 도구로 강제하는 규칙

- oxfmt(`.oxfmtrc.json`): 공백 4칸, 큰따옴표, 줄바꿈 LF (md 파일은 포맷 대상 아님)
- `.gitattributes` · `.editorconfig`: 모든 텍스트 파일 줄바꿈 LF (`*.bat`·`*.cmd`·`*.ps1`만 CRLF, `tests/fixtures/`는 원본 보존)
- oxlint(`.oxlintrc.json`): `no-explicit-any`, 훅 규칙, 상위 폴더 상대 경로 import 금지(`@/` 사용), 화면 코드의 Node·Electron·main import 금지, shared의 Node import 금지
- ESLint(`eslint.config.mjs`): oxlint에 없는 두 가지만 — `shell: true` 금지, `typ`/`itf`/`cls` 접두사
- 단위 테스트: 차단 목록의 옵션이 생성 결과에 나오지 않는다 (`tests/unit/command-builder.test.ts`)
- `f_`·`h_` 접두사와 4.3~4.5 규칙은 도구로 강제하지 않으므로 리뷰에서 확인한다.
