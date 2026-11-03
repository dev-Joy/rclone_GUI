# Spec: 앱에서 rclone remote 추가·수정·삭제·재인증

- Intent: [INT-006](intent.md) | Status: planned | 작성일: 2026-11-03

> 이 spec은 intent를 구현할 수 있는 수준으로 풀어 쓴 문서다. 내용이 서로 다르면 intent가 우선한다.
> 심볼과 경로는 커밋 `2215254` 기준이다.
> §10 질문 Q1~Q8은 2026-11-03에 결정했다(사용자 승인). 근거는 같은 날 rclone v1.75.1 실측(`docs/knowhow/rclone-notes.md` #39~#45)이다. `[결정 Qn]`은 그 결정을 따른 부분이다.
> rclone 동작 중 `[probe]` 표시는 아직 실측하지 않은 예상이다. 실측과 다르면 실측을 따른다.

## 1. 개요

| 영역 | 지금 | 목표 |
| :--- | :--- | :--- |
| remote 만들기 | `rclone config` 대화형 CLI로만 만든다. 앱은 `listremotes`로 이름·종류만 읽는다(`src/main/rclone/config.ts:132`, `:168`) | 설정 화면에서 모든 종류를 골라 만든다. 입력 칸은 `rclone config providers` 정의로 자동 생성한다 |
| OAuth 종류 | 만료되면 `rclone config reconnect` 명령을 안내만 한다(`src/main/parsers/rclone-env-parser.ts:140`) | 앱에서 브라우저 로그인을 시작하고 결과를 표시한다. 재인증도 앱에서 한다 |
| 수정·삭제 | 없음 | 비밀 아닌 값은 채워서 보여 주고 비밀 값은 바꿀 때만 입력한다. 삭제 전에 참조 작업·북마크·예약 수를 보여 주고, 예약 켜진 작업은 자동 실행을 끈 뒤 지운다 |
| 없는 remote 실행 | rclone 원문 오류("didn't find section in config file")를 힌트로 바꿔 보여 준다(`rclone-env-parser.ts:142`) | 실행·비교 전에 확인해 `REMOTE_NOT_FOUND`로 막고, 작업 목록에 "remote 없음"을 표시한다 |

용어: 이 코드베이스에서 `remotes:*` IPC와 `clsRemoteStore`는 **remote 북마크**(별칭 + remote 이름 + 기준 경로)를 뜻한다(`src/main/ipc/remotes.ts`, `src/main/store/remote-store.ts`). 이 spec에서 rclone.conf의 remote 자체는 **remote 설정**이라 부르고, 새 IPC는 `remoteConfig:*` 이름을 쓴다(intent의 "remotes 채널 추가"를 이름 충돌 없이 구현).

## 2. 범위 (In-scope / Out-of-scope)

### 2.1 In-scope
- T-01 probe: `config providers`·`delete`·`redacted`, rcd `config/create`·`update`(질문 흐름 포함)·`core/quit`, OAuth 대기·취소·포트 충돌 출력 실측. 결과는 `docs/knowhow/rclone-notes.md`와 `tests/fixtures/rclone/`
- T-02 providers 파서·zod 스키마·동적 입력 폼(모든 종류, 고급 옵션 접기)
- T-03 비OAuth remote 추가(명령·IPC·이름 검증·목록 갱신)
- T-04 OAuth 종류 추가와 재인증(브라우저 연동·대기·취소·시간 제한)
- T-05 수정·삭제(참조 표시, 확인 창, BUSY, 예약 끄기, "remote 없음" 표시, `REMOTE_NOT_FOUND`)
- T-06 README·CHANGELOG·MVP_SPEC·E2E

### 2.2 Out-of-scope
- remote 이름 변경 `[결정 Q4]`. 편집 화면의 이름 칸은 읽기 전용이다. 후속 아이디어는 `_ideas/INBOX.md`.
- **작업별 rclone.conf(`configPathOverride`)의 remote 관리.** 앱은 감지된 기본 conf(`clsRcloneEnv.detect().configPath`, 순서는 `src/main/rclone/config.ts:5`)의 remote만 만들고 고치고 지운다. 작업별 conf를 쓰는 작업은 참조 수에 넣지 않는다(§4 FR-19).
- conf 파일 직접 읽기·쓰기, `config show`·`config dump`(intent 제약).
- OAuth 리디렉트 포트 변경(`[결정 Q3]`), 여러 OAuth 동시 진행.
- 헤드리스(`--run-job`)에서 OAuth·재인증 시작.
- conf 암호화 설정·해제(`config encryption`), conf 비밀번호 입력 UI.

## 3. 영향 시스템 · 모듈 · 데이터

| 위치 | 지금 | 변경 |
| :--- | :--- | :--- |
| `src/main/rclone/command-builder.ts:99` `ALLOWED_COMMANDS` | `config file`만 허용. 주석이 "config show/dump 차단 — 안전 규칙 6" | `config providers`·`delete`·`redacted`, `rcd`(FR-14 조건 고정)를 추가. `config create`·`update`·`reconnect`는 CLI로 실행하지 않는다(값이 명령줄에 나오므로 rcd만). `show`·`dump`·`edit`·`password`·`encryption`은 계속 막는다. 새 `build*Args` 함수 |
| `src/main/rclone/command-builder.ts:51` `BLOCKED_FLAGS` | 플래그 영역만 검사 | 변경 없음. 옵션 값은 rc HTTP 본문으로 가므로 명령줄에 나오지 않는다. remote 이름이 `-`로 시작하면 rclone이 플래그로 해석하므로(notes #44) 명령 전에 FR-5로 막는다 |
| `src/main/rclone/process.ts:22` `itfRunProcessOptions` | stdin 입력 없음 | 변경 없음(`obscure -` 방식은 쓰지 않는다, §10 Q1). rcd 수명 관리는 새 `src/main/rclone/rc-session.ts` |
| `src/main/rclone/process.ts:275` `buildRcloneEnv` | `RCLONE_*`는 `RCLONE_CONFIG_PASS`·`RCLONE_PASSWORD_COMMAND`만 남김 | 기본은 변경 없음. rcd 실행에만 `RCLONE_RC_USER`·`RCLONE_RC_PASS`(실행마다 새로 만든 난수)를 더한다. 사용자 환경의 같은 이름 값은 계속 버린다 |
| `src/main/parsers/` | providers 파서 없음 | `rclone-providers-parser.ts`(providers JSON → 옵션 정의), `rclone-config-parser.ts`(redacted 출력 → 비밀 아닌 값, rc `config/create`·`update` 응답의 질문 상태), rcd 시작 줄(`Serving remote control on http://127.0.0.1:<port>/`) 파서 |
| `src/main/services/` | `remote-service.ts`는 북마크·탐색, `remote-ops.ts`는 탐색 직렬 큐·BUSY | 새 `remote-config-service.ts`(추가·수정·삭제·참조 조회), `remote-auth-session.ts`(OAuth 한 건 관리). 둘 다 `clsRemoteOps.run`으로 직렬화 |
| `src/main/services/job-context.ts:76` `resolveJobContext` | 경로·rclone·conf 확인 | conf가 정해진 뒤 remote 이름이 conf에 있는지 확인, 없으면 `REMOTE_NOT_FOUND` |
| `src/main/services/os-scheduler.ts` `syncJobs`·`idle` | job-store onChange로 차분 등록·삭제(`src/main/index.ts:608`) | 변경 없음. 삭제 흐름이 작업의 `autoSync.enabled=false` 저장 뒤 `idle()`을 기다리고 등록이 사라졌는지 확인한다 |
| `src/main/store/job-store.ts:214` `update` | 사용자 편집 저장 | 변경 없음. 자동 실행 끄기에 그대로 쓴다(rev 증가) |
| `src/main/index.ts:720` before-quit | 실행 중이면 확인 후 종료 | OAuth 대기 중이면 rclone 프로세스 트리를 끝내고 반쪽 remote를 정리한 뒤 종료 |
| `src/shared/errors.ts` `ERROR_CODES` | `REMOTE_NOT_FOUND` 없음 | `REMOTE_NOT_FOUND`, `REMOTE_NAME_INVALID`, `AUTH_TIMEOUT`, `AUTH_PORT_IN_USE`, `RC_START_FAILED`(rcd 시작·포트 읽기 실패) 추가(이름은 초안) |
| `src/shared/remote-name.ts` | 한 글자 이름 경고만(저장은 막지 않음) | 새로 만들 때 쓰는 이름 검증 `validateNewRemoteName` 추가. 기존 경고 함수는 그대로 |
| `src/shared/ipc-contract.ts:44` | `remotes:*`(북마크), `rclone:listRemotes` | `remoteConfig:*` 채널·`itfRcloneGuiApi.remoteConfig`·진행 이벤트 추가 |
| `src/shared/schemas/` | — | `remote-config.ts`(입력 zod) |
| `src/pages/SettingsPage.tsx:237` | `RemoteBookmarksPanel`만 있음 | 그 위에 `RemoteConfigPanel`(목록·추가·수정·삭제·재인증). 새 `RemoteConfigEditor`, `RemoteConfigForm`(동적 폼), `RemoteDeleteModal`, `RemoteAuthModal` |
| `src/stores/rclone-env-store.ts:149` | remote 목록을 env 감지로 받음 | 추가·수정·삭제 뒤 env를 다시 감지해 `RemoteBookmarksPanel`·`RemotePicker`가 새 목록을 쓰게 한다 |
| `src/pages/JobSidebar.tsx` | — | 기본 conf를 쓰는 작업 중 remote가 목록에 없으면 "remote 없음" 표시 |
| 데이터 | SQLite `jobs`·`remotes`(북마크)·`schedules` | **스키마 변경 없음**. remote 설정은 rclone.conf에만 있다 |
| 문서·규칙 | AGENTS.md 안전 규칙 6 | 반영함(2026-11-03): 규칙 1에 rcd 조건, 규칙 6에 `config redacted` 예외(§10 Q1·Q2) |
| 테스트 | — | 단위: 인자 생성·허용 목록·파서·이름 검증·비밀 가림·참조 계산·삭제 순서. 통합: 임시 conf의 `local`·`memory`·`alias`. E2E: 임시 `RCLONE_CONFIG`로 추가·수정·삭제 |

## 4. 기능 요구사항 (FR-n)

### 4.1 목록·종류 (T-02)
- **FR-1** 설정 화면에 기본 conf의 remote 목록(이름·종류)을 보여 준다. 출처는 지금처럼 `listremotes --long`이다.
- **FR-2** `rclone config providers` 출력을 파싱해 종류 목록과 옵션 정의(이름·설명·기본값·필수·고급·비밀·선택지·제한 선택지·숨김)를 만든다. 숨김 옵션은 폼에 넣지 않는다. 결과는 rclone 경로 기준으로 앱 실행 동안 캐시한다.
- **FR-3** 폼은 옵션 정의로 칸을 만든다: 선택지가 있으면 고르기, 불리언은 체크, 비밀은 가림 입력, 나머지는 글자 입력. 고급 옵션은 기본으로 접는다. 필수 칸이 비면 저장을 막는다.
- **FR-4** 종류 고르기 화면은 검색할 수 있고 OAuth 종류에 표시를 붙인다(OAuth 판정 기준은 `[probe]`: providers 옵션에 `token`이 있는지).

### 4.2 추가 (T-03)
- **FR-5** `[결정 Q7]` 새 이름은 저장 전에 검사한다. 규칙은 shared에 두고 renderer·main이 같이 쓴다.
  - rclone 규칙(notes #44): 글자(한글 포함)·숫자·`_`·`-`·`.`·`+`·`@`·공백. `-`·공백으로 시작하거나 공백으로 끝나면 거부. 끝의 `-`도 v1.75.1에서 거부됐다.
  - 앱 규칙(부분집합): 공백 금지, 두 글자 이상(드라이브 문자와 겹침), `-`로 시작·끝 금지, 기존 이름과 대소문자 무시 중복 금지. 초안 정규식 `^[\p{L}\p{N}_.+@][\p{L}\p{N}_.+@-]*[\p{L}\p{N}_.+@]$`(u 플래그).
  - 이미 있는 공백 이름 remote는 지금처럼 쓸 수 있다(읽기 쪽 규칙은 바꾸지 않는다).
- **FR-6** `[결정 Q1]` 비OAuth 종류는 rc `config/create`(`{ name, type, parameters, opt: { nonInteractive: true, obscure: true } }`) 한 번으로 만든다(FR-14).
- **FR-7** 만든 뒤 env를 다시 감지해 remote 목록·북마크 편집기·remote 고르기에 바로 나타나게 한다. 결과 화면에 `연결 테스트` 버튼을 준다(지금의 경로 확인 `pathService.probe`를 `<name>:`로 부른다).
- **FR-8** 기본 conf가 없으면(`source: "none"`) rclone이 기본 위치에 만든다 `[probe]`. 만든 뒤 env 감지가 그 파일을 찾는지 확인한다.

### 4.3 OAuth·재인증 (T-04)
- **FR-9** OAuth 종류는 rc `config/create`를 비대화형으로 시작하고, rclone이 브라우저를 열어 로그인을 받는 동안 기다린다(rcd 안에서 브라우저·53682 대기가 되는지 `[probe]`). 대기 창에는 남은 시간·`취소`·"브라우저가 열리지 않으면 이 주소를 여세요"(rclone이 출력한 `http://127.0.0.1:53682/auth?...` 주소, `[probe]`)를 보여 준다.
- **FR-10** OAuth는 앱 전체에서 한 번에 하나만 진행한다. 진행 중에 다른 OAuth·재인증을 시작하면 `BUSY`.
- **FR-11** `[결정 Q3]` 시간 제한은 10분이다(2단계 인증·계정 선택이 긴 사용자 고려, 취소 버튼이 있으므로 길게 둔다). 시간 초과·취소·앱 종료 때 rclone 프로세스 트리를 끝낸다(`killProcessTree`, `process.ts:121`).
- **FR-12** **새로 추가**하다 실패·취소·시간 초과로 끝나면, 이번 시도에서 앱이 만든 remote만 `config delete`로 지운다. 시작 전에 없던 이름일 때만 지운다.
- **FR-13** 재인증은 대화형 CLI `config reconnect` 대신 rc `config/update`의 질문 흐름(FR-15a)으로 한다. 토큰을 새로 받게 하는 질문·상태 이름은 `[probe]`이고, 안 되면 `config reconnect <name>:`를 비대화형으로 쓸 수 있는지 확인한다. 실패·취소하면 기존 설정을 바꾸지 않는다(rclone이 토큰을 바꾸지 않았는지 `[probe]`). 인증 만료 힌트(`rclone-env-parser.ts:140`)에 "앱에서 재인증" 버튼을 단다.

### 4.4 비밀 값 (T-03·T-05)
- **FR-14** `[결정 Q1]` 옵션 값(비밀 포함)을 쓰는 create·update는 **짧게 띄운 rcd**에 HTTP 본문으로 보낸다. 명령줄에는 옵션 값이 나오지 않는다.
  - 근거(notes #39~#42): obscure는 `IsPassword` 옵션(36개)에만 적용되고 `Sensitive` 옵션(206개: S3 `secret_access_key`, Drive `client_secret`·`token` 등)은 평문으로 저장된다. obscure 값은 `rclone reveal`로 되돌릴 수 있어 프로세스 감사 로그에 남으면 평문과 같다. 환경 변수 `RCLONE_CONFIG_<NAME>_<OPT>`는 conf에 기록되지 않는다.
  - rcd 조건(안전 규칙 1): `rcd --rc-addr 127.0.0.1:0 --ask-password=false [--config C]`, 인증은 실행마다 새로 만든 `RCLONE_RC_USER`·`RCLONE_RC_PASS` 환경 변수, `--rc-no-auth`·`--rc-web-gui`·`--rc-serve`·`--rc-files` 금지. stderr의 시작 줄에서 포트를 읽는다. main은 Node `fetch`로 `config/create`·`config/update`·`core/quit`만 부른다(`config/get`·`config/dump`는 obscure 값을 돌려주므로 금지, notes #42). 요청 흐름이 끝나면 `core/quit`, 응답이 없으면 프로세스 트리를 끝낸다.
  - 평문은 `opt.obscure: true`로 rclone이 obscure 한다. 앱은 obscure·reveal을 하지 않는다.
- **FR-15** 암호화 conf(`RCLONE_CONFIG_PASS`·`RCLONE_PASSWORD_COMMAND`가 환경에 있음)도 같은 rcd 길을 쓴다(notes #41). 비밀 값 입력을 따로 막지 않는다. 비밀번호가 없어 conf를 못 열면 rcd 시작 오류를 기존 힌트로 보여 준다.
- **FR-15a** `[결정 Q8]` OAuth 등에서 rclone이 질문(`State`·`Option`)을 돌려주면, 앱은 `Option`(Help·Default·Examples·Type·IsPassword·Required·Exclusive)으로 질문 하나짜리 범용 폼을 보여 주고 답을 rc `config/create`·`update`의 `opt.continue`·`state`·`result`로 보낸다(답도 HTTP 본문으로만).
  - `config_is_local`만 앱이 자동으로 `true`로 답한다.
  - Drive의 `config_shared_client_id` 질문(기본값 false, "공용 client_id가 2026년 중 중단")은 그대로 보여 주고, "직접 만든 client_id 권장" 안내와 rclone 문서 링크를 붙인다(notes #45).
  - 질문 수 한도 20개(초안). 넘으면 실패로 끝내고 CLI를 안내한다.
- **FR-16** rclone 인자·stderr를 오류 문구·로그·IPC 응답으로 내보낼 때 비밀 옵션 값과 obscure 값은 `***`로 바꾼다. 가림 함수는 하나로 두고 단위 테스트로 강제한다.

### 4.5 수정 (T-05)
- **FR-17** `[결정 Q2]` 수정 화면은 `config redacted <name>` 출력에서 비밀 아닌 값만 채운다(안전 규칙 6 예외). rclone은 `IsPassword`·`Sensitive`를 모두 `XXX`로 가린다(notes #43: sftp `host`·`user`, S3 `access_key_id`도 가려짐). main은 providers 정의에서 `IsPassword`·`Sensitive`인 옵션과 `token`, 값이 `XXX`인 칸을 한 번 더 버리고, renderer에는 `{ type, values, secretsSet }`만 보낸다(가려진 칸은 `secretsSet`, 화면은 "설정됨 — 바꿀 때만 입력"). redacted 출력 원문은 메모리에서만 쓴다.
- **FR-18** 수정은 바뀐 칸만 rc `config/update`(FR-14)로 보낸다. 비밀 칸은 비워 두면 바꾸지 않는다. 종류는 바꿀 수 없다. OAuth 종류의 client_id·client_secret을 바꾸면 저장 뒤 재인증을 안내한다.

### 4.6 참조·삭제 (T-05)
- **FR-19** 참조 조회는 remote 이름 하나에 대해 다음을 센다(대소문자 무시, `remoteNamesOfJob`과 같은 기준):
  - 작업: `configPathOverride`가 null이고 원본·대상 중 하나가 그 remote를 쓰는 작업. 그중 `autoSync.enabled`이 켜진 작업은 앱 예약·OS 예약으로 나눠 센다.
  - 북마크: `remoteName`이 같은 북마크.
- **FR-20** 수정·삭제는 `clsRemoteOps.run([name], ...)` 안에서 한다. 같은 remote가 비교·실행·탐색 중이면 `BUSY`.
- **FR-21** 삭제 확인 창은 참조 수를 보여 주고, 예약 켜진 작업이 있으면 버튼 문구를 "작업 N개의 자동 실행을 끄고 삭제"로 바꾼다. 예약 없는 작업·북마크는 "remote 없음으로 표시됩니다" 경고만 한다(지우지 않는다).
- **FR-22** 삭제 순서: (1) 예약 켜진 참조 작업마다 `jobStore.update(id, { autoSync: { ...현재, enabled: false } })` → (2) `osScheduler.idle()`을 기다리고 그 작업들의 OS 예약 해시가 없어졌는지 확인 → (3) `config delete <name>` → (4) env 재감지. (1)·(2)에서 실패하면 (3)을 하지 않고 멈춘다(이미 꺼진 예약은 그대로 둔다).
- **FR-23** 결과 문구는 일어난 일을 쓴다: "remote ‘x’ 삭제, 작업 2개의 자동 실행을 껐습니다. 작업 3개·북마크 1개가 이 remote를 가리킵니다."

### 4.7 없는 remote (T-05)
- **FR-24** `resolveJobContext`는 conf가 정해진 뒤 작업이 쓰는 remote가 그 conf의 `listremotes`에 있는지 확인한다. 없으면 `REMOTE_NOT_FOUND`("remote ‘x’가 rclone 설정에 없습니다. 설정 화면에서 추가하거나 작업의 경로를 바꾸세요.")를 던진다. 비교·수동 실행·자동 실행·OS 예약이 모두 이 길을 지난다.
- **FR-25** 작업 목록(`JobSidebar`)과 작업 화면은 기본 conf를 쓰는 작업의 remote가 env의 remote 목록에 없으면 "remote 없음"을 표시한다. env를 읽지 못했으면 표시하지 않는다.
- **FR-26** 북마크 패널은 remote 목록에 없는 북마크에 "remote 없음"을 표시한다.

## 5. 비기능 요구사항 (NFR-n)

- **NFR-1 안전 규칙 1** 모든 rclone 실행은 `runRclone`(허용 목록·차단 목록·명령줄 길이 확인)을 거친다. `shell: false`. remote 이름은 인자 배열의 개별 원소로만 넣고, 옵션 값은 rcd HTTP 본문으로만 보낸다(FR-14).
- **NFR-2 안전 규칙 6** conf 파일을 앱 코드에서 열지 않는다. `config show`·`dump`는 허용 목록에 넣지 않는다. `config redacted`는 FR-17 용도로만 쓴다(승인 2026-11-03).
- **NFR-3 비밀 값** 비밀 값·obscure 값·토큰·redacted 원문·rcd 인증 토큰은 로그·실행 이력·오류 문구·IPC 응답·renderer 상태·테스트 fixture에 남지 않는다. fixture는 임시 conf의 가짜 값만 쓴다.
- **NFR-4 테스트 격리** 단위·통합·E2E는 임시 폴더의 임시 conf만 쓴다(AGENTS.md 4.7·4.8). OAuth 실측은 수동 probe로만 하고 토큰은 저장하지 않는다.
- **NFR-5 응답성** providers 읽기는 캐시 후 다시 부르지 않는다. 추가·수정·삭제 명령의 시간 제한은 `RCLONE_TIMEOUTS`에 새 항목(초안: 30초)으로 둔다. OAuth만 10분.
- **NFR-6 직렬화** remote 설정 변경은 `clsRemoteOps`의 전역 큐를 쓴다. 같은 remote의 실행·비교 중에는 막는다.
- **NFR-7 접근성** 새 창은 `getByRole("dialog")`로 찾을 수 있고, 폼 칸은 레이블과 연결한다(E2E 규칙 4.7).
- **NFR-8 문구** UI 문구는 일어날 일을 쓴다(AGENTS.md 4.1).

## 6. 인터페이스 · 데이터 스키마

모두 **초안**이다. 확정은 T-01 probe와 §10 결정 뒤다.

### 6.1 IPC 채널 (`src/shared/ipc-contract.ts`)

| 채널 | 입력 | 출력 | 비고 |
| :--- | :--- | :--- | :--- |
| `remoteConfig:providers` | 없음 | `itfRemoteProvider[]` | 캐시 |
| `remoteConfig:get` | `{ name }` | `itfRemoteConfigView` | `[결정 Q2]` redacted 기반 |
| `remoteConfig:usage` | `{ name }` | `itfRemoteUsage` | FR-19 |
| `remoteConfig:create` | `typRemoteConfigCreateInput` | `{ name }` | OAuth 종류면 인증 세션을 시작하고 진행 이벤트를 보낸다 |
| `remoteConfig:update` | `typRemoteConfigUpdateInput` | `{ name, reauthSuggested: boolean }` | FR-18 |
| `remoteConfig:delete` | `{ name, disableSchedules: true }` | `itfRemoteDeleteResult` | 예약 켜진 참조가 있는데 `disableSchedules`가 없으면 `CONFIRM_REQUIRED` |
| `remoteConfig:reconnect` | `{ name }` | `{ name }` | FR-13 |
| `remoteConfig:answer` | `{ state, result }` | 다음 질문 또는 완료 | FR-15a. 진행 중인 세션만 |
| `remoteConfig:authCancel` | 없음 | `null` | 진행 중인 세션만 |
| 이벤트 `remoteConfig:authProgress` | — | `{ phase: "waiting" \| "done" \| "failed" \| "canceled" \| "timeout", authUrl?: string, expiresAt?: string, message?: string }` | `authUrl`은 127.0.0.1 주소만 통과 |

### 6.2 타입 (`src/shared/types/remote-config.ts`, 초안)

```ts
export interface itfRemoteOption {
    name: string;
    help: string;
    defaultText: string;
    required: boolean;
    advanced: boolean;
    secret: boolean;           // IsPassword || Sensitive  [probe]
    kind: "string" | "bool" | "int" | "duration" | "size" | "enum";
    choices: { value: string; help: string }[];
    exclusive: boolean;        // 선택지 밖 값 금지
}

export interface itfRemoteProvider {
    type: string;              // providers의 Prefix
    description: string;
    oauth: boolean;            // FR-4
    options: itfRemoteOption[];
}

export interface itfRemoteConfigView {
    name: string;
    type: string;
    values: Record<string, string>;   // 비밀 아닌 값만
    secretsSet: string[];             // 값이 있는 비밀 옵션 이름
}

export interface itfRemoteUsage {
    jobs: { id: string; name: string; autoSync: "off" | "app" | "os" }[];
    bookmarks: { id: string; alias: string }[];
    otherConfigJobs: number;          // 작업별 conf를 써서 세지 않은 작업 수(안내용)
}

export interface itfRemoteDeleteResult {
    name: string;
    disabledJobIds: string[];
}
```

### 6.3 입력 스키마 (`src/shared/schemas/remote-config.ts`, 초안)

```ts
zRemoteConfigCreateInput = z.object({
    name: zNewRemoteName,                       // FR-5
    type: z.string().min(1).max(64),
    values: z.record(z.string(), z.string().max(4096)),   // 비밀 아닌 값
    secrets: z.record(z.string(), z.string().max(4096)),  // 비밀 평문. main은 rc 본문에만 넣고 보관하지 않음
});
zRemoteConfigUpdateInput = z.object({
    name: zExistingRemoteName,
    values: z.record(...),                      // 바뀐 칸만
    secrets: z.record(...),                     // 바꿀 칸만
});
```

옵션 이름은 providers 정의에 있는 것만 받는다(main에서 재검증). `=`·줄바꿈이 들어간 키는 거부한다.

### 6.4 rclone 인자 (`command-builder.ts`, 초안, `[probe]`)

```
config providers
config redacted <name> --ask-password=false [--config C]
config delete <name> --ask-password=false [--config C]
rcd --rc-addr 127.0.0.1:0 --ask-password=false [--config C]       (env: RCLONE_RC_USER·RCLONE_RC_PASS)
  POST /config/create  { name, type, parameters, opt: { nonInteractive: true, obscure: true } }
  POST /config/create  { name, type, parameters: {}, opt: { nonInteractive: true, continue: true, state, result } }   (질문 답, FR-15a)
  POST /config/update  { name, parameters, opt: { nonInteractive: true, obscure: true } }
  POST /core/quit      {}
```

OAuth가 rcd 안에서 브라우저를 열고 53682에서 기다리는지, 그동안 HTTP 요청이 열린 채로 있는지는 `[probe]`(S1-2).

## 7. 예외 · 엣지 케이스

- **E-1 같은 remote 실행 중** 수정·삭제·재인증은 `BUSY`(FR-20). 메시지는 `busyMessageFor`를 쓴다.
- **E-2 CLI에서 동시에 바뀜** 앱이 목록을 읽은 뒤 사용자가 CLI로 같은 이름을 만들거나 지울 수 있다. 추가는 rclone 결과(이미 있음)를 그대로 보여 주고, 수정·삭제는 직전에 `listremotes`로 다시 확인해 없으면 `REMOTE_NOT_FOUND`.
- **E-3 열린 작업 편집기** 삭제 흐름이 작업의 자동 실행을 끄면 rev가 오른다. 같은 작업을 편집기에서 저장하지 않은 채 열어 두었으면 저장할 때 rev 충돌 안내가 나와야 한다(기존 충돌 처리 재사용, 확인 필요).
- **E-4 OS 예약 제거 실패** `schtasks` 삭제 실패 시 FR-22 (2)에서 멈추고 "작업 스케줄러에서 예약을 지우지 못해 remote를 지우지 않았습니다"를 보여 준다. 자동 실행은 꺼진 채로 둔다.
- **E-5 OS 예약을 쓸 수 없는 환경** (`OS_UNAVAILABLE`) OS 예약이 켜진 작업이 있어도 등록이 없을 수 있다. 해시가 없으면 통과로 본다.
- **E-6 OAuth 포트 충돌** rclone의 bind 실패 출력을 파싱해 `AUTH_PORT_IN_USE`("다른 프로그램이 53682 포트를 쓰고 있습니다")로 안내한다. 정확한 문구는 probe.
- **E-7 OAuth 중 앱 종료** before-quit에서 세션을 취소하고 FR-12 정리를 한 뒤 종료한다. 정리가 5초 안에 안 끝나면 그냥 종료하고, 다음 시작 때 정리하지 않는다(반쪽 remote는 사용자가 지운다 — §9 리스크 R-4).
- **E-8 헤드리스** `--run-job`에서는 `remoteConfig:*`가 등록되지 않는다. 인증 만료는 실행 실패로 기록한다(지금과 같음).
- **E-9 한 글자 이름** 새로 만들 때는 막는다(FR-5). 이미 있는 한 글자 remote는 목록에 경고와 함께 보이고 삭제만 할 수 있다(앱에서 `x:` 경로를 쓸 수 없으므로 수정·연결 테스트는 막는다).
- **E-10 providers 출력 변화** 모르는 필드는 무시하고, 필수 필드가 없으면 그 종류만 목록에서 뺀다(전체 실패로 만들지 않는다).
- **E-11 conf 없음** 처음 추가하면 conf가 생긴다(FR-8). 감지 순서상 `RCLONE_CONFIG`가 없는 파일을 가리키면 rclone이 그 경로에 만들 수 있다 `[probe]`.
- **E-12 암호화 conf** FR-15. 일반 conf와 같은 rcd 길로 추가·수정한다.
- **E-13 아주 긴 값** 옵션 값 4096자 제한, 전체 명령줄은 `assertCommandLength`가 막는다.

## 8. 수용 기준 (AC-n)

- **AC-1** Given 임시 conf, When 설정 화면에서 `alias` 종류로 이름 `it-alias`, remote 값을 넣어 저장하면, Then remote 목록·북마크 편집기·remote 고르기에 `it-alias`가 바로 나타나고 `연결 테스트`가 성공한다.
- **AC-2** Given 기존 remote `ab`, When 새 이름으로 `AB`·`x`·`a b`(허용 안 되는 문자)를 넣으면, Then 저장 버튼이 막히고 이유가 칸 아래 보인다.
- **AC-3** Given 비밀 옵션(`IsPassword`·`Sensitive` 각각 하나 이상)이 있는 종류, When 비밀 값을 넣어 저장하면, Then rclone 명령줄·앱 로그·IPC 응답 어디에도 평문·obscure 값이 없다(단위: 인자 배열·가림 결과, 통합: conf에 저장됨).
- **AC-4** Given 비밀 값이 설정된 remote, When 수정 화면을 열면, Then 비밀 아닌 값은 채워지고 비밀 칸은 "설정됨 — 바꿀 때만 입력"으로 비어 있으며 renderer가 받은 데이터에 비밀 값이 없다.
- **AC-5** Given 수정 화면에서 비밀 칸을 비워 두고 다른 값만 바꾸면, When 저장하면, Then `config update` 인자에 비밀 옵션이 없다.
- **AC-6** Given OAuth 종류 추가 대기 중, When `취소`를 누르거나 10분이 지나면, Then rclone 프로세스가 끝나고 그 이름의 remote가 conf에 남지 않는다(시작 전에 없던 이름일 때).
- **AC-7** Given 재인증 대기 중, When 취소하면, Then 기존 remote 설정이 그대로이고 목록에서 사라지지 않는다.
- **AC-8** Given remote `r1`을 쓰는 작업 3개(그중 앱 예약 1개, OS 예약 1개)와 북마크 1개, When 삭제를 누르면, Then 확인 창에 작업 3개·자동 실행 2개·북마크 1개가 보이고 버튼이 "작업 2개의 자동 실행을 끄고 삭제"다.
- **AC-9** Given AC-8에서 확인하면, Then 두 작업의 자동 실행이 꺼지고 `\rcloneGUI\` 아래 그 작업의 예약이 사라진 뒤 remote가 지워지며, 작업 3개와 북마크는 남아 "remote 없음"으로 표시된다.
- **AC-10** Given OS 예약 제거가 실패하도록 만든 상태, When 삭제하면, Then remote는 남고 자동 실행은 꺼진 상태이며 실패 이유가 보인다.
- **AC-11** Given 같은 remote로 실행 중, When 수정·삭제·재인증을 누르면, Then `BUSY` 안내가 나오고 아무것도 바뀌지 않는다.
- **AC-12** Given CLI에서 지워져 conf에 없는 remote를 쓰는 작업, When 비교·실행·자동 실행·`--run-job`을 하면, Then rclone을 부르기 전에 `REMOTE_NOT_FOUND`로 끝나고 이력에 그 문구가 남는다.
- **AC-13** 앱은 `config show`·`config dump`를 실행할 수 없다(허용 목록 단위 테스트).
- **AC-15** rcd는 `127.0.0.1`에만 열리고, 인증 없는 요청은 401을 받으며, 요청 흐름이 끝나면 프로세스가 남지 않는다(통합 테스트).
- **AC-16** Given Drive 추가, When rclone이 `config_shared_client_id` 질문을 내면, Then 앱 폼에 질문과 client_id 안내가 보이고 답이 rc 본문으로 전달된다(단위: 가짜 rc 응답).
- **AC-14** E2E: 임시 `RCLONE_CONFIG`로 추가 → 수정 → 삭제를 화면에서 하고 renderer 콘솔 오류가 0건이다.

## 9. 가정과 리스크

### 9.1 가정
- A-1 intent 미해결 질문은 §10대로 결정했다(2026-11-03).
- A-2 지원 rclone은 `MIN_RCLONE_VERSION` 1.65.0 이상(`rclone-env-parser.ts:30`)이고, 그 범위에서 `config providers`(JSON)·`config redacted`·rcd `config/create`(`opt.continue`)·`--rc-addr 127.0.0.1:0`이 있다(v1.75.1 확인, 1.65.0은 `[probe]`). 없으면 해당 기능만 끄고 CLI를 안내한다.
- A-3 북마크는 기본 conf의 remote를 가리킨다(`remote-service.ts`의 `f_AssertRemoteKnown`이 기본 conf로 확인).
- A-4 remote가 삭제돼도 북마크는 지우지 않는다(intent 결정은 "작업은 지우지 않는다"까지만 명시, 북마크도 같은 정책으로 본다).

### 9.2 리스크
- R-1 **안전 규칙 6 완화**: `config redacted`가 어떤 비밀을 가리지 못하면 conf 값이 앱 메모리에 들어온다. 대응: providers 비밀 표시로 이중 제거, 원문 비보관, 단위 테스트.
- R-2 **rcd 노출**: rcd가 떠 있는 몇 초 동안 같은 PC의 프로세스가 포트에 접근할 수 있다. 대응: loopback만, 실행마다 새 인증 토큰(환경 변수, 명령줄 아님), 흐름 뒤 즉시 `core/quit`, 웹 GUI·파일 서비스 금지.
- R-3 **OAuth 흐름이 버전마다 다름**: 비대화형 흐름의 질문 순서·출력이 rclone 버전에 따라 바뀔 수 있다. 대응: fixture 기반 파서, 알 수 없는 상태면 실패로 끝내고 CLI 안내.
- R-4 **반쪽 remote**: 앱 강제 종료 시 OAuth 추가 중인 remote가 토큰 없이 남을 수 있다. 목록에서 사용자가 지울 수 있으므로 자동 정리는 하지 않는다.
- R-5 **실행 전 `listremotes` 비용**: 비교·실행마다 rclone을 한 번 더 부른다(수십 ms). 자동 실행 tick에는 영향이 작다.
- R-6 **참조 계산 누락**: 작업별 conf를 쓰는 작업은 세지 않는다. 확인 창에 `otherConfigJobs`로 "다른 rclone.conf를 쓰는 작업 N개는 확인하지 않았습니다"를 함께 보여 준다.

## 10. 결정된 질문 (2026-11-03, 사용자 승인)

- **Q1 비밀 값 전달 → rcd HTTP 본문.** `obscure -`(stdin)와 `--no-obscure`는 동작하지만 `Sensitive` 옵션을 못 막고, obscure 값은 되돌릴 수 있다. 환경 변수는 conf에 기록되지 않는다. FR-14·FR-15, 안전 규칙 1 보완.
- **Q2 수정 화면 → `config redacted` + 이중 제거.** 안전 규칙 6 예외 승인. 가려지는 범위가 넓어 채워지는 칸은 비밀 아닌 옵션뿐이다. FR-17.
- **Q3 OAuth 대기 → 한 건만·10분·취소·반쪽 정리·포트 변경 없음.** FR-10~FR-12.
- **Q4 이름 변경 → 지원하지 않음.** INBOX에 캡처.
- **Q5 IPC 이름 → `remoteConfig:*`.** 기존 `remotes:*`(북마크)는 그대로.
- **Q6 작업별 conf → 범위 밖.** 참조 수는 기본 conf를 쓰는 작업만 센다(FR-19, `otherConfigJobs` 안내).
- **Q7 이름 규칙 → 공백 금지·두 글자 이상·`-`로 시작·끝 금지.** 기존 공백 이름은 계속 쓸 수 있다. FR-5.
- **Q8 OAuth 질문 → 범용 질문 폼.** 기본값으로 넘기면 Drive가 첫 질문(기본값 false)에서 client_id 입력으로 간다. `config_is_local`만 자동 답. FR-15a.
