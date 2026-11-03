# Spec: rclone이 외부에서 강제 종료됐을 때 이해할 수 있는 실패 안내

- Intent: [INT-005](intent.md) | Status: planned | 작성일: 2026-11-03

> 기준 커밋 `41d3e3a`. intent의 결정(Q1~Q3)을 따른다. 종료 코드 값은 T-01 probe 실측으로 확정하며, 실측 전 값은 "가설"로 표기한다.
>
> **intent Q2 결정과 다른 점(2026-11-03, §10 Q-1·Q-4·Q-5 근거)**: rclone 소스(`lib/atexit`)와 Go 런타임 종료 경로를 보고 판별 규칙을 보완했다. ① Go 충돌은 대부분 exit 2로 끝나므로 충돌은 종료 코드가 아니라 stderr의 Go 충돌 표지로 판정한다. ② Windows에서 rclone이 Ctrl+C를 받으면 exit 1과 `Signal received:` 로그를 남기므로(가설, T-01 확인), exit 1이라도 이 표지가 있으면 외부 종료로 본다(intent 제약 "exit 1은 분류하지 않는다"를 좁힘). ③ `0xC000013A`는 rclone이 Ctrl+C를 직접 처리하므로 외부 종료 집합에서 뺀다(probe로 재현될 때만 추가). intent 문구 갱신은 T-01 결과가 나온 뒤 함께 한다.

## 1. 개요

rclone 실제 전송·미리보기·사전 확인이 rclone 종료 코드(0~10)가 아닌 Windows 종료 코드로 끝나면 지금은 `rclone이 오류로 끝났습니다(exit 4294967295).`처럼 부호 없는 큰 숫자와 일반 오류 문구만 보인다. 이 spec은 종료 코드를 int32로 정규화하고, 아래 두 경우를 일반 오류와 나눠 안내한다.

- **외부 종료로 보임**(`RCLONE_KILLED`): 다른 프로그램이 rclone을 끝냈거나(종료 코드 `-1`), rclone이 중단 신호를 받고 끝낸 경우(`Signal received:` 로그)
- **충돌 가능**(`RCLONE_CRASHED`): rclone 프로세스 자체가 비정상 종료한 경우(stderr의 Go 충돌 표지, 또는 Go가 처리하지 못한 NTSTATUS 종료 코드)

실행 상태(`zRunStatus`)·안전 게이트·연속 실패 집계는 바꾸지 않는다.

## 2. 범위 (In-scope / Out-of-scope)

**In-scope**
- probe `kill` 묶음: 외부 종료 방식별 rclone 종료 코드 실측, fixture 저장, rclone-notes 기록
- shared 종료 코드 도우미(int32 정규화·표기·분류·NTSTATUS 이름)
- 오류 코드 `RCLONE_KILLED`·`RCLONE_CRASHED` 추가와 기본 메시지
- `decideRunOutcome` 분류(stderr 끝부분의 Go 충돌 메시지 확인 포함)
- run-service의 이력 `exitCode` 정규화 저장, 실행 로그·app.log `exit=` 표기
- 이력 상세의 종료 코드 표기, 연속 실패 경고 문구
- 사용자 문서: CHANGELOG, MVP_SPEC §8.6, rclone-notes

**Out-of-scope**
- 새 실행 상태 추가, 이력 필터 분류 변경, 자동 재시도(intent 제약)
- `Signal received:` 표지가 없는 exit 1의 외부 종료 판별(구분할 수 없음, §9 R-1)
- 비교(`lsjson`)·`backend features`·remote 설정 등 전송이 아닌 rclone 호출의 종료 안내
- 종료 주체 자동 탐지(이벤트 로그·Sysmon 조회). 사용자가 직접 확인한다(intent Q3)
- 예전 이력 레코드의 `exitCode`·`error` 다시 쓰기(마이그레이션 없음. 표기만 정규화)

## 3. 영향 시스템 · 모듈 · 데이터

| 파일 | 현재 | 변경 |
| :--- | :--- | :--- |
| `src/main/parsers/run-output.ts:78-158` | `itfRunOutcomeInput`(canceled·exitCode·stats·errorLines·hint), `decideRunOutcome`: 취소 > 3 > 7 > 0 > 그 밖 `RCLONE_FAILED` `exit ${code}` | 입력에 `stderrTail` 추가, exit 0 뒤·그 밖 분기 앞에 충돌 표지·신호 표지·외부 종료·NTSTATUS 분기(§6.4), 문구의 종료 코드 표기 |
| `src/shared/errors.ts:7-42`, `ERROR_MESSAGES` | 오류 코드 33개 | `RCLONE_KILLED`·`RCLONE_CRASHED`와 메시지 추가 |
| `src/shared/schemas/common.ts:47-52` `zAppErrorPayload` | `code: z.enum(ERROR_CODES)` | 코드 변경 없음(ERROR_CODES를 따라감). 이력 JSON에 새 값 저장 |
| `src/shared/schemas/run.ts:78` `exitCode: z.number().int().nullable()` | 부호 없는 값(4294967295)이 그대로 저장됨 | 스키마 불변, 저장값을 int32로 정규화 |
| (신규) `src/shared/exit-code.ts` | 없음 | 순수 도우미(§6.1) |
| `src/main/services/run-service.ts:870-884` `decide` | `result.stderrTail`은 hint에만 사용 | `stderrTail` 전달 |
| `src/main/services/run-service.ts:916-927` 사전 확인 실패 | `decide` 결과 message 앞에 "사전 확인에 실패해 실행하지 않았습니다(대상은 바뀌지 않음)." | 동작 불변(새 코드·문구가 그대로 감싸짐) |
| `src/main/services/run-service.ts:945`, `:1091-1103`, `:1134` | `exit=${exitCode}` 원값, 이력 `exitCode` 원값 | 정규화 값과 16진 표기 |
| `src/main/services/scheduler.ts:80-120` `autoOutcomeNotice` | failed → `ERROR_MESSAGES[o.error.code]` | 코드만 추가되면 자동 반영(코드 변경 없음) |
| `src/main/services/scheduler.ts:260-275` `countFailure` | `failed`/`partial` 집계, n회째 고정 문구 | 집계 불변, 마지막 실패 코드에 따라 문구 분기 |
| `src/pages/HistoryDetail.tsx:72-76` | `rclone 종료 코드` = `rec.exitCode` 원값 | `formatExitCode` 표기 |
| `src/pages/RunView.tsx:128-130`, `src/pages/HistoryView.tsx:141-146` | `error.message` 표시·배지 title | 코드 변경 없음(새 메시지가 그대로 보임) |
| `src/shared/partial-files.ts:43` | `failed`면 `.partial` 안내 | 불변(상태 유지라 계속 안내됨) |
| `scripts/probes/rclone-probes.mjs:138-171` `f_ProbeKillOnTransfer` | `taskkill /PID <pid> /T /F` 고정 | 종료 방식을 인자로 받는 형태로 확장, `kill` 묶음 추가(Ctrl+C 전달 `kill-ctrl-c` 포함) |
| `tests/fixtures/rclone/copy-cancel-large.exit.txt` | `1` (rclone-notes #17 부근 107-108행: taskkill /T /F = exit 1) | 근거로 재사용 |
| `tests/unit/run-output.test.ts` | decideRunOutcome 분기 테스트 | 새 분기 테스트 |
| `tests/unit/scheduler.test.ts` | 연속 실패 경고 테스트 | 문구 분기 테스트 |
| (신규) `tests/unit/exit-code.test.ts` | 없음 | 도우미 테스트 |
| `docs/specs/MVP_SPEC.md:1246-1259` §8.6 | "그 외 비정상 exit → failed" | 외부 종료·충돌 행 추가 |

데이터: DB 스키마·IPC 계약 변경 없음. 이력 레코드 `error.code`에 새 enum 값 2개가 저장될 수 있다(§9 R-3).

## 4. 기능 요구사항 (FR-n)

- **FR-1** 종료 코드 정규화: 종료 코드가 정수면 int32로 해석한다(`4294967295` → `-1`, `3221225786` → `-1073741510` = 0xC000013A). `null`은 그대로 둔다.
- **FR-2** 종료 코드 표기: 정규화 값이 0 이상이면 숫자만 쓴다(`3`). 음수면 `-1 (0xFFFFFFFF)`처럼 부호 있는 값과 8자리 대문자 16진을 함께 쓴다. 알려진 NTSTATUS면 이름을 덧붙인다(`-1073741819 (0xC0000005 STATUS_ACCESS_VIOLATION)`).
- **FR-3** 외부 종료 분류: 다음을 모두 만족하면 `status: "failed"`, `error.code: "RCLONE_KILLED"`로 끝낸다.
  - 취소가 아님
  - 정규화 코드가 외부 종료 집합에 속함. 확정: `-1`(2026-11-03 실제 건). `0xC000013A`는 T-01에서 rclone 종료 코드로 재현될 때만 추가한다(Q-4)
  - `errorLines`가 비어 있음
  - `stderrTail`에 Go 충돌 표지가 없음(FR-5)
- **FR-3a** 신호 종료 분류(T-01 `kill-ctrl-c` 실측으로 확정. 재현되지 않으면 이 FR과 AC-17을 지운다): 취소가 아니고, 정규화 코드가 `1`이며, `stderrTail`에 신호 표지(FR-5a)가 있고 Go 충돌 표지가 없으면 `failed` + `RCLONE_KILLED`. 신호 표지는 rclone이 중단 신호를 받았다는 직접 기록이므로 `errorLines` 유무와 상관없이 적용한다(신호 뒤 진행 중 전송이 끊기며 남는 오류는 결과로 본다).
- **FR-4** 충돌 분류: 취소가 아니고 exit 0·3·7이 아닐 때, 다음 중 하나면 `failed` + `RCLONE_CRASHED`.
  - `stderrTail`에 Go 충돌 표지(FR-5)가 있음. 종료 코드와 상관없다. Go 런타임은 panic·`fatal error`(메모리 부족 포함)·Go가 잡은 Windows 예외를 모두 **exit 2**로 끝내며, 이 값은 rclone 사용법 오류(2)와 같아 코드만으로는 구분할 수 없다
  - 정규화 코드가 `0xC0000000` 이상 범위(int32로 음수 중 상위 2비트가 `11`)이고 외부 종료 집합에 없으며 `0xC000013A`가 아님. Go 처리기를 우회한 종료(예: `0xC0000409` fail-fast)만 이 값으로 나온다
- **FR-4a** `0xC000013A`(STATUS_CONTROL_C_EXIT)가 외부 종료 집합에 없으면 충돌로도 보지 않는다. `RCLONE_FAILED` + FR-2 표기(NTSTATUS 이름 포함)로 둔다. 콘솔 닫기·로그오프 쪽 종료라 충돌이 아니지만 실측 근거가 없어 외부 종료로 단정하지 않는다.
- **FR-5** Go 충돌 표지: `stderrTail`의 **JSON이 아닌 줄** 중 줄 시작이 `panic: `·`fatal error: `·`Exception 0x`인 줄이 있으면 충돌로 본다. rclone 로그는 `--use-json-log`라 `{`로 시작하므로, 로그 메시지 안의 같은 문자열은 표지가 아니다. `goroutine N [running]:`만 있는 경우는 표지로 보지 않는다(panic/fatal 줄이 같이 나오므로 중복).
- **FR-5a** 신호 표지: `stderrTail`의 JSON 로그 줄 중 `msg`가 `Signal received: `로 시작하는 줄. rclone `lib/atexit`가 신호를 받으면 INFO로 남기는 기록이다(앱은 `-v`로 실행하므로 남는다). JSON으로 읽히지 않는 줄은 보지 않는다.
- **FR-6** 외부 종료 집합(FR-3)에 속하지만 `errorLines`가 있으면 지금처럼 `RCLONE_FAILED`로 두고, 문구의 종료 코드만 FR-2 표기로 바꾼다. 오류를 낸 뒤 종료됐을 수 있어 원인을 단정하지 않기 위해서다(FR-3a는 직접 기록이 있어 예외).
- **FR-7** 기존 분기 불변: 취소 > exit 3 > exit 7 > exit 0 순서와 결과는 바뀌지 않는다. 표지가 없는 exit 1·2·4~6·8~10은 지금처럼 `RCLONE_FAILED`이고, 종료 코드 표기만 FR-2를 따른다(0 이상이라 표기가 같음).
- **FR-8** 문구(제안. 최종 문구는 T-03에서 확정):
  - `RCLONE_KILLED`(FR-3, 종료 코드): `rclone이 외부에서 종료된 것으로 보입니다(종료 코드 -1 (0xFFFFFFFF), 오류 기록 없음). 다시 비교한 뒤 실행하면 아직 반영되지 않은 것만 처리합니다. 계속 반복되면 백신이나 다른 프로그램이 rclone을 끝내는지 확인하세요.`
  - `RCLONE_KILLED`(FR-3a, 신호): `rclone이 중단 신호를 받고 종료했습니다(종료 코드 1). 다시 비교한 뒤 실행하면 아직 반영되지 않은 것만 처리합니다. 계속 반복되면 다른 프로그램이 rclone에 중단 신호를 보내는지 확인하세요.`
  - `RCLONE_CRASHED`: `rclone이 비정상 종료했습니다(종료 코드 <FR-2 표기>). 충돌일 수 있습니다. 다시 실행해도 반복되면 rclone 버전을 바꿔 보세요.`
  - 두 문구 모두 `hint`(hintForRcloneError)가 있으면 뒤에 붙인다(기존 RCLONE_FAILED와 같은 방식).
  - 원인을 단정하는 단어("백신이 종료했습니다" 등)는 쓰지 않는다.
- **FR-9** `ERROR_MESSAGES` 기본 메시지(자동 실행 알림 `autoOutcomeNotice`에 쓰임):
  - `RCLONE_KILLED`: `rclone이 외부에서 종료된 것으로 보입니다.`
  - `RCLONE_CRASHED`: `rclone이 비정상 종료했습니다.`
- **FR-10** 이력 저장: run-service는 실제 실행·미리보기 결과 이력의 `exitCode`를 FR-1로 정규화해 저장한다.
- **FR-11** 로그 표기: 실행 로그 끝 줄(`# 종료: … exit=`), app.log의 `실행 종료:`·`사전 확인:` 줄은 `exit=-1(0xFFFFFFFF)`처럼 공백 없이 표기한다(키=값 구문 유지). 0 이상은 숫자만, null은 `-`.
- **FR-12** 이력 상세: `rclone 종료 코드` 값은 저장값을 FR-2로 표기한다. 예전 레코드의 부호 없는 값(4294967295)도 같은 표기(`-1 (0xFFFFFFFF)`)로 보인다.
- **FR-13** 사전 확인 실패: 사전 확인 rclone이 외부 종료·충돌로 끝나면 기존 감싸기(`사전 확인에 실패해 실행하지 않았습니다(대상은 바뀌지 않음). …`)에 FR-8 문구가 붙고 코드는 `RCLONE_KILLED`/`RCLONE_CRASHED`다.
- **FR-14** 연속 실패 경고: 집계 조건(`failed`/`partial` 증가, `success`/`noop` 초기화, n = `FAILURE_WARN_COUNT`일 때 1회)은 바꾸지 않는다. 경고 시점 실패의 `error.code`가 `RCLONE_KILLED`면 문구를 `‘<작업>’ 자동 실행이 n번 연속 실패했습니다. 마지막 실패는 rclone이 외부에서 종료된 경우입니다. 백신이나 다른 프로그램이 rclone을 끝내는지 확인하세요.`로 바꾼다. 그 밖은 기존 문구.
- **FR-15** probe `kill` 묶음(`--only=kill`일 때만 실행): 임시 폴더에서 `--bwlimit`로 느리게 copy를 띄우고, 첫 stats `bytes > 0`에서 다음 방식으로 각각 끝낸다. 각 `<name>.exit.txt`·`stderr`·`stdout`을 저장한다.
  - `kill-taskkill-f`: `taskkill /PID <pid> /F`
  - `kill-taskkill-tf`: `taskkill /PID <pid> /T /F`(앱 `killProcessTree`와 같음, `copy-cancel-large`와 대조)
  - `kill-stop-process`: `powershell.exe -NoProfile -NonInteractive -Command Stop-Process -Id <pid> -Force`
  - `kill-dotnet-kill`: `[System.Diagnostics.Process]::GetProcessById(<pid>).Kill()`
  - `kill-cim-terminate`: `Invoke-CimMethod`로 `Win32_Process.Terminate`(Reason 생략)
  - `kill-ctrl-c`: 도우미 `powershell.exe`가 P/Invoke로 `FreeConsole` → `AttachConsole(<pid>)` → `SetConsoleCtrlHandler(null, true)`(도우미 자신은 무시) → `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)`를 호출한다. `windowsHide`로 띄운 rclone도 숨긴 콘솔을 가지므로 붙을 수 있다. 확인할 것: 종료 코드(가설 1), stderr의 `Signal received: interrupt`·`Exiting...` 줄, `0xC000013A`가 나오는지(Q-4). 붙기에 실패하면 이유를 stdout에 남기고 이 방식만 건너뛴다
  - 실행 파일은 `%SystemRoot%\System32\…` 절대 경로, `shell: false`, 인자에는 숫자 pid만 넣는다(안전 규칙 1의 정신).
  - 작업 관리자 "작업 끝내기"는 사람이 1회 수행하고 rclone-notes에만 기록한다(fixture 선택).
- **FR-16** rclone-notes에 방식별 실측 코드, Ctrl+C 시 종료 코드·신호 표지, 표지 없는 exit 1 구분 불가 한계, 외부 종료 집합 확정 값, Go 충돌이 exit 2로 끝난다는 점(소스 근거)을 기록한다(#58~).

## 5. 비기능 요구사항 (NFR-n)

- **NFR-1** 순수성: 종료 코드 도우미와 `decideRunOutcome`은 순수 함수다. shared 도우미는 Node·DOM에 의존하지 않는다(`tests/unit/shared-boundary.test.ts` 규칙).
- **NFR-2** 개인정보: 문구·로그·fixture·테스트에 사용자 경로·remote 이름을 넣지 않는다. probe 출력은 기존 `f_Sanitize`/`f_MaskDir`로 가린다.
- **NFR-3** 호환: DB 스키마·IPC 계약·`zRunStatus` 불변. 예전 레코드는 그대로 읽힌다.
- **NFR-4** 비용: `stderrTail`(최대 20 KiB, `DEFAULT_STDERR_TAIL_BYTES`) 검사 1회. 성능 영향 무시 가능.

## 6. 인터페이스 · 데이터 스키마

### 6.1 `src/shared/exit-code.ts` (제안·신규)

```ts
/** 정수면 int32로, null은 null (FR-1) */
export function toInt32ExitCode(code: number | null): number | null;
/** 화면용: "3", "-1 (0xFFFFFFFF)", "-1073741819 (0xC0000005 STATUS_ACCESS_VIOLATION)" (FR-2) */
export function formatExitCode(code: number | null): string;
/** 로그용: "3", "-1(0xFFFFFFFF)", null → "-" (FR-11) */
export function formatExitCodeForLog(code: number | null): string;
export type typAbnormalExit = "killed" | "crash" | null;
/** 코드만 본 분류. 오류 줄·Go 충돌 표지는 decideRunOutcome이 함께 판단한다 */
export function classifyAbnormalExit(code: number | null): typAbnormalExit;
/** 외부 종료로 볼 코드(int32). 확정: -1. 0xC000013A는 T-01에서 재현될 때만 추가 */
export const EXTERNAL_KILL_EXIT_CODES: readonly number[];
```

`classifyAbnormalExit`: 외부 종료 집합 → `"killed"`, `0xC0000000` 이상이면서 `0xC000013A`가 아님 → `"crash"`, 그 밖(0~10·`0xC000013A`·null) → `null`. Go 충돌 표지(FR-5)·신호 표지(FR-5a)는 stderr 파싱이라 `run-output.ts`의 파일 내부 함수(`f_HasGoCrashMarker`·`f_HasSignalMarker`)로 둔다.

NTSTATUS 이름 표(제안): `0xC0000005 STATUS_ACCESS_VIOLATION`, `0xC0000017 STATUS_NO_MEMORY`, `0xC00000FD STATUS_STACK_OVERFLOW`, `0xC000013A STATUS_CONTROL_C_EXIT`, `0xC0000409 STATUS_STACK_BUFFER_OVERRUN`. 표에 없는 코드는 16진만 쓴다.

### 6.2 `src/main/parsers/run-output.ts` (제안)

```ts
export interface itfRunOutcomeInput {
    canceled: boolean;
    exitCode: number | null;      // 원값 또는 정규화 값 모두 허용(내부에서 정규화)
    stats: typRunStats | null;
    errorLines: readonly string[];
    hint: string | null;
    /** rclone stderr 끝부분(가림 처리 전 원문 아님 — process.ts의 stderrTail). Go 충돌 표지 확인용 */
    stderrTail: string;            // 추가(필수). 호출처는 run-service.decide 하나뿐
}
```

결과 `itfRunOutcome`은 불변이다.

### 6.3 `src/shared/errors.ts` (확정 방향)

`ERROR_CODES`에 `"RCLONE_KILLED"`, `"RCLONE_CRASHED"`를 `RCLONE_PARSE_ERROR` 뒤에 추가하고, `ERROR_MESSAGES`에 FR-9 메시지를 넣는다.

### 6.4 분류표 (확정 방향, 코드 값은 T-01 후 확정)

| 조건 (위에서부터 먼저 맞는 것) | status | code |
| :--- | :--- | :--- |
| 취소 | `canceled` | `CANCELED` |
| exit 3 | `failed` | `PATH_NOT_FOUND` |
| exit 7 | `failed` | `MAX_DELETE_EXCEEDED` |
| exit 0 | `success`/`partial` | -/`RCLONE_FAILED` |
| Go 충돌 표지 있음(코드 무관, 주로 exit 2) | `failed` | `RCLONE_CRASHED` |
| exit 1 + 신호 표지 (FR-3a, T-01 확정 시) | `failed` | `RCLONE_KILLED` |
| 외부 종료 집합 + 오류 줄 없음 | `failed` | `RCLONE_KILLED` |
| 외부 종료 집합 + 오류 줄 있음 | `failed` | `RCLONE_FAILED` |
| 0xC0000000 이상(외부 종료 집합·`0xC000013A` 제외) | `failed` | `RCLONE_CRASHED` |
| 그 밖(표지 없는 1·2·4~6·8~10, `0xC000013A`(집합에 없을 때), 기타·null) | `failed` | `RCLONE_FAILED` |

## 7. 예외 · 엣지 케이스

- **E-1** 앱 중지(취소): taskkill로 exit 1이지만 취소가 최우선이므로 `CANCELED`. 불변.
- **E-2** exit 1인 외부 종료(`taskkill /F`·작업 관리자): 신호 표지가 없으므로 `RCLONE_FAILED` 그대로. 구분 불가 한계(R-1). Ctrl+C로 끝난 exit 1은 신호 표지가 있어 `RCLONE_KILLED`(FR-3a).
- **E-3** `exitCode === null`(close 없이 `KILL_WAIT_MS` 경과 등): `RCLONE_FAILED`, 표기 `알 수 없음`(현행 유지).
- **E-4** 사전 확인 단계 외부 종료: FR-13. 대상은 바뀌지 않았다는 기존 문구가 앞에 남는다.
- **E-5** 미리보기(dry-run) 외부 종료: 같은 분류. 대상은 바뀌지 않으며 `.partial` 안내도 나오지 않는다(`mayLeavePartial` 불변).
- **E-6** 실제 전송 중 외부 종료: `failed` + `transferStarted: true`라 `.partial` 안내가 그대로 나온다. Drive는 `.partial`이 없지만(rclone-notes #36) 기존 동작과 같다.
- **E-7** 예전 이력 레코드(`exitCode: 4294967295`, `RCLONE_FAILED`): 상세의 종료 코드만 `-1 (0xFFFFFFFF)`로 보이고 메시지는 예전 그대로다.
- **E-8** 외부 종료 집합 코드인데 stderr에 `panic:` 표지: `RCLONE_CRASHED`.
- **E-8a** exit 2 + `fatal error: out of memory`: `RCLONE_CRASHED`. 메모리 부족도 Go 런타임이 exit 2로 끝낸다.
- **E-8b** exit 2, 표지 없음(rclone 사용법 오류 등): `RCLONE_FAILED` 그대로.
- **E-8c** rclone 로그 메시지(JSON 줄) 안에 `panic:`·`Signal received:` 같은 문자열이 들어 있음: FR-5는 JSON이 아닌 줄만, FR-5a는 JSON `msg`의 시작만 보므로 오분류하지 않는다.
- **E-9** stderr 끝부분이 잘려 `panic:` 줄이 20 KiB 밖에 있음: 표지를 놓쳐 `RCLONE_KILLED`로 분류될 수 있다. Go panic 출력은 마지막에 나오므로 가능성은 낮다(R-4).
- **E-10** 양의 큰 정수가 아닌 값(소수·NaN): Node `exit` 코드는 정수이므로 발생하지 않는다. 도우미는 정수가 아니면 null로 취급한다.
- **E-11** 비Windows(테스트 환경): 코드 집합이 Windows 값이라 해당하지 않으면 기존 분기를 탄다.

## 8. 수용 기준 (AC-n)

- **AC-1** Given 종료 코드 `4294967295`, When `toInt32ExitCode`, Then `-1`. `3221225786` → `-1073741510`. `3` → `3`. `null` → `null`.
- **AC-2** Given `-1`, When `formatExitCode`, Then `-1 (0xFFFFFFFF)`. Given `3221225477`, Then `-1073741819 (0xC0000005 STATUS_ACCESS_VIOLATION)`. Given `3`, Then `3`.
- **AC-3** Given 취소 아님·exit `4294967295`·오류 줄 없음·stderr에 충돌 표지 없음, When `decideRunOutcome`, Then `{ status: "failed", error.code: "RCLONE_KILLED" }`이고 message에 `-1 (0xFFFFFFFF)`가 들어가며 `4294967295`는 들어가지 않는다.
- **AC-4** Given AC-3에서 오류 줄 1개 이상, Then `RCLONE_FAILED`이고 message의 종료 코드는 `-1 (0xFFFFFFFF)` 표기.
- **AC-5** Given exit `0xC0000005`(원값 `3221225477`), Then `RCLONE_CRASHED`, message에 `STATUS_ACCESS_VIOLATION`.
- **AC-6** Given exit `-1`·오류 줄 없음·stderrTail에 `panic: runtime error` 줄, Then `RCLONE_CRASHED`.
- **AC-7** Given 취소 + exit 1, Then `CANCELED`. Given exit 1(취소 아님, 표지 없음), Then `RCLONE_FAILED`, message `exit 1` 표기 유지. Given exit 3/7/0, Then 기존 결과와 같다(기존 테스트 그대로 통과).
- **AC-8** Given T-01 fixture(`kill-*.exit.txt`·`kill-*.stderr.txt`)의 각 쌍, When 단위 테스트가 그 종료 코드와 stderr로 `decideRunOutcome`을 호출, Then 방식마다 rclone-notes에 기록한 기대 분류와 같다(외부 종료 집합 → `RCLONE_KILLED`, Ctrl+C → `RCLONE_KILLED`(FR-3a 확정 시), 표지 없는 exit 1 → `RCLONE_FAILED`). 기대 분류는 테스트 안의 표로 둔다.
- **AC-15** Given exit 2·stderrTail에 `fatal error: out of memory` 줄(합성), Then `RCLONE_CRASHED`. Given exit 2·`Exception 0xc0000005 0x0 …` 줄(합성), Then `RCLONE_CRASHED`. Given exit 2·표지 없음, Then `RCLONE_FAILED`.
- **AC-16** Given exit `3221225786`(0xC000013A)·외부 종료 집합에 없음, Then `RCLONE_FAILED`이고 message에 `STATUS_CONTROL_C_EXIT`. Given exit `0xC0000409`, Then `RCLONE_CRASHED`.
- **AC-17** (FR-3a 확정 시) Given exit 1·stderrTail에 `{"level":"info","msg":"Signal received: interrupt",…}` 줄(T-01 `kill-ctrl-c` fixture), Then `RCLONE_KILLED`이고 신호 문구. Given 같은 stderr + 취소, Then `CANCELED`. Given JSON `msg`가 `… Signal received: …`처럼 중간에만 들어 있음, Then 표지가 아니다.
- **AC-9** Given 자동 실행 결과 `RCLONE_KILLED`, When `autoOutcomeNotice`, Then message에 `rclone이 외부에서 종료된 것으로 보입니다.`가 들어간다.
- **AC-10** Given 연속 실패 n = `FAILURE_WARN_COUNT`이고 마지막 실패 코드 `RCLONE_KILLED`, When `countFailure`, Then 외부 종료 반복 안내 문구로 1회 경고. 마지막 실패가 `RCLONE_FAILED`면 기존 문구. 집계 횟수는 두 경우 같다.
- **AC-11** Given 실행이 외부 종료로 끝남, When 이력 레코드가 저장됨, Then `exitCode === -1`이고 실행 로그 끝 줄에 `exit=-1(0xFFFFFFFF)`.
- **AC-12** Given `exitCode: 4294967295`인 예전 레코드, When 이력 상세를 연다, Then `rclone 종료 코드`가 `-1 (0xFFFFFFFF)`.
- **AC-13** Given 빌드본(drive-app)에서 실제 copy 실행 중, When 바깥에서 `Stop-Process -Id <rclone pid> -Force`, Then 실행 결과·이력 목록 배지 title·이력 상세에 FR-8 문구가 보이고 renderer 콘솔 오류 0건. (`Stop-Process`가 -1이 아니라고 실측되면 외부 종료 집합에 드는 다른 방식으로 대체)
- **AC-14** Given probe `--only=kill`, Then `tests/fixtures/rclone/kill-*.{exit,stderr,stdout}.txt`가 생기고 사용자 경로·임시 폴더 실제 경로가 가려져 있다.

## 9. 가정과 리스크

- **R-1** exit 1 구분 불가(일부 해소): `taskkill /F`·작업 관리자는 exit 1로 예상되고(`taskkill /T /F`는 실측 1, `copy-cancel-large`), rclone 자체 오류(예: 없는 필터 파일, rclone-notes #21)도 exit 1이다. 이런 강제 종료는 rclone이 기록을 남길 틈이 없어 지금처럼 일반 오류로 보인다. 문서에 한계로 남긴다. Ctrl+C처럼 rclone이 직접 처리하는 신호는 `Signal received:` 기록이 남아 구분된다(FR-3a). 단 신호 처리기는 rclone이 `atexit.Register`를 한 번이라도 호출해야 켜지므로(`registerOnce`) copy·sync 경로에서 켜지는지는 T-01로만 확인할 수 있다.
- **R-2** 가설 오류: `Stop-Process`/.NET `Kill()`이 -1이 아니면, 이번 건의 -1을 만든 주체는 다른 방식이다. 이번 건의 실제 값(-1)이 근거이므로 -1은 집합에 그대로 두고 probe 결과는 notes에 남긴다. `0xC000013A`는 probe로 재현될 때만 집합에 넣고, 재현되지 않으면 notes에 "미재현"으로 적고 FR-4a대로 둔다.
- **R-2a** 근거 출처: Windows 신호 처리(`lib/atexit/atexit_other.go`: `exitSignals = {os.Interrupt}`, `exitCode` = `exitcode.UncategorizedError`(1), `atexit.go`: `fs.Infof("Signal received: %s")`)는 rclone master 소스를 읽은 것이다. 앱이 쓰는 rclone 버전에서 같은지는 T-01이 확인한다. Go 충돌이 exit 2로 끝난다는 점은 Go 런타임 동작이며, rclone으로 재현할 수 없어 합성 문자열로 테스트한다(R-5).
- **R-3** 새 오류 코드의 하위 호환: 새 버전이 저장한 `RCLONE_KILLED` 레코드를 이전 버전 앱이 읽으면 `zAppErrorPayload` enum 파싱에 실패할 수 있다(다운그레이드에서만). 다운그레이드는 지원 범위 밖으로 보고 CHANGELOG에 적지 않는다. 확인함: `history-store.ts:68-75` `f_ParseRows`는 파싱 실패 행을 건너뛰고, 시작 때 읽을 수 없는 행이 있으면 알릴 뿐 지우지 않는다(`:88`). 이전 버전에서는 그 행만 안 보이고 데이터는 남는다.
- **R-4** Go 충돌 출력이 stderr 끝부분 20 KiB를 넘어 앞부분 `panic:`이 잘릴 가능성. 긴 goroutine 덤프에서 생길 수 있으나 `RCLONE_KILLED` 오분류여도 상태·게이트는 같다(문구만 다름).
- **R-5** 실제 Go 충돌 출력 fixture를 rclone에서 재현할 방법이 없다. FR-5 테스트는 Go 런타임 형식을 따른 합성 문자열을 쓰고, 테스트에 합성임을 주석으로 남긴다(AGENTS 4.6 "실제 출력으로 테스트" 예외).
- **가정** Node `child.on("exit")`의 Windows 종료 코드는 부호 없는 DWORD 값이다(이번 건 4294967295가 근거).

## 10. 미해결 질문 (Open questions)

- [x] **Q-1** `RCLONE_CRASHED`를 따로 둘지 → **결정(2026-11-03): 둔다. 판정은 종료 코드가 아니라 stderr의 Go 충돌 표지가 기준(FR-4·FR-5).**
  - 근거: 자동 실행 알림이 `ERROR_MESSAGES[code]`만 쓰므로 코드가 없으면 알림에서 구분할 수 없다. Go 런타임은 panic·`fatal error`·Go가 잡은 Windows 예외를 exit 2로 끝내므로, 처음 안("충돌 표지 + 코드 음수", "0xC0000000 이상")은 실제 충돌 대부분을 놓친다. 표지에 `Exception 0x`를 더하고, 표지가 있으면 코드와 상관없이 충돌로 본다. NTSTATUS 범위는 Go 처리기를 우회한 경우를 위해 남긴다.
- [x] **Q-2** 이력 읽기가 zod 실패 행을 어떻게 다루는지 → 확인(2026-11-03): 건너뛰고 지우지 않는다(R-3). 추가 조치 없음.
- [x] **Q-3** 이력 목록에 "외부 종료" 보조 배지를 둘지 → **결정(2026-11-03): 목록 배지는 추가하지 않는다. 이력 상세 headline 보조 표기만 T-03(S3-3)에서 화면을 보고 정한다.**
  - 근거: 상태가 `failed`로 같아 목록에서 할 일(다시 실행)도 같다. 배지 title은 마우스를 올려야 보여 잘 띄지 않으므로, 필요하면 상세에서 "외부 종료로 보임"을 짧게 보인다. 같은 건이 이력에 쌓이는 경우가 확인되면 배지를 다시 검토한다.
- [x] **Q-4** probe에서 `0xC000013A`를 재현할 방법 → **결정(2026-11-03): `kill-ctrl-c`(AttachConsole + GenerateConsoleCtrlEvent)로 시도하고(FR-15), 기대 결과는 `0xC000013A`가 아니라 exit 1 + `Signal received:` 기록이다.**
  - 근거: rclone은 Windows에서 `os.Interrupt`를 직접 받아 `exitcode.UncategorizedError`(1)로 끝낸다(R-2a). 숨긴 창으로 띄워도 rclone은 숨긴 콘솔을 가져 붙을 수 있다. 결과에 따라 FR-3a를 확정하거나 지우고, `0xC000013A`는 재현될 때만 외부 종료 집합에 넣는다(재현되지 않으면 FR-4a).
- [x] **Q-5** WER 1000 기록에 따라 -1을 외부 종료 집합에서 뺄지 → **결정(2026-11-03): 빼지 않는다. 재검토 조건을 없앤다.**
  - 근거: 충돌이면 종료 코드는 2(Go 처리)나 예외 코드(0xC…)이고, -1(0xFFFFFFFF)은 나오지 않는다. -1은 `TerminateProcess(h, -1)` 같은 외부 종료의 흔적이다. 같은 시각 WER 기록이 있더라도 다른 프로세스일 수 있다. 이벤트 로그 확인(intent Q3)은 종료 주체를 찾는 용도로만 쓴다.
