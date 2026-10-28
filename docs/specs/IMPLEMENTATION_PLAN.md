# rcloneGUI MVP 구현 계획 (IMPLEMENTATION_PLAN)

- 프로젝트: `/mnt/d/dev-Joy/rcloneGUI` (Windows `D:\dev-Joy\rcloneGUI`)
- 설계 기준: `docs/specs/MVP_SPEC.md` (**SSOT**)
- 작성일: 2026-10-27
- 최종 수정일: 2026-10-28 (린트/포맷 도구를 oxlint·oxfmt로 확정)
- 검증 등급: **Tier 3 (Major)**
- 범위: 구현 순서/파일/의존성/검증/리스크. 이 문서에는 소스 코드를 포함하지 않는다.

> 구현 원칙: 한 단계가 끝나면 **빌드 가능 + 테스트 통과 + 이전 기능 유지** 상태를 만든다.
> 각 단계는 독립적으로 되돌릴 수 있어야 하며, 실제 사용자 데이터(`E:\My Projects`, 실제 Drive)는
> 자동 테스트에 사용하지 않는다.

---

## 1. 실행 환경과 명령 규칙

### 1.1 환경 전제

| 항목 | 값 |
| :--- | :--- |
| OS | Windows 11 x64 |
| 프로젝트 | `D:\dev-Joy\rcloneGUI` |
| Node | 24.20.0 |
| npm | 9.2.0 (가능하면 `npm.cmd`) |
| rclone | 1.75.1 (`C:\Users\LG\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_...\rclone.exe`) |
| rclone config | `C:\Users\LG\AppData\Roaming\rclone\rclone.conf` |
| WSL | Ubuntu, 프로젝트는 Windows 파일 시스템에서 빌드 |

### 1.2 Windows PowerShell 제약

- PowerShell 실행 정책 때문에 `npm.ps1`이 차단될 수 있으므로 **항상 `npm.cmd`**를 사용한다.
- PowerShell 5.1에서는 `&&`가 동작하지 않을 수 있으므로 명령을 한 줄씩 실행한다.
- 개발 서버/Electron은 Windows GUI 세션에서 실행한다. WSL 셸에서 `npm run dev`를 실행하지 않는다.
- WSL 셸에서 Windows 명령을 실행할 때만 `cmd.exe /c`를 사용한다.
- `lint`/`format`/`format:check`도 Windows `npm.cmd`로 실행한다. WSL에서 설치한 oxlint/oxfmt Linux binding과 혼용하지 않는다.

```powershell
cd D:\dev-Joy\rcloneGUI
npm.cmd install
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test
```

```bash
# WSL에서 Windows 빌드 도구를 호출하는 경우 (예시)
cmd.exe /c "cd /d D:\dev-Joy\rcloneGUI && npm.cmd run typecheck"
```

- 각 Phase 종료 시 `npm.cmd run typecheck`/`lint`/`format:check`/`test`를 실행한다.

### 1.3 버전 고정 원칙

- `package.json`은 정확한 버전(또는 `~` 최소 범위)과 lockfile을 사용한다.
- **TypeScript 5.9.3 고정**: Vite 8/electron-vite 6/React 19 타입 조합의 채택값이며 Phase 0에서 재확인한다.
  oxlint는 TS 버전에 독립적이며, oxlint type-aware/type-check는 TS 7.0+와 `oxlint-tsgolint`가 필요하므로
  MVP에서는 사용하지 않는다. TS 7 전환은 Vite/electron-vite/React 타입 호환 확인 후 별도 승인으로 진행한다.
- **oxlint/oxfmt 정확한 버전 고정**: `oxlint 1.90.0`, `oxfmt 0.75.0`. oxfmt는 0.x이므로 `^`/`~` 범위를 사용하지 않는다.
- Electron 45 / electron-vite 6 / Vite 8 / @vitejs/plugin-react 6 조합을 Phase 0에서 실제 빌드로 검증한다.
- npm 9 설치 문제가 반복되면 사용자 승인 후 `npm.cmd install -g npm@11`로 업그레이드한다(임의 변경 금지).

---

## 2. 단계 요약

| Phase | 목표 | 주요 산출물 | 선행 | 검증 |
| :--- | :--- | :--- | :--- | :--- |
| 0 | 스캐폴딩/도구 호환성 | 빈 앱 창, 빌드/테스트 설정, CJS preload 확인 | - | dev/build/typecheck/lint/format:check |
| 1 | 공유 순수 코어 | 타입/zod, diff, args, log parser, path pure, 단위 테스트 | 0 | unit/typecheck/lint |
| 2 | Main 기반/저장소/IPC | 원자적 JSON store, settings/jobs, envelope, preload API | 1 | unit + dev |
| 3 | rclone 환경/WSL/경로 | 감지/설정/remotes, WSL helper, path probe, 온보딩 | 2 | integration + manual |
| 4 | Job CRUD UI | 목록/편집/경로 필드/WSL helper/설정 화면 | 3 | manual + unit |
| 5 | 비교 엔진/UI | lsjson 병렬, diff, 요약/필터/정렬/가상화, plan token | 4 | integration + manual |
| 6 | 실행 코어(copy/dry-run) | runner, stats/log, 취소, 락, 이력 기록, 실행 UI | 5 | integration + unit |
| 7 | 파괴적 실행/안전 게이트 | sync, 삭제 모달, preflight, max-delete, 고아 복구 | 6 | integration + gate audit |
| 8 | 자동화/운영 UI | scheduler, 자동 실행, 이력/로그 UI, 트레이/테마/로그인 | 7 | unit(fake clock) + manual |
| 9 | 패키징/E2E/문서/수용 | NSIS, README/AGENTS, smoke E2E, 실제 환경 수용 | 8 | build:win + E2E + manual |

### 2.1 의존성 그래프

```text
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
                                                        ↓
                                                     Phase 6
                                                        ↓
                                                     Phase 7
                                                        ↓
                                                     Phase 8
                                                        ↓
                                                     Phase 9
```

- 순차 진행을 기본으로 한다. Phase 3과 4의 일부 UI는 병렬화할 수 있지만, 안전한 통합을 위해 단일 구현자가
  순서대로 진행하는 것을 권장한다.
- Phase 6에서 sync 실제 실행은 **비활성**한다. Phase 7의 안전 게이트가 완성된 뒤에만 활성화한다.
- Phase 8의 스케줄러는 Phase 7의 자동 실행 게이트를 재사용한다. 게이트를 우회하는 별도 실행 경로를 만들지 않는다.

---

## 3. 단계별 상세

### Phase 0 — 스캐폴딩과 호환성 스파이크

**목표**: 빈 저장소에 실행 가능한 Electron 앱 골격을 만들고, 최신 스택 조합과 CJS preload/샌드박스를 검증한다.

**파일**

- `package.json`, `package-lock.json` (npm 생성)
- `electron.vite.config.mts`
- `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- `.oxlintrc.json`, `.oxfmtrc.json`, `.editorconfig`, `.gitignore`
- `electron-builder.yml` (초안)
- `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`
- `src/main/index.ts`, `src/main/window.ts`
- `src/preload/index.ts`
- `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`
- `src/renderer/src/styles/tokens.css`, `base.css`
- `resources/tray.png` (임시 아이콘), `build/icon.ico` (있으면)
- `src/shared/types/ipc.ts` (ping용 최소 타입)

**작업**

1. 의존성 설치: Electron 45.0.0, electron-vite 6.0.0, Vite 8.3.5, @vitejs/plugin-react 6.1.2,
   React 19.3.1, TypeScript 5.9.3, **oxlint 1.90.0, oxfmt 0.75.0**, zod 4.6.7, Zustand 5.0.16,
   lucide-react 1.62.0, @tanstack/react-virtual 3.14.23, Vitest 5.0.5, Playwright 1.64.1,
   electron-builder 26.18.0. ESLint/typescript-eslint/eslint-plugin-react-hooks/Prettier는 설치하지 않는다.
2. `package.json`에 `"type": "module"`을 넣지 않고, `main`/`preload` CJS 출력 확인.
3. `BrowserWindow`에 `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`.
4. preload는 `window.rclonegui.app.getInfo()` 정도의 최소 API만 제공(더미 응답 가능).
5. `app.setName('rcloneGUI')`, 단일 인스턴스, 창 ready-to-show, CSP 초안, 탐색/권한 차단.
6. electron-vite dev/build가 동작하는지 확인. `out/main/index.js`, `out/preload/index.js`가 CJS인지 확인.
7. `out/main`/`out/preload`에 외부 `require('zod')`가 없는 번들링 전략(전 의존성 번들)을 확인.
8. React 19 + Vite 8 + HMR + CSP(개발/운영) 충돌 여부를 확인하고, 필요하면 개발 CSP만 완화한다.
9. `test`는 unit config만, `test:integration`은 별도 config를 사용하도록 설정.
10. `.oxlintrc.json`/`.oxfmtrc.json`을 추가하고 `lint`/`lint:fix`/`format`/`format:check` 스크립트를 설정한다.
    oxlint는 correctness=error, suspicious=warn, React 19/Hooks/a11y/Vitest 플러그인, main/preload/renderer/test env
    override를 사용한다. core 규칙은 `no-console`/`no-unused-vars`처럼 접두사 없이 쓴다. oxfmt는 Prettier 기본과
    맞추기 위해 `printWidth: 80`, `endOfLine: "lf"`, `sortImports: false`, `sortPackageJson: false`를 명시하고
    `docs/**`/`tests/fixtures/**`를 제외한다.

**검증 명령**

```powershell
cd D:\dev-Joy\rcloneGUI
npm.cmd install
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build
npm.cmd run dev
```

**합격 기준**

- dev 창이 뜨고 렌더러 콘솔 에러 0건.
- build 성공, `out/preload/index.js`가 샌드박스에서 로드됨(`window.rclonegui` 확인).
- typecheck/lint/format:check exit 0. `oxlint --version`=1.90.0, `oxfmt --version`=0.75.0.
- ESLint/Prettier 설정 파일과 devDependencies가 0건.
- Electron 45가 Node 24.22.0 기반임을 `app:getInfo`로 확인.
- **Go/No-Go**: electron-vite 6이 `"type":"module"`을 강제하지 않는지 확인. 강제하면 preload를 CJS `.cjs`로
  출력하는 대안을 적용하고, `sandbox:false`로 낮추지 않는다(필요 시 사용자 승인).
- **Go/No-Go**: Windows x64에서 oxlint/oxfmt native binding이 정상 실행되고, `lint`/`format:check`가
  결정적으로 동작하는지 확인. 실패가 2회 반복되면 사용자 승인 후 ESLint/Prettier로 임시 회귀한다.

**롤백**: Phase 0에서 추가한 파일만 제거하고 빈 저장소 상태로 되돌린다.

---

### Phase 1 — 공유 순수 코어와 단위 테스트

**목표**: Main/Renderer가 공유하는 타입, 검증, diff, args, 로그 파서, 경로 유틸을 먼저 완성한다.
UI/프로세스 없이 테스트로 고정해 이후 단계의 회귀를 막는다.

**파일**

- `src/shared/types/common.ts`, `job.ts`, `settings.ts`, `compare.ts`, `run.ts`, `ipc.ts`
- `src/shared/schemas/job.ts`, `settings.ts`, `compare.ts`, `run.ts` (zod)
- `src/shared/paths/path-utils.ts` (Node API 미사용)
- `src/shared/diff/engine.ts`
- `src/shared/rclone/args.ts`
- `src/shared/rclone/log-parser.ts`
- `src/shared/format.ts`
- `tests/unit/paths.test.ts`, `diff.test.ts`, `args.test.ts`, `log-parser.test.ts`, `schemas.test.ts`, `format.test.ts`, `shared-boundary.test.ts`
- `tests/fixtures/rclone-log/*.jsonl` (실측 로그에서 경로/민감정보 익명화)

**작업**

1. MVP_SPEC §5, §12의 타입과 zod 스키마를 그대로 구현한다.
2. 경로 분류/정규화/UNC 변환/루트·중첩·동일 검사 pure 함수와 케이스 표를 테스트한다.
   `\\wsl$\`↔`\\wsl.localhost\`, `\\wsl.localhost\<distro>\mnt\e\...`↔`E:\...` canonical key도 포함한다.
3. diff 엔진: 상태 5종, tolerance 경계(0/정확히 허용/초과), 해시 우선순위/fallback, type conflict,
   case-only/collision, 빈 디렉터리 미표시 전제를 테스트한다.
4. args builder: 정확한 배열/순서/플래그 생략, `--config`, `--exclude` 반복, `--modify-window`,
   positional 앞 `--` terminator, copy/sync `--max-delete` 차이, `--dry-run`을 테스트한다.
5. log parser: 관측된 skipped copy/delete/touch, stats, 실제 copy/delete, exit 7 오류, 비JSON/부분 라인.
6. `shared-boundary.test.ts`: `src/shared/**`가 `node:*`/Node 전역을 import하지 않는지 검사한다.
7. 타입/스키마에서 `NodeJS.*`, Electron 타입을 shared에 넣지 않는다(Renderer typecheck 보호).

**검증 명령**

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
```

**합격 기준**

- diff/args/parser/path 테스트 전부 통과. 관측 fixture가 모두 파싱됨.
- tolerance 경계와 hash fallback이 MVP_SPEC §7.3과 일치.
- shared에 Node/Electron 의존성 0건.

**롤백**: shared 모듈은 이후 단계에서만 사용되므로 해당 파일과 테스트를 제거하면 이전 상태로 복귀한다.

---

### Phase 2 — Main 기반, 저장소, IPC 골격

**목표**: 앱 설정/Job/이력의 영속화와 검증된 IPC 경계를 만든다. UI 없이 서비스 단위로 검증한다.

**파일**

- `src/main/lib/{result,errors,logger,mutex,ids,time}.ts`
- `src/main/stores/{json-store,settings-store,job-store,history-store}.ts`
- `src/main/ipc/{register,handle,sender,app,settings,jobs}.ts`
- `src/main/index.ts` 확장, `src/main/window.ts` 확장
- `src/preload/api.ts`, `src/preload/index.ts` 확장
- `src/shared/schemas/*` 보완
- `tests/unit/{json-store,settings-store,job-store}.test.ts`
- `src/renderer/src/stores/{toast,settings,jobs}.ts` (최소 스토어)

**작업**

1. 원자적 JSON 쓰기(tmp→fsync→bak→rename retry), async mutex, 손상 복구(`.bak`/`.corrupt-*`).
2. Settings: 기본값 merge, `SettingsPatch` 검증, 저장 실패 시 기존 값 유지.
3. Job: CRUD, rev 증가, autoSync 관리 필드 보호, 입력 검증, 중복/삭제.
4. History store: `running` 선기록, 종료 갱신, limit prune, `interrupted` 전환 API.
5. IPC envelope, zod 검증, sender 검증, 표준 에러 매핑. Preload는 명시적 API만 노출.
6. userData 경로: `app.getPath('userData')` 호출 **전에** `app.setName('rcloneGUI')`을 실행하고,
   `RCLONEGUI_USER_DATA` 오버라이드(E2E용), app info를 구성한다.
7. 로거: app.log, 회전, 민감정보 미기록.

**검증 명령**

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run dev
```

**합격 기준**

- store 테스트: 동시 update 직렬화, main JSON 손상 시 `.bak` 복구, 둘 다 손상 시 기본값+알림.
- job CRUD 후 재시작 유지. rev 증가. 잘못된 patch는 `VALIDATION`.
- IPC 응답이 항상 envelope. 알 수 없는 sender/채널 거부.
- `%APPDATA%\rcloneGUI`에 settings/jobs/history가 생성됨(개발/E2E는 임시 경로).

**롤백**: stores/IPC 파일 제거, `src/main/index.ts`를 Phase 0 창으로 환원. 테스트 userData 삭제.

---

### Phase 3 — rclone 환경, WSL, 경로 검증

**목표**: 실제 rclone을 감지하고 config/remotes/경로 접근을 확인하며, WSL 경로 도우미와 온보딩을 제공한다.

**파일**

- `src/main/rclone/{detect,config,process}.ts`
- `src/main/services/{path-service,wsl}.ts`
- `src/main/ipc/{rclone,wsl,dialog,system}.ts`
- `src/preload/api.ts` 확장
- `src/renderer/src/features/onboarding/*`
- `src/renderer/src/features/settings/RcloneSetup.tsx`
- `src/renderer/src/stores/system.ts` (감지 상태)
- `tests/unit/{wsl,path-service}.test.ts`
- `tests/integration/rclone-detect.test.ts`

**작업**

1. 감지 우선순위(수동→PATH→WinGet/일반 경로), 버전 파싱/최소 버전, stderr 표준화.
2. `rclone config file` 파싱, config override, `listremotes`.
3. `spawn` 공통 래퍼: timeout, line reader, 종료 코드, kill tree, Windows `windowsHide`.
4. 경로 probe: 로컬/UNC fs.stat, remote 부모 listing으로 폴더 확인.
5. WSL `-l -q` UTF-16LE 디코드, Linux→UNC 변환, `/mnt/<drive>` 대안, distro 목록.
6. 온보딩 배너/설정 화면에서 감지/수동 경로/config/테스트/remotes 표시.
7. 실제 rclone 통합 테스트(버전, config, remotes, 임시 폴더 lsjson/probe). remote는 사용자 데이터 없이 local만.

**검증 명령**

```powershell
npm.cmd run test
npm.cmd run test:integration
npm.cmd run typecheck
npm.cmd run dev
```

**수동 확인**

- rclone 자동 감지 → `v1.75.1`, config 경로, `gdrive-test:` 목록.
- WSL Ubuntu 선택 → `/home/...` → UNC 변환.
- 로컬/UNC/remote 경로 테스트 성공/실패 메시지.

**합격 기준**

- rclone 미설치 시 온보딩이 뜨고 수동 지정 후 정상 감지.
- WSL UTF-16LE가 깨지지 않고 distro 목록이 정확.
- UNC 경로 probe 성공, remote 폴더/파일/없는 경로 구분.
- integration 테스트가 rclone 없으면 명시적으로 skip, 있으면 통과.

**롤백**: 감지/WSL UI 제거, Phase 2 상태로. 설정 파일은 수동 삭제 가능.

---

### Phase 4 — Job CRUD UI와 경로 입력

**목표**: 사용자가 실제 job을 만들고 저장/재시작할 수 있는 화면을 완성한다. 비교/실행은 아직 비활성.

**파일**

- `src/renderer/src/App.tsx`, `components/{Sidebar,JobList,JobHeader,Tabs,Modal,Toast,EmptyState}.tsx`
- `src/renderer/src/features/jobs/{JobEditor,PathField,RemotePicker,WslPathHelper,ExcludesEditor,AutoSyncEditor}.tsx`
- `src/renderer/src/stores/{jobs,ui,settings}.ts`
- `src/renderer/src/features/settings/SettingsView.tsx` (rclone/defaults/안전 UI 뼈대)
- `src/shared/schemas/job.ts` 보완
- `tests/unit/job-form.test.ts` (스키마/검증 매핑)

**작업**

1. App 레이아웃: TopBar + Job Sidebar + Job Header + Tabs.
2. Job 목록: 선택, 새 작업, 복제, 삭제(확인), 마지막 실행/자동 배지.
3. Job 편집: 필수/고급/위험 옵션, excludes, config override, 자동 옵션, 메모.
4. 경로 필드: 종류 배지, 폴더 선택(로컬/UNC), remote 목록, 직접 입력, 테스트, WSL 도우미.
5. 저장 전 zod 검증, 필드별 오류, dirty 상태에서 비교/실행 비활성.
6. 설정 기본값이 새 job에 복사되도록 연결.
7. 재시작 후 선택/목록/설정 유지 확인.

**검증 명령**

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run dev
```

**수동 시나리오**

- 새 job 생성(WSL UNC→E:), 저장, 앱 재시작 → 유지.
- 잘못된 경로(상대/`/home/...`/루트/중첩) 저장 차단.
- WSL 도우미로 UNC 적용, remote 선택 후 `remote:path` 입력.
- 자동 ON/OFF, interval 변경, allowDeletes 경고 확인.

**합격 기준**

- CRUD/중복/삭제/재시작 유지.
- 경로 안전 규칙(S1~S4a)이 저장 단계에서 동작.
- 폼 검증 메시지가 사용자 친화적이고, 고급 위험 옵션에 경고 표시.
- 비교/실행 버튼은 "준비 중" 또는 비활성(Phase 5/6 전).

**롤백**: UI 파일 제거, Phase 3 온보딩만 유지. 저장된 jobs는 userData에서 삭제 가능.

---

### Phase 5 — 비교 서비스와 비교 UI

**목표**: read-only 비교의 정확성을 확보하고, GoodSync식 좌우 테이블/요약/필터/가상화를 완성한다.

**파일**

- `src/main/rclone/lsjson.ts`
- `src/main/services/compare-service.ts`
- `src/main/ipc/compare.ts`
- `src/shared/types/compare.ts` 보완
- `src/renderer/src/features/compare/{CompareView,SummaryCards,CompareToolbar,CompareTable,StatusBadge}.tsx`
- `src/renderer/src/stores/compare.ts`
- `tests/unit/{lsjson,compare-service}.test.ts`
- `tests/integration/compare.local.test.ts`, `compare.unc.test.ts` (조건부)

**작업**

1. lsjson args/exit code 처리: exit != 0이면 stdout 파싱 금지, exit 3 → `PATH_NOT_FOUND`.
2. source/dest 병렬 실행, 취소, phase 이벤트, 30분 타임아웃, stderr tail.
3. listing 파싱(Path/Size/ModTime/Hashes), `--no-mimetype`, `--hash` 조건, NFC/대소문자 키.
4. diff 엔진 연결, summary/plan token, lastCompare 캐시, job rev/설정 변경 무효화.
5. 비교 UI: 요약 카드, 상태 필터, 검색, 동일 숨기기, 정렬, 가상화, stale/충돌 배너.
6. copy/sync 모드별 onlyDest 라벨 차이.
7. 실제 임시 트리에서 CLI 결과와 카운트 비교.

**검증 명령**

```powershell
npm.cmd run test
npm.cmd run test:integration
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run dev
```

**수동 시나리오**

- 임시 원본/대상에 신규/변경/동일/대상만 파일을 만들고 비교 → 각 상태/요약 확인.
- WSL UNC 원본 비교.
- 없는 경로, 파일 경로, 권한 오류 메시지 확인.
- 1만~5만 행(생성 가능한 범위)에서 스크롤/필터 확인.

**합격 기준**

- 실측 트리에서 diff/카운트/바이트가 기대와 일치.
- exit 3에서 잘못된 결과를 만들지 않음.
- 취소 후 compare 캐시가 남지 않고 `CANCELED`.
- job 수정/설정 변경 후 plan token이 무효화되고 Run이 `PLAN_REQUIRED`.
- 테이블 5만 행 목표에서 체감 지연 없음(가상화).

**롤백**: compare IPC/UI 제거, job UI는 유지. lastCompare는 메모리 only.

---

### Phase 6 — 실행 코어: dry-run, copy, 로그/stats, 취소

**목표**: 실행 파이프라인을 완성하되 **sync 실제 실행은 비활성**한다. copy(비파괴)와 dry-run으로
프로세스/로그/취소/이력/락을 검증한다.

**파일**

- `src/main/rclone/process.ts` 확장(스트리밍)
- `src/main/services/{run-service,run-recovery}.ts`
- `src/main/ipc/run.ts`
- `src/main/services/history-service.ts`
- `src/shared/types/run.ts`, `src/shared/rclone/log-parser.ts` 보완
- `src/renderer/src/features/run/{RunPanel,StatsGrid,LogTail,DryRunSummary}.tsx`
- `src/renderer/src/stores/run.ts`
- `tests/unit/{run-state-machine,cancel,log-batching}.test.ts` (fake process)
- `tests/integration/run.copy.test.ts`, `run.dryrun.test.ts`

**작업**

1. args builder로 dry-run/copy 실행, JSON log/stats 라인 파싱, 로그 파일 기록.
2. 전역 activity 락, `BUSY`, run snapshot, 이벤트 배칭(stats 1/s, log 200ms/100줄).
3. 계획 필수(수동 실제 실행), dry-run은 계획 불필요.
4. copy 실행 + 완료 이력 + job.lastRun + compare 무효화.
5. 취소: taskkill `/T /F`, 5초 대기, canceled 우선, 부분 반영 고지.
6. `active-run.json` 기록/삭제, 시작 시 고아 복구(기본 구현), running→interrupted.
7. 실행 UI: 단계/진행률/stats/로그 tail/취소. sync 실제 버튼은 숨김 또는 비활성(Phase 7).
8. dry-run 결과 카드(복사/삭제 예정/샘플).

**검증 명령**

```powershell
npm.cmd run test
npm.cmd run test:integration
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run dev
```

**수동 시나리오**

- 임시 원본→대상 copy: dry-run 카운트 → 실제 copy → 파일 확인 → 이력.
- copy 중 취소(가능한 큰 트리) → 프로세스 종료/이력 canceled.
- 앱을 강제 종료한 뒤 재시작 → active-run 복구/이력 interrupted 확인(테스트 트리).
- 실행 중 다른 job 비교/실행 시도 → BUSY.

**합격 기준**

- dry-run skip 이벤트와 stats가 계획과 일치(수동 copy의 경우).
- copy 실행 후 파일/이력/로그 정상.
- 취소 시 `taskkill`로 종료, 이벤트/이력 canceled, orphan 없음.
- 실행 중 UI 재접속(`run:getActive`)으로 상태/로그 tail 확인.
- sync 실제 실행 경로가 UI/IPC에서 차단됨.

**롤백**: run IPC/UI 제거, compare 상태로. active-run 잔여 파일 삭제.

---

### Phase 7 — 파괴적 실행과 안전 게이트

**목표**: sync 실제 실행을 활성화하되, MVP_SPEC §9의 게이트를 모두 통과한 경우에만 실행한다.
안전 게이트가 Tier 3의 핵심이므로 코드 리뷰/테스트를 별도로 수행한다.

**파일**

- `src/main/services/safety.ts` (또는 `run-service` 내 gate 모듈)
- `src/main/ipc/run.ts` 확장(`confirmDeletes/confirmLargeDeletes/confirmIgnoreErrors`)
- `src/renderer/src/features/run/{DeleteConfirmDialog,PlanDriftDialog,SafetyBanner}.tsx`
- `src/renderer/src/features/compare/` 배너 보완
- `src/shared/types/run.ts` 보완
- `tests/unit/{safety-gates,plan-drift}.test.ts`
- `tests/integration/run.sync.test.ts`, `run.gates.test.ts`
- `src/main/services/run-recovery.ts` 보완

**작업**

1. 안전 매트릭스 S1~S20 구현. 비협상 차단과 확인 필수 조건을 분리.
2. 수동 sync: 계획 필수/신선도/토큰, 삭제 확인, 대량 경고, ignoreErrors 추가 확인.
3. preflight dry-run: transfers/deletes/bytes 일치, 불일치 시 `PLAN_DRIFT`, 실제 실행 금지.
4. 실제 sync: `--max-delete plan.deleteFiles` (0 포함), exit 7 처리.
5. 빈 원본/형식 충돌/caseOnly/중첩/루트/동일 경로 차단.
6. 삭제 확인 모달 샘플/체크박스/버튼 라벨, main 재검증.
7. sync 실제 UI 활성화. copy/sync 모두 계획/락/이력 경로 통일.
8. 고아 복구 보완: PID/이미지명 확인, 실패 시 사용자 안내.

**검증 명령**

```powershell
npm.cmd run test
npm.cmd run test:integration
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run dev
```

**통합 테스트(임시 폴더만)**

- 원본에 신규 파일, 대상에 여분 파일 → sync dry-run/실제 삭제 → 확인.
- `--max-delete 0`/계획 수 초과 → exit 7/차단.
- 비교 후 대상에 파일 추가 → preflight drift 감지, 실제 실행 안 됨.
- 원본 비우기 → sync 차단.
- 파일 vs 디렉터리 충돌 트리 → typeConflict, 실행 차단.
- 중첩/루트/동일 경로 → 저장/실행 차단.
- `ignoreErrors` sync → 수동 추가 확인 없이는 차단.

**합격 기준**

- 확인 없이 삭제가 발생하는 IPC/UI 경로 0건.
- preflight 불일치 시 파일 변경 0건.
- sync 성공/부분/취소/차단 이력이 정확.
- max-delete 초과 시 실패 상태와 안내.
- 안전 게이트 단위 테스트가 매트릭스 전 항목 커버.

**롤백**: sync 실제 실행만 다시 비활성화(Phase 6 상태). copy/dry-run은 유지.

---

### Phase 8 — 스케줄러, 이력/로그 UI, 트레이/테마/로그인

**목표**: 앱 실행 중 자동 동기화와 운영 기능을 완성한다.

**파일**

- `src/main/services/scheduler.ts`
- `src/main/ipc/{scheduler,history}.ts` 확장
- `src/main/tray.ts`
- `src/main/index.ts` (login/tray/quit), `window.ts` (hidden)
- `src/renderer/src/features/history/{HistoryView,HistoryDetail,LogViewer}.tsx`
- `src/renderer/src/features/settings/{SafetySettings,AppearanceSettings,LogSettings}.tsx`
- `src/renderer/src/stores/{history,scheduler}.ts`
- `tests/unit/scheduler.test.ts` (fake clock)
- `tests/integration/history-log.test.ts` (필요 시)

**작업**

1. 20초 tick, nextRunAt 영속화, 시작/재시작/절전, busy 재시도, 일시정지.
2. 자동 실행: compare→gates→noop/run, 중복 방지, nextRunAt 예약/완료 갱신.
3. 자동 성공/차단/실패 알림(창 숨김 시 Notification), 앱 로그.
4. 이력 UI: 목록/필터/상세/stats/로그 tail/폴더 열기/비우기.
5. 설정 완성: 안전 임계값, 로그 보존/이력 수, 테마, 트레이, 로그인 시작.
6. 트레이 Show/Open logs/Pause/Quit, close-to-tray, 종료 확인.
7. 로그인 자동 시작: `--hidden` args, Electron 44에서 제거된 `openAsHidden` 미사용.
8. 로그/이력 보존 정리, jobs:changed 이벤트.
9. 앱 종료 시 취소/대기/고아 방지 최종 점검.

**검증 명령**

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run dev
```

**수동 시나리오**

- 자동 interval 1분, allowDeletes=false + 대상 여분 파일 → 차단 알림/로그.
- allowDeletes=true + 소량 삭제 → 자동 실행/이력.
- 앱 재시작 → nextRunAt 유지, 중복 실행 없음.
- 일시정지/해제, 다음 실행 시각 표시.
- 이력 상세/로그 tail/폴더 열기.
- 테마 light/dark/system, 트레이 hide/show, 로그인 시작(개발에서는 skip 확인).

**합격 기준**

- fake clock 테스트: due/overdue/busy/paused/disable/interval 변경/noop.
- 자동 실행이 게이트를 우회하지 않음.
- 재시작 후 nextRunAt/lastRun 유지, 중복 실행 0건.
- 트레이/종료/알림/테마/로그인 시작이 요구대로 동작.
- 이력/로그 보존 정책 적용.

**롤백**: scheduler/tray/로그인 UI 비활성화, Phase 7 수동 실행 상태로. nextRunAt 필드는 유지 가능.

---

### Phase 9 — 패키징, E2E, 문서, 실제 환경 수용

**목표**: 설치 가능한 Windows 앱으로 마무리하고, 실제 사용 환경(임시 폴더/테스트 remote)에서 수용한다.

**파일**

- `electron-builder.yml` 최종화, `build/icon.ico`, `resources/tray.png`
- `README.md`, `AGENTS.md`
- `tests/e2e/{smoke.spec.ts,compare-copy.spec.ts}`
- `playwright.config.ts` 최종화
- 필요 시 `docs/specs` 보완(구현 중 결정 기록)
- (선택) `/z_skill_code_asset_indexer` 실행 → `docs/code-asset-index/COMPONENTS.md`

**작업**

1. `build:win` NSIS x64, per-user, asar, extraResources, 아이콘.
2. README: 설치/개발/테스트/WSL/Drive/안전/데이터 경로/문제 해결/제한.
3. AGENTS.md: 아키텍처 불변식/명령/안전 규칙/코드 스타일.
4. Playwright Electron smoke + 임시 폴더 compare/copy(E2E 전용 userData, `--hidden`/tray 비활성).
5. 실제 환경 수용 테스트(아래 §7).
6. 설치본으로 실행/재시작/트레이/로그인 시작/제거 시 데이터 보존 확인.
7. 최종 typecheck/lint/format:check/unit/integration/e2e/build:win 전체 실행.

**검증 명령**

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test
npm.cmd run test:integration
npm.cmd run test:e2e
npm.cmd run build:win
```

**합격 기준**

- 모든 명령 exit 0. `format:check` 포함.
- ESLint/Prettier 설정/의존성 잔재 0건.
- `release/rcloneGUI-Setup-0.1.0.exe` 설치/실행/제거(데이터 보존) 확인.
- E2E smoke 통과, 콘솔 에러 0.
- 실제 환경 수용 체크리스트(§7) 통과.
- README/AGENTS가 실제 명령과 일치.

**롤백**: 패키징 산출물/release 삭제, Phase 8 앱으로 복귀. 설치본 제거.

---

## 4. 테스트 전략과 명령

### 4.1 테스트 계층

| 계층 | 도구 | 범위 | 실행 시점 |
| :--- | :--- | :--- | :--- |
| Unit | Vitest | shared core, stores, gates, scheduler, parser | Phase 1~8, 매 단계 |
| Integration | Vitest + 실제 rclone | detect, lsjson, diff, dry-run, copy, sync, gates (임시 폴더) | Phase 3~7 |
| E2E | Playwright Electron | 앱 실행, job CRUD, compare, copy, 이력 | Phase 9 |
| Manual acceptance | Windows 실제 환경 | WSL UNC, 테스트 remote, tray/login, installer | Phase 9 |
| Static | tsc, oxlint | 전체 | 매 단계 |
| Format | oxfmt --check | 전체 | 매 단계(또는 커밋 전) |

### 4.2 단계별 필수 테스트

| Phase | 최소 테스트 |
| :--- | :--- |
| 0 | typecheck/lint/format:check/build/dev |
| 1 | shared unit 전부 + shared boundary |
| 2 | store 원자성/손상 복구, IPC envelope, CRUD |
| 3 | detect/config/remotes, WSL decode, path probe |
| 4 | job schema/검증, 수동 CRUD/재시작 |
| 5 | lsjson exit 3, diff/summary, plan token/stale, compare cancel, UI 가상화 |
| 6 | fake process 상태 머신/취소, dry-run/copy integration, 이력/lock |
| 7 | safety matrix, preflight drift, sync/max-delete integration, orphan recovery |
| 8 | scheduler fake clock, auto gates, nextRunAt, tray/login manual |
| 9 | E2E smoke, installer, 실제 환경 수용 |

### 4.3 Windows 실행 명령(권장 순서)

```powershell
cd D:\dev-Joy\rcloneGUI
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run build:win
```

- `npm.cmd ci`는 lockfile이 있을 때만. 최초에는 `npm.cmd install`. oxlint/oxfmt의 optional native binding이
  lockfile에 포함되는지 확인한다.
- `format:check`는 파일을 수정하지 않는다. 실패 시 `npm.cmd run format` 후 diff를 리뷰한다.
- 통합 테스트는 rclone 미설치 시 skip되며, "0 failed"와 skip 사유를 확인한다.
- E2E는 Windows GUI 세션이 필요하다. 잠금 화면/원격 세션 연결 끊김 상태에서는 실패할 수 있다.
- `build:win`은 WSL/Linux에서 실행하지 않는다.
- 테스트 실패 시 로그: Vitest 출력, `tests` 임시 폴더, `%APPDATA%\rcloneGUI\logs`(E2E는 임시 userData).

### 4.4 합격 기준(공통)

- typecheck/lint/format:check/test/integration 모두 exit 0, 실패 0.
- 통합 테스트는 실제 rclone 1.75.1에서 통과. 버전이 다르면 skip/사유 명시.
- 변경된 shared 코어의 단위 테스트가 추가되어 있음(회귀 방지).
- UI 변경은 수동 시나리오 체크리스트를 통과.
- Tier 3이므로 Phase 9에서 전체 스위트를 다시 실행.

---

## 5. 의존 관계와 병렬화

### 5.1 핵심 의존성

```text
타입/zod(Phase 1) ─┬─ stores/IPC(Phase 2) ─┬─ rclone env(Phase 3) ─┬─ jobs UI(Phase 4) ─┐
                   │                       │                      │                     ├─ compare(Phase 5) ─ run(Phase 6) ─ safety(Phase 7) ─ scheduler(Phase 8) ─ packaging(Phase 9)
                   └─ args/parser/diff ────┴──────────────────────┴─────────────────────┘
```

- args/diff/parser는 Phase 1에서 끝내 Phase 6에서 재작업하지 않는다.
- safety gate는 Phase 7에서 처음부터 다시 만들지 않고, Phase 6의 기본 검증을 확장한다.
- scheduler는 run service의 공개 메서드만 사용하고 별도 spawn 경로를 만들지 않는다.

### 5.2 병렬화 가능 항목(선택)

- Phase 3(rclone/WSL)과 Phase 4(job UI 골격)는 타입/IPC 계약이 고정된 후 병렬 가능.
- Phase 8의 이력 UI와 scheduler는 병렬 가능하나, 자동 실행 이벤트 계약을 먼저 확정해야 한다.
- 병렬 구현 시에도 안전 게이트/실행 경로는 단일 소유자가 관리한다.

---

## 6. 리스크 체크포인트와 Go/No-Go

| 시점 | 체크포인트 | 실패 시 |
| :--- | :--- | :--- |
| Phase 0 종료 | Electron 45 + electron-vite 6 + Vite 8 + TS 5.9.3 + CJS sandbox preload + oxlint/oxfmt | 버전/모듈 형식 재결정, 필요 시 사용자 승인 |
| Phase 1 종료 | diff/args/parser가 실측 fixture와 일치 | `MVP_SPEC` §7.3 재검토 후 코드 수정 |
| Phase 3 종료 | 실제 rclone/config/WSL UNC 감지 | 경로/감지 설계 보완 |
| Phase 5 종료 | 비교 카운트가 CLI/수동 기대와 일치 | diff/hash/tolerance 규칙 재검토 |
| Phase 6 종료 | dry-run/copy/취소/이력/락 | runner/취소/로그 설계 보완 |
| Phase 7 종료 | **안전 게이트 감사** (삭제 경로 0건) | sync 실제 실행 비활성 유지, 재설계 |
| Phase 8 종료 | 자동 실행 게이트/중복/재시작 | scheduler 재설계 |
| Phase 9 착수 전 | 실제 데이터 미사용 확인 | 테스트 경로 재확인 |
| Phase 9 종료 | installer/E2E/실제 수용 | 릴리스 보류 |

- Phase 7 종료 시 `code-tester`가 안전 매트릭스 전 항목을 체크리스트로 검증한다.
- 설계 결함으로 판단되면 `code-implementer`가 아닌 `code-planner`로 회귀해 MVP_SPEC을 갱신한다.
- 실제 사용자 데이터를 대상으로 한 파괴적 테스트는 금지한다. 필요 시 사용자 명시 승인 + 백업 후 별도 수행.

---

## 7. 실제 환경 수용 테스트 (임시 경로/테스트 remote만)

### 7.1 사전 준비

- Windows에서 rclone 1.75.1, config/remotes 확인.
- WSL 임시 폴더 생성: `/home/dev-joy/tmp-rclonegui-acceptance/src`.
- Windows 임시 폴더: `D:\tmp-rclonegui\acceptance\...`.
- 테스트 remote: 감지된 테스트 remote(예: `gdrive-test:rcloneGUIAcceptance`). 실제 업무 remote 사용 금지.
- 앱 데이터: 개발/E2E는 임시 userData, 수동 수용은 `%APPDATA%\rcloneGUI`(필요 시 백업/삭제).

### 7.2 시나리오 A — WSL UNC → Windows (copy)

1. WSL 임시 원본에 파일 3개/하위 폴더 생성.
2. Windows 대상 임시 폴더 준비.
3. Job 생성: `\\wsl.localhost\Ubuntu\home\dev-joy\tmp-rclonegui-acceptance\src` → `D:\tmp-rclonegui\acceptance\wsl-dst`, copy.
4. 경로 테스트 → 비교 → 요약 확인.
5. Dry-run → 복사 예정 수/바이트 확인.
6. 복사 실행 → 대상 파일/이력/stats 확인.
7. `rclone check` 또는 파일 비교로 내용 확인.

**합격**: 카운트 일치, 파일 내용 일치, 이력 success, 로그에 오류 0.

### 7.3 시나리오 B — Windows → 테스트 remote (sync, 삭제 포함)

1. `D:\tmp-rclonegui\acceptance\drive-src`에 파일 생성, 대상 remote 테스트 폴더에 여분 파일 2개 생성.
2. Job 생성: sync, checkHashes 옵션 ON/OFF 각각 확인(가능하면).
3. 비교 → 삭제 예정 2건 확인.
4. 실행 → 삭제 확인 모달(체크 없이는 버튼 비활성) → 실행.
5. 이력/stats/로그 확인. 여분 파일이 삭제되었는지 확인.
6. 원본 비우기/형식 충돌/중첩 경로를 각각 시도해 차단 확인.

**합격**: 확인 없이 삭제 0건, 삭제 후 이력 success, 차단 케이스가 명확한 메시지와 함께 실행되지 않음.

### 7.4 시나리오 C — 자동/운영

1. 자동 interval 1분, allowDeletes=false, 대상 여분 파일 존재 → 차단 알림/이력.
2. allowDeletes=true로 변경 → 자동 실행/이력/다음 실행 시각.
3. 앱 재시작 → nextRunAt 유지, 중복 실행 없음.
4. 실행 중 취소 → 프로세스 종료/이력 canceled.
5. 트레이 hide/show, 종료 확인, 테마, 로그인 자동 시작(설치본).
6. 로그 보존/이력 비우기.

### 7.5 시나리오 D — 패키징

1. `build:win` → 설치본 설치(per-user).
2. 시작 메뉴/바탕화면 아이콘, 알림, 트레이.
3. job/설정/이력 재시작 유지.
4. 제거 후 userData 보존 확인(문서화된 정책).
5. SmartScreen 경고 문구/README 안내 확인.

---

## 8. 릴리스 체크리스트 (Definition of Done)

- [ ] `docs/specs/MVP_SPEC.md`와 실제 구현이 일치하거나, 변경 사항이 문서에 반영됨.
- [ ] `npm.cmd run typecheck` / `lint` / `format:check` / `test` / `test:integration` / `test:e2e` 통과.
- [ ] `oxlint@1.90.0`/`oxfmt@0.75.0` 정확한 버전 고정, ESLint/Prettier 잔재 0건.
- [ ] `npm.cmd run build:win` 성공, NSIS 설치본 실행 확인.
- [ ] 실제 환경 수용 A~D 통과(임시 폴더/테스트 remote).
- [ ] 안전 게이트 S1~S20 감사 완료, 확인 없는 삭제 경로 0건.
- [ ] 취소/앱 종료/고아 프로세스 복구 확인.
- [ ] JSON 저장소 손상 복구/백업 확인.
- [ ] rclone 미설치/무버전/config 없음/remote 오류 온보딩 확인.
- [ ] Windows 로그인 시작 + `--hidden` + 트레이 동작.
- [ ] README/AGENTS 최신, 데이터 경로/제한/문제 해결 포함.
- [ ] Renderer 콘솔 에러 0, CSP/샌드박스 유지(`sandbox:false`로 낮추지 않음).
- [ ] 실제 사용자 데이터(`E:\My Projects`, 실제 Drive)에 자동 테스트가 접근하지 않았음을 확인.
- [ ] (선택) code-asset-index 갱신.

---

## 9. 구현 순서 요약 (한눈에)

1. **Phase 0**: 빈 앱 + 최신 스택/CJS preload 호환성 + oxlint/oxfmt 기준선.
2. **Phase 1**: 타입/zod/diff/args/parser/path 순수 코어 + 테스트.
3. **Phase 2**: 원자적 JSON store + IPC envelope + preload API.
4. **Phase 3**: rclone 감지/config/remotes + WSL + path probe.
5. **Phase 4**: Job CRUD/경로 입력 UI.
6. **Phase 5**: lsjson 비교 엔진 + 가상화 비교 UI + plan token.
7. **Phase 6**: dry-run/copy 실행, stats/log, 취소, 락, 이력.
8. **Phase 7**: sync 실제 실행 + 안전 게이트/preflight/max-delete/삭제 모달.
9. **Phase 8**: 자동 스케줄러 + 이력/로그 UI + 트레이/테마/로그인.
10. **Phase 9**: NSIS 패키징 + E2E + README/AGENTS + 실제 환경 수용.

각 단계 종료 시 "빌드 가능 + 이전 기능 유지 + 테스트 통과"를 확인하고 다음 단계로 넘어간다.
