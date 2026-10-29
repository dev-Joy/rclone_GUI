# rcloneGUI

rclone을 감싼 Windows용 폴더 비교·동기화 데스크톱 앱입니다. 왼쪽(원본)과 오른쪽(대상)의 파일을
비교해 **복사**하거나, 대상에만 있는 파일까지 정리하는 **동기화(삭제 포함)** 를 실행할 수 있습니다.
로컬 폴더, WSL의 `\\wsl.localhost\...` UNC 경로, rclone remote(Google Drive, FTP, SFTP 등)를
같은 화면에서 다룹니다.

- Electron 45 + electron-vite 6 + React 19 + TypeScript 5.9
- rclone CLI 최소 1.65.0 (개발·검증 환경: 1.75.1)
- Windows 11 x64, 사용자 단위 NSIS 설치본

> 이 앱은 rclone을 대신 실행하는 화면입니다. rclone 설정 파일(`rclone.conf`)의 인증·토큰은
> rclone이 관리하며, 앱은 설정 파일 **경로만** `--config`로 넘깁니다(파일 내용을 읽지 않음).

---

## 1. 설치

### 1.1 rclone 준비

1. rclone을 설치합니다.

   ```powershell
   winget install Rclone.Rclone
   ```

2. 새 PowerShell에서 버전을 확인합니다.

   ```powershell
   rclone version
   ```

   1.65.0 이상이어야 합니다. 앱은 수동 지정 → `PATH` → WinGet/일반 설치 경로 순으로 rclone을 찾습니다.

3. cloud remote를 쓸 때만 rclone 설정을 만듭니다.

   ```powershell
   rclone config
   ```

   remote 이름은 예를 들어 `gdrive:`처럼 정합니다. 앱의 경로 입력란에는 `gdrive:백업/폴더`처럼
   **remote 이름과 폴더**를 함께 씁니다(remote 루트 전체는 저장할 수 없음).

### 1.2 앱 설치

`dist\rcloneGUI-Setup-0.1.0.exe`를 실행합니다.

- 사용자 단위 설치(관리자 권한 불필요), 설치 폴더 변경 가능
- 바탕 화면·시작 메뉴 바로가기 생성
- 코드 서명이 없어 **Windows SmartScreen 경고**가 뜰 수 있습니다. 배포처(이 저장소)를 확인한 뒤
  “추가 정보 → 실행”을 선택하세요.
- 제거해도 `%APPDATA%\rcloneGUI`의 작업·설정·이력·로그는 지우지 않습니다.

---

## 2. 첫 실행

1. 앱을 열면 상단에 rclone 상태(`rclone 사용 가능 v1.75.1` 등)가 표시됩니다.
2. rclone을 못 찾거나 버전이 낮으면 배너에서 `rclone.exe 직접 지정` 또는 `rclone 다시 찾기`를 씁니다.
3. rclone.conf가 없으면 로컬·UNC 경로만 쓸 수 있다는 안내가 뜹니다. remote를 쓰려면
   `rclone.conf 파일 고르기`로 지정하거나 설정 화면에서 경로를 바꿉니다.
4. 왼쪽 `새 작업`을 눌러 이름·모드·원본·대상·제외 규칙·옵션을 정하고 `저장`합니다.
5. 상단 `비교`로 차이를 확인합니다. 파일은 아직 바뀌지 않습니다.
6. 필요하면 `미리보기`(dry-run)로 rclone이 할 일을 확인한 뒤 `복사 실행` 또는 `동기화 실행`을
   누릅니다. 동기화에 삭제가 있으면 삭제 확인 창에서 체크해야 실행됩니다.

### 자주 쓰는 경로

| 종류 | 예 | 비고 |
| :--- | :--- | :--- |
| 로컬 | `D:\Data\백업` | `폴더 선택`으로 고를 수 있음 |
| WSL UNC | `\\wsl.localhost\Ubuntu\home\<사용자>\work` | WSL 도우미가 `/home/...`을 변환 |
| WSL `/mnt` | `\\wsl.localhost\Ubuntu\mnt\d\Data` | `D:\Data`와 같은 폴더 |
| rclone remote | `gdrive:백업/폴더` | `rclone.conf`와 remote 이름 필요 |

WSL 도우미를 쓰려면 WSL이 설치되어 있어야 합니다. 배포판 목록은 `wsl.exe -l -q`로 읽고,
`/mnt/<드라이브>` 경로는 Windows 드라이브 경로로도 안내합니다. WSL이 중지되어 있으면 UNC 접근이
실패할 수 있으니 배포판을 한 번 실행한 뒤 다시 시도하세요.

---

## 3. 복사와 동기화

| 모드 | 하는 일 | 대상에만 있는 파일 |
| :--- | :--- | :--- |
| **복사(copy)** | 원본에 있는 파일을 대상에 복사·갱신 | 지우지 않음 |
| **동기화(sync)** | 대상을 원본과 같게 만듦 | **삭제** |

두 모드 모두 원본은 바꾸지 않습니다. 실행 전에 반드시 비교하고, 동기화는 삭제 확인 절차를 거칩니다.

### 안전 동작

- **실제 실행 전 비교 결과 필수**: 수동 실행은 같은 작업의 유효한 비교 결과(계획 토큰)와 확인한
  삭제 수가 있어야 시작합니다. 비교 후 10분이 지나거나 작업을 고치면 다시 비교해야 합니다.
- **삭제 확인**: 동기화에 삭제가 있으면 삭제 파일 수·크기·비율·샘플을 보여 주고, 체크해야 버튼이
  켜집니다. 대량 삭제(기본 50개 또는 대상의 10% 초과)는 한 번 더 확인합니다.
- **사전 확인(dry-run)**: 실제 동기화 직전에 같은 실행 안에서 다시 비교합니다. 대상이 바뀌었으면
  아무것도 바꾸지 않고 `PLAN_DRIFT`로 막고 차이를 보여 줍니다.
- **삭제 한도**: 실제 동기화는 항상 `--max-delete <계획한 삭제 수>`로 실행합니다. rclone이 계획보다
  많이 지우려 하면 실패(exit 7)로 끝납니다.
- **차단되는 경우**: 원본이 비었거나, 파일·폴더 형식이 충돌하거나, 대소문자만 다른 경로가 겹치거나,
  원본·대상이 같거나 중첩된 경로, 동기화 + `--ignore-errors`는 실행하지 않습니다.
- **취소·실패**: 이미 복사·삭제된 파일은 되돌리지 않습니다. 전송 중 취소·실패로 rclone 임시 파일
  (`이름.8자리16진수.partial`)이 대상에 남을 수 있으며, 비교 목록·이력에서 안내합니다.
- **자동 실행**: 작업별로 주기 실행을 켤 수 있습니다. 삭제가 필요하면 `자동 실행 때 삭제 허용`,
  `자동 실행 최대 삭제 수`(기본 50, 0이면 금지), 대량 삭제 아님, 사전 확인 켜짐을 모두 만족할 때만
  실행합니다. 하나라도 어기면 아무것도 바꾸지 않고 알림·이력(`blocked`)을 남깁니다.

> **주의**: sync는 파괴적입니다. 처음에는 임시 폴더나 테스트 remote로 확인한 뒤 실제 폴더에 쓰세요.
> 실제 업무 데이터를 대상으로 한 자동 테스트는 이 저장소에서 실행하지 않습니다.

---

## 4. 데이터·로그·백업

| 항목 | 경로 |
| :--- | :--- |
| 작업·설정·이력 | `%APPDATA%\rcloneGUI\` (`jobs.json`, `settings.json`, `history.json` 등) |
| 실행 로그 | `%APPDATA%\rcloneGUI\logs\run-*.log` |
| 앱 로그 | `%APPDATA%\rcloneGUI\logs\app.log` |
| 진행 중 실행 표시 | `%APPDATA%\rcloneGUI\active-run.json` (정상 종료 시 삭제) |

- 저장 파일은 임시 파일 → `fsync` → 백업(`.bak`) → 이름 바꾸기 순서로 씁니다. JSON이 손상되면
  `.bak`으로 복구하고, 둘 다 손상되면 기본값으로 시작하며 시작 알림에 남깁니다.
- 로그에는 **파일 경로·파일명**이 포함될 수 있습니다. 공유 전에 내용을 확인하세요. 앱은 rclone.conf
  내용과 자격 증명을 로그에 남기지 않도록 경로를 가립니다.
- 실행 로그는 기본 30일, 이력은 500건까지 보관하며 시작할 때와 하루에 한 번 정리합니다.
  설정 화면에서 이력을 비울 수 있습니다(로그 파일 삭제는 선택).
- 창을 닫으면 기본적으로 트레이로 숨겨 자동 실행을 계속합니다. 완전히 끝내려면 트레이 메뉴의
  `종료`를 쓰세요. 실행 중에 끝내면 취소 후 최대 10초 기다리고, 끝나지 않으면 다시 확인합니다.
- 비정상 종료로 남은 rclone은 다음 시작 때 이미지 이름과 PID를 확인해 정리합니다. 확인하지 못하면
  PID를 안내합니다.

### 데이터 초기화

앱을 끝낸 뒤 `%APPDATA%\rcloneGUI`를 다른 곳에 복사(백업)하고 폴더를 지우면 처음 상태로 돌아갑니다.
작업만 지우려면 앱의 작업 삭제를 쓰세요. 원본·대상 폴더의 파일은 앱이 건드리지 않습니다.

---

## 5. 개발

### 5.1 요구 사항

- Windows 11 x64
- Node 24 (개발 환경: 24.20.0)
- pnpm (`pnpm-lock.yaml` 사용, npm·yarn·bun으로 설치하지 않음)
- rclone 1.65.0 이상(통합·E2E 비교 테스트에 필요, 없으면 건너뜀)
- PowerShell에서 실행. WSL에는 Node가 없으므로 빌드·테스트는 Windows에서 합니다.

```powershell
cd D:\dev-Joy\rcloneGUI
pnpm install
```

`postinstall`이 Electron 실행 파일을 내려받습니다.

### 5.2 명령

| 명령 | 하는 일 |
| :--- | :--- |
| `pnpm run dev` | 개발 실행(HMR) |
| `pnpm run build` | `out/`에 운영 빌드 |
| `pnpm start` | 빌드본 미리보기 |
| `pnpm run check` | typecheck + lint(oxlint, ESLint 2규칙) + 단위 테스트 |
| `pnpm run test` | 단위 테스트(Vitest) |
| `pnpm run test:int` | 실제 rclone 통합 테스트(임시 폴더, rclone 없으면 skip) |
| `pnpm run test:e2e` | 빌드 + Playwright Electron E2E(Windows GUI 세션 필요) |
| `pnpm run format` / `format:check` | oxfmt로 포맷 / 검사만 |
| `pnpm run build:win` | NSIS x64 설치 파일을 `dist/`에 만든다 |
| `pnpm run dist` | `build:win`과 같음(호환용 이름) |
| `pnpm run smoke:installer` | 설치본을 임시 폴더에 설치·실행·제거하고 데이터 보존을 확인 |
| `node scripts/probes/rclone-probes.mjs` | rclone 동작 실측(임시 폴더만, fixture 갱신) |
| `node scripts/dev/make-icon.mjs` | `build/icon.ico` 재생성(도형만 그림) |

`pnpm run check`에는 포맷 검사가 포함되지 않습니다. 커밋 전에 `pnpm run format:check`도 실행하세요.
oxlint는 correctness=error, suspicious=warn과 React 19·Hooks·a11y·Vitest 규칙을 쓰고, ESLint는
oxlint에 없는 두 규칙(`shell: true` 금지, `typ`/`itf`/`cls` 접두사)만 검사합니다.
oxlint type-aware 검사는 TypeScript 7+와 `oxlint-tsgolint`가 필요해 MVP에서는 쓰지 않습니다.

### 5.3 E2E

```powershell
pnpm run test:e2e
```

- `tests/e2e/smoke.spec.ts`: 창·preload API, 새 작업 저장, 재시작 후 유지
- `tests/e2e/compare-copy.spec.ts`: 임시 폴더 비교 → 복사 확인 창 → 대상 파일 → 이력
- `RCLONEGUI_USER_DATA`를 임시 폴더로, `RCLONEGUI_E2E=1`로 트레이 없이 실행하며,
  `RCLONE_CONFIG`도 빈 임시 파일로 두어 실제 remote 설정을 읽지 않습니다.
- 콘솔 오류 0건을 확인합니다. rclone이 없으면 비교·복사 테스트만 skip됩니다.
- 잠금 화면·원격 세션 연결 끊김 상태에서는 Electron 창 테스트가 실패할 수 있습니다.

### 5.4 설치 파일과 설치 스모크

```powershell
pnpm run dist
pnpm run smoke:installer
# 로그인 시 시작 항목까지 확인하려면(사용자 HKCU Run 값을 잠시 씀)
pnpm run smoke:installer -- --login-item
```

`smoke:installer`는 다음을 확인합니다.

- `dist\rcloneGUI-Setup-0.1.0.exe`를 임시 폴더에 사용자 단위 무인 설치
- 설치 폴더·제거 프로그램·바로가기·Uninstall 키
- `app.asar`에 `out/`, `package.json`, 운영 의존성(`zod`)만 포함(소스·테스트·문서 제외)
- 언어 팩 `ko`·`en-US`, 트레이 아이콘 포함
- 임시 userData로 실행, 설치본 `drive-app` 스모크 통과
- 무인 제거 후 설치 폴더·바로가기·Uninstall 키·로그인 항목 없음, userData 보존
- 실제 `%APPDATA%\rcloneGUI`는 존재 여부·수정 시각만 전후 비교

이미 설치된 rcloneGUI가 있거나 실행 중이면 사용자 환경을 건드리지 않도록 중단합니다.

### 5.5 구조

```text
src/main          rclone 실행·감지, 파서, 저장소, 서비스, IPC, 트레이
src/preload       contextBridge API (window.rclonegui)
src/renderer      화면 진입점
src/components    공용 컴포넌트 ZBC*와 테마
src/pages         페이지·레이아웃
src/stores        화면 상태(zustand)
src/lib           화면용 순수 도우미
src/shared        타입·zod 스키마·IPC 계약·diff/args/parser (Node·DOM 비의존)
tests/unit        Vitest 단위
tests/integration 실제 rclone(임시 폴더)
tests/e2e         Playwright Electron
scripts/probes    rclone 동작 실측
scripts/dev       빌드본·설치본 확인 도구
```

`@/`는 어느 프로세스에서나 `src`를 가리킵니다. main·preload·shared·renderer 경계와 안전 규칙은
[`AGENTS.md`](AGENTS.md)를 따릅니다.

---

## 6. 문제 해결

| 증상 | 확인 |
| :--- | :--- |
| `rclone을 찾지 못해…` | `rclone version`이 되는지, PATH에 있는지 확인. 배너에서 `rclone.exe 직접 지정` |
| `CONFIG_NOT_FOUND` | 설정 화면의 rclone.conf 경로가 실제 파일인지 확인. remote를 안 쓰면 비워도 됨 |
| remote 목록이 비어 있음 | `rclone listremotes --config <파일>`로 확인. 한 글자 remote(`x:`)는 Windows 드라이브로 해석되어 선택 불가 |
| WSL UNC 접근 실패 | WSL 배포판 실행 여부, `\\wsl.localhost\<배포판>\...` 이름, `/mnt/<드라이브>` 표기 확인 |
| 비교가 오래 걸림 | 30분 제한이 있음. 해시 비교를 끄거나 제외 규칙·`fast-list`를 조정. 취소 가능 |
| `PLAN_REQUIRED` / `PLAN_DRIFT` | 비교를 다시 실행. 대상이 바뀌었으면 차이를 확인한 뒤 재비교 |
| 삭제가 차단됨 | 원본 비었는지, 형식 충돌, 대소문자 충돌, `--ignore-errors` 여부 확인 |
| SmartScreen 경고 | 코드 서명이 없음. 저장소에서 받은 파일인지 확인 후 “추가 정보 → 실행” |
| 앱이 트레이에서 안 보임 | 알림 영역의 ↑(숨겨진 아이콘) 확인. 설정에서 `창을 닫으면 트레이로 숨기기`를 끌 수 있음 |
| 실행이 안 끝남 | 실행 탭에서 취소. 앱을 다시 시작하면 `active-run.json`을 확인해 남은 rclone을 정리 |
| 로그가 너무 큼 | 설정의 로그 보관 일수·이력 보관 수를 줄이고, 이력 비우기(로그 삭제 선택) |

문제를 보고할 때는 앱 버전(`설정 → 앱 정보`), rclone `version` 출력, 재현 순서, `logs\app.log`의
관련 부분을 함께 적어 주세요. 경로·파일명이 포함될 수 있으니 공유 전에 가리세요.

---

## 7. 알려진 제한

- Windows x64만 지원합니다(macOS/Linux 패키징 없음).
- 코드 서명이 없습니다. 자동 업데이트·telemetry·계정 로그인은 없습니다.
- 선택한 파일만 복사, 파일 감시(watcher), `rclone bisync`, 예약 실행 중 PC 절전 복구 세부 정책은
  MVP 범위 밖입니다.
- 비교는 `rclone lsjson` 메타데이터 기반이며, 해시 비교는 작업 옵션으로 켤 때만 합니다.
  Google Drive처럼 수정시간이 정확하지 않은 remote는 허용오차(기본 2초)를 씁니다.
- 빈 폴더 차이는 비교 표에 표시하지 않습니다.
- 로그 tail은 화면에 최근 줄만 보여 주고, 전체 내용은 로그 파일에 있습니다.
- 제거 프로그램은 사용자 데이터를 지우지 않습니다. 완전 삭제는 위 4장을 참고하세요.

---

## 8. 고지

- rclone은 별도 오픈소스 프로젝트입니다. 이 앱은 rclone 실행 파일을 포함하지 않습니다.
- 사용한 오픈소스 라이브러리와 라이선스는 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에
  정리되어 있습니다. 설치본에는 `resources\THIRD_PARTY_NOTICES.md`로 함께 들어갑니다.
