# Spec: OS 예약·헤드리스 실행·sync 오류 무시/백업 폴더·GCS 실측 후속

- Intent: [INT-003](intent.md) | Status: planned | 작성일: 2026-11-02

> 이 spec은 intent를 구현할 수 있는 수준으로 풀어 쓴 문서다. 내용이 서로 다르면 intent가 우선한다.
> 심볼과 경로는 커밋 `928f9b4` 기준이다. 범위는 남은 태스크 T-01·T-03·T-04·T-05다. T-02·T-06·T-07은 취소했다(intent "결정 (2026-11-02)").

## 1. 개요

| 영역 | 지금 | 목표 |
| :--- | :--- | :--- |
| 예약 실행 | 앱 안 스케줄러(`clsScheduler`, 20초 tick)만 있다. 앱을 끄면 예약이 돌지 않는다 | 작업마다 **앱 안** 또는 **Windows 작업 스케줄러**를 고른다. OS 예약은 `rcloneGUI.exe --run-job <id>`로 창 없이 실행되고, 같은 자동 실행 게이트(`startAuto`)를 거쳐 이력에 남는다 |
| sync + 오류 무시 | `checkPlanSafety`가 sync + `ignoreErrors`를 항상 막는다(`SYNC_IGNORE_ERRORS_TEXT`). 백업 폴더 필드가 없다 | 작업에 백업 폴더를 지정할 수 있다. 실행마다 `<백업폴더>/YYYY-MM-DD_HHmmss/`로 `--backup-dir`을 주고, 백업 폴더가 있으면 sync + 오류 무시를 수동·자동 실행 모두에서 허용한다. 백업 없는 오류 무시는 계속 막는다 |
| GCS 수용 | `tests/integration/gcs-acceptance.test.ts`는 있지만 키가 없어 skip | 전용 버킷으로 skip 없이 통과시키고 결과를 기록한다 |
| 빈 폴더 없는 저장소 | `전체` 범위면 버킷형 remote에 `createDirs` 차이가 매번 남을 것으로 예상(MVP_SPEC E-6) | `rclone backend features`의 `CanHaveEmptyDirectories`로 판정해, false면 편집기에서 경고하고 비교 화면에서 빈 폴더 차이를 따로 표시한다. 자동 실행은 이 차이만으로 실행하지 않는다 |

## 2. 범위 (In-scope / Out-of-scope)

### 2.1 In-scope
- T-04 GCS 수용 테스트 실측과 `CanHaveEmptyDirectories` 확인(probe)
- T-01 Windows 작업 스케줄러 등록·해제·정리, 헤드리스 `--run-job`, second-instance 전달, 설치 제거 시 정리, Electron fuses
- T-03 작업 옵션 백업 폴더(`--backup-dir`), 위치 검사, 실행별 하위 폴더, 계획 토큰·게이트 변경
- T-05 빈 폴더를 만들 수 없는 대상 판정·편집기 경고·비교 화면 구분 표시·자동 실행 판정 보정

### 2.2 Out-of-scope
- 백업 없는 sync `--ignore-errors`(T-02 취소). 안전 규칙 3과 `BLOCKED_FLAGS`는 바꾸지 않는다.
- `폴더만` 범위(T-06 취소), WSL cron(T-07 취소)
- 백업 폴더 보관 기간 자동 정리(앱이 백업을 지우지 않는다)
- 작업별 "놓친 예약 건너뛰기" 옵션(INT-002 결정)
- 암호화된 rclone.conf의 헤드리스 실행(지원하지 않고 경고만 한다)
- 관리자 권한·비밀번호 저장(`/RU`·`/RP`)이 필요한 예약, "로그온하지 않아도 실행"

## 3. 영향 시스템 · 모듈 · 데이터

| 파일 | 지금 | 바뀌는 것 |
| :--- | :--- | :--- |
| `src/main/index.ts` | `requestSingleInstanceLock()` 인자 없음(`:603`), `second-instance`는 창만 보인다(`:607`), `--hidden`만 읽는다(`:96`), `f_Start`가 항상 창·트레이·스케줄러를 만든다(`:369`) | `--run-job <id>` 해석, `additionalData`로 전달, 헤드리스 모드(창·트레이 없이 실행 후 종료), 헤드리스 중 GUI 요청이면 GUI 모드로 바꾼다 |
| `src/main/services/run-service.ts` | `startAuto(jobId)`가 trigger를 `"scheduler"`로 고정한다(`:384`, `:396`). `f_CheckAutoGate`(`:231`), `buildTransferArgs`는 `spawnTransfer`(`:833`)에서만 부른다 | `startAuto(jobId, trigger)`로 trigger를 받는다. 백업 폴더가 있으면 실행별 하위 폴더를 만들어 `buildTransferArgs`에 넘긴다 |
| `src/main/services/scheduler.ts` | 켜진 모든 작업을 tick에서 본다 | OS 백엔드 작업은 앱 스케줄러에서 건너뛴다 |
| `src/shared/schemas/job.ts` | `zAutoSyncInput`(`:76`)에 백엔드 없음, `zJobRunOptions`(`:44`)에 백업 폴더 없음 | `autoSync.backend`(`"app" \| "os"`), `options.backupDir`(문자열 또는 null) 추가. 저장된 값 읽기는 기본값(`"app"`, `null`)으로 예전 데이터를 읽는다 |
| `src/shared/schemas/common.ts` | `zRunTrigger = ["manual", "scheduler"]`(`:32`) | `"os-scheduler"` 추가 |
| `src/shared/run-gates.ts` | `checkPlanSafety`가 sync + `ignoreErrors`를 항상 막는다(`:73`), `SYNC_IGNORE_ERRORS_TEXT`(`:20`) | 백업 폴더가 있으면 통과. 안내 문구 갱신 |
| `src/main/rclone/command-builder.ts` | `BLOCKED_FLAGS`의 "백업 없음" 규칙(`:57`), `ALLOWED_COMMANDS`(`:85`)에 `backend` 없음, `buildTransferArgs`(`:236`) | 차단 규칙은 그대로. `buildTransferArgs`에 `backupDir` 입력 추가. `["backend", "features"]` 허용과 인자 빌더 추가 |
| `src/main/services/plan-token.ts` | 토큰 버전 `3`, `backupDir` 없음(`:44`) | 버전 `4`, 백업 폴더 기준 경로(정규화) 포함 |
| `src/shared/path-utils.ts` | `checkPathPair`(`:230`, S1~S4a), `canonicalLocation`·`pathKey` | 백업 폴더 검사 함수 추가(같은 remote, 원본·대상과 겹침 금지). 기존 함수 재사용 |
| `src/shared/diff-engine.ts` | `createDirs`·`deleteDirs` 계산(`:293`) | 계산은 그대로 둔다. 표시·자동 판정에서 구분한다(§4.4) |
| `src/main/services/remote-service.ts`·`compare-service.ts` | remote 종류는 `listremotes --long`으로 얻는다 | 대상 remote의 `CanHaveEmptyDirectories`를 조회·캐시하고 비교 결과에 싣는다 |
| 새 파일 `src/main/services/os-scheduler.ts`(초안 이름) | 없음 | 작업 스케줄러 XML 생성(순수 함수)과 `schtasks` 실행(`execFile` + `shell:false`) |
| `src/main/rclone/process.ts` | `RCLONE_*` 환경 변수를 지우고 `RCLONE_CONFIG_PASS`·`RCLONE_PASSWORD_COMMAND`만 남긴다(`:92`) | 바꾸지 않는다. 헤드리스에서 암호화 conf를 풀 수 없다는 전제의 근거다 |
| `build/installer.nsh` | 제거 시 로그인 항목만 지운다 | `${ifNot} ${isUpdated}`일 때 `\rcloneGUI\` 예약 작업도 지운다 |
| `electron-builder.yml` | fuses 설정 없음(electron-builder 26.18.0, electron 45.0.0) | Electron fuses 설정 |
| `scripts/dev/installer-smoke.mjs` | 설치·실행·제거, `--login-item` | `--run-job` 실행·종료 코드·이력 기록, 제거 시 예약 작업 삭제 확인 |
| `scripts/probes/rclone-probes.mjs` | rclone 동작 실험 | `backend features`·`--backup-dir` probe 추가 |
| `tests/integration/gcs-acceptance.test.ts` | 6개 수용 테스트, 환경 변수 없으면 skip | 실측 실행. `CanHaveEmptyDirectories` 확인 추가 |
| DB(`src/main/store/db-schema.ts`) | 작업 전체는 `jobs.data` JSON(`job-store.ts:73`). `schedules` 테이블(V1 `:71`)은 만들어져 있지만 main 코드에서 쓰지 않는다 | 새 필드는 `jobs.data` JSON에 넣는다. **DDL 마이그레이션 없음** |
| 문서 | AGENTS.md 안전 규칙 2·3, MVP_SPEC, README, CHANGELOG, rclone-notes | 규칙 2에 OS 예약 경로 한 줄, MVP_SPEC 금지 목록·FR-28·E-6 반영, README에 OS 예약·제거 동작 |

## 4. 기능 요구사항 (FR-n)

### 4.1 T-04 GCS 실측
- **FR-1** 세 환경 변수(`RCLONEGUI_TEST_GCS_CONFIG`·`_REMOTE`·`_BUCKET`)를 주고 `pnpm run test:int`를 돌리면 `gcs-acceptance.test.ts`가 skip 없이 모두 통과한다.
- **FR-2** probe가 GCS 대상의 `rclone backend features <remote>:` 결과에서 `CanHaveEmptyDirectories`를 기록한다. `directory_markers`를 켠 테스트 remote와 끈 remote 두 경우를 비교한다(두 번째 remote는 같은 버킷, 테스트 conf 안에서만).
- **FR-3** `전체` 범위로 copy·sync한 뒤 다시 비교했을 때 `createDirs`가 남는지 기록한다.
- **FR-4** 결과는 `docs/knowhow/rclone-notes.md`(9장 형식)·`docs/CHANGELOG.md`에 남기고, 버킷명·remote 이름·키·conf 경로는 쓰지 않는다.

### 4.2 T-01 OS 예약·헤드리스 실행
- **FR-5** 작업 편집기 자동 실행에 "예약 방식: 앱이 켜져 있을 때(앱 안) / Windows 작업 스케줄러(앱이 꺼져 있어도)"를 둔다. 작업마다 하나만 켜진다(`autoSync.backend`).
- **FR-6** OS 백엔드로 저장하면 `\rcloneGUI\<jobId>` 예약 작업을 `schtasks /Create /XML <임시파일> /TN \rcloneGUI\<jobId> /F`로 등록한다. 등록에 실패하면 저장은 유지하되 화면에 실패 사유를 보이고 작업에 "OS 예약 미등록" 상태를 표시한다.
- **FR-7** XML: 작업 이름은 jobId(uuid)만 쓴다. `LogonType=InteractiveToken`, `RunLevel=LeastPrivilege`, `StartWhenAvailable=true`, `DisallowStartIfOnBatteries=false`, `StopIfGoingOnBatteries=false`, `MultipleInstancesPolicy=IgnoreNew`, `ExecutionTimeLimit=PT13H`(FR-34 앱 내부 제한 + 1시간 여유, 백스톱)를 명시한다. `RestartOnFailure`는 넣지 않는다(FR-22). 예약 종류는 interval → `TimeTrigger` + `Repetition`(`PT<n>M`), daily → `CalendarTrigger/ScheduleByDay`, weekly → `CalendarTrigger/ScheduleByWeek`(요일 비트 → `DaysOfWeek`)로 바꾼다.
- **FR-8** XML 파일은 UTF-16 LE BOM으로, userData 아래 앱 폴더에 `wx` 플래그로 만들고 등록 후 지운다. exe 경로·인자는 XML 이스케이프한다(인자는 uuid뿐이라 사실상 exe 경로만). `schtasks /Query … /XML` stdout은 BOM·null 바이트로 UTF-16 LE 여부를 판별해 디코딩한다(코드페이지 출력이면 그대로 읽는다 — 실제 형식은 probe로 기록, §10 Q-1).
- **FR-9** 작업을 지우거나, 자동 실행을 끄거나, 백엔드를 앱으로 바꾸면 해당 예약 작업을 `schtasks /Delete /TN \rcloneGUI\<jobId> /F`로 지운다.
- **FR-10** 앱 시작 때(GUI·헤드리스 모두) `\rcloneGUI\` 아래 예약 작업 목록을 읽어 DB에 없는 작업 또는 OS 백엔드가 아닌 작업의 예약을 지우고, 등록된 exe 경로가 현재 `process.execPath`와 다른 예약은 다시 등록한다. OS 언어에 따라 바뀌는 `/FO CSV`·`/FO LIST`의 열 이름·값에 기대지 않는다: 작업 이름 목록만 얻고, 작업마다 `/Query /TN \rcloneGUI\<jobId> /XML`에서 `<Command>`만 읽는다.
- **FR-11** OS 백엔드는 `app.isPackaged`일 때만 고를 수 있다. 개발 실행과 E2E에서는 선택지를 비활성화하고 이유를 보인다.
- **FR-12** `rcloneGUI.exe --run-job <uuid>`로 첫 실행되면 창·트레이·앱 스케줄러 없이 시작한다. 진입 검사(작업 있음 + `autoSync.enabled` + `backend === "os"` + 전역 일시정지 아님)를 통과하면 `startAuto(jobId, "os-scheduler")`를 부르고, 끝나면 앱을 끝낸다. 검사에 걸리면 실행하지 않고 이력에 `blocked`와 사유를 남긴다.
- **FR-13** argv에서는 `--run-job` 다음 값만 읽고 zod(`z.uuid()`)로 검증한다. 다른 앱 플래그(`--hidden` 제외)는 무시한다. 형식이 틀리면 실행하지 않고 app.log에만 남긴 뒤 종료 코드 2로 끝낸다.
- **FR-14** 이미 앱이 실행 중이면 `requestSingleInstanceLock({ runJob: id })`의 `additionalData`로 넘기고 두 번째 프로세스는 바로 끝난다. 받는 쪽은 `additionalData`를 zod로 검증한 뒤 FR-12와 같은 진입 검사 → `startAuto(…, "os-scheduler")`를 한다. argv는 첫 실행에만 파싱한다.
- **FR-15** 헤드리스 실행 중 사용자가 앱을 열면(`second-instance`, `runJob` 없음) 창과 트레이를 만들고 앱 스케줄러를 시작하는 GUI 모드로 바뀐다. 이 경우 실행이 끝나도 앱을 끝내지 않는다.
- **FR-16** 실행 중(전역 락 BUSY)이면 OS 예약 실행은 바로 끝내지 않고 프로세스 안 대기열(FIFO)에 넣는다. 같은 jobId가 이미 대기 중이면 다시 넣지 않는다. 락이 풀리면 다음 작업을 진입 검사부터 다시 하고 실행한다. 대기열에 들어간 지 60분이 지나면 실행하지 않고 `blocked`(사유: 다른 실행이 길어짐) 이력을 남긴다. 헤드리스는 실행 중인 작업과 대기열이 모두 비면 끝낸다. 앱 스케줄러가 BUSY면 다음 tick에 다시 보는 동작(`scheduler.ts:6`)과 맞춘다. (§10 Q-3)
- **FR-17** 헤드리스 종료 코드(초안): 0 = success·noop, 1 = failed·partial·canceled, 2 = 인자 오류·진입 검사 차단·blocked, 3 = 시작 실패(DB 열기 실패 등). 작업 스케줄러 "마지막 실행 결과"로 보인다. FR-14로 실행 중인 앱에 넘기고 끝나는 두 번째 프로세스는 넘김 성공이면 0으로 끝나므로, 이때 "마지막 실행 결과"는 실제 실행 결과가 아니다(결과는 앱 이력에서 본다).
- **FR-18** 헤드리스 실행 결과는 앱 스케줄러와 같은 규칙으로 OS 알림을 보낸다(noop 제외, 문구에 경로 없음). 이력의 trigger는 `os-scheduler`이고 화면에는 "Windows 예약"으로 표시한다.
- **FR-19** 작업 설정 파일(`configPathOverride` 또는 전역 conf)이 암호화되어 있음을 실행 전에 알 수 없으므로, OS 백엔드 선택 시 "암호화된 rclone.conf는 예약 실행에서 쓸 수 없음"을 항상 안내한다. 실행 중 암호 입력 대기는 `--ask-password=false`(이미 모든 명령에 붙음)로 실패한다.
- **FR-20** 앱을 제거하면(업데이트 아님) `\rcloneGUI\` 아래 예약 작업을 모두 지운다. DB는 남으므로 재설치 후 앱을 처음 열 때 FR-10이 예약을 다시 등록한다.
- **FR-21** 패키징 빌드에 Electron fuses를 적용한다: `RunAsNode`·`EnableNodeCliInspectArguments`·`EnableNodeOptionsEnvironmentVariable` 끄기, `EnableEmbeddedAsarIntegrityValidation`·`OnlyLoadAppFromAsar` 켜기.
- **FR-22** 로그온 직후 경로가 아직 준비되지 않아 실패하는 경우는 헤드리스 안에서 재시도한다: 전송 시작 전 경로 확인(원본·대상 접근)에 실패하면 2분 간격으로 최대 3회 다시 확인한다. 전송이 시작된 뒤에는 재시도하지 않는다. 작업 스케줄러는 0이 아닌 종료 코드를 실패로 보고 재시작하지 않는 것으로 보므로 XML에 `RestartOnFailure`를 넣지 않는다(두 겹 재시도 방지 — probe로 동작만 기록, §10 Q-2).
- **FR-34** 헤드리스 실행에는 앱 내부 제한 시간(12시간)을 둔다. 넘으면 기존 취소 경로(`killProcessTree`, taskkill /T /F)로 rclone 트리를 끝내고 이력에 `canceled`(사유: 시간 제한)를 남긴 뒤 종료 코드 1로 끝낸다. 작업 스케줄러의 `ExecutionTimeLimit`(FR-7)은 앱이 응답하지 않을 때의 백스톱이다(§10 Q-8).

### 4.3 T-03 백업 폴더
- **FR-23** 작업 옵션에 "백업 폴더"(선택, 비우면 사용 안 함)를 둔다. sync 모드에서만 쓴다(copy는 지우지 않으므로 숨김·무시). 값은 경로 입력 규칙(`zPathInput`)을 따른다.
- **FR-24** 저장 전 검사: (a) 대상과 같은 remote(로컬이면 같은 드라이브 문자 또는 같은 UNC 공유. 다른 드라이브는 rclone 동작과 상관없이 거부한다 — 이름 바꾸기 대신 복사+삭제가 되어 I/O가 두 배이고 중간 실패 시 반쯤 옮겨진 상태가 남는다, §10 Q-4), (b) 원본·대상과 겹치지 않음(같은 경로, 서로의 상위·하위 모두 금지, 대소문자 설정은 `pathKey` 규칙을 따름), (c) 원본·대상과 같은 형식 검사(S1~S4a 중 해당 항목).
- **FR-25** 실제 실행(사전 확인 dry-run 포함)마다 `--backup-dir <백업폴더>/<YYYY-MM-DD_HHmmss>_<jobId 앞 8자>`를 준다. 시각은 실행 시작 시각(로컬 시간)이고, 같은 실행의 사전 확인과 실제 실행은 같은 값을 쓴다. 전역 락으로 같은 작업이 같은 초에 두 번 돌 수 없으므로 존재 확인·`_2` 붙이기는 하지 않는다. 시각을 앞에 두어 시간순으로 정렬되게 하고, 작업 이름은 쓰지 않는다(경로 금지 문자·개인정보, §10 Q-6).
- **FR-26** 백업 폴더가 있으면 `checkPlanSafety`의 "sync + 오류 무시" 차단을 통과한다. 수동·자동·OS 예약 실행 모두 같다. 백업 폴더가 없으면 지금처럼 막는다. `BLOCKED_FLAGS`의 "백업 없음" 규칙은 그대로 둔다(백스톱).
- **FR-27** 계획 토큰에 백업 폴더 기준 경로(정규화, 실행별 하위 폴더 제외)를 넣는다. 바뀌면 PLAN_STALE로 다시 비교하게 한다.
- **FR-28** 삭제 확인 창·실행 결과·이력 상세에 "지우거나 덮어쓴 파일은 <백업폴더>/<하위폴더>로 옮김"을 보인다. 실행 로그 파일에도 남긴다(app.log에는 경로를 남기지 않는다).
- **FR-35** `--backup-dir`을 쓸 때의 삭제 수는 T-03 첫 단계 probe로 확정하고 fixture로 남긴다: (1) dry-run·실제 실행의 로그 문구(`skipped` 값이 `"delete"`가 아닌 백업 이동 문구로 바뀌는지), (2) 백업 이동이 `--max-delete`에 세어지는지, (3) 덮어쓴 파일의 백업 이동이 어떻게 찍히는지. `log-parser.ts`의 `f_Skip`은 지우는 파일의 백업 이동만 `delete`로 세고, 덮어쓰기 이동은 세지 않게 고친다. 사전 확인의 삭제 수가 계획 삭제 수와 같다는 게이트 규칙과 `--max-delete <계획 삭제 수>`는 그대로 둔다(probe 결과가 다르면 이 FR을 고친 뒤 구현, §10 Q-5).
- **FR-29** 편집기·옵션 안내(`SYNC_IGNORE_ERRORS_TEXT`)를 "백업 폴더를 지정하면 쓸 수 있음"으로 바꾼다. 백업 폴더는 앱이 지우지 않으며 직접 정리해야 한다는 안내를 붙인다.

### 4.4 T-05 빈 폴더를 만들 수 없는 대상
- **FR-30** 비교 시작 때 대상이 remote면 `rclone backend features <remote>: --ask-password=false [--config C]` 결과의 `Features.CanHaveEmptyDirectories`를 읽는다. 결과는 (remote 이름, conf 경로, rclone 경로) 키로 앱 실행 동안 캐시한다. 로컬 대상은 조회하지 않고 true로 본다. 조회에 실패하면 null(알 수 없음)로 두고 지금처럼 동작한다.
- **FR-31** 비교 결과에 `destCanHaveEmptyDirs: boolean | null`을 싣는다. false이고 `createDirs > 0`이면 비교 화면 요약에서 빈 폴더 생성 수를 일반 변경과 분리해 "이 저장소는 빈 폴더를 만들 수 없음(N개)"으로 보이고, 변경 목록에서도 같은 표시를 단다.
- **FR-32** 편집기에서 범위 `전체` + 대상 remote의 값이 false이면 경고한다(저장은 막지 않는다). 값은 편집기에서 대상 remote를 고를 때 조회한다.
- **FR-33** 자동 실행(앱·OS 예약)의 "바꿀 것 없음(noop)" 판정에서, 대상이 false면 `createDirs`를 변경으로 세지 않는다. 그래야 빈 폴더 차이만으로 매번 rclone을 돌리지 않는다.

## 5. 비기능 요구사항 (NFR-n)
- **NFR-1** 안전 규칙: `schtasks`·`powershell`도 `execFile` + `shell:false` + 고정 인자 배열. 사용자 입력(작업 이름·경로)은 예약 이름·인자에 들어가지 않는다. 경로는 XML 본문(exe 경로)에만 들어가고 이스케이프한다.
- **NFR-2** 실제 전송은 계속 `spawnTransfer` 한 곳에서만 시작한다. 헤드리스도 `startAuto`만 부른다.
- **NFR-3** 헤드리스 시작에서 종료까지 창을 띄우지 않는다(오류 창 `f_ShowStartError` 포함 — 헤드리스면 app.log와 종료 코드만).
- **NFR-4** 두 프로세스가 같은 DB를 동시에 열지 않는다(single-instance 락). WAL·`busy_timeout`은 방어용으로 유지한다.
- **NFR-5** app.log에는 id·수·코드만 남긴다. 백업 폴더 경로·XML 내용은 남기지 않는다.
- **NFR-6** `rclone backend features` 조회는 비교 시간을 크게 늘리지 않는다(캐시, 타임아웃 10초).
- **NFR-7** 예전 DB 데이터(백엔드·백업 폴더 필드 없음)를 그대로 읽는다. 마이그레이션 없음.

## 6. 인터페이스 · 데이터 스키마

> **확정**: 위치·근거가 코드에 있는 것. **초안**: 이름·모양은 구현 단계에서 바뀔 수 있다.

### 6.1 스키마 (초안)
```ts
// src/shared/schemas/job.ts
export const zScheduleBackend = z.enum(["app", "os"]);
zAutoSyncInput  += { backend: zScheduleBackend }                 // 저장 입력: 필수(기본값 없음 — 기존 규칙과 같음)
zAutoSync       += { backend: zScheduleBackend.default("app") }  // 저장된 값 읽기
zJobRunOptions  += { backupDir: zPathInput.nullable() }          // 읽기용은 .default(null)

// src/shared/schemas/common.ts
export const zRunTrigger = z.enum(["manual", "scheduler", "os-scheduler"]);

// src/shared/schemas/system.ts (또는 새 파일)
export const zRunJobAdditionalData = z.object({ runJob: z.uuid() }).strict();
```
- `zJobRunOptions`는 저장 입력과 읽기에 같은 객체를 쓰므로(`:44`) 읽기용 기본값을 넣을 방법은 구현 단계에서 정한다(`zJobStoredDraft`에서 `options` 확장).

### 6.2 함수 (초안)
```ts
// src/main/services/run-service.ts (확정 위치, 시그니처 초안)
startAuto(jobId: string, trigger: "scheduler" | "os-scheduler" = "scheduler")

// src/main/rclone/command-builder.ts
itfTransferArgsInput += { backupDir: string | null }   // 실행별 하위 폴더까지 붙은 최종 값
buildBackendFeaturesArgs(remote: string, configPath: string | null): string[]
ALLOWED_COMMANDS += ["backend", "features"]

// src/shared/run-gates.ts
typGateJob.options += "backupDir"   // checkPlanSafety가 백업 폴더 유무를 본다

// src/shared/path-utils.ts
checkBackupDir(backup, source, destination, caseInsensitive): itfPathIssue | null

// src/main/services/os-scheduler.ts
buildTaskXml(input: { exePath: string; jobId: string; autoSync: typAutoSyncOptions; now: Date }): string  // 순수
decodeSchtasksOutput(buf: Buffer): string   // 순수, UTF-16 LE(BOM·null 바이트) 판별
class clsOsScheduler { register(job), unregister(jobId), reconcile(jobs), list() }

// src/main/services/run-service.ts 또는 새 파일 (초안)
buildBackupSubdir(now: Date, jobId: string): string   // 순수, "YYYY-MM-DD_HHmmss_<jobId 앞 8자>"
```

### 6.3 IPC (초안)
- `scheduler:osStatus` → `{ available: boolean; reason: string | null; tasks: { jobId; registered; exeMatches }[] }` — 편집기·작업 목록 표시용. 채널과 타입은 `src/shared/ipc-contract.ts`에만 정의한다.
- `remotes:features` → `{ canHaveEmptyDirs: boolean | null }` — 편집기 경고용.
- 응답은 기존 `{ ok, data } | { ok: false, error }` envelope.

### 6.4 외부 형식 (확인 필요)
- `rclone backend features remote:` 출력 JSON의 `Features.CanHaveEmptyDirectories`(T-04 probe로 확정).
- 작업 스케줄러 XML 스키마 `http://schemas.microsoft.com/windows/2004/02/mit/task`. 등록 파일은 UTF-16 LE BOM으로 쓴다(결정). `/Query /XML` stdout 인코딩은 T-01 probe로 기록한다.
- `--backup-dir` 사용 시 dry-run·실제 실행 JSON 로그의 `skipped`·`msg` 문구(T-03 probe로 확정, FR-35).

## 7. 예외 · 엣지 케이스
- **E-1** OS 예약이 실행됐는데 작업이 지워졌다 → 진입 검사에서 차단하고 이력은 남기지 않는다(작업 없음). FR-10이 다음 시작 때 예약을 지운다. app.log와 종료 코드 2.
- **E-2** OS 예약 실행 중 사용자가 같은 작업을 수동 실행 → 전역 락으로 BUSY(기존 동작).
- **E-3** 노트북 배터리 → XML에서 전원 조건을 끄므로 그대로 실행된다. 시간 제한은 앱 내부 제한(FR-34)이 먼저 걸려 rclone 트리를 정리한다. 앱이 응답하지 않아 OS가 강제 종료(`ExecutionTimeLimit`)하면 정상 종료 신호가 없어 `.partial`·rclone 자식이 남을 수 있고, 이력은 다음 시작의 `recoverActiveRun`·`markInterrupted`가 정리한다. probe로 OS 강제 종료 시 rclone 자식도 함께 끝남을 확인했다(§10 Q-8, notes #5). `.partial`은 남을 수 있다.
- **E-4** 사용자가 작업 스케줄러에서 예약을 직접 지우거나 바꿈 → FR-10이 다음 앱 시작 때 다시 등록한다(DB가 원본).
- **E-5** 업데이트 설치로 exe 경로가 바뀜 → FR-10이 다시 등록한다. 재시작 전까지는 예전 경로를 가리킬 수 있다.
- **E-6** 헤드리스 실행 중 사용자가 트레이 종료와 같은 종료 흐름을 탄다 → 기존 `f_QuitFlow` 확인 창을 그대로 쓴다(GUI 모드로 바뀐 뒤).
- **E-7** 헤드리스에서 DB 열기 실패 → 오류 창 없이 app.log + 종료 코드 3.
- **E-8** 백업 폴더가 대상 안에 있음 → 저장 거부(rclone은 필터로 제외하면 허용하지만 지원하지 않는다).
- **E-9** 백업 폴더가 대상과 다른 remote·다른 드라이브 → 저장 거부(FR-24 (a)).
- **E-10** 백업 폴더에 원본·대상 제외 패턴이 걸림 → 겹치지 않는 경로만 허용하므로 영향 없다.
- **E-11** 실행별 하위 폴더 이름 충돌 → 이름에 jobId 앞 8자가 들어가고 전역 락으로 한 번에 하나만 실행되므로 생기지 않는다. 여러 작업이 같은 백업 폴더를 써도 겹치지 않는다(FR-25).
- **E-12** `backend features` 조회 실패·시간 초과 → null, 경고·구분 표시 없음, 자동 noop 판정도 지금과 같다.
- **E-13** 대상 경로의 remote가 alias·union 등 다른 remote를 감싼 것 → `backend features` 결과를 그대로 믿는다.
- **E-14** 전역 일시정지 중 OS 예약 실행 → 진입 검사에서 차단하고 `blocked`(사유: 일시정지) 이력.
- **E-15** `--max-delete`와 `--backup-dir`을 같이 쓰면 이동이 삭제로 세어지는지, dry-run 문구가 바뀌어 사전 확인 삭제 수가 0으로 읽히는지 → FR-35 probe·fixture로 확정하고 파서 테스트로 막는다.
- **E-16** 두 OS 예약이 같은 시각에 실행됨 → 두 번째는 FR-14로 넘겨져 대기열에서 첫 실행이 끝나기를 기다린 뒤 실행된다(FR-16).

## 8. 수용 기준 (AC-n)
- **AC-1** Given GCS 테스트 환경 변수 3개, When `pnpm run test:int`, Then GCS 수용 테스트가 skip 없이 통과하고 rclone-notes에 `CanHaveEmptyDirectories` 결과가 기록된다.
- **AC-2** Given 설치본, When 작업을 OS 예약(5분 간격)으로 저장, Then `schtasks /Query /TN \rcloneGUI\<jobId> /XML` 결과에 jobId·`--run-job`·`StartWhenAvailable=true`·배터리 조건 false·`IgnoreNew`가 있다.
- **AC-3** Given OS 예약 작업, When 앱을 완전히 끈 상태에서 예약이 실행, Then 창 없이 실행되고 이력에 trigger `os-scheduler`인 기록이 남고 프로세스가 끝난다.
- **AC-4** Given 앱이 켜져 있음, When OS 예약이 실행, Then 두 번째 프로세스는 바로 끝나고 기존 앱에서 실행되어 이력이 남는다.
- **AC-5** Given `--run-job` 값이 uuid가 아님 또는 OS 백엔드가 아닌 작업, When 실행, Then rclone을 실행하지 않고 종료 코드 2로 끝난다(전자는 이력 없음, 후자는 blocked 이력).
- **AC-6** Given OS 예약 작업, When 작업 삭제·자동 실행 끄기·앱 백엔드로 변경, Then `\rcloneGUI\<jobId>`가 없어진다.
- **AC-7** Given 설치본 + OS 예약 작업, When 제거(업데이트 아님), Then `\rcloneGUI\` 예약 작업이 없고 `%APPDATA%\rcloneGUI`는 남는다.
- **AC-8** Given 개발 실행, When 편집기를 연다, Then OS 백엔드를 고를 수 없고 이유가 보인다.
- **AC-9** Given sync + 오류 무시 + 백업 폴더 없음, When 수동·자동 실행, Then 지금처럼 SAFETY_BLOCKED.
- **AC-10** Given sync + 오류 무시 + 올바른 백업 폴더, When 실행, Then rclone 인자에 `--ignore-errors`와 `--backup-dir <백업폴더>/<YYYY-MM-DD_HHmmss>_<jobId 앞 8자>`가 있고, 지워진 대상 파일이 그 하위 폴더에 있다.
- **AC-11** Given 백업 폴더가 대상 안·원본 안·다른 remote, When 저장, Then 저장이 거부되고 이유가 필드에 보인다.
- **AC-12** Given 비교 후 백업 폴더 변경, When 실행, Then PLAN_STALE.
- **AC-13** Given `CanHaveEmptyDirectories=false` 대상 + `전체` 범위 + 원본에 빈 폴더, When 비교, Then 요약에 빈 폴더 차이가 따로 표시되고, When 자동 실행, Then 다른 변경이 없으면 noop이다.
- **AC-14** Given 모든 변경, Then `pnpm run check`·`format:check`·`test:int`·`test:e2e`(콘솔 오류 0)·`build:win`·`smoke:installer`가 통과한다.
- **AC-15** Given OS 예약 작업 A가 실행 중, When 작업 B의 OS 예약이 실행, Then B는 A가 끝난 뒤 실행되어 이력이 남는다. 60분 안에 락이 풀리지 않으면 B는 `blocked` 이력을 남긴다.
- **AC-16** Given 백업 폴더가 있는 sync + 삭제 대상 N개, When 사전 확인 dry-run, Then 파서가 읽은 삭제 수가 N이다(덮어쓰기 이동 제외, fixture 기반 단위 테스트).
- **AC-17** Given 백업 폴더가 대상과 다른 로컬 드라이브, When 저장, Then 저장이 거부되고 이유가 필드에 보인다.

## 9. 가정과 리스크
- **A-1** (확인 2026-11-02) electron-builder 26.18.0은 `electronFuses` 설정을 지원한다(`app-builder-lib/out/configuration.d.ts:260` `electronFuses?: FuseOptionsV1`). `@electron/fuses@1.8.0`은 app-builder-lib의 기존 의존성이라 새 의존성·THIRD_PARTY_NOTICES 추가가 없다. FR-21은 `electron-builder.yml`의 `electronFuses`로 한다.
- **A-2** `schtasks /Create /XML`이 사용자 권한(`LeastPrivilege`, `InteractiveToken`)으로 비밀번호 없이 등록된다고 가정한다.
- **R-1** 헤드리스 모드가 `f_Start`의 순서(DB → 복구 → 서비스 → 창)를 갈라야 해서 `index.ts` 변경이 크다. 창·트레이·스케줄러 생성을 함수로 분리해 GUI 전환(FR-15)에서 재사용한다.
- **R-2** fuses의 `OnlyLoadAppFromAsar`·asar 무결성 검사가 설치본 실행을 막을 수 있다 → `smoke:installer`로 확인하고, 문제가 있으면 해당 fuse만 끈다.
- **R-3** 작업 스케줄러 그룹 정책·회사 PC에서 등록이 막힐 수 있다 → FR-6 오류 표시, 앱 안 예약으로 되돌릴 수 있다.
- **R-4** `CanHaveEmptyDirectories`가 `directory_markers`를 반영하지 않으면 FR-30 판정이 틀린다 → T-04 결과에 따라 판정 방법을 다시 정한다(T-05는 T-04 뒤).
- **R-5** (해소) 여러 작업이 같은 백업 폴더를 써도 하위 폴더 이름에 jobId 앞 8자가 들어가 겹치지 않는다(FR-25).
- **R-6** 백업 폴더가 계속 커진다(자동 정리 없음) → 안내 문구로 알린다.

## 10. 미해결 질문 (Open questions)

> 2026-11-02 모두 결정했다. "probe로 기록"은 설계를 바꾸지 않고 동작만 `rclone-notes.md`·fixture에 남긴다는 뜻이다. Q-5만 probe 결과가 다르면 FR-35를 고친다.

- **Q-1** (결정) XML은 UTF-16 LE BOM으로 쓰고, 이스케이프는 exe 경로에만 필요하다(인자는 uuid). 조회는 언어에 따라 바뀌는 CSV·LIST 형식을 쓰지 않고 작업마다 `/Query /TN … /XML`에서 `<Command>`만 읽는다. stdout 인코딩은 `decodeSchtasksOutput`가 판별한다 → FR-8·FR-10. probe로 기록: `/Query /XML` stdout 인코딩.
  - probe 결과(2026-11-02, Windows 11 한국어, `docs/knowhow/windows-task-scheduler-notes.md` #1·#2): **UTF-16 LE BOM은 등록 XML 쓰기에만 쓴다. 파이프로 받은 조회 출력(`/Query /XML`·`/FO CSV`)은 BOM 없는 CP949**다(XML 선언은 `encoding="UTF-16"`이지만 실제 바이트는 CP949). 그래서 `decodeSchtasksOutput`은 UTF-16(BOM 유무)·UTF-8 BOM일 때만 확실(reliable)로 보고, 그 밖에 비ASCII가 있으면 exe 경로를 비교하지 않는다(`exeMatches: null`, 그것만으로 재등록 안 함). 재등록 판단은 ASCII인 `<Description>rcloneGUI;spec=<hash></Description>`로 한다. 작업 이름 목록은 `/Query /FO CSV /NH` 전체 출력에서 줄 첫 필드 `"\rcloneGUI\<uuid>"`만 정규식으로 뽑는다(머리글·다른 열을 쓰지 않으므로 언어 독립).
- **Q-2** (결정) 앱 안에서 재시도한다: 전송 시작 전 경로 확인 실패만 2분 간격 최대 3회. XML에 `RestartOnFailure`를 넣지 않는다. 근거: 작업 스케줄러는 0이 아닌 종료 코드를 재시작 조건으로 보지 않는 것으로 알려져 있고, 앱 안 재시도는 횟수·조건을 정확히 정하고 단위 테스트할 수 있다 → FR-22. probe로 기록: `RestartOnFailure`와 종료 코드.
  - probe 결과(2026-11-02, notes #4): `RestartOnFailure`(PT1M, 2회) + exit 1 더미는 200초 동안 1회만 실행됐다. 0이 아닌 종료 코드로는 재시작하지 않음을 확인했으므로 결정대로 앱 안에서만 재시도한다.
- **Q-3** (결정) BUSY면 바로 blocked로 끝내지 않고 프로세스 안 대기열에서 최대 60분 기다린다. 근거: 두 작업을 같은 시각(예: 매일 03:00)에 걸면 두 번째가 매번 blocked가 되어 매일 예약은 하루 치 실행을 잃는다. 앱 스케줄러도 BUSY면 다음 tick에 다시 본다 → FR-16·FR-17·E-16·AC-15.
- **Q-4** (결정) 로컬 백업 폴더는 대상과 같은 드라이브(또는 같은 UNC 공유)만 허용한다. rclone이 다른 드라이브를 복사+삭제로 처리하더라도 I/O 두 배·중간 실패 시 반쯤 옮겨진 상태 때문에 1차에서는 막는다 → FR-24·E-9·AC-17. probe로 기록: 다른 드라이브 `--backup-dir` 동작.
- **Q-5** (결정, probe 필수) T-03 첫 단계에서 probe·fixture로 확정한다. 위험: dry-run 문구가 백업 이동 문구로 바뀌면 `f_Skip`이 `other`로 분류해 사전 확인 삭제 수가 0이 되고, 덮어쓰기 이동이 같은 문구로 찍히면 삭제 수가 늘어난다. 지우는 파일의 백업 이동만 삭제로 센다 → FR-35·E-15·AC-16.
- **Q-6** (결정) 하위 폴더 이름은 `YYYY-MM-DD_HHmmss_<jobId 앞 8자>`. 충돌이 없어 `_2` 붙이기와 remote 충돌 예외를 뺀다 → FR-25·E-11·R-5.
- **Q-7** (결정) electron-builder 26.18.0이 `electronFuses`를 지원한다. 새 의존성 없음 → A-1·FR-21. 설치본 실행은 `smoke:installer`로 확인한다(R-2).
- **Q-8** (결정) 시간 제한은 앱 내부(12시간)에서 걸어 `killProcessTree`로 rclone 트리를 정리한다. `ExecutionTimeLimit=PT13H`는 백스톱이다. 근거: OS가 강제 종료하면 앱에 정상 종료 신호가 없어 정리 코드가 돌지 못하고, rclone이 남은 채 락이 풀려 다음 실행과 겹칠 수 있다 → FR-7·FR-34·E-3. probe로 기록: OS 강제 종료 뒤 rclone 자식이 남는지.
  - probe 결과(2026-11-02, notes #5): **OS 강제 종료 시 자식도 종료됨을 확인**했다. `ExecutionTimeLimit PT1M`에서 부모는 약 63초 뒤 끝났고 그때 자식 프로세스도 이미 없었다. rclone이 남아 다음 실행과 겹칠 위험은 낮지만, 정상 종료 신호 없이 끝나므로 이력은 `running`으로 남아 다음 시작의 `markInterrupted`가 정리한다. 그래서 앱 내부 12시간 제한을 먼저 건다(결정 유지).
