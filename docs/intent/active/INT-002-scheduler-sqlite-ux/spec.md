# Spec: rcloneGUI 스케줄·SQLite·리모트/제외 패턴 UX 개선

- Intent: [INT-002](intent.md) | Status: active | 작성일: 2026-10-29

> 이 spec은 intent를 구현할 수 있는 수준으로 풀어 쓴 문서다. 내용이 서로 다르면 intent가 우선한다.
> 심볼과 경로는 커밋 `53e7388` 기준이다. Phase 1(T-01) 구현분은 아직 커밋하지 않았고 작업 트리에만 있다.

## 1. 개요

rcloneGUI(INT-001 완료본)의 데이터 저장 방식과 작업 흐름 UX를 1차로 개선한다.

| 영역 | 지금 | 목표 |
| :--- | :--- | :--- |
| 저장 | `jobs.json`·`settings.json`·`history.json`(`clsJsonStore`) | SQLite 파일 하나(`rclonegui-store.sqlite`, `node:sqlite`)로 합친다. JSON은 한 번만 이전한다 |
| 제외 패턴 | 작업마다 한 줄 입력(`ExcludesEditor`, `zExcludes` 최대 100개) | 전역 패턴 라이브러리에서 체크박스로 고른다. 한 줄 입력도 남긴다. 많으면 `--exclude-from`으로 넘긴다 |
| 리모트 | `RemotePicker`로 `이름:`만 넣는다 | 북마크(remote 이름 + 기준 경로 + 별칭)를 등록하고 폴더를 탐색한다 |
| 동기화 범위 | 파일만(`lsjson --files-only`, rclone 기본) | 작업마다 `전체`(빈 폴더 포함) 또는 `파일만`을 고른다 |
| 작업 목록 | 이름·모드·자동 배지·마지막 실행(`JobSidebar`) | 원본·대상·자동화·주기·최근 동기화·상태 텍스트를 보여 주고, 목록에서 바로 실행한다 |
| 스케줄 | 분 단위 주기만(`zAutoSyncInput.intervalMinutes`) | 주기·매일 HH:MM·요일. 트레이에서 종료할 때와 로그인 시 시작이 꺼져 있을 때 경고한다 |
| 실행 화면 | 헤더 버튼과 탭(비교·실행·이력·작업 설정)이 섞여 있다 | 비교·미리보기 → 실행 → 결과·이력 순서로 나누고, 중지는 실행 제어 하나로 합친다. 용어도 손본다 |
| 옵션 검증 | 길이 제한이 들쭉날쭉하다(경로 4096, 패턴 512×100) | 옵션마다 최대 길이를 두고 명령 전체 길이를 검사한다. 빈 값은 "rclone.conf 값 사용"으로 표시한다 |
| 수용 | 로컬 임시 폴더만 쓴다 | 전용 GCS 테스트 remote로 수용 테스트를 한다(키가 없으면 skip) |

P3로 미룬 것: Windows 작업 스케줄러·헤드리스 `--run-job`(T-13), 백업 없는 sync `--ignore-errors`(T-07), `폴더만` 범위, WSL cron.

## 2. 범위 (In-scope / Out-of-scope)

### 2.1 In-scope
- T-01 SQLite 저장 계층(스키마 v1, JSON 이전, 백업, 손상 복구, 이력 페이지 조회)
- T-02 리모트 북마크 CRUD, 읽기 전용 연결 테스트, 폴더 탐색
- T-03 제외 패턴 라이브러리
- T-09 옵션 길이 검증, `--exclude-from`, "rclone.conf 값 사용" 표시
- T-05 동기화 범위(`전체`/`파일만`)
- T-04 작업 목록 확장, 목록에서 실행
- T-06 앱 스케줄러 보완(매일·요일), 종료·로그인 안내, `/mnt` 변환 확인
- T-08 실행 화면 재구성, 용어 검토
- T-10 GCS 수용 테스트
- T-11 배포 형태 확인
- T-12 문서

### 2.2 Out-of-scope
- T-07, T-13(P3 보류). 착수하면 intent의 "P3 OS 예약·`--ignore-errors` 착수 시 적용" 절을 따른다.
- `rclone config create/update/delete`와 rclone.conf 쓰기. rclone.conf 읽기(`config dump` 포함)도 하지 않는다.
- cron 5필드 스케줄, `폴더만` 범위, portable exe.
- 안전 규칙 1~6 변경.

## 3. 영향 시스템 · 모듈 · 데이터

| 영역 | 파일(커밋 기준) | 영향 |
| :--- | :--- | :--- |
| 저장 | `src/main/store/{job,settings,history,json}-store.ts` | T-01에서 내부를 DB로 바꾼다(public API 유지). 새 파일: `sqlite-db.ts`·`db-schema.ts`·`json-import.ts`·`app-db.ts` |
| 시작 순서 | `src/main/index.ts` (`f_Start`, `f_RequestQuit` 256행, `setLoginItemSettings` 152행, `HIDDEN_ARG` 76행) | 창을 띄우기 전에 DB를 연다(T-01). 종료 경고를 넣는다(T-06) |
| 스키마 | `src/shared/schemas/job.ts` (`zExcludes` max 100·512자, `zPathInput` max 4096, `zAutoSyncInput`), `settings.ts` (`zJobDefaults.excludes`, `ui`), `history.ts` | 범위·스케줄·패턴 참조·표시 설정 필드를 추가한다. 길이 제한을 바꾼다 |
| IPC | `src/shared/ipc-contract.ts` `IPC_CHANNELS`(30개), `itfRcloneGuiApi` | 채널 추가: `remotes:*`, `excludes:*`, `rclone:listDir` |
| 명령 빌더 | `src/main/rclone/command-builder.ts` (`ALLOWED_COMMANDS` 79행: version·config file·listremotes·lsjson·copy·sync, `BLOCKED_FLAGS` 31행, `buildProbeListArgs` 130행, `buildLsjsonArgs` 160행 `--files-only`, `buildTransferArgs` 189행, `f_PushCommon` 218행 `--exclude P`) | `--exclude-from`, `--create-empty-src-dirs`, 폴더 목록 인자를 넣는다. 허용 명령은 늘리지 않는다 |
| 계획 토큰 | `src/main/services/plan-token.ts` `computePlanToken` (`excludes` 포함) | 패턴 스냅샷 해시와 범위를 넣는다 |
| 비교 | `src/main/services/compare-service.ts` (`cache` Map, `invalidate(jobId)` 243행), `src/shared/diff-engine.ts`(파일 5상태) | 범위 `전체`일 때 폴더도 비교한다. 패턴 변경 시 캐시를 무효화한다 |
| 실행 | `src/main/services/run-service.ts` (`start` 310행, `startAuto` 340행, `spawnTransfer` 753행), `src/shared/run-gates.ts` | 게이트는 바꾸지 않는다. 목록 실행도 같은 경로를 탄다 |
| 스케줄 | `src/shared/schedule.ts` (`nextRunAfterEdit`·`reconcileNextRun`, 분 단위), `src/main/services/scheduler.ts` (20초 tick, `startAuto`) | 매일·요일 계산을 넣는다 |
| 트레이 | `src/main/tray.ts` (메뉴 "종료" → `onQuit`) | 자동 작업이 있으면 종료 전에 경고한다 |
| 화면 | `src/pages/JobSidebar.tsx`, `JobEditor.tsx`, `PathField.tsx`, `RemotePicker.tsx`, `ExcludesEditor.tsx`, `JobWorkspace.tsx`(탭 51~54행), `RunView.tsx`, `CompareView.tsx`, `SettingsPage.tsx`, `HistoryView.tsx` | T-02·T-03·T-04·T-08 |
| 공용 컴포넌트 | `src/components/ZBC*` (Badge·Button·Checkbox·Field·Input·Modal·Select·Tabs·Textarea·Toast) | 체크박스 목록·트리 탐색에 재사용한다. 새로 만들면 `ZBC` 규칙을 따른다 |
| 화면 상태 | `src/stores/*-store.ts` (zustand) | remotes·excludes store를 추가한다 |
| 테스트 | `tests/unit`, `tests/integration`(`run-harness.ts`), `tests/e2e`(`app-harness.ts`, smoke·compare-copy·migration), `scripts/probes/rclone-probes.mjs` | 각 Phase |
| 데이터 | `%APPDATA%\rcloneGUI\` (`rclonegui-store.sqlite`, `db-backups\`, `*.json.migrated`, `active-run.json`, `logs\`, `runs\`) | 이 앱이 만들지 않은 `rclonegui.db`가 이미 있다. 열지 않고 건드리지 않는다 |

## 4. 기능 요구사항 (FR-n)

### T-01 SQLite
- **FR-1** 작업·설정·이력은 `userData/rclonegui-store.sqlite`에 저장한다. 리모트·제외 패턴·스케줄 테이블은 스키마 v1에 만들어 둔다.
- **FR-2** 처음 시작할 때 JSON 3종을 트랜잭션 하나로 가져온다. COMMIT한 뒤 `X.json`은 `X.json.migrated`로, `X.json.bak`은 `X.json.bak.migrated`로 이름을 바꾸고, `meta.json_import`에 표시를 남긴다. 표시가 있으면 다시 가져오지 않는다.
- **FR-3** 시작할 때 `integrity_check`를 한다. 손상(CORRUPT/NOTADB 또는 결과가 ok가 아님)이면 파일을 `.corrupt-<시각>`으로 옮기고 정상 백업에서 복구한다. 쓸 백업이 없으면 새 DB로 시작한다. 어느 쪽이든 알림을 띄운다.
- **FR-4** 스키마를 바꾸기 전과 하루에 한 번 `VACUUM INTO`로 `db-backups\`에 백업한다. daily 백업은 5개만 남긴다.
- **FR-5** 이력은 `history.list({ jobId?, limit?, offset? })`로 페이지 단위로 조회한다.
- **FR-6** DB가 앱보다 새 버전(`user_version`이 더 큼)이면 DB를 건드리지 않고 오류 창을 띄운 뒤 종료한다.

### T-03 제외 패턴 + T-09 길이·`--exclude-from`
- **FR-7** 제외 패턴은 전역 테이블에 하나씩만 저장한다. 앞뒤 공백 제거와 완전 중복 제거만 하고, 유니코드 정규화는 하지 않는다. 줄바꿈과 제어문자가 들어 있거나, `#`·`;`로 시작하면 저장하지 않는다.
- **FR-8** 작업 편집기에서 패턴을 체크박스로 여러 개 고르고, 새 패턴을 추가하고, 기존 한 줄 입력(작업 전용 패턴)도 쓸 수 있다. 실행 때 쓰는 패턴은 고른 전역 패턴과 작업 전용 패턴의 합집합이다(중복 제거, 순서 고정).
- **FR-9** 전역 패턴을 고치거나 지울 때는 그 패턴을 쓰는 작업 목록을 보여 준다. 자동 실행 작업은 따로 강조하고, 확인을 받는다. 확인하면 해당 작업의 비교 캐시를 무효화한다(`compare-service.invalidate`).
- **FR-10** 실행 시점의 패턴 스냅샷 해시를 계획 토큰에 넣는다. 비교한 뒤 패턴이 바뀌면 실행을 막는다.
- **FR-11** 패턴 수나 명령 길이가 기준을 넘으면 `--exclude-from <임시 파일>`로 넘긴다. 파일 조건은 userData 앱 폴더, `wx` 배타 생성, UTF-8(BOM 없음), LF, 빈 줄 없음이다. 실행이 끝나면 지운다. `--filter-from`은 쓰지 않는다.
- **FR-12** 옵션 값의 길이가 한도를 넘으면 저장을 막고 필드별 오류를 보여 준다. 한도는 경로 1024, 패턴 한 줄 512·최대 500개, 일반 문자열 256이다. 숫자·크기·시간은 형식을 검사한다. 명령 전체 길이(Windows 32,767자)도 검사한다(§10 Q1 참고).
- **FR-13** remote 옵션을 비워 두면 화면에 "rclone.conf 값 사용"이라고 표시한다. remote 종류는 `rclone listremotes --long`으로 알아낸다.

### T-02 리모트 북마크
- **FR-14** 리모트 북마크(별칭·remote 이름·기준 경로)를 추가·수정·삭제한다. remote 이름은 `listremotes`에 있는 것만 고를 수 있다. 영문 한 글자 remote는 지금처럼 막는다(`remote-name.ts`).
- **FR-15** 연결 테스트는 기존 `buildProbeListArgs`(`lsjson --max-depth 1 --ask-password=false`)를 다시 쓴다. 새 rclone 하위 명령은 넣지 않는다.
- **FR-16** 작업 편집기 경로 필드에서 북마크를 고르고, 폴더를 한 단계씩 탐색해 고른다. 결과는 `remote:기준경로/하위`로 경로에 들어간다.
- **FR-17** 탐색과 연결 테스트는 한 번에 하나만 돈다. 실행이나 비교가 같은 remote를 쓰고 있으면 BUSY로 막는다(OAuth 토큰 갱신 경합 방지).

### T-05 동기화 범위
- **FR-18** 작업에 `scope: "all" | "files"`를 두고 기본값은 `files`(현재 동작)로 한다. `all`이면 비교 목록에 폴더를 넣고(`--files-only` 빼기), 실행에 `--create-empty-src-dirs`를 붙인다.
- **FR-19** 범위는 diff, 미리보기, 실행, 삭제 확인, `autoMaxDeletes`, 계획 토큰에 똑같이 들어간다. sync `all`에서 대상의 빈 폴더가 지워진다면 삭제 수에 들어가야 한다(probe로 확인).

### T-04 작업 목록
- **FR-20** 목록 항목에 이름, 원본 → 대상(줄임 표시, 전체는 title), 모드, 자동 여부, 스케줄 요약, 최근 동기화 시각, 상태 텍스트를 보여 준다. 상태 텍스트는 설정 `ui.showJobStatusText` 체크박스로 켜고 끈다.
- **FR-21** 목록에서 실행하면 수동은 비교 → (삭제가 있으면) 삭제 확인 모달 → `run.start` 순서로, 자동 예약 작업의 "지금 실행"은 `startAuto` 게이트로 간다. 확인 없이 실제 전송하는 경로는 없다.

### T-06 스케줄
- **FR-22** 스케줄 종류는 `interval`(분, 1~10080), `daily`(HH:MM), `weekly`(요일 비트 + HH:MM)다. 로컬 시간대로 계산하고 UTC ISO로 저장한다. cron은 받지 않는다.
- **FR-23** 자동 실행 작업이 하나라도 켜져 있을 때 트레이 "종료"를 누르면 "다음 예약: <작업> <시각> — 종료하면 실행되지 않습니다"라는 확인을 띄운다.
- **FR-24** `ui.launchAtLogin`이 꺼져 있는 상태에서 자동 실행 작업을 저장하면, 로그인 시 시작을 켜라는 안내를 한 번 띄운다.
- **FR-25** `/mnt/x/...`는 실행할 때 기존 경로 변환으로 `X:\...`가 되는지 테스트로 확인한다.

### T-08 실행 화면
- **FR-26** 작업 화면을 ① 비교·미리보기 → ② 실행 → ③ 결과·이력 순서로 묶는다. 중지는 실행·비교 중에 나타나는 공통 컨트롤 하나로 한다.
- **FR-27** 화면 문구를 전부 검토해 "일어날 일" 표현으로 바꾼다(AGENTS.md 4.1).
- **FR-28** sync에서 오류 무시를 고르면 "백업 폴더를 지정하면 오류를 무시하고 진행할 수 있습니다"라고 안내하고 백업 필드로 옮겨 준다.

### T-10·T-11·T-12
- **FR-29** 테스트 conf 경로를 환경 변수로 받는다. remote나 버킷 경로가 `rclonegui-test-`로 시작하지 않으면 테스트를 거부한다. 실행마다 고유 하위 경로를 쓰고 끝나면 정리한다. copy·sync·삭제·취소를 확인한다.
- **FR-30** 배포 형태는 NSIS 설치본 하나다. portable은 만들지 않는다. 설치 스모크를 통과해야 한다.
- **FR-31** README·AGENTS·MVP_SPEC·CHANGELOG에 바뀐 저장·스케줄·범위·리모트·패턴 동작을 반영한다.

## 5. 비기능 요구사항 (NFR-n)

- **NFR-1 안전 규칙 유지:** `execFile`/`spawn` + `shell:false`를 쓴다. 실제 전송은 `spawnTransfer`에서만 시작한다. `ALLOWED_COMMANDS`는 늘리지 않는다. `BLOCKED_FLAGS`는 그대로 둔다.
- **NFR-2 main 스레드:** `node:sqlite`는 동기 API다. 작업·설정은 메모리 캐시로 다루고, 이력은 LIMIT/OFFSET과 인덱스로 조회한다. 이전·integrity·백업은 창을 띄우기 전에 한 번만 한다.
- **NFR-3 어댑터 격리:** `node:sqlite` import는 `src/main/store/sqlite-db.ts`에만 둔다(경계 테스트로 강제). Electron을 올릴 때마다 어댑터 테스트를 다시 돌린다.
- **NFR-4 SQL 안전:** 모든 쿼리는 prepared statement와 이름 있는 파라미터로 한다. 정렬 컬럼이나 `json_extract` 경로를 입력값으로 조립하지 않는다.
- **NFR-5 비밀 정보:** DB·로그·fixture에 자격 증명, rclone.conf 내용, 버킷명, 키 경로를 넣지 않는다.
- **NFR-6 동시성:** 폴더 탐색과 연결 테스트는 직렬로 한다. 전역 활동 락(`activity-lock.ts`)과 충돌 규칙을 명확히 한다.
- **NFR-7 컨벤션:** TS strict, `any` 금지, zod, `@/`, 접두사 규칙, LF, 신규 파일 JSDoc을 지킨다.
- **NFR-8 성능:** 작업 목록 100개, 이력 5000건에서 목록 렌더링과 이력 첫 페이지 조회가 체감 지연 없이(< 100ms) 끝나야 한다.

## 6. 인터페이스 · 데이터 스키마

### 6.1 확정/초안 상태

| 항목 | 상태 |
| :--- | :--- |
| DB 파일명, 스키마 v1 DDL, `clsSqliteDb`·`migrateSchema`·`importLegacyJson`·`openAppDb` 시그니처 | **확정(구현 완료, 미커밋)** |
| v2 이후 마이그레이션(작업-패턴 연결, 범위, 스케줄 이전) | 초안 |
| IPC `remotes:*`, `excludes:*`, `rclone:listDir` | 초안 |
| 작업 스키마 추가 필드 | 초안 |

### 6.2 스키마 v1 (확정)
테이블은 `meta`, `settings`(id=1 단일 행, JSON), `jobs`(seq, id UNIQUE, name, rev, created_at, updated_at, data JSON), `run_records`(seq, id UNIQUE, job_id, status, started_at, log_file, data JSON; 인덱스 `(job_id, seq DESC)`, 부분 인덱스 `status='running'`), `remotes`, `exclude_patterns`(pattern UNIQUE, 길이 1~512, CR/LF 금지 CHECK), `schedules`(job_id FK CASCADE, kind interval/daily/weekly)다. 모든 테이블은 STRICT다. T-01에서 `autoSync`는 `jobs.data` 안에 그대로 둔다.

### 6.3 스키마 v2 이후 (초안)
- **v2 (T-03):** `job_exclude_patterns(job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE, pattern_id TEXT REFERENCES exclude_patterns(id) ON DELETE RESTRICT, PRIMARY KEY(job_id, pattern_id)) STRICT`. 패턴 삭제는 RESTRICT로 막고, 앱이 확인한 뒤 연결부터 지운다. `exclude_patterns.pattern` CHECK에 `substr(pattern,1,1) NOT IN ('#',';')`를 더한다. 기존 데이터에 `#`·`;` 패턴이 있을 수 있으므로 v2 전에 검사하고, 있으면 작업 전용 패턴으로 남긴 채 알린다.
- **v3 (T-06):** `jobs.data.autoSync`를 `schedules`로 옮긴다. 이후 `schedules`가 단일 진실 공급원이 된다.
- 작업 범위(`scope`)는 `jobs.data` JSON 필드로 넣고 zod 기본값을 `files`로 둔다. DDL 변경은 없다.

### 6.4 작업 스키마 (초안, `src/shared/schemas/job.ts`)
```ts
zJobDraft.extend({
    scope: z.enum(["all", "files"]).default("files"),        // T-05
    excludePatternIds: z.array(z.uuid()).max(500).default([]), // T-03 (DB에서는 연결 테이블)
    // excludes(작업 전용 한 줄 입력)는 유지
    autoSync: zAutoSyncInput.extend({                         // T-06
        kind: z.enum(["interval", "daily", "weekly"]).default("interval"),
        timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
        weekdays: z.number().int().min(0).max(127),            // bit0 = 일요일
    }),
})
```

### 6.5 IPC (초안, `IPC_CHANNELS`에 추가)
| 채널 | 입력 | 출력 |
| :--- | :--- | :--- |
| `remotes:list` / `create` / `update` / `delete` | 북마크 zod | `typRemoteBookmark[]` / 1건 |
| `remotes:test` | `{ id }` | `itfPathProbe` (기존 형식 재사용) |
| `rclone:listDir` | `{ path, configPath? }` | `{ name, isDir }[]` (폴더만, `lsjson --max-depth 1 --dirs-only`) |
| `excludes:list` | — | `{ id, pattern, usedBy: { jobId, jobName, auto }[] }[]` |
| `excludes:create` / `update` / `delete` | `{ pattern }` / `{ id, pattern, confirmed }` / `{ id, confirmed }` | 1건 / null. 사용 중인데 `confirmed`가 아니면 `CONFIRM_REQUIRED` + 사용 작업 목록 |

응답은 모두 `{ ok, data } | { ok:false, error }` 형식이다(AGENTS.md 4.6).

### 6.6 계획 토큰 (`itfPlanTokenInput`, 초안)
기존 입력에 `scope`와 `excludeSnapshotHash`(실제로 쓰는 패턴 목록 + `--exclude-from` 사용 여부의 sha256)를 더한다.

### 6.7 설정 (초안, `zSettings.ui`)
`showJobStatusText: boolean`(기본 true), `launchAtLoginHintShown: boolean`. 기존 settings 행은 `deepMerge(createDefaultSettings(), parsed)`가 기본값을 채워 준다.

## 7. 예외 · 엣지 케이스

| # | 상황 | 처리 |
| :--- | :--- | :--- |
| E-1 | JSON 이전 중 디스크 오류 | ROLLBACK한다. JSON은 원래 이름 그대로 둔다. 오류 창을 띄우고 종료하며, 다음 시작 때 다시 시도한다 |
| E-2 | 구버전으로 내렸다가 다시 올림(표시가 있는데 원래 이름 JSON도 있음) | 가져오지 않고 파일도 그대로 둔다. 경고 알림을 띄운다 |
| E-3 | `rclone.conf`가 암호화돼 있음 | 연결 테스트·탐색이 `--ask-password=false`로 실패한다. "암호화된 rclone.conf는 지원하지 않습니다"라고 표시한다 |
| E-4 | `#tmp`처럼 `#`·`;`로 시작하는 기존 패턴 | 파일 방식에서는 주석으로 빠지므로 작업 전용 인자 방식(`--exclude`)으로 남긴다. 라이브러리 저장은 막는다 |
| E-5 | 전역 패턴을 지움 → sync 삭제 범위가 늘어남 | 사용 작업과 자동 작업을 표시하고 확인을 받는다. 캐시를 무효화하고 계획 토큰이 바뀌어 이전 비교로는 실행되지 않는다 |
| E-6 | `전체` 범위 + GCS 버킷(폴더 없음) | probe 결과에 따라 안내 문구를 띄우거나 `전체`를 막는다 |
| E-7 | 실행 중에 같은 remote 탐색 | BUSY로 거부하고 문구를 보여 준다 |
| E-8 | 매일 02:30 + DST 또는 시간대 변경 | 로컬 시간대로 다음 시각을 다시 계산한다. 절전 재개·시작 때는 `reconcileNextRun` 규칙(몰아서 따라잡지 않음)을 따른다 |
| E-9 | 자동 작업이 없을 때 트레이 종료 | 지금처럼 바로 종료한다(실행 중 확인은 그대로) |
| E-10 | 길이를 줄이면서 이미 저장된 작업이 새 한도를 넘음 | 로드는 허용한다. 편집하고 저장할 때만 막는다(§10 Q1) |
| E-11 | `--exclude-from` 임시 파일이 남음(강제 종료) | 시작할 때 앱 전용 폴더의 남은 파일을 지운다 |
| E-12 | 폴더 탐색 결과가 아주 많음 | 한 단계(`--max-depth 1`)씩만 읽는다. 표시 개수에 상한을 두고 "N개 더" 표시를 한다 |

## 8. 수용 기준 (AC-n)

- **AC-1 (T-01)** v1 JSON fixture가 있는 임시 userData로 앱을 시작하면 사이드바에 fixture 작업이 같은 순서로 보이고, 이력 개수가 같다. `*.json.migrated`가 생기고, 다시 시작해도 중복이 없다.
- **AC-2 (T-01)** 이전 트랜잭션이 실패하면 JSON 파일 이름이 그대로이고 DB에 작업 0건, 표시 없음 상태다.
- **AC-3 (T-01)** DB 2번째 페이지가 손상된 상태로 시작하면 `.corrupt-*`가 생기고 최신 정상 백업으로 복구되며 알림이 1건 뜬다.
- **AC-4 (T-01)** 같은 폴더의 `rclonegui.db`는 바이트와 mtime이 바뀌지 않는다.
- **AC-5 (T-03)** 패턴 3개를 체크해 저장한 작업은 비교와 실행에서 세 패턴이 모두 적용된다. 그중 하나를 전역에서 지우면 사용 작업 목록이 있는 확인 창이 뜨고, 확인한 뒤 이전 비교 결과로 실행하면 `PLAN_STALE`류로 거부된다.
- **AC-6 (T-03)** `#a`, `;a`, `a\nb`, 앞뒤 공백만 다른 중복 패턴은 저장이 거부되거나 하나로 합쳐진다.
- **AC-7 (T-09)** 패턴 600개를 가진 작업은 저장이 막힌다. 패턴 200개는 `--exclude-from`으로 실행되고, 인자 방식과 비교·전송 결과가 같으며(probe), 끝나면 임시 파일이 없다.
- **AC-8 (T-02)** 북마크 `test-remote:base`를 등록하고 연결 테스트를 하면 `lsjson --max-depth 1 --ask-password=false`만 실행된다. 폴더를 두 단계 탐색해 고르면 경로 필드에 `test-remote:base/a/b`가 들어간다.
- **AC-9 (T-05)** 빈 폴더가 있는 원본에서 `전체` 범위로 copy하면 대상에 빈 폴더가 생기고, `파일만`이면 생기지 않는다. sync `전체`에서 대상에만 있는 빈 폴더가 삭제 수에 들어간다(probe 결과를 반영).
- **AC-10 (T-05)** 범위를 바꾸면 기존 비교 결과로는 실행할 수 없다(계획 토큰이 바뀜).
- **AC-11 (T-04)** 목록에 원본·대상·자동·스케줄·최근 동기화가 보인다. 상태 텍스트 설정을 끄면 숨겨진다. 삭제가 있는 sync를 목록에서 실행하면 삭제 확인 모달을 거쳐야 실행된다.
- **AC-12 (T-06)** "매주 월·수 09:00" 작업의 다음 실행 시각이 로컬 기준으로 맞게 계산된다(단위 테스트, 시간대 고정). 자동 작업이 있을 때 트레이 종료를 누르면 다음 예약이 적힌 확인 창이 뜬다.
- **AC-13 (T-08)** 작업 화면에서 비교·미리보기·실행·결과 영역이 위에서 아래(또는 단계 탭) 순서로 보이고, 중지 버튼은 하나만 있다. E2E에서 콘솔 오류는 0건이다.
- **AC-14 (T-10)** 테스트 conf 환경 변수가 없으면 skip하고 이유를 출력한다. 접두사가 다르면 실행을 거부한다. 있으면 copy·sync·삭제·취소 4개 시나리오가 통과하고 원격 하위 경로가 정리된다.
- **AC-15 (T-11)** `pnpm run build:win`과 `pnpm run smoke:installer`가 통과하고 `dist/`에는 NSIS 설치본만 있다.
- **AC-16 (공통)** Phase마다 `pnpm run check`, `format:check`가 통과한다. 빌더·파서를 바꾸면 `test:int`, 화면을 바꾸면 `test:e2e`도 통과한다.

## 9. 가정과 리스크

### 9.1 가정
- 사용자는 단일 Windows 사용자이며 single-instance 락 때문에 DB 동시 접근은 없다.
- Electron 45의 `node:sqlite`(SQLite 3.53.4)가 계속 플래그 없이 동작한다. probe에서 확인했다.
- GCS 테스트 버킷과 서비스 계정은 사용자가 따로 준비한다. 없으면 T-10은 skip한다.

### 9.2 리스크
| 리스크 | 영향 | 대응 |
| :--- | :--- | :--- |
| `node:sqlite` API가 바뀜 | 시작 실패 | 어댑터 한 파일, 경계 테스트, Electron 업그레이드 때 다시 테스트 |
| 구버전으로 내리면 빈 목록 | 사용자 혼란 | README "SQLite 이전과 되돌리기"(T-01에서 작성) |
| 전역 패턴 변경이 sync 삭제 범위를 바꿈 | 데이터 손실 | 확인 창, 자동 작업 강조, 계획 토큰, 캐시 무효화 |
| `--exclude-from` 주석 처리 차이 | 삭제 대상이 바뀜 | `#`·`;` 차단, probe로 결과가 같은지 확인 |
| `전체` 범위에서 폴더 삭제가 삭제 수에서 빠짐 | 확인 없이 삭제 | probe를 먼저 하고, 빠지면 diff에 폴더 삭제를 넣거나 `전체` + sync를 막음 |
| 화면 재구성(T-08)으로 E2E 셀렉터가 깨짐 | 회귀 | 역할·이름·id 셀렉터를 유지하고 E2E를 같은 Phase에서 갱신 |

## 10. 미해결 질문 (Open questions)

- [x] **Q1 경로 길이 1024 vs 현재 4096:** 경로 입력·읽기 모두 4096자로 유지한다. Windows 확장 경로·깊은 UNC 경로를 1024자로 막으면 기존 작업을 다른 옵션만 고쳐도 저장할 수 없다. 명령 전체 길이는 `assertCommandLength`가 계속 검사한다. (2026-10-30 결정)
- [x] **Q2 패턴 최대 500개 vs `zExcludes` max 100:** 작업 전용 한 줄 입력은 100개, 공용 선택 + 작업 전용 합계는 500개(`EXCLUDES_TOTAL_MAX`)를 유지한다. (2026-10-30 결정)
- [x] **Q3 `settings.defaults.excludes`와 라이브러리:** 문자열 배열 그대로 둔다. 라이브러리가 비어 있어도 기본 패턴이 동작하고, 공용 패턴 삭제 시 settings JSON까지 정리할 필요가 없다. (2026-10-30 결정)
- [x] **Q4 `전체` 범위의 폴더 비교:** 파일 diff 5상태에 섞지 않고 빈 폴더 생성·삭제를 `createDirs`·`deleteDirs`로 따로 센다. `--max-delete`는 파일 삭제만 세므로 폴더 삭제를 합산하면 안전 백스톱이 느슨해진다. 사전 확인 dry-run도 파일·폴더를 각각 대조한다. (2026-10-30 결정)
- [x] **Q5 폴더 탐색 명령:** `buildListDirsArgs`를 만들어 `lsjson --max-depth 1 --dirs-only --ask-password=false`를 쓴다. `ALLOWED_COMMANDS`는 늘리지 않는다. (2026-10-30 결정)
- [x] **Q6 "기타:상태칩대로" 문구:** `src/`에 없으므로 T-08에서 UI 문자열 전수 목록을 만들어 검토한다. (2026-10-30 결정)
- [x] **Q7 목록 실행의 "지금 실행":** 목록 버튼은 자동 설정과 무관하게 항상 수동 흐름(비교 → 필요 시 삭제 확인 → `run.start`)으로 통일하고, `startAuto`는 스케줄러 전용으로 둔다. (2026-10-30 결정)
- [x] **Q8 `schedules` 테이블 이전 시점:** T-06에서도 `jobs.data.autoSync`를 유지하고 v3 이전은 하지 않는다. 스케줄은 작업과 1:1이고 `allowDeletes`까지 함께 옮기려면 테이블을 다시 만들어야 한다. (2026-10-30 결정)
