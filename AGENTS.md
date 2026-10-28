# AGENTS.md — rcloneGUI

# Agent Instructions

- Answer in korean.
- 같은 내용을 반복하지마. 같은 내용을 반복하는 경우 멈추고 다시 진행해.
- 현재 실행환경이 Windows Command, Windows Powershell, Linux 어떤 환경인지 인지하고, 실행해.

## 개발 규칙

- 탭은 공백 4칸.
- 문자열은 ""(따옴표)가 기본이고, ''(작은따옴표), ``(백틱)이 필요할 때만 사용.
- type은 typ, interface는 itf 로 prefix 사용.
- 내부 Function은 f_로 prefix 사용. (예: `f_Func1()`, `f_Func2()`)
- handle Function은 h_로 prefix 사용. (예: `h_Submit()`)
- js class는 cls로 prefix 사용. (예: `clsMyClass`)
- 공용 컴포넌트 규칙:
    - 위치: `src/components/` 에 생성
    - CSS 파일: `src/components/<ComponentName>.css` 에 작성 및 `src/components/ZBC.css`에서 @import
    - 테마 변수 파일: `src/components/themes/` 에 작성 (예: `default.css`)
    - 컴포넌트 이름: `ZBC` prefix 사용 (예: `ZBCButton`, `ZBCInput`)
    - className: 반드시 `zbc` (공통) + `zbc<ComponentName>` 두 개를 함께 부여 (예: `className="zbc zbcButton"`). 컴포넌트 내부에 사용되는 모든 내부 dom의 className은 `zbc<ComponentName>` prefix를 반드시 사용.
    - Wrapper dom이 필요한 경우 `zbc<ComponentName>Wrapper`로 생성.
- 페이지/레이아웃 컴포넌트 규칙:
    - 위치: `src/pages/` 에 생성
    - CSS 파일: 컴포넌트와 같은 위치에 생성. `컴포넌트.module.css` 사용. css 코드는 들여쓰기 사용.
    - 스타일 파일 생성 시 `docs/guide/File.module.css.guide`의 구조와 작성 스타일을 준수할 것.
    - className: 최상단은 컴포넌트명과 같은 이름으로 생성, 내부의 컴포넌트는 prefix없이 사용. 예: `HomePage`컴포넌트의 내부 dom의 className은 `title`, `content`, `footer`등으로 사용.
    - CSS Cascade Layers: 페이지 module.css는 `@layer pages { ... }`, 레이아웃 module.css는 `@layer layouts { ... }`로 배정할 것 (순서: base < components < layouts < pages). 공용 컴포넌트 클래스(.zbcXxx) 오버라이드 시 `:global()` 사용.
- import 시 꼭 "@/" 사용. 단, 동일한 폴더 "./", 하위 폴더 "../~" 사용.

## 작업 원칙

- **Surgical Changes**: 요청된 부분만 수정, 나머지 불변
- **제3자 오픈소스 고지**: 외부 오픈소스 라이브러리/폰트(무료 라이브러리 포함)를 새로 도입할 경우, 반드시 루트 `THIRD_PARTY_NOTICES.md`에 기록할 것 (라이선스 의무 이행)
- **파일 생성 규칙 (File Generation Rules)**:
    - 신규 TypeScript/React 파일 생성 시 `docs/guide/File.tsx.guide`의 구조와 작성 스타일을 준수할 것.
    - 신규 페이지/레이아웃 CSS Module 파일 생성 시 `docs/guide/File.module.css.guide`의 구조와 작성 스타일을 준수할 것.
    - JSDoc 상단 정보 작성 (`@author dev-Joy YYYY-MM-DD` 필수 명시 및 파일/컴포넌트 설명 기술).
    - Imports 분류 (`External imports`, `Internal imports` 섹션 구분).
    - Props & Types 정의 (기본값 설정 `propsDefault` 형태 적용).
    - 컴포넌트 내부 섹션 구분을 주석으로 명확히 나눌 것 (`hook & state 변수 선언`, `Effect (부수 효과)`, `내부 변수 (_V)`, `이벤트 핸들러 및 내부 함수`).

## 작업 내역 (docs/works/)

- **`WORKS.md`** — 일일 요약 저장. 하루 작업을 `[YYYY-MM-DD] : 요약` 한 줄로 기록. 새 요청 시 **최우선으로 읽어** 맥락 파악 (답변 본문에는 출력 금지)
- **`WORKS_HISTORY.md`** — 상세 기록 저장. `[TASK_NNN] : (YYYY-MM-DD) [변경 요약]` 형식, 동일 기능 반복 수정 시 이전 기록 갱신
- 오류: `WORKS_HISTORY.md` Error 섹션 기록 → 해결 시 작업ID와 연결, 3개 이상 누적 시 요약 압축

rclone을 감싼 Windows용 폴더 비교·동기화 데스크톱 앱. Electron + electron-vite + React + TypeScript.
사람과 AI 에이전트가 같은 규칙으로 작업한다.

## 1. 안전 규칙 (예외 없음)

1. rclone은 `spawn`/`execFile(rcloneExe, args[], { shell: false })`로만 실행한다. 명령 문자열 조립과 `shell: true` 금지.
2. 실제 동기화(`--dry-run` 없는 sync/copy)는 `RcloneRunner.execute()` 한 곳에서만 시작하고, 미리보기 실행 ID와 확인한 삭제 수 없이는 부를 수 없게 유지한다.
3. 위험 옵션(`--delete-excluded`, `--no-check-dest`, `--max-delete -1`, `--dump*`, 백업 없는 `--ignore-errors`)은 `command-builder.ts`의 차단 목록을 거친다. 차단 목록을 줄이는 변경은 ADR 필수.
4. 테스트·예제·로그에 실제 사용자 경로(`E:\…`, `\\wsl.localhost\…`, `GDRIVE-…`)와 rclone.conf 내용을 넣지 않는다. 테스트는 임시 폴더만 쓴다.
5. renderer에서 Node API를 쓰지 않는다. `contextIsolation`과 `sandbox`를 끄지 않는다.
6. rclone.conf는 경로로만 넘긴다. 앱 코드에서 열어 읽거나 기록에 남기지 않는다.

## 2. 명령

- 패키지 매니저는 pnpm이다 (`pnpm-lock.yaml`). npm · yarn · bun으로 설치하지 않는다
- `pnpm install` — 의존성 설치. 끝나면 `postinstall`이 Electron 실행 파일을 내려받는다
- `pnpm run dev` — 개발 실행
- `pnpm run check` — typecheck + lint(oxlint, eslint) + 단위 테스트 (커밋 전 필수)
- `pnpm run harness:sync` — `.claude/`의 규칙·스킬·검증 에이전트를 `.agents/`로 옮김 (`pnpm run check`가 어긋남을 검사)
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
- `docs/intent.md`(의도와 판단 기준), `docs/prd.md`(요구사항과 상태), `docs/adr/`, `docs/knowhow/rclone-notes.md`, `docs/CHANGELOG.md`, `docs/works/`
- `scripts/probes` — rclone 동작 실험, `scripts/dev/drive-app.mjs` — 빌드본을 임시 프로필로 띄워 조작하는 확인 도구
- `.claude/` — Claude Code 하네스. 이 문서의 규칙을 되풀이하지 않고 가리키기만 한다
    - `settings.json` — 훅 4개와 검증 명령 허용 목록
    - `hooks/` — 편집한 파일 oxfmt 포맷, `--dry-run` 없는 rclone 쓰기 명령 차단, 비밀값(토큰·비밀번호·rclone.conf 내용) 쓰기 차단, 스킬·에이전트 사용 기록
    - `rules/` — 경로별 주의 사항(화면 · main · 테스트)과 검증 루프 제한(최대 3회)
    - `skills/` — `feature-pipeline`(명세 → 구현 → 병렬 검증), `run-rclonegui`, `rclone-probe`, `new-ui-file`, `metrics-summary`
    - `agents/` — `reviewer`(정적 감사), `app-verifier`(앱을 띄워 검증). 둘 다 `STATUS: APPROVED | REJECTED`로 판정만 한다
- `.agents/` — Antigravity 하네스. `.claude/`와 같은 내용을 Antigravity 형식으로 둔다
    - `rules/`, `skills/`, `agents/reviewer.md`, `agents/app-verifier.md` — **생성 파일**. `.claude/`의 원본을 고친 뒤 `pnpm run harness:sync`로 만든다. 직접 고치지 않는다
    - `hooks.json`, `scripts/`, `agents/senior-architect.md`, `agents/implementer.md` — Antigravity 전용이라 여기서 직접 관리한다
- `scripts/harness/` — 두 하네스가 함께 쓰는 훅 로직(`lib.mjs`)과 동기화 스크립트(`sync-agents.mjs`). 무엇을 막고 기록하는지는 `lib.mjs` 한 곳에서만 고친다
- `.codegraph/` — CodeGraph 색인 (`codegraph init`으로 만든 로컬 DB, git에 올리지 않음). 코드를 찾거나 영향 범위를 볼 때는 grep보다 먼저 쓴다:
  MCP 도구 `codegraph_explore`, 또는 셸에서 `codegraph explore "<심볼이나 질문>"`, `codegraph callers <심볼>`, `codegraph impact <심볼>`.
  색인은 파일이 바뀌면 스스로 따라온다. 어긋나 보이면 `codegraph sync`
- `docs/specs/` — 기능 명세서 (`YYYY-MM-DD-{작업요약-kebab-case}.md`). `feature-pipeline`이 만든다
- `@/`는 어느 프로세스에서나 `src`를 가리킨다 (`electron.vite.config.mts`, `tsconfig.*.json`, `vitest.config.mts`)

## 4. 코드 컨벤션

- TypeScript strict, `any` 금지. 외부 입력은 `unknown`으로 받아 zod로 파싱한다.
- 파일명 kebab-case, 컴포넌트 `PascalCase.tsx`, 훅 `useXxx`, 테스트 `*.test.ts`.
- 접두사 적용 범위: `f_`는 파일·함수 안에서만 쓰는 함수에 붙이고, export하는 함수와 클래스 메서드에는 붙이지 않는다. React 훅(`use*`)과 컴포넌트는 React 규칙을 따른다.
- 신규 파일은 `docs/guide/File.tsx.guide`(화면 컴포넌트와 main·preload·shared 모듈), `docs/guide/File.module.css.guide`를 따른다.
- 식별자와 커밋 타입은 영어, 주석·UI 문구·문서는 한국어.
- IPC 채널과 타입은 `src/shared/ipc-contract.ts`에만 정의한다.
- IPC 응답은 `{ ok: true, data } | { ok: false, error: { code, message } }`. 예외를 그대로 넘기지 않는다.
- rclone 출력 파서는 순수 함수로 만들고 `tests/fixtures`의 실제 출력으로 테스트한다.
- UI 문구는 일어날 일을 쓴다: "동기화" 대신 "대상에 12개 복사, 3개 삭제".

## 5. 완료 기준 (변경마다)

- [ ] `pnpm run check` 통과
- [ ] 빌더·파서·안전 로직을 바꿨다면 테스트 추가, `pnpm run test:int` 통과
- [ ] 사용자에게 보이는 변경은 `docs/CHANGELOG.md`에 한 줄
- [ ] 새로 알게 된 rclone 동작은 `docs/knowhow/rclone-notes.md`에 기록

## 6. 커밋

- Conventional Commits: feat, fix, test, docs, refactor, chore
- 한 커밋에 한 가지 변경. 실험용 임시 코드는 커밋하지 않는다.

## 7. 노하우 기록 형식

- `rclone-notes.md`: 날짜 · rclone 버전 · OS · 명령 · 결과 · 앱에 준 영향
- `docs/adr/NNNN-제목.md`: 배경 · 결정 · 버린 대안 · 결과

## 8. 도구로 강제하는 규칙

- oxfmt(`.oxfmtrc.json`): 공백 4칸, 큰따옴표
- oxlint(`.oxlintrc.json`): `no-explicit-any`, 훅 규칙, 상위 폴더 상대 경로 import 금지(`@/` 사용), 화면 코드의 Node·Electron·main import 금지, shared의 Node import 금지
- ESLint(`eslint.config.mjs`): oxlint에 없는 두 가지만 — `shell: true` 금지, `typ`/`itf`/`cls` 접두사
- 단위 테스트: 차단 목록의 옵션이 생성 결과에 나오지 않는다 (`tests/unit/command-builder.test.ts`)
- 통합 테스트: 미리보기 없이·확인 수가 다르면·30분이 지나면·설정이 바뀌면 실행이 거부된다 (`tests/integration/runner.test.ts`)
