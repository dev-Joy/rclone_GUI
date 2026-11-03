---
id: INT-006
title: 앱에서 rclone remote 추가·수정·삭제·재인증
status: planned
priority: P2
created: 2026-11-03
updated: 2026-11-03
---

# Intent: 앱에서 rclone remote 추가·수정·삭제·재인증

> 출처: 2026-11-03 사용자 요청("앱에서 remote 추가 기능"). 지금은 README 1.1의 `rclone config` 대화형 CLI로만 remote를 만들 수 있다.

## 문제 (Problem)
- remote를 쓰려면 PowerShell에서 `rclone config` 대화형 메뉴를 직접 다뤄야 한다. 앱은 이미 만들어진 remote를 고르기(리모트 북마크·탐색)만 한다.
- 인증이 만료되면 앱은 `rclone config reconnect <remote>:` 명령을 안내만 하고, 사용자가 다시 CLI로 가야 한다.
- 한 글자 이름처럼 앱에서 쓸 수 없는 remote도 CLI에서 만든 뒤에야 알게 된다.
- 영향: CLI에 익숙하지 않은 사용자, cloud remote(Google Drive 등)를 처음 연결하는 사용자, 인증 만료를 겪는 사용자.

## 제안 결과 (Proposed outcome)
- 설정 화면에서 rclone이 지원하는 **모든 remote 종류**를 골라 추가할 수 있다. 입력 칸은 `rclone config providers`의 옵션 정의(필수·선택·고급·비밀 값·선택지)로 자동 생성한다.
- OAuth가 필요한 종류(Google Drive·OneDrive·Dropbox 등)는 앱에서 시작하면 브라우저 로그인으로 이어지고, 끝나면 앱에 결과(성공/실패)가 표시된다. client_id·client_secret 입력도 지원한다.
- 기존 remote를 **수정·삭제·재인증**할 수 있다. 삭제·수정 전에는 그 remote를 쓰는 작업·북마크·예약 수를 보여 주고 확인을 받는다.
- 추가·수정 직후 remote 목록·북마크 화면이 새 값으로 갱신되고, `연결 테스트`로 바로 확인할 수 있다.
- 앱에서 쓸 수 없는 이름(한 글자·금지 문자·중복)은 저장 전에 막는다.

## 영향 사용자 및 시스템 (Affected users and systems)
- main: `src/main/rclone/command-builder.ts`(config providers·create·update·delete·reconnect 인자), `src/main/rclone/process.ts`(대화형·OAuth 대기·취소), `src/main/services/remote-service.ts`·`remote-ops.ts`(직렬 큐·BUSY), 새 providers 출력 파서(`src/main/parsers/`)
- shared: `src/shared/ipc-contract.ts` remotes 채널 추가, zod 스키마, `remote-name.ts` 이름 규칙
- renderer: `src/pages/SettingsPage.tsx`, `RemoteBookmarksPanel`·`RemotePicker` 목록 갱신, 새 remote 편집기·삭제 확인 창
- 실행 중 작업·OS 예약(`os-run-queue`)과의 동시성, 작업이 참조하는 remote 이름
- 테스트: providers 출력 fixture(probe), 단위(인자 생성·파서·이름 검증), 통합(임시 conf의 local/memory/alias 종류), E2E(임시 `RCLONE_CONFIG`)

## 제약 (Constraints)
- **rclone.conf는 rclone이 쓴다**(사용자 결정): 앱은 `rclone config create/update/delete/reconnect`를 `spawn(rcloneExe, args[], { shell: false })`로만 실행하고 conf 파일을 직접 열거나 쓰지 않는다(AGENTS.md 안전 규칙 1·6 유지). 위치는 지금의 conf 경로 결정 순서를 그대로 쓴다.
- 비밀 값(비밀번호·토큰·client_secret)은 로그·이력·오류 문구·IPC 응답·테스트 fixture에 남기지 않는다. `rclone config show/dump`처럼 conf 내용을 출력하는 명령은 차단 목록(`--dump*`)과 같은 수준으로 다룬다.
- 실제 사용자 conf·remote로 테스트하지 않는다(임시 conf만, AGENTS.md 4.7·4.8).
- 실행·비교·탐색 중인 remote는 수정·삭제를 막는다(`BUSY`).
- conf가 암호화(`RCLONE_CONFIG_PASS`)된 경우의 동작은 기존 `--ask-password=false` 정책과 충돌하지 않아야 한다.

## 미해결 질문 (Open questions)
- [x] 비밀 값을 명령 인자로 넘기면 같은 사용자의 다른 프로세스가 명령줄을 볼 수 있다. 환경 변수·`--obscure`·rclone의 `--continue/--state` 비대화형 흐름 중 무엇으로 넘길지 (probe 필요) → **결정(2026-11-03): 짧게 띄운 rcd에 HTTP 본문으로 넘긴다**(아래 제안 대신)
  - 실측(rclone-notes #39~#42): obscure는 `IsPassword` 옵션 36개에만 적용되고, `Sensitive` 옵션 206개(S3 `secret_access_key`, Drive `client_secret` 등)는 평문으로 저장된다. 환경 변수 `RCLONE_CONFIG_<NAME>_<OPT>`는 conf에 기록되지 않는다. `rcd --rc-addr 127.0.0.1:0` + `config/create`는 본문의 평문을 저장하고, 암호화 conf에서도 된다.
  - rcd 조건: loopback·임의 포트, 실행마다 새 인증 토큰(환경 변수), `config/create`·`update`·`core/quit`만 호출(`config/get`은 obscure 값을 돌려주므로 금지), 흐름 뒤 즉시 종료. AGENTS.md 안전 규칙 1에 반영.
  - **제안(Claude, 2026-11-03)**: 평문은 stdin으로만 넘긴다. `rclone obscure -`(stdin 입력)로 obscure 값을 받고, `config create/update`에는 그 값과 `--no-obscure`를 준다.
  - 근거: 같은 사용자는 rclone.conf를 직접 읽을 수 있고, conf에도 같은 obscure 값이 들어간다. 그래서 명령줄 노출이 conf 노출보다 넓지 않다. 평문이 작업 관리자·프로세스 목록에 보이는 것만 막으면 된다.
  - 앱이 남기는 기록이 더 위험하다. 실행 인자를 로그·이력·오류 문구에 남길 때 비밀 옵션(`IsPassword`·`Sensitive`) 값은 `***`로 가린다. 단위 테스트로 강제한다.
  - 예외: 암호화된 conf(`RCLONE_CONFIG_PASS`)는 conf가 보호되므로 명령줄 노출이 실제로 더 넓어진다. probe에서 환경 변수(`RCLONE_CONFIG_<REMOTE>_<OPT>`)·rc API로 넘길 수 있는지 확인하고, 안 되면 암호화 conf에서는 비밀 값 입력을 막고 CLI를 안내한다.
  - `--continue/--state` 흐름도 답을 인자로 넘기므로 노출 문제를 풀지 못한다. OAuth 질문 처리에만 쓴다.
- [x] 수정 화면에 기존 값을 채우려면 conf 내용을 읽어야 한다. 비밀이 아닌 값만 보여 줄 방법(`config show` 출력에서 비밀 옵션 가리기 vs 비밀 값은 "바꿀 때만 입력") → **결정(2026-11-03): 제안대로(`config redacted` + 이중 제거), 안전 규칙 6 예외 승인**
  - 실측(notes #43): redacted는 `IsPassword`·`Sensitive`를 모두 가린다(sftp host·user 포함). 채워지는 칸은 비밀 아닌 옵션뿐이다.
  - **제안(Claude, 2026-11-03)**: 두 방식을 함께 쓴다. `rclone config redacted <remote>`(비밀 값을 rclone이 가린 출력)를 probe해서 쓰고, 비밀 값은 "설정됨 — 바꿀 때만 입력"으로 보여 준다.
  - 이중 방어로 main이 providers 정의의 비밀 옵션과 `token`을 한 번 더 버린다. renderer에는 `{ 비밀 아닌 값, secretSet: boolean }`만 넘긴다. 출력 원문은 로그·IPC·fixture에 남기지 않는다(fixture는 임시 conf의 가짜 값만).
  - `config show/dump`는 쓰지 않는다. `redacted`가 없거나 가리지 못하는 옵션이 있으면 그 옵션은 "바꿀 때만 입력"으로 처리한다.
  - AGENTS.md 안전 규칙 6("conf를 앱 코드에서 읽지 않는다")과 부딪힌다. "rclone의 redacted 출력에서 비밀 아닌 값만 화면에 쓴다"는 예외를 사용자가 승인해야 하며, 승인하면 규칙 6에 한 줄 추가한다.
- [x] OAuth 대기 중 앱 종료·취소·포트(53682) 충돌·시간 제한 처리 → **결정(2026-11-03): 제안대로, 시간 제한만 10분**
  - OAuth 중 rclone 질문은 기본값으로 넘기지 않고 범용 질문 폼으로 받는다(notes #45: Drive 첫 질문 `config_shared_client_id`의 기본값이 false). `config_is_local`만 자동 true.
  - **제안(Claude, 2026-11-03)**: OAuth는 앱 전체에서 한 번에 하나만 진행한다(`remote-ops` 직렬 큐).
  - 취소·시간 제한(10분)·앱 종료 때는 rclone 프로세스 트리를 끝낸다. 대기 중에는 남은 시간과 `취소` 버튼을 보여 준다.
  - 포트 충돌: rclone 출력의 bind 실패를 파싱해 "다른 프로그램(다른 rclone 인증 등)이 53682 포트를 쓰고 있습니다"로 안내한다. 포트를 바꾸는 옵션은 1차 범위에서 뺀다(공용 client_id의 redirect URL이 고정이라 효과가 적다).
  - 새로 추가하다 실패·취소하면 이번 시도에서 앱이 만든 remote만 `config delete`로 지운다. 토큰 없는 반쪽 remote를 남기지 않는다. 재인증(`reconnect`)이 실패하면 기존 설정을 그대로 둔다.
  - 헤드리스(OS 예약·`--run-job`)에서는 OAuth를 절대 시작하지 않는다. 인증 만료는 실행 실패로 기록하고 앱에서 재인증하라고 안내한다.
- [x] 이름 변경을 지원할지(rclone은 rename이 없어 create+delete) — 작업·북마크 참조 갱신 포함 여부 → **결정(2026-11-03): 제안대로 지원하지 않음, INBOX 캡처**
  - **제안(Claude, 2026-11-03)**: INT-006에서는 지원하지 않는다. 편집 화면의 이름 칸은 읽기 전용으로 두고, 필요하면 `_ideas/INBOX.md`에 따로 캡처한다.
  - 근거: create+delete로 바꾸려면 비밀 값까지 옮겨야 하는데 앱은 비밀 값을 읽지 않는다(질문 2). 작업·북마크·예약 참조를 DB와 conf에 걸쳐 원자적으로 바꾸기도 어렵다. 중간에 실패하면 같은 설정의 remote가 둘 생기거나 참조가 끊긴다.
  - 대안 안내: "새 이름으로 추가 → 작업에서 remote 바꾸기 → 기존 remote 삭제". 삭제 결정(질문 5)의 참조 작업 표시가 이 흐름을 돕는다.
- [x] (spec 조사 중 추가) IPC 이름·작업별 conf·새 이름 규칙 → **결정(2026-11-03)**: 새 채널은 `remoteConfig:*`(기존 `remotes:*`는 북마크). 작업별 conf의 remote 관리는 범위 밖이고 참조 수는 기본 conf 작업만 센다. 새 이름은 공백·한 글자·`-`로 시작·끝 금지(notes #44), 기존 공백 이름은 계속 쓸 수 있다.
- [x] 삭제 시 그 remote를 쓰는 작업·OS 예약을 어떻게 할지 → **결정(2026-11-03): 혼합**
  - 실행·비교·탐색 중이면 막는다(`BUSY`).
  - 자동 실행(앱 예약·OS 예약)이 켜진 참조 작업은 확인 창에서 "작업 N개의 자동 실행을 끄고 삭제"로 한 번에 처리한다(OS 예약 등록도 제거). 다시 켜는 것은 사용자가 직접 한다.
  - 예약 없는 작업·북마크는 경고 후 삭제하고, 작업은 지우지 않고 "remote 없음"으로 표시한다.
  - 순서: 자동 실행 끄기·OS 예약 제거 → `rclone config delete`. 중간 실패 시 "예약은 꺼지고 remote는 남은" 쪽으로 끝난다.
  - 이유: 같은 이름으로 다른 저장소를 다시 만들면 살아 있는 예약이 삭제 포함 sync를 엉뚱한 대상에 돌릴 수 있다. 오류 상태로만 두면 OS 예약이 주기마다 실패·재시도한다. 완전 차단은 작업 설정을 지우게 만들어 불편하다.
  - CLI에서 지운 경우도 같으므로, 실행 전에 remote가 있는지 확인하고 `REMOTE_NOT_FOUND`로 안내한다(rclone 원문 오류 대신).

## 작업 (Tasks)
- [ ] T-01 [P2] probe: `config providers`·delete·`config redacted` 가림 범위, rcd `config/create`·`update`(질문 흐름 `continue/state/result`)·`core/quit`·인증 없는 요청, OAuth(rcd 안 브라우저·53682 대기·포트 충돌·취소)·재인증 출력 실측과 rclone-notes·fixture (결정용 1차 실측은 notes #39~#45)
- [ ] T-02 [P2] providers 파서·옵션 스키마와 동적 입력 폼(모든 종류, 고급 옵션 접기)
- [ ] T-03 [P2] remote 추가(비OAuth) — main 명령·IPC·이름 검증·목록 갱신
- [ ] T-04 [P2] OAuth 종류 추가와 재인증 — 브라우저 연동·대기·취소
- [ ] T-05 [P2] remote 수정·삭제 — 참조 작업·예약 표시, 확인 창, BUSY, 삭제 시 참조 작업 자동 실행 끄기·OS 예약 제거, 작업 목록 "remote 없음" 표시, 실행 전 remote 존재 확인(`REMOTE_NOT_FOUND`)
- [ ] T-06 [P3] README·CHANGELOG·MVP_SPEC·E2E 반영
