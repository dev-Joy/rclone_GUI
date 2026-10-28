# rcloneGUI MVP 설계 명세 (MVP_SPEC)

- 프로젝트: `/mnt/d/dev-Joy/rcloneGUI` (Windows `D:\dev-Joy\rcloneGUI`)
- 연결 Intent: `docs/intent/active/INT-001-rclone-sync-gui/intent.md`
- 작성일: 2026-10-27
- 최종 수정일: 2026-10-28 (린트/포맷 도구를 oxlint·oxfmt로 확정)
- 상태: **설계 확정안 — Phase 0~2 구현 완료 (2026-10-28), 아래 "구현 반영" 참고**
- 대상 환경: Windows 11 x64, Node 24.20.0, npm 9.2.0, rclone 1.75.1
- 관련 문서: `docs/specs/IMPLEMENTATION_PLAN.md`

> 이 문서는 구현 계획과 검증의 단일 기준(Single Source of Truth)이다. 구현 단계에서 설계 변경이 필요하면
> 이 문서를 먼저 갱신한 뒤 코드를 수정한다. `docs/intent/` 구조와 내용은 변경하지 않는다.

### 구현 반영 (2026-10-28, Phase 0~2)

`AGENTS.md`(프로젝트 규칙)와 이 문서가 다른 항목은 `AGENTS.md`를 따른다(사용자 결정). 아래 외에는 이 문서 그대로다.

| 항목 | 이 문서 | 실제 구현 |
| :--- | :--- | :--- |
| 패키지 매니저 | npm 9 (`npm.cmd`) | **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`의 `allowBuilds`) |
| 포맷 | 2칸, printWidth 80 | **4칸, 큰따옴표, printWidth 100** (`.oxfmtrc.json`) |
| 린트 | oxlint만, ESLint 없음 | oxlint + **ESLint 2규칙만**(`shell: true` 금지, `typ`/`itf`/`cls` 접두사, `eslint.config.mjs`) |
| 타입 이름 | `Job`, `Settings` … | `typJob`, `itfAppInfo`, `clsAppError` … (zod 스키마에서 타입 추론) |
| 화면 폴더 | `src/renderer/src/*` | `src/renderer`(진입점), `src/components`(ZBC*), `src/pages`, `src/stores`, `src/lib` |
| main 폴더 | `stores/`, `shared/rclone/args.ts`, `shared/rclone/log-parser.ts` | `store/`, `main/rclone/command-builder.ts`, `main/parsers/{lsjson,log}-parser.ts` |
| IPC 정의 | `shared/types/ipc.ts` | `src/shared/ipc-contract.ts` 한 곳(채널은 구현된 것만) |
| 설정 파일 | `vitest.config.ts` | `vitest.config.mts`, `vitest.integration.config.mts` (Vite ESM 로딩 경고 제거) |
| 위험 옵션 차단 | 금지 목록(§8.1)만 | `command-builder.ts` 차단 목록: `--delete-excluded`, `--no-check-dest`, `--max-delete` 음수, `--dump*`, **`--backup-dir` 없는 sync `--ignore-errors`**. 실제 sync는 `maxDelete` 없이 인자를 만들 수 없음 |
| 운영 CSP | 응답 헤더 | 운영은 빌드 시 `index.html` meta, 개발은 main의 응답 헤더(HMR 예외) |
| 확인 도구 | - | `scripts/probes/rclone-probes.mjs`(fixture 수집), `scripts/dev/drive-app.mjs`(빌드본/개발 서버를 임시 userData로 띄워 CDP로 확인) |

**Phase 7 전에 반영할 실측**: 내용이 같고 수정시간만 다른 파일은 diff에서 `modified(mtime)`이지만 rclone은
복사하지 않고 시간만 갱신한다(dry-run `skipped: update modification time`). §8.4의
`transfers == createFiles + updateFiles` 비교식은 이 경우 PLAN_DRIFT 오탐이 난다. 자세한 내용은
`docs/knowhow/rclone-notes.md`.

---

## 0. 핵심 결정 요약

| 항목 | 결정 | 근거 |
| :--- | :--- | :--- |
| 앱 이름/패키징 | **rcloneGUI**, Electron + electron-vite, Windows x64 NSIS | 요구사항 및 실제 사용 환경 |
| 프로세스 경계 | Renderer는 UI만, 모든 파일/프로세스 작업은 Main | contextIsolation + sandbox + 검증된 IPC |
| 비교 방식 | 양측 `rclone lsjson` 병렬 실행 후 순수 diff 엔진 | 메타데이터 기반 비교, 원본 무변경 |
| 비교 키 | Windows 기본 **대소문자 무시**(NFC 정규화), 충돌 시 차단 | Windows/Drive의 실제 동작과 안전 |
| 수정시간 기본 허용오차 | **2000ms**, 실행 시 `--modify-window 2000ms` 동일 적용 | UI 계획과 rclone 실제 동작 일치 |
| 해시 비교 | 작업별 선택(기본 OFF), 공통 해시 우선, 없으면 크기-only fallback | `--checksum` 동작과 일치 |
| 실행 | `copy`/`sync`만, `--config` 명시, `--use-json-log -v --stats 1s` | 관측된 JSON 로그/통계 형식 |
| 삭제 안전 | 계획 토큰 + 신선도 + 삭제 확인 모달 + `--max-delete <계획 수>` | 파괴적 sync 차단 |
| 자동 동기화 | Main 상주 interval 스케줄러, **비교 → 게이트 → 실행** | 삭제 게이트와 stale 방지 |
| 동시성 | 비교/실행/자동 동기화를 포함한 **전역 단일 활동 락** | rclone 중복 실행 및 자원 경합 방지 |
| 영속화 | userData의 버전ed JSON + 원자적 쓰기 + `.bak` | DB 없는 로컬 앱, 손상 복구 |
| 린트/포맷 | **oxlint 1.90.0 + oxfmt 0.75.0** (ESLint/Prettier 대체) | Rust 기반 고속 도구, Prettier 호환 워크플로, 신규 프로젝트라 마이그레이션 비용 없음 |
| 선택 항목만 복사 | **Post-MVP로 제외** | MVP 안정성 우선, filter-list 실행 계층 추가 필요 |
| 검증 등급 | **Tier 3 (Major)** | 신규 아키텍처 + 삭제 기능 + 스케줄러 + 패키징 |

---

## 1. Tier 산정

### 1.1 결과: **Tier 3 (주요/구조적 변경)**

| 판단 축 | 내용 |
| :--- | :--- |
| 코드베이스 파급 | 기존 소스가 없는 신규 저장소이므로 기존 코드에 대한 직접 파급은 0 |
| 신규 구조 | Main/Preload/Renderer 3계층, IPC 계약, JSON 저장소, 스케줄러, 트레이, 패키징을 모두 신규 설계 |
| 위험도 | `sync`가 대상 파일을 삭제하는 **파괴적 동작**을 포함하며, WSL UNC·클라우드 remote·자동 실행까지 결합 |
| 검증 요구 | 단위 + 실제 rclone 통합 + Electron E2E + Windows 설치본 + 실제 환경 수용 테스트 필요 |
| 모호성 원칙 | Tier 2/3 사이에서 모호하면 상위 Tier 적용 |

**결론**: 기존 코드 영향이 없더라도 아키텍처 규모와 파괴적 파일 연산 때문에 Tier 3으로 산정한다.
Tier 1 Fast-path 대상이 아니며, `code-planner → code-implementer → code-tester` 전체 파이프라인과
최종 빌드/설치 검증을 적용한다.

### 1.2 Tier 3 완료 조건

- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run format:check`, `npm.cmd run test` (unit) 모두 통과
- Windows에서 `npm.cmd run test:integration` (실제 rclone, 임시 폴더만) 통과
- `npm.cmd run build` 및 `npm.cmd run build:win` 성공, NSIS 설치본 실행 확인
- Electron smoke E2E 통과, 렌더러 콘솔 에러 0건
- 실제 환경 수용 테스트(`IMPLEMENTATION_PLAN.md` §7) 체크리스트 통과

---

## 2. MVP 범위 확정

### 2.1 MVP 포함 (In Scope)

| # | 기능 | MVP 구현 내용 | 수용 기준 |
| :--- | :--- | :--- | :--- |
| 1 | rclone/설정 감지 | PATH → WinGet/일반 경로 탐색, `rclone version`, `rclone config file`, `listremotes`; 수동 경로/테스트 | 감지 실패 시 온보딩 안내, 수동 지정 후 정상 감지 |
| 2 | 작업 CRUD/영속화 | 이름, 원본/대상, copy/sync, excludes, checkers/transfers, fastList, skipLinks, ignoreErrors, hash, tolerance, config override, 자동동기화, 메모 | 재시작 후 작업/설정 유지, 손상 시 `.bak` 복구 |
| 3 | 경로 입력 | 로컬 폴더 선택, UNC 직접 입력, WSL distro 목록/변환, remote 목록/직접 입력, 경로 테스트 | WSL `/home/...` → `\\wsl.localhost\...` 변환 정확 |
| 4 | 비교 | 양측 lsjson 병렬 → diff(onlySource/onlyDest/modified/equal/typeConflict), 요약/검색/필터/정렬, 가상화 테이블 | 실제 임시 트리에서 분류/카운트 일치 |
| 5 | 실행 | copy/sync args 빌더, dry-run, 실시간 stats/log, 진행률, 취소(taskkill tree), 전역 중복 방지 | dry-run 카운트와 계획 일치, 취소 시 프로세스 종료 |
| 6 | 안전장치 | 삭제 확인 모달, 대량 삭제 경고, 빈 원본 차단, source==dest/루트/중첩 차단, stale 감지, 자동 실행 삭제 게이트 | 모든 파괴 경로가 게이트를 통과해야만 실행 |
| 7 | 자동 동기화 | 앱 실행 중 interval 스케줄러, 다음 실행 시각, 작업별 on/off, 일시정지 | 1분 간격 테스트에서 중복 실행 없이 동작 |
| 8 | 이력/로그 | 실행 기록(상태/모드/시작/종료/stats/계획), 로그 파일, 보기/폴더 열기/정리 | 앱 재시작 후 이력 유지, 로그 tail 열람 |
| 9 | 설정 | rclone/conf, 기본 excludes/옵션, 안전 임계값, 트레이, 로그인 시작, 테마, 로그 보존 | 설정 저장/적용/재시작 유지 |
| 10 | 패키징/문서 | electron-builder NSIS x64, dev/build/typecheck/lint/format:check/test 스크립트, README/AGENTS.md | 설치본으로 실행 및 실제 작업 생성 가능 |

### 2.2 Post-MVP (과감히 제외)

| 제외 항목 | 제외 이유 | 업그레이드 순서 |
| :--- | :--- | :--- |
| 선택 항목만 복사/삭제 | `--files-from-raw` 필터 수명주기, 부분 실행 이력, 안전 확인이 추가로 필요 | 1순위 (GoodSync 유사성) |
| 파일 감시(watcher) 자동 동기화 | 디바운스/대량 이벤트/잠금 파일 처리 복잡, interval로 MVP 충족 | 2순위 |
| `rclone bisync` 양방향 | 충돌 해결 정책과 데이터 손실 위험이 큼, 단방향 copy/sync 안정화 후 | 3순위 |
| `--backup-dir`, `--track-renames` | 삭제/복원 정책과 UI가 복잡 | 3순위 |
| cron/캘린더 스케줄, 다중 작업 병렬 실행 | MVP는 균등 interval + 전역 1개 실행 | 3순위 |
| 사전/사후 스크립트, 웹훅/메일 알림 | 로컬 단일 사용자 요구 밖 | 4순위 |
| 앱 자동 업데이트 | 서명/배포 채널 미정 | 4순위 |
| macOS/Linux 패키징 | Windows 우선 요구, Electron 코드는 플랫폼 분기 최소화 | 4순위 |
| 다국어(i18n) | 한국어 단일 사용자 | 5순위 |
| 원격 OAuth 관리 UI | rclone config에 위임, 토큰 취급 위험 회피 | 5순위 |
| 대용량(>20만) 스트리밍 비교 | MVP는 5만 파일 목표, JSON 배열 파싱 | 필요 시 |
| 심볼릭 링크 비교/동기화 | 기본 `--skip-links`, Windows 링크 권한 이슈 | 필요 시 |
| 빈 디렉터리 비교 | `--files-only` 사용, 파일 중심 비교 | 필요 시 |

### 2.3 비목표 (Non-goals)

- 서버, 계정 로그인, 클라우드 백엔드, 텔레메트리
- Google Drive 가상드라이브 직접 마운트/제어
- rclone 설정 파일 편집/OAuth 토큰 저장
- 암호화된 rclone config의 비밀번호 프롬프트 UI(발생 시 rclone 오류 안내)
- 파일 내용 뷰어/바이너리 비교/3-way merge
- 다중 사용자/다중 창/원격 제어
- 임의의 raw rclone 플래그/args 입력(구조화된 옵션만 허용, 셸/옵션 주입 방지)

### 2.4 MVP 성공 기준

**기능**
- 실제 WSL UNC 원본 → `E:\...` 대상 job을 만들고 비교/복사/이력 확인이 가능하다.
- `E:\...` → Drive remote job에서 dry-run/실제 sync/삭제 확인이 동작한다.
- 앱 재시작 후 job/settings/history가 유지되고 자동 동기화 nextRunAt이 복원된다.

**안전**
- 확인 없이 삭제가 발생하는 경로가 0건이다.
- 빈 원본, 루트, 동일/중첩 경로, 형식 충돌, stale 계획은 실행이 차단된다.
- 자동 실행은 `allowDeletes=false`일 때 삭제 대상이 있으면 실행되지 않는다.
- 취소 시 rclone 프로세스 트리가 종료되고 이력이 `canceled`로 남는다.

**성능(목표)**
- 로컬/UNC 2만 파일 비교 60초 이내(네트워크/Drive 제외), diff 계산 1초 이내
- 5만 행 테이블에서 필터/스크롤 체감 지연 없음(가상화), 메모리 600MB 이하
- 앱 콜드 스타트 3초 이내(창 표시 기준)

**신뢰성/배포**
- JSON 저장소 손상 시 `.bak` 복구 또는 사용자 알림 후 기본값 로드, 무한 크래시 없음
- NSIS 설치본이 관리자 권한 없이 설치/실행된다.
- 자동 테스트는 실제 사용자 데이터(`E:\My Projects`, 실제 Drive)에 접근하지 않는다.

### 2.5 가정

- 앱 이름은 **rcloneGUI**으로 확정한다(변경 시 `productName`/`appId`만 조정).
- remote 이름은 하드코딩하지 않는다. 실제 환경의 `GDRIVE-storiez11:`은 예시이며, 감지된 목록을 사용한다.
- Windows x64만 지원한다. WSL은 Windows에서 UNC로 접근한다.
- rclone은 단일 config 파일을 사용하며, job별 override는 같은 파일 형식이다.
- 한 번에 하나의 비교 또는 실행만 허용한다(전역 락).
- 창은 단일 인스턴스/단일 창이다.

---

## 3. 사용자 워크플로

### 3.1 Workflow A: WSL 작업 폴더 → E 드라이브 (copy)

1. 앱 시작 → rclone 감지(버전/config/remotes) 확인.
2. 새 작업 생성: 이름, 원본 `\\wsl.localhost\Ubuntu\home\dev-joy\work`, 대상 `E:\My Projects\work`, 모드 `copy`, 기본 excludes 적용.
3. 경로 테스트로 양측 폴더 접근 확인.
4. **비교** → 원본만/대상만/변경/동일/충돌 요약과 좌우 테이블 확인.
5. **Dry-run 미리보기**로 rclone이 실제로 복사할 항목 수/바이트 확인.
6. **복사 실행** → 실시간 stats/로그 확인. 완료 후 이력/로그 확인.
7. 대상에만 있는 파일은 copy 모드에서 삭제되지 않음을 UI에 명시.

### 3.2 Workflow B: E 드라이브 → Google Drive (sync, 삭제 포함)

1. Drive remote job 생성: 원본 `E:\My Projects`, 대상 `GDRIVE-storiez11:My Projects`, 모드 `sync`.
2. 필요 시 해시 검증 ON, 수정시간 허용오차 2초, excludes 확인.
3. **비교** → 삭제 예정(대상만) 목록과 충돌 확인.
4. **실행** 클릭 → 삭제 건수/바이트/샘플 + 대량 삭제 경고 모달 → 체크 후 실행.
5. 사전 preflight(dry-run)로 계획 드리프트가 없으면 실제 sync 시작.
6. 진행률/삭제 카운트/에러 확인. 완료 후 이력에서 최종 stats 확인.

### 3.3 Workflow C: 자동 동기화

1. Job의 자동 동기화 ON, interval 60분, allowDeletes는 필요 시에만 ON.
2. 앱을 트레이로 최소화(또는 로그인 자동 시작).
3. 스케줄러가 due 시 **내부 비교 → 안전 게이트 → 실행**.
4. 삭제 대상이 있는데 allowDeletes가 꺼져 있으면 실행 차단 + 알림/로그.
5. 다음 실행 시각은 작업 목록/헤더에 표시되고 재시작 후에도 유지.

### 3.4 테스트/수용 원칙

- 자동화 테스트와 수동 수용 테스트는 **임시 폴더와 테스트 remote**만 사용한다.
- 실제 `E:\My Projects`와 실제 Drive를 대상으로 한 파괴적 실행은 사용자가 명시적으로 요청할 때만 수행한다.
- 수용 테스트용 예시: `D:\tmp-rclonegui\acceptance\...`, `gdrive-test:rcloneGUIAcceptance`.

---

## 4. 아키텍처

### 4.1 프로세스 경계와 보안

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (React 19, Chromium sandbox, Node 없음)            │
│  - 화면/상태/Zustand/가상화 테이블                          │
│  - window.rclonegui API만 사용                               │
└───────────────▲─────────────────────────────────────────────┘
                │ contextBridge (typed API, 최소 노출)
┌───────────────┴─────────────────────────────────────────────┐
│ Preload (sandbox: true, CJS 단일 번들)                      │
│  - ipcRenderer.invoke 래퍼 + 이벤트 구독                    │
│  - fs/path/child_process 접근 없음                          │
└───────────────▲─────────────────────────────────────────────┘
                │ IPC (invoke / event)
┌───────────────┴─────────────────────────────────────────────┐
│ Main (Node 24, Electron 45)                                 │
│  IPC handler → zod 검증 → 서비스                            │
│  RcloneEnv / Compare / Run / Scheduler / History / Stores   │
│  Tray / Dialog / WSL / Logger                               │
└───────────────▲─────────────────────────────────────────────┘
                │ spawn(args 배열, shell 없음), windowsHide
┌───────────────┴─────────────────────────────────────────────┐
│ rclone.exe 1.75.1+                                          │
│  - lsjson(비교), copy/sync(실행), version/config/listremotes │
└─────────────────────────────────────────────────────────────┘
```

**보안 불변식**

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`.
- Preload는 `contextBridge`로 명시적 메서드만 노출한다. `invoke(channel, ...)` 같은 범용 통로 금지.
- Main은 모든 IPC 입력을 zod로 검증하고, 알려진 창의 `webContents`에서 온 요청만 처리한다.
- rclone은 항상 `spawn(binary, argsArray, { shell: false, windowsHide: true })`로 실행한다.
- Renderer에서 받은 문자열을 셸 명령으로 조합하지 않는다.
- rclone config 파일은 존재/경로만 확인하고 **내용을 읽거나 로그에 남기지 않는다**(OAuth 토큰 보호).
- 외부 탐색/새 창/권한 요청은 기본 차단한다. `shell.openExternal`은 명시적 https 링크만 허용.
- CSP는 Main에서 응답 헤더로 설정한다(운영 `script-src 'self'`, 개발 HMR 예외만 추가).

### 4.2 모듈 책임

| 모듈 | 위치 | 책임 |
| :--- | :--- | :--- |
| Main entry/window | `src/main/index.ts`, `window.ts` | 앱 수명주기, 단일 인스턴스, 창/트레이, CSP, 종료 처리 |
| IPC | `src/main/ipc/*` | 채널 등록, 입력 검증, 결과 envelope, 이벤트 브로드캐스트 |
| Settings/Job/History Store | `src/main/stores/*` | JSON 로드/원자적 저장/복구/스키마 버전 |
| Rclone environment | `src/main/rclone/detect.ts` | 바이너리/버전/config/remotes 감지 |
| Rclone process | `src/main/rclone/process.ts` | spawn, line reader, timeout, kill tree, orphan marker |
| Compare service | `src/main/services/compare-service.ts` | 병렬 lsjson, diff 실행, plan token, 캐시/취소 |
| Run service | `src/main/services/run-service.ts` | 계획 검증, preflight, args 실행, stats/log, 이력, 락 |
| Scheduler | `src/main/services/scheduler.ts` | due 계산, 자동 실행 오케스트레이션, nextRunAt |
| Path service | `src/main/services/path-service.ts` | 로컬/UNC/remote 검증, 루트/중첩 검사, probe |
| WSL service | `src/main/services/wsl.ts` | distro 목록(UTF-16LE), UNC 변환 |
| History/Log | `src/main/services/history-service.ts`, `logger.ts` | 이력/로그 tail/보존/앱 로그 |
| Shared pure core | `src/shared/*` | 타입/zod, diff, args builder, log parser, path pure utils, format |
| Renderer | `src/renderer/src/*` | 화면, 스토어, 가상화, 다이얼로그/토스트 |

**공통 자산 인덱스**: 현재 저장소에는 소스/공통 자산이 없다. 모든 컴포넌트/유틸을 신규로 만들되,
구현 완료 후 `/z_skill_code_asset_indexer`로 `docs/code-asset-index/COMPONENTS.md`를 생성해 중복 구현을 방지한다.

### 4.3 디렉터리 구조

```
rcloneGUI/
├─ docs/
│  ├─ intent/                         # 기존 유지 (수정 금지)
│  └─ specs/
│     ├─ MVP_SPEC.md                  # 이 문서
│     └─ IMPLEMENTATION_PLAN.md
├─ resources/
│  ├─ tray.png                        # 트레이 아이콘 (16/32)
│  └─ icon.png                        # 창/개발용
├─ build/
│  └─ icon.ico                        # NSIS/앱 아이콘 (없으면 기본 아이콘)
├─ src/
│  ├─ shared/
│  │  ├─ types/                       # common, job, settings, compare, run, ipc
│  │  ├─ schemas/                     # zod 스키마 (main+renderer 공용)
│  │  ├─ diff/engine.ts               # 순수 diff 엔진
│  │  ├─ rclone/args.ts               # copy/sync/lsjson args builder
│  │  ├─ rclone/log-parser.ts         # JSON log/stats 파서
│  │  ├─ paths/path-utils.ts          # Node API 없는 pure 경로 유틸
│  │  └─ format.ts                    # bytes/date/duration/percent
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ window.ts
│  │  ├─ ipc/                         # register, handle, settings, jobs, rclone,
│  │  │                               # wsl, dialog, compare, run, history, system
│  │  ├─ services/
│  │  │  ├─ compare-service.ts
│  │  │  ├─ run-service.ts
│  │  │  ├─ scheduler.ts
│  │  │  ├─ path-service.ts
│  │  │  ├─ wsl.ts
│  │  │  ├─ history-service.ts
│  │  │  └─ run-recovery.ts
│  │  ├─ rclone/
│  │  │  ├─ detect.ts
│  │  │  ├─ process.ts
│  │  │  └─ config.ts
│  │  ├─ stores/                      # settings-store, job-store, history-store, json-store
│  │  ├─ lib/                         # logger, app-error, result, ids, time, mutex
│  │  └─ tray.ts
│  ├─ preload/
│  │  ├─ index.ts
│  │  └─ api.ts
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx, App.tsx
│        ├─ features/{jobs,compare,run,history,settings,onboarding}/
│        ├─ components/               # 공통 UI
│        ├─ stores/
│        ├─ styles/
│        └─ hooks/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ e2e/
│  └─ fixtures/rclone-log/
├─ electron.vite.config.mts
├─ electron-builder.yml
├─ tsconfig.json / tsconfig.node.json / tsconfig.web.json
├─ .oxlintrc.json
├─ .oxfmtrc.json
├─ vitest.config.ts / vitest.integration.config.ts
├─ playwright.config.ts
├─ package.json
├─ README.md
└─ AGENTS.md
```

### 4.4 기술 스택과 버전 호환성

**검증된 조합(2026-10-28 기준 레지스트리/릴리스 확인)**

| 패키지 | 버전 | 비고 |
| :--- | :--- | :--- |
| Electron | `45.0.0` | Chromium 156, **내장 Node 24.22.0**, MVP는 Windows x64 대상 |
| electron-vite | `6.0.0` | Vite 8 지원, ESM 패키지이므로 설정 파일은 ESM 필요 |
| Vite | `8.3.5` | Node `^20.19 \|\| >=22.12` |
| @vitejs/plugin-react | `6.1.2` | Vite 8 필요 |
| React / React DOM | `19.3.1` | 타입 `@types/react` 19.3.x |
| TypeScript | **`5.9.3` 고정** | Vite 8/electron-vite 6/React 19 타입 조합의 채택값(Phase 0 재확인). oxlint는 TS 버전에 독립적이며, TS 7 type-aware는 MVP 미사용 |
| oxlint | `1.90.0` | Rust 기반 린터. React Hooks/TS/import/a11y/Vitest 플러그인 내장, Windows x64 binding 제공 |
| oxfmt | `0.75.0` | Rust 기반 포매터. Prettier 3.9.9 호환 워크플로, **0.x이므로 정확한 버전 고정** |
| zod | `4.6.7` | shared 스키마 |
| zustand | `5.0.16` | 렌더러 상태 |
| lucide-react | `1.62.0` | 아이콘 |
| @tanstack/react-virtual | `3.14.23` | diff 테이블 가상화 |
| Vitest | `5.0.5` | Vite 8 지원 |
| @playwright/test + playwright | `1.64.1` | Electron `_electron` |
| electron-builder | `26.18.0` | NSIS x64 |
| @types/node | `24.x` (예: 24.19.2) | Electron 45 내장 Node 24와 정렬 |

**린트/포맷 결정**

- ESLint 10 / typescript-eslint 8 / eslint-plugin-react-hooks 7 / Prettier 3.9는 **사용하지 않는다**.
- oxlint는 `.oxlintrc.json`, oxfmt는 `.oxfmtrc.json`을 사용한다. ESLint/Prettier 설정 파일은 만들지 않는다.
- oxlint type-aware/type-check는 TypeScript 7.0+와 `oxlint-tsgolint`가 필요하므로 MVP에서 사용하지 않는다.
  타입 검사는 기존대로 `tsc -p tsconfig.*.json --noEmit`이 담당한다.
- oxfmt는 Prettier 3.9.9 기준 호환이며 기본 `printWidth`가 100이다. Prettier 기본과 맞추기 위해
  `.oxfmtrc.json`에 `printWidth: 80`을 명시하고, `sortImports`/`sortPackageJson`은 MVP에서 끈다.
- oxlint는 `--deny-warnings`로 경고를 실패로 처리한다(ESLint `--max-warnings=0` 대응).
  core 규칙은 `no-console`/`no-unused-vars`처럼 접두사 없이, 플러그인 규칙만 `typescript/`/`react/`/`import/` 접두사를 쓴다.
- 공식 린트/포맷 명령은 Windows `npm.cmd` 기준이다. WSL 셸에서 npm을 직접 실행하지 않는다.
- `docs/**`(설계 문서)와 `tests/fixtures/**`(관측 로그/fixture)는 lint/format 대상에서 제외해 무손실 보존한다.

**모듈 형식 결정**

- `package.json`에 `"type": "module"`을 넣지 않는다. Main/Preload는 **CJS 단일 번들**.
- Electron 샌드박스 preload는 ESM import를 지원하지 않으므로 CJS가 필수다.
- electron-vite 6 설정은 ESM이어야 하므로 `electron.vite.config.mts`를 사용한다.
- 만약 설치/빌드 단계에서 electron-vite 6이 ESM package를 강제하면(`"type":"module"` 필요),
  preload만 `format: 'cjs'` + `.cjs` 출력으로 유지하고 sandbox를 유지하는 대안을 Phase 0에서 검증한다.
  `sandbox: false`로 낮추는 것은 최후 수단이며 사용자 승인이 필요하다.
- Renderer는 Vite가 ESM으로 번들링하며 Node API를 사용하지 않는다.

**npm 9.2.0 주의**

- Node 24 기본 npm(11.x)보다 오래된 npm 9.2.0이다. PowerShell에서는 `npm.ps1` 실행 정책 문제를 피하기 위해
  항상 `npm.cmd`를 사용한다.
- WSL 셸에서 npm을 직접 실행하지 않는다(현재 환경에서 node 미탐지). Windows `cmd.exe` 경유로 실행한다.
- 설치 오류가 반복되면 사용자 승인 후 `npm.cmd install -g npm@11`로 업그레이드한다(강제 아님).
- oxlint/oxfmt는 플랫폼별 optional native binding을 사용한다. Windows에서는 `npm.cmd install`로 설치하고
  `oxlint --version`/`oxfmt --version`으로 확인한다. WSL에서 설치한 Linux binding과 혼용하지 않는다.

---

## 5. 데이터 모델

### 5.1 공통 타입

```ts
export type IsoDateString = string; // UTC ISO-8601
export type RunMode = 'copy' | 'sync';
export type RunStatus =
  | 'running' | 'success' | 'partial' | 'failed'
  | 'canceled' | 'blocked' | 'noop' | 'interrupted';
export type RunTrigger = 'manual' | 'scheduler';
export type CompareStatus = 'onlySource' | 'onlyDest' | 'modified' | 'equal' | 'typeConflict';
export type ModifiedReason = 'size' | 'mtime' | 'hash' | 'type' | 'mtimeUnknown';
export type PathKind = 'local' | 'unc' | 'remote';
export type RunPhase = 'validating' | 'comparing' | 'preflight' | 'transferring' | 'finalizing';

export interface AppErrorPayload {
  code: ErrorCode;
  message: string;       // 사용자용 한국어
  detail?: string;       // 기술 상세 (로그/접기)
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppErrorPayload };
```

### 5.2 Job

```ts
export interface JobRunOptions {
  checkers: number;              // 1..64, 기본 8
  transfers: number;             // 1..32, 기본 4
  fastList: boolean;             // 기본 true
  skipLinks: boolean;            // 기본 true
  ignoreErrors: boolean;         // 기본 false (고급/위험)
  checkHashes: boolean;          // 기본 false
  modtimeToleranceMs: number;    // 0..600000, 기본 2000
  preflightBeforeDestructive: boolean; // 기본 true
}

export interface AutoSyncOptions {
  enabled: boolean;              // 기본 false
  intervalMinutes: number;       // 1..10080, 기본 60
  allowDeletes: boolean;         // 기본 false
  nextRunAt: IsoDateString | null;
  lastAutoRunAt: IsoDateString | null;
}

export interface Job {
  id: string;                    // crypto.randomUUID()
  name: string;                  // 1..80자
  notes: string;                 // 0..4000자
  source: string;                // 사용자 입력 원문
  destination: string;
  mode: RunMode;
  excludes: string[];            // 최대 100개, 각 512자
  options: JobRunOptions;
  configPathOverride: string | null;
  autoSync: AutoSyncOptions;
  rev: number;                   // 사용자 수정마다 +1 (plan token 검증)
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  lastRun: { runId: string | null; at: IsoDateString; status: RunStatus } | null;
}
```

`lastRun.runId`는 noop에서 `null`이다(noop은 이력 미기록). UI는 runId가 null이면 이력 링크를 비활성화한다.
`lastRun`, `autoSync.nextRunAt/lastAutoRunAt` 같은 스케줄러 bookkeeping 갱신은 `rev`를 올리지 않고
`updatedAt`도 바꾸지 않는다. `rev`/`updatedAt`은 사용자 편집/실행 설정 변경에만 갱신하며,
수동 비교 plan token을 불필요하게 무효화하지 않는다.

### 5.3 Settings

```ts
export type ThemeMode = 'system' | 'light' | 'dark';

export interface JobDefaults {
  excludes: string[];
  checkers: number;
  transfers: number;
  fastList: boolean;
  skipLinks: boolean;
  ignoreErrors: boolean;
  checkHashes: boolean;
  modtimeToleranceMs: number;
  preflightBeforeDestructive: boolean;
}

export interface Settings {
  version: 1;
  rclonePath: string | null;       // null = 자동
  configPath: string | null;       // null = 자동
  defaults: JobDefaults;
  compare: {
    caseInsensitivePaths: boolean; // 기본 true (Windows 우선)
  };
  safety: {
    deleteConfirmFiles: number;    // 기본 50
    deleteConfirmPercent: number;  // 기본 10
    autoMaxDeletes: number;        // 기본 50
    compareMaxAgeMinutes: number;  // 기본 10
  };
  scheduler: { paused: boolean };  // 기본 false
  logs: {
    retentionDays: number;         // 1..365, 기본 30
    historyLimit: number;          // 100..5000, 기본 500
  };
  ui: {
    theme: ThemeMode;              // 기본 system
    minimizeToTray: boolean;       // 기본 true
    launchAtLogin: boolean;        // 기본 false
  };
}
```

### 5.4 비교 결과

```ts
export interface DiffSide {
  path: string;            // 해당 side의 원문 relative path
  size: number;            // bytes (음수는 0으로 보정 + 경고)
  modTimeMs: number | null;
}

export interface DiffEntry {
  path: string;            // 표시/매칭 기준 path (source 우선)
  status: CompareStatus;
  reasons: ModifiedReason[];
  source: DiffSide | null;
  dest: DiffSide | null;
  caseOnly: boolean;       // 양쪽 path가 대소문자만 다름
  hashAlgo: string | null; // 실제 비교에 사용한 공통 해시 (값은 보관하지 않음)
  hashUnavailable: boolean;
}

export interface CompareSummary {
  sourceFiles: number;
  destFiles: number;
  createFiles: number;     // onlySource
  updateFiles: number;     // modified
  deleteFiles: number;     // onlyDest
  sameFiles: number;       // equal
  conflictFiles: number;   // typeConflict (파일 엔트리 수)
  conflictGroups: number;  // 충돌 루트 수
  createBytes: number;
  updateBytes: number;
  deleteBytes: number;
  transferBytes: number;   // createBytes + updateBytes
  caseOnlyFiles: number;
  hashComparedFiles: number;
  hashUnavailableFiles: number;
}

export interface CompareResult {
  jobId: string;
  jobRev: number;
  createdAt: IsoDateString;
  durationMs: number;
  summary: CompareSummary;
  entries: DiffEntry[];    // path asc 정렬
  warnings: string[];
  planToken: string;
}
```

### 5.5 실행/이력

```ts
export interface RunPlan {
  sourceFiles: number;
  destFiles: number;
  createFiles: number;
  updateFiles: number;
  deleteFiles: number;
  transferBytes: number;
  deleteBytes: number;
  conflictFiles: number;
  caseOnlyFiles: number;
}

export interface RunStats {
  bytes: number;
  totalBytes: number;
  transfers: number;
  totalTransfers: number;
  deletes: number;
  deletedDirs: number;
  checks: number;
  totalChecks: number;
  listed: number;
  errors: number;
  speedBps: number | null;
  etaSeconds: number | null;
  elapsedMs: number;
  fatalError: boolean;
  lastError: string | null;
}

export interface RunRecord {
  id: string;
  jobId: string;
  jobName: string;         // 이력 시점 스냅샷
  mode: RunMode;
  dryRun: boolean;
  trigger: RunTrigger;
  status: RunStatus;
  phase: RunPhase;
  startedAt: IsoDateString;
  finishedAt: IsoDateString | null;
  durationMs: number | null;
  plan: RunPlan | null;
  preflight: RunStats | null;
  stats: RunStats | null;
  exitCode: number | null;
  pid: number | null;
  error: AppErrorPayload | null;
  logFile: string | null;  // logs/ 기준 파일명만
}

export interface RunSnapshot {
  runId: string;
  jobId: string;
  jobName: string;
  mode: RunMode;
  dryRun: boolean;
  trigger: RunTrigger;
  status: RunStatus;
  phase: RunPhase;
  startedAt: IsoDateString;
  stats: RunStats | null;
  logFile: string | null;   // 재접속 시 history:readLog로 tail 조회
}
```

### 5.6 영속화

**userData 레이아웃**

```
%APPDATA%\rcloneGUI\
├─ settings.json (+ .bak)
├─ jobs.json (+ .bak)
├─ history.json (+ .bak)
├─ active-run.json (+ .bak)      # 비정상 종료 복구용
├─ logs/
│  ├─ app.log
│  └─ run-YYYYMMDD-HHmmss-<job8>-<run8>.log
└─ tmp/                           # 필요 시 임시 파일 (현재 MVP 미사용)
```

**원자적 쓰기**

```
writeJsonAtomic(file, value):
  tmp = `${file}.tmp-${pid}-${Date.now()}`
  data = JSON.stringify(value, null, 2)
  write(tmp, data) + fsync
  if exists(file): copyFile(file, `${file}.bak`)   // best-effort
  retry 3회: rename(tmp, file)                      // EPERM/EBUSY 시 50ms backoff
  실패 시 tmp 정리 후 STORE_ERROR
```

- 각 스토어는 async mutex로 mutation을 직렬화한다. scheduler와 IPC가 동시에 써도 lost update가 없어야 한다.
- 읽기: main 파싱 실패 → `.bak` 파싱 → 둘 다 실패 시 해당 파일을 `.corrupt-<timestamp>`로 이동하고
  기본값/빈 목록으로 시작 + 사용자 배너/토스트. 무한 크래시 금지.
- `version: 1` 고정. 향후 버전이 다르면 자동 삭제하지 않고 백업 후 `STORE_VERSION_UNSUPPORTED`로 안내.
- 모든 시간은 UTC ISO로 저장, 표시만 로컬 시간.
- ID는 Main에서 `crypto.randomUUID()`. Renderer는 ID를 생성하지 않는다.

**기본값**

| 항목 | 기본값 |
| :--- | :--- |
| excludes | `node_modules/**`, `_session/**`, `_gsdata_/**`, `.codegraph/daemon.sock` |
| checkers / transfers | 8 / 4 |
| fastList / skipLinks | true / true |
| ignoreErrors | false |
| checkHashes | false |
| modtimeToleranceMs | 2000 |
| preflightBeforeDestructive | true |
| autoSync | disabled, 60분, allowDeletes false |
| deleteConfirmFiles / Percent | 50 / 10% |
| autoMaxDeletes | 50 |
| compareMaxAgeMinutes | 10 |
| caseInsensitivePaths | true |
| historyLimit / retentionDays | 500 / 30 |
| theme / minimizeToTray / launchAtLogin | system / true / false |

**검증 범위**

- name 1..80, notes ≤4000, excludes ≤100(각 ≤512, NUL/CR/LF 금지)
- checkers 1..64, transfers 1..32, tolerance 0..600000, interval 1..10080
- 경로는 §6에서 분류/안전 검증. 빈 문자열/루트/중첩/동일 경로는 저장 단계에서 차단
  (단, 아직 존재하지 않는 원격 경로는 저장 가능해야 하므로 "형식/안전"만 저장 시 검증하고
  "접근 가능"은 테스트/비교/실행 시 검증한다).

---

## 6. 경로 모델

### 6.1 분류

| 형태 | 판별 | 예 | 처리 |
| :--- | :--- | :--- | :--- |
| 로컬 드라이브 | `^[A-Za-z]:[\\/]` | `E:\My Projects` | `local` |
| UNC | `^\\\\` 또는 정규화 후 `//` | `\\wsl.localhost\Ubuntu\home\dev-joy` | `unc` |
| rclone remote | 첫 `:` 앞이 드라이브 문자가 아님 | `GDRIVE-storiez11:My Projects` | `remote` |
| WSL Linux path | `/...` | `/home/dev-joy/work` | **거부** + WSL 도우미 안내 |
| 상대 경로 | 그 외 | `work\src` | **거부** |
| `\\?\` 확장 경로 | prefix | `\\?\C:\...` | **거부** (rclone 호환성 확인 전) |

- 분류는 shared의 pure 함수로 구현하고 Node `path`에 의존하지 않는다(Renderer에서도 배지/미리보기 사용).
- Main의 파일 시스템 접근/정규화는 `node:path.win32`를 추가로 사용할 수 있다.
- remote 이름은 하드코딩하지 않는다. `remote:`(빈 path)는 루트로 간주해 **차단**한다.

### 6.2 정규화

- 앞뒤 공백 제거, NUL/제어문자 거부.
- 로컬/UNC: `/` → `\`, 중복 구분자 축소, 후행 `\` 제거(루트 제외), `node:path.win32.normalize`로 `.`/`..` 정리.
- remote: 첫 `:` 기준으로 remoteName/path 분리, path의 `\` → `/`, 중복 `/` 축소, 선행/후행 `/` 정리.
  `.`/`..` 세그먼트는 백엔드별 해석 차이를 막기 위해 **거부**한다.
- 비교 키: path를 NFC 정규화하고, `caseInsensitivePaths=true`이면 소문자로 변환한다.
- **표시는 원문**, **비교/안전 검사는 정규화 키**를 사용한다.
- WSL 별칭 canonical key(S2/S3 전용): UNC host `wsl$` → `wsl.localhost`,
  `\\wsl.localhost\<distro>\mnt\<letter>\...` → `<letter>:\...`로 변환해 비교한다.
  이는 WSL automount가 `<letter>:`와 동일하다는 가정이며, 경고/문서화한다.
  서로 다른 경로(중첩 아님)는 허용하되 UI에 "WSL /mnt 별칭" 배지를 표시한다.

### 6.3 WSL 도우미

- `wsl.exe -l -q` 출력은 **UTF-16LE**(NUL + CRLF)이다. 실측 결과:
  `55 00 62 00 75 00 6e 00 74 00 75 00 0d 00 0a 00` → `Ubuntu`.
- Main에서 UTF-16LE 여부를 먼저 판별한다(BOM 또는 짝수 바이트의 상위 바이트가 0인 비율). UTF-16LE이면
  `Buffer.toString('utf16le')`, 아니면 `utf8`로 디코드 → `\u0000`/BOM/`\r` 제거 → trim → 빈 줄 제거.
- Linux 절대 경로 → `\\wsl.localhost\<distro>\<path-with-backslashes>` 변환.
- `/mnt/<drive>/...` 입력은 두 가지를 제안한다.
  - UNC: `\\wsl.localhost\<distro>\mnt\<drive>\...`
  - Windows native: `C:\...` (권장, 9p 오버헤드 회피)
- distro 이름에 공백/하이픈이 있어도 그대로 사용한다. `\\wsl$\` 대신 `\\wsl.localhost\`를 기본으로 한다.
- WSL이 중지/미설치면 `WSL_NOT_AVAILABLE`/`PATH_NOT_FOUND`로 안내하고 자동 시작은 하지 않는다.

### 6.4 경로 안전 규칙

| 규칙 | 검사 | 결과 |
| :--- | :--- | :--- |
| 빈 경로 | trim 후 empty | 차단 |
| 동일 경로 | 정규화 키 동등(대소문자 무시) | 차단 |
| 로컬/UNC 중첩 | 같은 볼륨/share에서 `relative()`가 내부를 가리킴 | 차단 (양방향) |
| remote 중첩 | 같은 remote에서 path segment prefix | 차단 (양방향) |
| 파일시스템 루트 | drive root, UNC share root, WSL distro root, `/` | 차단 |
| remote 루트 | `remote:` (path empty) | 차단 |
| 원본=대상 별칭 | `\\wsl$\` vs `\\wsl.localhost\`, `E:` vs WSL `/mnt/e` | canonical key로 동일/중첩 차단, 그 외 경고 |
| WSL /mnt canonical | `\\wsl.localhost\<distro>\mnt\<letter>` → `<letter>:\` | 동일/중첩 차단, 단독 사용은 경고 |
| 파일 경로 | 로컬 `fs.stat().isDirectory()`, remote 부모 listing의 `IsDir` | 폴더가 아니면 차단 |
| 긴 경로 | 240자 초과 | 경고 (차단 아님) |
| 케이스 충돌 | 한쪽 listing에 소문자 키 중복 | 비교 차단 (`CASE_COLLISION`) |
| 케이스만 다름 | 양쪽 path가 대소문자만 다름 | 비교는 가능, **실행 차단** |

**경로 접근 확인(probe)**

- 로컬/UNC: `fs.stat` + `isDirectory` + `fs.access(R_OK)`.
- remote: 대상 path의 부모를 `rclone lsjson --max-depth 1 -- <remote:parent>`로 나열하고,
  basename과 일치하는 `IsDir:true` 엔트리를 찾는다. 이 probe에는 `--files-only`를 쓰지 않는다.
  없으면 `PATH_NOT_FOUND`, 파일이면 `PATH_NOT_DIRECTORY`.
  (rclone은 파일 path도 lsjson으로 자기 자신을 반환할 수 있으므로 부모 listing 방식이 더 정확하다.)
- remote 루트(`remote:`)는 안전 규칙상 차단되지만, 감지/테스트 자체는 접근 가능 여부만 확인할 수 있다.

---

## 7. rclone 연동과 비교 엔진

### 7.1 환경 감지

**우선순위**

1. `settings.rclonePath`가 있으면 그 경로만 사용(실패 시 fallback 없이 오류).
2. 없으면 PATH의 `rclone`을 `spawn`하여 `version` 확인.
3. 실패 시 일반 경로 탐색:
   - `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Rclone.Rclone_*\rclone-*\rclone.exe`
   - `%ProgramFiles%\rclone\rclone.exe`
   - `%USERPROFILE%\scoop\shims\rclone.exe`
4. 모두 실패 → `RCLONE_NOT_FOUND`.

- 버전 파싱: `/^rclone v(\d+)\.(\d+)\.(\d+)/m`; 최소 **1.65.0**, 1.75.1 검증, 상위 버전은 경고 후 허용.
- config 경로:
  1. job override → 2. settings override → 3. `rclone config file` 출력 파싱(`stored at:` 이후 경로)
  → 4. `%APPDATA%\rclone\rclone.conf` 존재 확인 → 5. null(환경변수 기본값에 위임, 경고).
- `rclone listremotes --config <path>` 결과에서 trailing `:` 제거, 정렬. 실패 시 stderr 요약 반환.
- 감지 결과는 메모리 캐시. 설정 변경/재감지 시 갱신. 모든 rclone 호출은 동일 binary/config를 사용한다.

### 7.2 비교용 lsjson

양측을 **병렬** 실행한다.

```
rclone lsjson --recursive --files-only --no-mimetype [--hash] [--skip-links]
       [--config <conf>] [--exclude <pattern> ...] -- <path>
```

- `--files-only`: 디렉터리 제외(빈 디렉터리 차이는 MVP에서 표시하지 않음).
- `--no-mimetype`: payload 축소.
- `--hash`: `checkHashes=true`일 때만. local은 해시 계산 비용이 있으므로 기본 OFF.
- `--skip-links`: job 옵션.
- `--exclude`: job excludes를 순서대로 각각 전달. 원본/대상 양쪽에 동일 적용.
- `--config`: 경로가 확인된 경우 항상 전달.
- **exit code != 0이면 stdout을 파싱하지 않는다.** rclone은 없는 경로에서 stdout에 `[`만 출력하고
  exit 3을 반환하는 것을 실측 확인했다. 이 경우 `PATH_NOT_FOUND` + stderr 요약으로 처리한다.
- JSON은 전체 배열을 파싱한다. 각 항목에서 `Path`, `Size`, `ModTime`, `IsDir`, `Hashes`만 사용한다.
- `Path`는 `/` 구분 상대 경로. `ModTime`은 오프셋 포함 ISO → epoch ms로 변환.
- 손상/비정형 항목이 있으면 `RCLONE_PARSE_ERROR`로 실패(잘못된 계획 생성 방지).

### 7.3 diff 알고리즘 (의사코드)

```text
function compare(job, sourceList, destList, opts):
  src = indexByPath(sourceList, opts.caseInsensitive)   // key -> file
  dst = indexByPath(destList, opts.caseInsensitive)
  // indexByPath: key = NFC(path).toLowerCase() (옵션), 중복 key는 CASE_COLLISION
  // FileMeta: { path, size, mtimeMs, hashes }

  conflictRoots = Set()

  // 1) 파일 vs 디렉터리(파일 하위 경로) 충돌 탐지
  for key in src.keys:
    for ancestor in ancestorsOf(key):          // "a/b/c" -> "a", "a/b"
      if dst.has(ancestor):
        conflictRoots.add(ancestor)            // dest 파일이 source 디렉터리를 막음
  for key in dst.keys:
    for ancestor in ancestorsOf(key):
      if src.has(ancestor):
        conflictRoots.add(ancestor)            // source 파일이 dest 디렉터리를 막음

  entries = []
  for key in sorted(union(src.keys, dst.keys)):
    s = src.get(key); d = dst.get(key)
    conflict = isSelfOrDescendant(key, conflictRoots)   // key == root || key.startsWith(root + "/")

    if conflict:
      status = 'typeConflict'; reasons = ['type']
    else if s && !d:
      status = 'onlySource'
    else if !s && d:
      status = 'onlyDest'
    else:
      status, reasons = comparePair(s, d, opts)

    entries.push({
      path: s?.path ?? d.path,
      status, reasons,
      source: s ? toSide(s) : null,
      dest: d ? toSide(d) : null,
      caseOnly: s && d && s.path !== d.path,
      hashAlgo: usedHashAlgo,
      hashUnavailable: ...
    })

  summary = summarize(entries)   // create/update/delete/same/conflict + bytes
  return { entries, summary, warnings }

function comparePair(s, d, opts):
  if s.size !== d.size: return ('modified', ['size'])

  if opts.checkHashes:
    algo = pickCommonHash(s, d, HASH_PRIORITY)
    if algo:
      if lower(s.hashes[algo]) !== lower(d.hashes[algo]): return ('modified', ['hash'])
      return ('equal', [])                    // 크기+해시 동일 → mtime 무시 (--checksum)
    else:
      hashUnavailable += 1
      return ('equal', [])                    // rclone --checksum의 size-only fallback과 일치

  if s.mtimeMs == null || d.mtimeMs == null:
    return ('modified', ['mtimeUnknown'])     // 보수적: 변경으로 표시
  if abs(s.mtimeMs - d.mtimeMs) > opts.modtimeToleranceMs:
    return ('modified', ['mtime'])
  return ('equal', [])
```

**해시 우선순위**: `sha1 → md5 → sha256 → xxh3 → xxh128 → crc32 → blake3 → dropbox → quickxor → whirlpool`.
양쪽에 존재하는 첫 알고리즘을 사용한다. 해시 값은 `CompareResult`에 보관하지 않는다(메모리 절감).

**요약 규칙**

- `createFiles = onlySource`, `updateFiles = modified`, `deleteFiles = onlyDest`, `sameFiles = equal`.
- `transferBytes = sum(source.size)` for create + update.
- `deleteBytes = sum(dest.size)` for delete.
- `typeConflict` 엔트리는 create/update/delete 어디에도 집계하지 않는다.
- `conflictGroups`는 conflict root 수, `conflictFiles`는 해당 엔트리 수.
- `caseOnlyFiles`는 양쪽 path가 대소문자만 다른 엔트리 수.
- `hashComparedFiles` / `hashUnavailableFiles`는 해시 옵션 사용 시 통계.

**제약/한계**

- 빈 디렉터리 차이는 보이지 않는다. sync 시 rclone이 빈 디렉터리를 정리할 수 있음을 UI에 명시한다.
- 심볼릭 링크는 기본 skip. `skipLinks=false`는 고급 옵션이며 문제 발생 시 오류를 그대로 표시한다.
- 대소문자 무시는 Windows/Drive에 맞춘 기본값이다. 케이스 민감 remote를 쓸 때는 설정에서 끈다.
- 5만 파일 초과 시 UI에 "대용량" 경고를 표시하되 실행을 막지는 않는다. 20만 초과는 Post-MVP 스트리밍 대상.

### 7.4 계획 토큰과 신선도

```
planToken = sha256(
  jobId | job.rev | compare.createdAt | source | destination | mode |
  normalizedExcludes | compare options | summary counts/bytes
).slice(0, 32)
```

- Main이 `lastCompare: Map<jobId, CompareResult>`를 보관한다. Renderer는 토큰만 보낸다.
- 실제 실행은 다음을 모두 만족해야 한다: 토큰 일치, `job.rev` 일치, 나이 < `compareMaxAgeMinutes`.
- 다음 이벤트에서 캐시를 무효화한다: job 수정, 실행 완료/실패, rclone 경로/config 변경,
  `caseInsensitivePaths` 변경, 비교 실패/취소(이전 결과 사용 금지).
- 앱 재시작 시 비교 결과는 메모리 only이므로 다시 비교해야 한다.

### 7.5 인증/백엔드 주의

- OAuth 갱신은 rclone이 담당한다. 실패 시 stderr의 안내와 `rclone config reconnect <remote>:` 힌트를 표시한다.
- Google Drive 삭제는 기본적으로 휴지통으로 갈 수 있으나 **복구를 보장하지 않는다**. 안전 게이트는 그대로 적용한다.
- Google Docs/Photos 등 크기/해시가 없는 항목은 size 0/해시 없음으로 나타날 수 있다. 경고 통계에 포함한다.
- FTP/SFTP는 해시가 없을 수 있어 size+mtime 또는 size-only fallback이 된다. UI에 비교 방식을 표시한다.
- rate limit/재시도는 rclone에 위임하고, 진행이 없으면 사용자가 취소할 수 있다.

---

## 8. 실행 엔진

### 8.1 args 매핑

| UI/모델 | CLI | 기본 | 비고 |
| :--- | :--- | :--- | :--- |
| mode | `copy` \| `sync` | - | positional |
| source/destination | positional | - | 정규화된 경로 |
| configPath | `--config <path>` | 감지값 | 존재 확인, 토큰 내용 비노출 |
| excludes[] | `--exclude <p>` 반복 | 기본 패턴 | 각각 별도 arg |
| checkers | `--checkers N` | 8 | 1..64 clamp/검증 |
| transfers | `--transfers N` | 4 | 1..32 |
| fastList | `--fast-list` | true | 메모리 사용 증가 |
| skipLinks | `--skip-links` | true | 심볼릭 링크 skip |
| ignoreErrors | `--ignore-errors` | false | **IO 오류에도 삭제** → 고급/경고 |
| checkHashes | `--checksum` | false | size+hash, 해시 없으면 size-only |
| modtimeToleranceMs | `--modify-window <n>ms` | 2000 | copy/sync 모두 적용 |
| dryRun | `--dry-run` | false | 미리보기/사전검증 |
| (sync only) delete guard | `--max-delete <plan.deleteFiles>` | 계획 수 | 0도 유효(모든 삭제 차단) |
| logging | `-v --use-json-log --stats 1s` | 항상 | dry-run 포함 |
| lsjson | `lsjson ...flags -- <path>` | - | `--recursive --files-only --no-mimetype`, `--hash`, `--skip-links`, `--exclude`, `--config` 추가 |

**금지/미사용**: `--delete-excluded`, `--ignore-times`, `--size-only`, `--update`, `--backup-dir`,
`--track-renames`, `--progress`(JSON 로그와 충돌), 셸 문자열 조합.

**정렬 원칙**: `[mode, ...flags, '--', source, destination]` 순서로 결정적으로 생성한다.
`--`는 positional 경로가 flag로 해석되는 것을 막는다(실측: rclone 1.75.1 copy/lsjson에서 동작).
args builder는 순수 함수이며 단위 테스트에서 정확한 배열을 검증한다.

### 8.2 실행 흐름

**수동 실제 실행**

```
validate job/path/config
→ require lastCompare(jobId) + planToken + fresh
→ acquire global activity lock
→ (sync && plan.deleteFiles>0 && preflightBeforeDestructive)
    → dry-run preflight (--dry-run, --max-delete 미포함)
    → parse stats: transfers/deletes/bytes
    → compare plan과 불일치 → PLAN_DRIFT로 중단 (실행 안 함)
→ spawn copy/sync (필요 시 --max-delete)
→ stream stats/log → renderer
→ exit → finalize → history/job.lastRun → clear compare → release lock
```

**Dry-run 미리보기**

- 계획/토큰 불필요, 안전 확인 불필요(변경 없음). 경로/설정 유효성만 확인.
- `--dry-run` 실행, skipped(copy/delete/touch) 이벤트와 stats를 이력에 `dryRun:true`로 기록.
- 삭제/복사 예정 샘플(최대 20개)을 UI에 표시.

**자동 실행**

```
due 감지 → acquire lock
→ compare (내부, UI 없이)
→ gates (allowDeletes, maxDeletes, empty source, conflicts, caseOnly, ignoreErrors)
→ 변경 없음(no-op) → 이력 없이 lastRun 갱신 + 다음 schedule
→ spawn copy/sync → finalize
```

- 자동 실행은 방금 만든 비교 계획을 사용하므로 별도 preflight를 생략한다(중복 스캔 비용).
- 자동 실행 중에는 UI 비교/수동 실행을 금지한다(전역 락).
- 실행 직전 소스/대상이 바뀌는 경쟁은 `--max-delete` backstop과 실제 stats로 완화한다.

### 8.3 프로세스/로그 파싱

**spawn**

```ts
spawn(binary, args, {
  windowsHide: true,
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
})
```

- UTF-8 `StringDecoder`로 stdout/stderr를 라인 단위 처리한다. 멀티바이트 분할에 대비한다.
- stderr는 run 로그 파일에 원문으로 기록하고, 동시에 JSON 이벤트로 파싱한다.
- stdout은 run 로그에 기록(보통 비어 있음). lsjson은 stdout 전체를 JSON으로 파싱한다.
- 메모리에는 최근 로그 라인 ring buffer(최대 200줄)와 최종 stats만 유지한다.

**관측된 JSON 로그 예(실측)**

```json
{"time":"...","level":"notice","msg":"Skipped copy as --dry-run is set (size 2)","skipped":"copy","size":2,"object":"sub/b.txt"}
{"time":"...","level":"notice","msg":"Skipped update modification time as --dry-run is set (size 1)","skipped":"update modification time","size":1,"object":"a.txt"}
{"time":"...","level":"notice","msg":"Skipped delete as --dry-run is set (size 3)","skipped":"delete","size":3,"object":"extra.txt"}
{"time":"...","level":"info","msg":"\nTransferred: ...\nDeleted: 2 (files), 1 (dirs), 5 B (freed)\n...","stats":{"bytes":2,"deletes":2,"deletedDirs":1,"transfers":1,"errors":0,"listed":7,"fatalError":false,"elapsedTime":0.02462}}
```

**파서 규칙**

- 라인이 `{`로 시작하면 `JSON.parse` 시도, 실패하면 raw 로그로 취급(절대 크래시 금지).
- `skipped` 이벤트:
  - `copy` → dry-run 복사 예정
  - `delete` → dry-run 삭제 예정
  - `update modification time` / `set directory modification time` → touch (계획 카운트에서 제외)
  - `remove directory` → 디렉터리 삭제 (파일 카운트 제외, `deletedDirs`는 stats 사용)
- 실제 이벤트: `Copied`, `Deleted`, `Moved` 등은 샘플/로그용. 최종 수치는 stats를 신뢰한다.
- stats 정규화: `bytes,totalBytes,transfers,totalTransfers,deletes,deletedDirs,checks,totalChecks,listed,errors,speed,eta,elapsedTime,fatalError,lastError`.
- `errors`는 누적값. exit 0이어도 `errors>0`이면 `partial`.
- 로그 `level`은 `debug|info|notice|warning|error`로 정규화하고, 알 수 없는 레벨은 `info`로 매핑한다.
- 비정상적으로 긴 라인은 8KB에서 잘라 로그 폭주를 방지한다(원문 파일에는 그대로 기록하되 UI 이벤트는 절단).

**렌더러 이벤트 배칭**

- stats: rclone이 1초마다 보내는 그대로 전달(최대 1/s).
- log: 200ms마다 최대 100줄 배치, `dropped` 카운트 포함. 전체 로그는 파일에 있으므로 UI는 tail만 표시.
- 종료 이벤트는 항상 마지막에 1회.

### 8.4 Preflight와 삭제 백스톱

- 수동 sync + `deleteFiles>0` + job 옵션 ON일 때만 preflight.
- preflight는 `--dry-run`으로 같은 args를 실행하되 `--max-delete`는 넣지 않는다.
  `--ignore-errors`를 포함한 나머지 옵션은 실제 실행과 동일하게 유지한다.
- 계획과 preflight의 `transfers == createFiles + updateFiles`, `deletes == deleteFiles`,
  `bytes == transferBytes`(= 전송 바이트, 삭제 바이트 아님)가 모두 같아야 실제 실행한다.
  (touch/디렉터리 이벤트는 비교하지 않는다.)
- 불일치: `PLAN_DRIFT`로 중단하고 최신 카운트를 UI에 표시. 자동으로 실제 실행하지 않는다.
- 실제 sync에는 `--max-delete <plan.deleteFiles>`를 항상 전달한다.
  실측: `--max-delete 0`은 **파일 삭제 0건**을 강제하고, 초과 시 exit 7 + fatal error로 중단한다.
  빈 디렉터리 삭제(deletedDirs)는 이 한도에 포함되지 않는 것도 확인했다(별도 안내).
  계획 드리프트가 있으면 일부 삭제 후 중단될 수 있으므로 preflight가 1차 방어, max-delete는 백스톱이다.
- copy 모드에는 `--max-delete`를 넣지 않는다(삭제 없음).

### 8.5 취소/동시성/종료

**취소**

- `run:cancel(runId)`는 idempotent.
- `taskkill /PID <pid> /T /F`를 `execFile`로 실행(shell 없음). 5초 내 종료 확인.
- 종료 후 exit code와 무관하게 `canceled` 우선. 로그에 취소 시각 기록.
- 비교 취소도 동일하게 자식 프로세스를 종료하고 `CANCELED` 반환.
- 사용자가 취소를 눌러도 삭제/복사 일부가 이미 반영될 수 있음을 UI에 고지한다.

**전역 락**

- `activity: null | {kind:'compare'|'run', jobId, runId?}`.
- 비교/실행/자동 실행은 상호 배타. 두 번째 요청은 `BUSY`.
- 스케줄러는 busy면 due를 유지하고 30초 후 재시도(로그 스팸 방지).

**앱 종료**

- 실행/비교 중 종료 요청 → 확인 다이얼로그:
  - "실행 중인 동기화를 취소하고 종료" / "취소(앱 유지)".
- 취소 선택 시 taskkill → 최대 10초 대기 → 미종료면 오류 안내(앱 유지). 무음 종료로 고아 프로세스를 만들지 않는다.
- 정상 종료 시 로그 스트림/스토어를 flush하고 트레이를 제거한다.

**고아 프로세스 복구**

- 실행 시작 시 `active-run.json`에 `runId, jobId, pid, startedAt`을 원자적으로 기록, 종료 시 삭제.
- 앱 시작 시 파일이 남아 있으면:
  1. `tasklist /FI "PID eq <pid>" /FO CSV /NH`로 프로세스 존재/이미지명 확인.
  2. `rclone.exe`가 맞으면 `taskkill /PID <pid> /T /F` (best-effort) 후 로그.
  3. history의 `running` 레코드를 `interrupted`로 전환.
- PID 재사용 위험을 줄이기 위해 이미지명을 확인한다. 확인 불가 시 자동 kill하지 않고 사용자에게 PID를 안내한다.

### 8.6 상태 매핑

| 조건 | 상태 |
| :--- | :--- |
| 취소 요청/종료 | `canceled` |
| preflight/게이트 중단 | `blocked` |
| exit 0, errors=0 | `success` |
| exit 0, errors>0 또는 `--ignore-errors`로 오류 존재 | `partial` |
| exit 3 | `failed` + `PATH_NOT_FOUND` 안내 |
| exit 7 | `failed` + `MAX_DELETE_EXCEEDED` |
| 그 외 비정상 exit | `failed` |
| 자동 비교 결과 변경 없음 | `noop` (이력 미기록, lastRun 갱신) |
| 앱 비정상 종료 후 복구 | `interrupted` |

---

## 9. 안전 규칙

### 9.1 규칙 매트릭스

| ID | 조건 | 동작 | 적용 |
| :--- | :--- | :--- | :--- |
| S1 | 빈 원본/대상/이름 | 차단 `VALIDATION` | 저장/비교/실행 |
| S2 | source == destination (정규화) | 차단 `SAFETY_BLOCKED` | 저장/비교/실행 |
| S3 | 로컬/UNC/remote 중첩 경로 | 차단 `SAFETY_BLOCKED` | 저장/비교/실행 |
| S4 | 파일시스템/remote/WSL 루트 | 차단 `SAFETY_BLOCKED` | 저장/비교/실행 |
| S4a | remote path에 `.`/`..` 세그먼트 | 차단 `VALIDATION` | 저장/비교/실행 |
| S5 | 형식 충돌(typeConflict) > 0 | 차단 `SAFETY_BLOCKED` (자동/수동 모두) | 실행 |
| S6 | 케이스 충돌/caseOnly > 0 | 차단 `SAFETY_BLOCKED` | 실행 |
| S7 | 원본 파일 0 + 대상 파일 > 0 + sync | 차단 `EMPTY_SOURCE_BLOCKED` | 실행/자동 |
| S8 | 실제 실행에 최신 계획 없음/토큰 불일치 | 차단 `PLAN_REQUIRED` | 실행 |
| S9 | 계획 나이 > 10분 | 차단 `PLAN_STALE` | 실행 |
| S10 | sync 삭제 > 0 | 확인 모달 + `confirmDeletes` 필수 | 수동 실행 |
| S11 | 삭제 > 50건 또는 대상의 10% | 추가 경고 + `confirmLargeDeletes` 필수 | 수동 실행 |
| S12 | 자동 실행 + 삭제 > 0 + allowDeletes=false | 실행 차단 + 알림/로그 | 자동 |
| S13 | 자동 실행 + 삭제 > 50 | 실행 차단 + 알림/로그 | 자동 |
| S14 | preflight 카운트 불일치 | 차단 `PLAN_DRIFT`, 실제 실행 안 함 | 수동 실행 |
| S15 | `ignoreErrors && mode=sync` | 수동: 추가 확인 필수 / 자동: 차단 | 실행/자동 |
| S16 | 이미 실행/비교 중 | 차단 `BUSY` | 모든 활동 |
| S17 | remote job인데 config/remote 접근 불가 | 차단 `CONFIG_REQUIRED`/`PATH_NOT_FOUND` | 비교/실행 |
| S18 | max-delete 초과 | rclone exit 7 → `failed` | 실행 |
| S19 | 계획에 없는 삭제 발생(백스톱) | max-delete로 제한, 실패 처리 | 실행 |
| S20 | 실행 중 job 수정/삭제 | 차단 `BUSY` | IPC |

**비협상 차단(override 없음)**: S1~S9, S12~S13, S15(자동), S16, S17.
**확인 후 허용**: S10, S11, S15(수동).

### 9.2 삭제 확인 모달

표시 내용:

- 작업 이름, 모드, 원본/대상
- 삭제 파일 수/바이트, 대상 전체 파일 수 대비 비율
- 삭제 샘플 최대 20개(경로, 크기)
- 형식 충돌/케이스 경고(있으면 실행 불가 안내)
- "빈 디렉터리도 정리될 수 있음" 안내
- 체크박스 1: "위 삭제 대상과 동기화 동작을 확인했습니다."
- 체크박스 2(조건부): "대량 삭제 경고를 확인했습니다."
- 체크박스 3(조건부): "`--ignore-errors`의 위험을 이해했습니다."
- 확인 버튼 라벨: "N개 삭제 포함 실행" / 취소

Main은 Renderer의 체크 상태를 신뢰하지 않고 `confirmDeletes/confirmLargeDeletes/confirmIgnoreErrors`를
다시 검증한다. 모달을 우회한 IPC 호출은 `SAFETY_BLOCKED`가 된다.

### 9.3 자동 실행 게이트 순서

```
1. job.autoSync.enabled && due
2. 전역 락 사용 가능
3. 비교 성공 (실패 시 failed)
4. allowDeletes 확인 (deleteFiles>0이면 필수)
5. deleteFiles <= autoMaxDeletes
6. sourceFiles>0 또는 deleteFiles==0
7. conflictFiles==0, caseOnlyFiles==0
8. !(ignoreErrors && mode==='sync')
9. copy는 create+update==0이면 noop, sync는 create+update+delete==0이면 noop
10. 실행
```

- gate 실패 시 `blocked` 이력 + 알림(창이 숨겨져 있으면 Notification) + 앱 로그.
- noop은 이력에 남기지 않고 `job.lastRun`과 앱 로그만 갱신(이력 폭주 방지).

---

## 10. 스케줄러

### 10.1 상태와 tick

- Main에서 `setInterval(tick, 20_000)` (20초).
- `nextRunAt`은 job에 영속화한다. 스케줄러는 `now >= nextRunAt`인 job 중 첫 번째를 처리한다.
- tick당 최대 1개 job 실행(전역 락). 나머지는 다음 tick에서 처리.
- 중복 방지: 자동 실행 시작 시 `nextRunAt = now + interval`로 예약 갱신, 종료 시 `finishedAt + interval`로 재계산.
- `lastAutoRunAt` 기록.

### 10.2 시작/재시작/sleep

- 앱 시작 시 enabled job에 대해:
  - `nextRunAt`이 없거나 과거면 `now + 60초`로 재설정(시작 직후 폭주 방지) 후 저장.
  - 미래면 유지.
- 절전/재개: 타이머가 지연되므로 다음 tick에서 due를 감지해 실행.
- 앱이 꺼져 있던 동안의 놓친 실행은 **한 번만** 재개(연속 catch-up 없음).
- job의 enabled/interval 변경:
  - enabled ON: `nextRunAt = now + interval`
  - interval 변경: `nextRunAt = now + newInterval`
  - OFF: `nextRunAt = null`; 진행 중 실행은 완료까지 유지.

### 10.3 일시정지

- Settings/tray의 `scheduler.paused`가 true면 새 실행만 중단(진행 중 실행 유지).
- 해제 시 과거 due job은 `now + 30초`로 재예약해 일시적 폭주를 피한다.
- UI는 "일시정지"와 다음 실행 시각을 표시한다.

### 10.4 알림/실패

- 자동 실행 성공(변경 있음), 차단, 실패는 트레이/알림으로 사용자에게 알린다.
- 실패 후 다음 실행은 고정 interval(지수 backoff 없음). 로그에 반복 실패가 남으면 사용자가 조정.
- 연속 실패 3회 시 앱 로그에 경고를 남기고 토스트 1회(자동 OFF는 하지 않음).
- 창이 보이면 toast, 숨겨져 있으면 `Notification`(지원 시) + 트레이 tooltip 갱신.

### 10.5 스케줄러 의사코드

- 자동 비교는 `storeForManualUi:false`로 실행해 수동 비교 탭의 `lastCompare`/plan token을 덮어쓰지 않는다.
  자동 실행 게이트는 내부 plan을 사용하고, 완료 후 수동 UI에는 `jobs:changed`만 알린다.
- 수동 실행과 자동 실행은 동일한 run service/안전 게이트를 사용한다.

```text
tick():
  if settings.scheduler.paused: return
  if activity != null: schedule retry in 30s; return
  now = clock()
  for job of jobs sorted by nextRunAt:
    if !job.autoSync.enabled: continue
    if !job.autoSync.nextRunAt || now < nextRunAt: continue
    runService.startAuto(job.id)   // async; sets nextRunAt reservation
    return

startAuto(jobId):
  acquire lock or return
  compare(job, {storeForManualUi: false})   // 수동 비교 캐시/UI를 덮어쓰지 않음
  gates...
  if noop: update lastRun/lastAutoRunAt, nextRunAt=now+interval; release; return
  run copy/sync
  finalize: nextRunAt=finishedAt+interval; persist; release
```

---

## 11. 이력/로그

### 11.1 이력

- `history.json`에 `RunRecord[]` 저장(최신순), 최대 `historyLimit`.
- 실행 시작 시 `running` 레코드를 먼저 저장(PID 포함), 종료 시 갱신.
  - 앱이 비정상 종료되면 시작 시 `running` → `interrupted`로 전환.
- 수동/자동/dry-run 모두 기록. noop 자동 실행만 제외.
- `job.lastRun`은 종료 시 갱신(noop 포함). jobName 스냅샷은 이력에 유지.
- 이력 정리: 사용자가 확인 후 전체 삭제 가능(실행 중에는 차단). 로그 파일도 함께 삭제할지 선택.

### 11.2 로그

- 실행 로그: `logs/run-YYYYMMDD-HHmmss-<job8>-<run8>.log`
  - `[ISO] [phase] raw line` 형식 + 우리가 추가한 command/phase/gate 메타데이터.
  - rclone config 내용은 절대 기록하지 않는다. args의 config 경로는 기록 가능.
- 앱 로그: `logs/app.log`, 5MB 초과 시 `app.1.log`로 회전.
- 보존: 시작 시 `retentionDays` 초과 로그 삭제, historyLimit 초과 이력 삭제(활성 실행 제외).
- UI: 이력 상세에서 stats/계획/오류/로그 tail(기본 256KB) 표시, "로그 폴더 열기".
- `history:readLog`는 runId로 이력 레코드를 찾고 logs 디렉터리 하위 경로만 읽는다(path traversal 방지).

---

## 12. IPC 계약

### 12.1 공통 규칙

- 모든 invoke 응답: `ApiResult<T>` envelope.
- Main은 zod로 요청을 검증하고, `event.sender`가 메인 창인지 확인한다.
- Renderer는 `window.rclonegui`만 사용한다. 범용 `ipcRenderer`는 노출하지 않는다.
- 이벤트는 envelope 없이 타입화된 payload로 전송하며, 구독 해제 함수를 반환한다.
- 채널명은 `domain:action` 규칙.

### 12.2 채널

| 채널 | 방향 | 요청 | 응답/이벤트 |
| :--- | :--- | :--- | :--- |
| `app:getInfo` | invoke | - | `{appVersion,electron,node,chrome,platform,userDataPath,logsPath}` |
| `app:openLogsFolder` | invoke | - | `void` |
| `settings:get` | invoke | - | `Settings` |
| `settings:update` | invoke | `SettingsPatch` | `Settings` |
| `rclone:detect` | invoke | `{force?: boolean}` | `RcloneEnvironment` |
| `rclone:listRemotes` | invoke | `{configPath?: string|null}` | `string[]` |
| `rclone:testPath` | invoke | `{path, configPath?: string|null}` | `PathProbe` |
| `wsl:listDistros` | invoke | - | `{distros: string[]}` |
| `dialog:pickDirectory` | invoke | `{title?, defaultPath?}` | `string \| null` |
| `dialog:pickFile` | invoke | `{title?, filters?}` | `string \| null` |
| `jobs:list` | invoke | - | `Job[]` |
| `jobs:create` | invoke | `JobDraft` | `Job` |
| `jobs:update` | invoke | `{id, patch: JobPatch}` | `Job` |
| `jobs:delete` | invoke | `{id}` | `void` |
| `jobs:duplicate` | invoke | `{id}` | `Job` |
| `compare:run` | invoke | `{jobId}` | `CompareResult` |
| `compare:cancel` | invoke | `{jobId}` | `void` |
| `compare:get` | invoke | `{jobId}` | `CompareResult \| null` |
| `compare:getActive` | invoke | - | `{jobId, phase, startedAt} \| null` |
| `run:start` | invoke | `StartRunInput` | `{runId}` |
| `run:cancel` | invoke | `{runId}` | `void` |
| `run:getActive` | invoke | - | `RunSnapshot \| null` |
| `history:list` | invoke | `{jobId?, limit?}` | `RunRecord[]` |
| `history:get` | invoke | `{runId}` | `RunRecord \| null` |
| `history:readLog` | invoke | `{runId, tailBytes?}` | `{text, truncated, size}` |
| `history:clear` | invoke | `{deleteLogs: boolean}` | `void` |
| `scheduler:getState` | invoke | - | `SchedulerState` |
| `scheduler:setPaused` | invoke | `{paused: boolean}` | `SchedulerState` |
| `run:event` | event | - | `RunEvent` |
| `compare:progress` | event | - | `{jobId, phase, at}` |
| `scheduler:state` | event | - | `SchedulerState` |
| `jobs:changed` | event | - | `{jobs: Job[]}` (자동 실행 후 lastRun/nextRun 갱신) |

```ts
export interface StartRunInput {
  jobId: string;
  dryRun: boolean;
  planToken?: string;             // 실제 수동 실행 시 필수
  confirmDeletes?: boolean;
  confirmLargeDeletes?: boolean;
  confirmIgnoreErrors?: boolean;
}

export type RunEvent =
  | { type: 'started'; snapshot: RunSnapshot }
  | { type: 'phase'; runId: string; phase: RunPhase; at: string }
  | { type: 'stats'; runId: string; stats: RunStats; at: string }
  | { type: 'log'; runId: string; lines: RunLogLine[]; dropped: number; at: string }
  | { type: 'finished'; runId: string; record: RunRecord };

export interface RunLogLine {
  at: string;
  level: 'debug'|'info'|'notice'|'warning'|'error';
  message: string;
  object?: string;
}

export interface PathProbe {
  kind: PathKind;
  exists: boolean;
  isDirectory: boolean;
  displayPath: string;
  sampleCount?: number;
}
```

### 12.3 요청/보조 타입

```ts
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface JobDraft {
  name: string;
  notes: string;
  source: string;
  destination: string;
  mode: RunMode;
  excludes: string[];
  options: JobRunOptions;
  configPathOverride: string | null;
  autoSync: Pick<AutoSyncOptions, 'enabled' | 'intervalMinutes' | 'allowDeletes'>;
}

export type JobPatch = Partial<JobDraft>;
export type SettingsPatch = DeepPartial<Omit<Settings, 'version'>>;

export interface RcloneEnvironment {
  binaryPath: string | null;
  version: string | null;
  os: string | null;
  arch: string | null;
  configPath: string | null;
  configSource: 'manual' | 'auto' | 'env' | 'none';
  remotes: string[];
  warnings: string[];
}

export interface AppInfo {
  appVersion: string;
  electron: string;
  node: string;
  chrome: string;
  platform: string;              // 'win32' 등
  userDataPath: string;
  logsPath: string;
}

export interface SchedulerState {
  paused: boolean;
  runningJobId: string | null;
  next: Array<{
    jobId: string;
    jobName: string;
    nextRunAt: IsoDateString;
    lastAutoRunAt: IsoDateString | null;
  }>;
}

export interface CompareProgress {
  jobId: string;
  phase: 'source' | 'destination' | 'diff';
  at: IsoDateString;
}
```

- `jobs:update`는 `JobPatch`를 Main에서 현재 Job에 병합하고 `rev`를 1 증가시킨 뒤 전체를 다시 검증한다.
  `autoSync.nextRunAt/lastAutoRunAt`은 Main만 갱신한다(Renderer patch에서 무시).
- `jobs:duplicate`는 새 id/`createdAt`/`rev=0`으로 복제하고 이름에 " (복사)"를 붙인다.
  (80자 제한을 넘으면 잘라낸다.) `lastRun=null`, `autoSync.lastAutoRunAt=null`, `nextRunAt=null`로
  초기화한다(이력은 복제하지 않음).
- `settings:update`는 `SettingsPatch`를 병합한 **최종 Settings**를 zod로 검증하고 저장한다.
  실패 시 기존 설정을 유지한다.

### 12.4 Preload API

```ts
export interface rcloneGUIApi {
  app: {
    getInfo(): Promise<ApiResult<AppInfo>>;
    openLogsFolder(): Promise<ApiResult<void>>;
  };
  settings: {
    get(): Promise<ApiResult<Settings>>;
    update(patch: SettingsPatch): Promise<ApiResult<Settings>>;
  };
  rclone: {
    detect(force?: boolean): Promise<ApiResult<RcloneEnvironment>>;
    listRemotes(configPath?: string | null): Promise<ApiResult<string[]>>;
    testPath(path: string, configPath?: string | null): Promise<ApiResult<PathProbe>>;
  };
  wsl: { listDistros(): Promise<ApiResult<{ distros: string[] }>> };
  dialog: {
    pickDirectory(opts?: { title?: string; defaultPath?: string }): Promise<ApiResult<string | null>>;
    pickFile(opts?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<ApiResult<string | null>>;
  };
  jobs: {
    list(): Promise<ApiResult<Job[]>>;
    create(draft: JobDraft): Promise<ApiResult<Job>>;
    update(id: string, patch: JobPatch): Promise<ApiResult<Job>>;
    remove(id: string): Promise<ApiResult<void>>;
    duplicate(id: string): Promise<ApiResult<Job>>;
  };
  compare: {
    run(jobId: string): Promise<ApiResult<CompareResult>>;
    cancel(jobId: string): Promise<ApiResult<void>>;
    get(jobId: string): Promise<ApiResult<CompareResult | null>>;
    getActive(): Promise<ApiResult<{ jobId: string; phase: string; startedAt: string } | null>>;
  };
  run: {
    start(input: StartRunInput): Promise<ApiResult<{ runId: string }>>;
    cancel(runId: string): Promise<ApiResult<void>>;
    getActive(): Promise<ApiResult<RunSnapshot | null>>;
  };
  history: {
    list(query?: { jobId?: string; limit?: number }): Promise<ApiResult<RunRecord[]>>;
    get(runId: string): Promise<ApiResult<RunRecord | null>>;
    readLog(runId: string, tailBytes?: number): Promise<ApiResult<{ text: string; truncated: boolean; size: number }>>;
    clear(deleteLogs: boolean): Promise<ApiResult<void>>;
  };
  scheduler: {
    getState(): Promise<ApiResult<SchedulerState>>;
    setPaused(paused: boolean): Promise<ApiResult<SchedulerState>>;
  };
  events: {
    onRunEvent(cb: (e: RunEvent) => void): () => void;
    onCompareProgress(cb: (e: CompareProgress) => void): () => void;
    onSchedulerState(cb: (e: SchedulerState) => void): () => void;
    onJobsChanged(cb: (e: { jobs: Job[] }) => void): () => void;
  };
}
```

---

## 13. UI/UX 설계

### 13.1 화면 구조

```
┌────────────────────────────────────────────────────────────────────┐
│ TopBar: rcloneGUI | rclone 상태 배지 | 스케줄러 일시정지 | 설정      │
├───────────────┬────────────────────────────────────────────────────┤
│ Job Sidebar   │ Job Header: 이름 | source → destination | mode | 자동│
│ + 새 작업     │ Tabs: 비교 | 실행 | 이력 | 작업 설정               │
│ - Job A       │                                                    │
│ - Job B       │  [Compare View]                                    │
│               │  요약 카드: 신규/갱신/삭제/동일/충돌/전송 바이트    │
│               │  툴바: 상태 필터 | 검색 | 동일 숨기기 | 새로고침     │
│               │  테이블(가상화): 상태|경로|좌측|우측|사유            │
└───────────────┴────────────────────────────────────────────────────┘
```

### 13.2 화면별 요구

**온보딩/상태 배너**
- rclone 미감지: 설치 안내(`winget install Rclone.Rclone`), 경로 선택, 다시 감지.
- config 미감지: 기본 경로 안내, 수동 선택. local-only job은 허용.
- remote 인증 오류: stderr 요약 + `rclone config reconnect` 안내.

**Job 목록**
- 이름, 모드 배지, 마지막 실행 상태/시각, 자동 배지 + 다음 실행 시각.
- 정렬: 이름 오름차순. 선택 상태는 UI 메모리(재시작 시 첫 job).
- 삭제/복제는 컨텍스트 메뉴 또는 상세 헤더.

**Job 편집**
- 필수: 이름/원본/대상/모드.
- 경로 필드: 텍스트 입력 + 종류 배지 + 폴더 선택 + WSL 도우미 + remote 선택 + 테스트.
- WSL 도우미 모달: distro, Linux path, preview UNC, `/mnt/<drive>` 대안, 적용 대상 선택.
- excludes: 한 줄에 하나, "기본값 불러오기".
- 고급: checkers/transfers/fastList/skipLinks/checkHashes/tolerance/config override/preflight.
- 위험: ignoreErrors는 경고 문구와 함께 접힌 영역.
- 자동: enabled/interval/allowDeletes, 다음 실행 시각 표시.
- 저장 전 zod 검증, 필드별 오류. 저장 안 된 변경이 있으면 비교/실행 비활성 + 안내.

**비교 탭**
- 요약 카드 클릭 → 해당 상태 필터.
- 기본 "동일 숨기기" ON. 상태 필터(전체/변경/원본만/대상만/변경됨/충돌/동일).
- 검색은 path 부분일치(대소문자 무시), 150ms 디바운스.
- 정렬: 경로/상태/좌측 크기/좌측 수정시간/우측 크기/우측 수정시간.
- 테이블: 고정 헤더, 30px 행, 좌우 컬럼, 상태 배지+사유, 경로 툴팁.
- copy 모드의 onlyDest는 "대상만(유지)", sync 모드는 "삭제 예정"으로 표시.
- 실행 버튼: 모드에 따라 "복사 실행"/"동기화 실행". 최신 계획 없으면 비활성.
- stale 배너/형식 충돌 배너/빈 원본 배너.
- 충돌 필터 시 해결 안내(수동 정리 필요).

**실행 탭**
- 단계 표시(검증/비교/사전검증/전송/마무리), 진행률(바이트), stats 그리드(전송/삭제/체크/에러/속도/ETA).
- 실시간 로그 tail(최대 2000줄, 자동 스크롤 토글), 전체 로그 폴더 열기.
- 취소 버튼(확인 후), 실행 중 다른 작업 전환 시 상태 유지.
- Dry-run 결과 카드: 복사/갱신/삭제 예정 수/바이트, 샘플.
- 완료 카드: 상태, 소요 시간, stats, 이력 링크.

**이력 탭**
- 전체/작업별, 상태 필터, 최신순.
- 컬럼: 시작, 트리거(수동/자동/미리보기), 모드, 상태, 소요, 복사/삭제/바이트/에러, 로그.
- 상세 drawer: 계획/preflight/오류/로그 tail, "로그 폴더 열기".

**설정**
- rclone: 감지 상태/버전/경로/config/remotes, 자동 감지, 수동 선택, 테스트.
- 기본값: excludes, checkers/transfers, fastList/skipLinks/checkHashes/tolerance/preflight.
- 안전: 삭제 확인 임계값, 자동 최대 삭제, compare max age, case-insensitive(고급).
- 스케줄러: 일시정지, 다음 실행 목록.
- 로그/이력: 보존 일수, 이력 수, 폴더 열기, 이력 비우기.
- 앱: 테마, 트레이 최소화, 로그인 자동 시작, 앱 정보.

**트레이**
- Show/Open logs/Scheduler pause toggle/Quit.
- Close(X) + minimizeToTray → hide + 첫 1회 안내. Quit은 실행 중 확인.
- 로그인 자동 시작은 `--hidden` 인자로 실행(openAsHidden은 Electron 44에서 제거됨).

### 13.3 상태 관리

| Store | 내용 |
| :--- | :--- |
| `settingsStore` | Settings, 로드/저장, 감지 상태 파생 |
| `jobsStore` | Job[], selectedJobId, CRUD, scheduler 갱신 반영 |
| `compareStore` | jobId별 CompareResult, 진행 phase, stale 여부, 취소 |
| `runStore` | active snapshot, phases, stats, 로그 ring buffer(2000), 취소 |
| `historyStore` | RunRecord[], 상세, 로그 tail |
| `toastStore` | 토스트 큐 |
| `uiStore` | 탭/모달/필터/테마 보조 |

- 대용량 entries는 한 번만 저장하고 파생 배열은 `useMemo`/`useDeferredValue`로 계산한다.
- 로그 tail은 ring buffer로 제한해 장시간 실행에서 메모리 폭증을 막는다.
- 앱 재시작/새로고침 시 `run:getActive`, `compare:getActive`, `scheduler:getState`로 재동기화한다.

### 13.4 디자인/접근성

- 순수 CSS + 디자인 토큰(`--bg`, `--panel`, `--text`, `--muted`, `--border`, `--accent`, `--danger`, `--warning`, `--success`).
- 라이트/다크/시스템. 시스템은 `prefers-color-scheme`, 수동은 `data-theme`.
- 상태는 색+텍스트+아이콘으로 표현(색만 의존 금지).
- 모달 focus trap, Esc 닫기(파괴 확인은 취소), aria-label, 키보드 탐색.
- 최소 창 960x640, 기본 1280x860. 테이블은 좁을 때 수평 스크롤.

---

## 14. 오류 처리

### 14.1 에러 코드

| 코드 | 의미 | 사용자 메시지(요약) |
| :--- | :--- | :--- |
| `VALIDATION` | 입력/스키마 오류 | 입력값을 확인하세요 |
| `NOT_FOUND` | job/run/history 없음 | 대상을 찾을 수 없습니다 |
| `BUSY` | 비교/실행 중 | 다른 작업이 실행 중입니다 |
| `RCLONE_NOT_FOUND` | 바이너리 미감지 | rclone을 찾지 못했습니다 |
| `RCLONE_NOT_EXECUTABLE` | 실행 권한/경로 오류 | rclone을 실행할 수 없습니다 |
| `RCLONE_VERSION_UNSUPPORTED` | 버전 < 1.65 | rclone 업그레이드가 필요합니다 |
| `RCLONE_FAILED` | rclone 비정상 종료 | rclone 실행에 실패했습니다 |
| `RCLONE_PARSE_ERROR` | 로그/JSON 파싱 실패 | rclone 출력을 해석하지 못했습니다 |
| `PATH_INVALID` | 형식 오류 | 경로 형식이 올바르지 않습니다 |
| `PATH_NOT_FOUND` | 접근 불가 | 경로를 찾을 수 없습니다 |
| `PATH_NOT_DIRECTORY` | 폴더 아님 | 폴더 경로가 아닙니다 |
| `CONFIG_REQUIRED` / `CONFIG_NOT_FOUND` | config 필요/없음 | rclone 설정 파일을 확인하세요 |
| `PLAN_REQUIRED` | 비교 계획 없음 | 먼저 비교하세요 |
| `PLAN_STALE` | 계획 만료/불일치 | 다시 비교하세요 |
| `PLAN_DRIFT` | preflight 카운트 불일치 | 비교 후 변경이 감지되었습니다 |
| `SAFETY_BLOCKED` | 안전 규칙 위반 | 안전 규칙으로 실행이 차단되었습니다 |
| `EMPTY_SOURCE_BLOCKED` | 빈 원본 삭제 시도 | 원본이 비어 있어 차단되었습니다 |
| `MAX_DELETE_EXCEEDED` | rclone exit 7 | 삭제 안전 한도를 초과했습니다 |
| `CANCELED` | 사용자 취소 | 취소되었습니다 |
| `STORE_ERROR` | JSON 저장/복구 실패 | 설정 저장에 실패했습니다 |
| `INTERNAL` | 예상치 못한 오류 | 내부 오류가 발생했습니다 |

### 14.2 rclone exit code

| exit | 처리 |
| :--- | :--- |
| 0 | 성공(단, stats.errors>0이면 partial) |
| 3 | 경로 없음(`PATH_NOT_FOUND`), stdout 파싱 금지 |
| 7 | `--max-delete` 초과(`MAX_DELETE_EXCEEDED`), 부분 삭제 가능 |
| 그 외 | `RCLONE_FAILED` + stderr tail |

- 취소 플래그가 있으면 exit code보다 `canceled`가 우선한다.
- stderr 마지막 20KB를 오류 상세로 보관하고, 전체는 로그 파일에 남긴다.
- 알 수 없는 JSON 라인/비JSON 라인은 버리지 않고 로그에 남긴다.
- Main의 `uncaughtException`/`unhandledRejection`은 app.log에 기록하고, 복구 가능한 경우 앱을 유지한다.

---

## 15. 성능/제약

| 항목 | 목표/제한 | 대응 |
| :--- | :--- | :--- |
| 비교 2만 파일 | 60초 이내(로컬/UNC, 네트워크 제외) | 병렬 lsjson, `--no-mimetype`, hash 기본 OFF |
| diff 계산 | 5만 파일 1초 이내 | O(n·depth) Map 기반, 해시 값 미보관 |
| 테이블 | 5만 행 부드러운 스크롤 | react-virtual, 행 memo, 필터/정렬 memo |
| 메모리 | 50k에서 600MB 이하 | entries 최소 필드, 로그 ring buffer |
| UI 이벤트 | 초당 stats 1회, 로그 배치 200ms | 배칭/드롭 카운트 |
| JSON 파싱 | lsjson 배열 전체 파싱 | 20만 초과 시 Post-MVP 스트리밍 |
| 프로세스 | 전역 1개 활동 | BUSY 응답, 스케줄러 재시도 |
| 앱 시작 | 3초 이내 | 감지 비동기, 창 ready-to-show |
| 긴 경로 | 240자 초과 경고 | rclone/Windows 동작 그대로 표시 |
| 빈 디렉터리 | 비교에 미표시 | UI 안내, Post-MVP |
| 심볼릭 링크 | 기본 skip | `--skip-links`, 고급 옵션 경고 |

---

## 16. 보안/프라이버시

- 로컬 전용, 계정/서버/텔레메트리 없음.
- rclone.conf는 OAuth 토큰을 포함할 수 있으므로 **읽기/복사/로깅 금지**. 경로 존재만 확인.
- Renderer는 Node API에 접근할 수 없고, preload는 제한된 API만 노출한다.
- 모든 IPC 입력은 zod 검증, sender 검증, 결과 envelope.
- 셸 미사용, args 배열 spawn, 경로/옵션은 구조화된 값에서만 생성.
- CSP/탐색 차단/권한 거부/`webviewTag` 비활성.
- 로그에는 파일 경로/파일명이 포함될 수 있음을 README에 명시.
- 로그 tail 읽기는 logs 디렉터리 하위로 제한.
- 앱 종료/취소 시 자식 프로세스를 종료해 의도치 않은 지속 실행을 방지.
- 자동 실행은 삭제 게이트를 통과해야 하며, allowDeletes는 명시적 opt-in이다.

---

## 17. 패키징/스크립트

### 17.1 package.json scripts

```json
{
  "dev": "electron-vite dev",
  "start": "electron-vite preview",
  "build": "npm run typecheck && electron-vite build",
  "build:win": "npm run build && electron-builder --win nsis --x64",
  "typecheck": "tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit",
  "lint": "oxlint --deny-warnings",
  "lint:fix": "oxlint --fix",
  "format": "oxfmt",
  "format:check": "oxfmt --check",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "test:e2e": "npm run build && playwright test",
  "postinstall": "electron-builder install-app-deps"
}
```

- `main`: `./out/main/index.js` (CJS). Preload: `./out/preload/index.js`.
- `package.json`에 `"type": "module"`을 넣지 않는다. config는 `electron.vite.config.mts`.
- `test`는 `vitest.config.ts`의 unit 범위만 실행하고, 실제 rclone 테스트는 `test:integration`으로 분리한다.
- `lint`/`lint:fix`/`format`/`format:check`는 oxlint/oxfmt를 사용한다. `format:check`는 파일을 수정하지 않으므로
  Phase 0/각 Phase/최종 DoD에서 사용한다.
- `.oxlintrc.json`/`.oxfmtrc.json`은 루트에 두고, `docs/**`와 `tests/fixtures/**`는 lint/format 대상에서 제외한다.
- oxlint/oxfmt는 `devDependencies`에 정확한 버전으로 고정한다(`oxlint: 1.90.0`, `oxfmt: 0.75.0`).
- `private: true`, `version: 0.1.0`, `description`, `author` 포함(NSIS 메타데이터).

### 17.2 electron-builder

```yaml
appId: com.rclonegui.app
productName: rcloneGUI
directories:
  output: release
  buildResources: build
files:
  - out/**/*
  - package.json
extraResources:
  - from: resources
    to: resources
asar: true
npmRebuild: false
win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.ico
  artifactName: rcloneGUI-Setup-${version}.${ext}
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: rcloneGUI
  uninstallDisplayName: rcloneGUI
  deleteAppDataOnUninstall: false
```

- **런타임 npm 의존성을 asar에 넣지 않는다.** Main/Preload가 import하는 JS 의존성(예: Main의 zod)은
  모두 번들하고, Renderer는 Vite가 번들한다. 따라서 `dependencies`는 비워 두고 라이브러리는
  `devDependencies`에 둔다.
  `externalizeDepsPlugin`을 사용하지 않으며( electron 자체/Node built-in만 external ), 패키지에는
  `out`과 `package.json`만 포함한다. 이는 native 모듈이 없는 MVP에서 설치본 크기/누락 위험을 줄인다.
  Phase 0에서 `out/main`에 `require('zod')` 같은 외부 require가 없는지 확인한다.
- 트레이 아이콘은 asar 밖에서 읽도록 `extraResources`로 `resources/`를 복사하고
  `process.resourcesPath/resources/tray.png`를 사용한다. 개발 모드에서는
  `app.getAppPath()/resources/tray.png`로 fallback한다.
- 코드 서명 없음(초기). SmartScreen 경고 가능성을 README에 명시.
- 설치본은 `release/rcloneGUI-Setup-0.1.0.exe`.
- 앱 아이콘/트레이 아이콘은 `build/icon.ico`, `resources/tray.png`. `build/icon.ico`가 없으면
  electron-builder의 `icon` 항목을 제거하고 기본 Electron 아이콘으로 빌드한 뒤 Phase 9에서 교체한다.
- 앱 시작 시 `app.setName('rcloneGUI')`을 `app.getPath('userData')` **호출 전에** 설정하고,
  `app.setAppUserModelId('com.rclonegui.app')`를 설정해 userData 경로와 Windows 알림/작업 표시줄
  식별자를 일치시킨다.
- Windows에서만 NSIS 빌드한다. WSL/Linux 교차 빌드는 지원하지 않는다.
- uninstall 시 userData(job/이력/로그)는 보존한다.

### 17.3 문서

- `README.md`: 요구사항, 설치(rclone), 첫 실행, WSL UNC 예시, Google Drive remote 예시,
  copy/sync 차이, 안전 동작, 데이터 경로, 문제 해결, 개발/빌드/테스트 명령, 알려진 제한.
- `AGENTS.md`: 아키텍처 불변식(샌드박스/검증/원자적 쓰기/셸 금지/안전 게이트), 디렉터리 규칙,
  테스트 명령, 커밋 전 체크리스트. code-asset-index 생성 권장.
- README/AGENTS에는 `npm.cmd run lint`/`format:check` 명령, `.oxlintrc.json`/`.oxfmtrc.json` 위치,
  oxlint type-aware 미사용 사유(TS 7+/`oxlint-tsgolint` 필요)를 기록한다.

---

## 18. 테스트 전략 (요약)

상세 단계/명령/합격 기준은 `IMPLEMENTATION_PLAN.md`에 둔다.

### 18.1 Unit (Vitest, Node)

- diff 엔진: 모든 상태, tolerance 경계, hash 우선순위/fallback, type conflict, case-only/collision.
- 경로: 분류/정규화/루트/중첩/동일, WSL UTF-16 디코드, `/mnt` 변환.
- args builder: 정확한 배열/순서/플래그 생략/`--max-delete`/`--modify-window`.
- log parser: 관측된 skipped/stats/실제/오류/비JSON/부분 라인.
- 안전 게이트 매트릭스, plan token, scheduler(fake clock), store(원자성/손상 복구), schemas.
- shared 경계: `src/shared`가 Node built-in을 import하지 않는지 검사.

### 18.2 Integration (실제 rclone, Windows, 임시 폴더)

- detect/version/config/listremotes.
- lsjson 정상/없는 경로(exit 3, partial stdout 미파싱).
- diff 기대값.
- dry-run 카운트, copy, sync 삭제, `--max-delete 0` 차단, `--modify-window` touch 방지.
- UNC 경로는 WSL 사용 가능 시에만 조건부 실행.
- 실제 사용자 폴더/remote는 절대 사용하지 않는다.

### 18.3 E2E (Playwright Electron)

- 임시 `RCLONEGUI_USER_DATA` + `RCLONEGUI_E2E=1`.
- smoke: 창 표시, 온보딩, job 생성/저장, 재시작 후 유지.
- compare/run: 임시 폴더로 비교→복사→이력(로컬 rclone 필요, 없으면 skip).
- 콘솔 에러 0.

### 18.4 수동 수용 테스트

- WSL UNC → `D:\tmp-rclonegui\acceptance` copy.
- `D:\tmp-rclonegui\acceptance` → 테스트 remote(`gdrive-test:rcloneGUIAcceptance`) sync.
- 삭제 확인/대량 경고/빈 원본 차단/형식 충돌 차단/stale 차단/취소/자동 1분/트레이/로그인 시작.
- 실제 `E:\My Projects`/실제 Drive는 사용자가 명시적으로 요청할 때만.

---

## 19. 리스크와 대응

| # | 리스크 | 영향 | 대응 |
| :--- | :--- | :--- | :--- |
| R1 | Drive/대용량 lsjson이 매우 느리거나 rate limit | 비교 지연/실패 | 진행 phase 표시, 취소, 30분 타임아웃, hash 기본 OFF, fastList 옵션, Post-MVP 스트리밍 |
| R2 | WSL distro 중지/UNC 접근 실패 | 비교/실행 불가 | 명확한 오류 + distro 확인 안내, 자동 시작 안 함 |
| R3 | rclone 버전/로그 형식 차이 | 파서 오류 | 최소 1.65, 비JSON 라인 보존, 관측 fixture 테스트, 알 수 없는 이벤트 무시 |
| R4 | Drive modtime/해시 부재 | 잘못된 동등 판정 | tolerance 2s, 해시 옵션, size-only fallback 경고, preflight 일치 확인 |
| R5 | 형식 충돌/케이스 충돌 | rclone이 예상과 다르게 삭제/복사 | 비교에서 차단, 수동 정리 안내 |
| R6 | 계획 이후 데이터 변경 | 예상 밖 삭제 | stale 10분, plan token, preflight, `--max-delete` backstop |
| R7 | 앱 강제 종료 시 고아 rclone | 의도치 않은 지속 동기화 | active-run.json + 시작 시 PID/이미지 확인 후 종료, interrupted 이력 |
| R8 | JSON 저장소 손상/AV 잠금 | 설정 유실 | 원자적 쓰기, `.bak`, `.corrupt` 보존, 재시도, 사용자 알림 |
| R9 | Electron/TS/도구 호환성 | 빌드 실패 | Electron 45/electron-vite 6/Vite 8/TS 5.9.3 고정, Phase 0 스파이크, TS 7 전환은 별도 검증 후 |
| R10 | npm 9 + Node 24 + native binding | 설치/스크립트 실패 | `npm.cmd`, `cmd.exe` 경유, optional deps 확인, 문제 시 npm 11 업그레이드(승인) |
| R11 | 샌드박스 preload 제약 | preload 로드 실패 | CJS 단일 번들, electron API만 사용, Buffer/Node 전역 미사용 |
| R12 | `--ignore-errors`로 오류 무시 삭제 | 데이터 손실 | 기본 OFF, 수동 추가 확인, 자동 실행 차단 |
| R13 | 자동 실행이 사용자 의도와 다르게 삭제 | 데이터 손실 | allowDeletes opt-in, maxDeletes, 빈 원본/충돌 차단, 알림 |
| R14 | 트레이/로그인 시작 혼동 | 자동 동기화 중단/미실행 | 트레이 안내, 설정 상태 표시, `--hidden` 처리 |
| R15 | 긴 경로/유니코드/예약 이름 | rclone 오류 | 오류 그대로 표시, 경로 길이 경고, NFC 비교 키 |
| R16 | 실제 remote 이름/환경 차이 | 감지 실패 | 하드코딩 금지, 수동 입력/테스트, 설정 override |
| R17 | oxfmt 0.x API/포맷 변경 | 대규모 포맷 diff/빌드 실패 | 정확한 버전 고정(0.75.0), 업그레이드 시 `format:check` diff 리뷰, Prettier 3.9.9 기준 호환 |
| R18 | oxlint 규칙 커버리지/오탐 | ESLint 대비 린트 공백 또는 과도한 경고 | correctness+핵심 플러그인만 활성, `tsc`로 타입 검사 보완, 필요한 규칙만 명시, JS 플러그인은 승인 후 |

---

## 20. 가정/열린 결정

Intent의 열린 질문에 대한 MVP 결정:

| 질문 | 결정 |
| :--- | :--- |
| 앱 이름 | **rcloneGUI** |
| 자동 동기화 1차 업그레이드 | interval scheduler → (Post-MVP) watcher → bisync |
| Google Drive OAuth | rclone에 위임, in-app OAuth 없음, reconnect 안내 |
| 해시 정책 | job 옵션, 기본 OFF, `--checksum`과 동일 규칙(size-only fallback) |
| 대용량 성능 | 2만 비교 60초, 5만 UI 목표; 20만 초과는 Post-MVP |
| Windows 외 플랫폼 | MVP 미지원 |
| TypeScript 7.x / oxlint type-aware | MVP는 TS 5.9.3 + non-type-aware oxlint 유지. TS 7 전환은 Vite/electron-vite/React 타입 호환 확인 후 Post-MVP |
| 선택 항목 복사 | Post-MVP (의도된 범위 축소) |
| 빈 디렉터리 | MVP 미표시, sync 시 정리 가능 안내 |

남은 사용자 결정(구현 전 확인 불필요, 기본값으로 진행):
- 실제 remote 이름/테스트 remote 경로
- 앱 아이콘/브랜딩 최종 디자인
- 코드 서명 인증서 도입 시점

---

## 부록 A. 실측 근거 (2026-10-27 ~ 2026-10-28)

| 항목 | 관측 결과 | 설계 반영 |
| :--- | :--- | :--- |
| rclone | `v1.75.1`, Windows amd64, PATH 존재 | 최소 1.65, 1.75.1 검증 |
| config | `C:\Users\LG\AppData\Roaming\rclone\rclone.conf` | `rclone config file` 파싱 |
| listremotes | `gdrive-test:` (콜론 포함) | trailing colon 제거 |
| lsjson | stdout 순수 JSON 배열, `Path/Size/ModTime/Hashes` | 전체 배열 파싱, hash lowercase |
| 없는 경로 | exit 3, stdout에 `[` 일부, stderr 오류 | exit code 우선, stdout 파싱 금지 |
| JSON dry-run | stderr 각 줄 JSON, skipped copy/delete/touch, stats 객체 | 라인 파서 + stats 정규화 |
| `--modify-window` | 2s 지정 시 동일 파일 touch 이벤트 사라짐 | UI/실행 동일 tolerance 적용 |
| `--max-delete 0` | 삭제 0건 강제, 초과 시 오류 | 계획 0도 backstop |
| `--max-delete 1` | 1건 삭제 후 exit 7, fatal | 계획 수 전달 + exit 7 처리 |
| `--ignore-errors` | 도움말: "Delete even if there are I/O errors" | 기본 OFF/추가 확인 |
| `--checksum` | 해시 없으면 size-only fallback | diff 규칙 일치 |
| WSL `-l -q` | UTF-16LE(NUL/CRLF) | utf16le 디코드 |
| UNC lsjson | `\\wsl.localhost\Ubuntu\...` 정상 | UNC 지원 |
| `rclone size --json` | `{count,bytes,sizeless}` | 참고 관측(빈 원본 판정은 비교 엔진 사용) |
| Electron 45 | Chromium 156, Node 24.22.0, MVP는 Windows x64 | 버전/타입 고정 |
| oxlint | npm `1.90.0`(2026-10-27), Node `^20.19 \|\| >=22.12`, Windows x64 binding | `.oxlintrc.json`, `--deny-warnings` |
| oxfmt | npm `0.75.0`(2026-10-27), Prettier 3.9.9 호환, 기본 `printWidth` 100 | `.oxfmtrc.json`, `printWidth: 80`, `--check` |
| 샌드박스 preload | ESM import 불가, Node 전역 없음 | CJS 단일 번들, electron API만 |
| `openAsHidden` | Electron 44에서 제거 | `--hidden` args로 대체 |

---

## 부록 B. 용어

| 용어 | 의미 |
| :--- | :--- |
| 원본(source) | 복사/동기화의 기준 폴더/remote |
| 대상(destination) | 복사/동기화가 적용되는 폴더/remote |
| copy | 원본의 신규/변경 파일을 대상에 반영, 대상에만 있는 파일은 유지 |
| sync | copy + 대상에만 있는 파일 삭제 |
| 계획(plan) | 비교 결과에서 계산한 신규/갱신/삭제/바이트 요약 |
| preflight | 실제 실행 직전 dry-run으로 계획 일치를 확인하는 단계 |
| stale | 비교 후 시간 경과/설정 변경으로 계획을 신뢰할 수 없는 상태 |
| type conflict | 같은 경로가 한쪽은 파일, 다른 쪽은 디렉터리(하위 파일 존재)인 상태 |
| case-only | 양쪽 경로가 대소문자만 다른 상태 |
| noop | 자동 실행에서 변경이 없어 rclone을 실행하지 않은 결과 |
