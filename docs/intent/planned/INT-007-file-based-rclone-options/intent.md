---
id: INT-007
title: 제외 패턴을 --filter-from 파일로 전달해 명령줄 전용 패턴 제한과 뒤 공백 버그 해소
status: planned
priority: P2
created: 2026-11-03
updated: 2026-11-03
---

# Intent: 제외 패턴을 --filter-from 파일로 전달해 명령줄 전용 패턴 제한과 뒤 공백 버그 해소

> 출처: 2026-11-03 사용자 요청("설정 파일을 만들어 rclone이 그 파일을 읽게 하는 구조"). 같은 날 검토와 실측(rclone-notes #46~#50)으로 범위를 좁혔다.
> 처음 범위였던 "모든 rclone 옵션을 파일로 전달"은 rclone에 작업 설정 파일·인자 파일(`@file`, #46)이 없어 rc(`rcd` + `sync/sync`) 전환만 가능했다. 이익(명령줄 해소)에 비해 실행·파서·중지·안전 게이트를 다시 짜야 해서 범위에서 뺐고, INBOX 아이디어로 남겼다.

## 문제 (Problem)
- 명령줄 한도가 사용자 설정을 막는 곳은 제외 패턴뿐이다. 나머지 인자는 경로 3개(각 4096자 이하)와 짧은 플래그라 Windows 한도(32,767자)에 닿지 않는다.
- 제외 패턴은 `--exclude-from` 파일로 넘기는데, 이 파일은 `#`·`;`로 시작하는 줄을 주석으로 읽고 줄 앞뒤 공백을 지운다(#18). 그래서 그런 패턴은 `--exclude` 인자로 따로 넘기고(`isFileSafePattern`), 그 길이 합이 16,000자(`EXCLUDE_ARG_ONLY_BUDGET`)를 넘으면 저장을 막는다.
- **버그**: 뒤 공백이 있는 패턴은 인자로 넘겨도 rclone이 공백을 지운다(#48). 사용자가 저장한 패턴(`name `)과 다른 규칙(`name`)이 적용된다.
- 패턴 수·길이에 따라 인자/파일 두 경로로 나뉘어(64개·8,000자 기준) 비교·실행·해시 계산이 복잡하다.

## 제안 결과 (Proposed outcome)
- 제외 패턴이 하나라도 있으면 실행마다 `--filter-from` 파일 하나로 넘긴다. 모든 줄은 `- <패턴>` 형식이고, 패턴 뒤 공백은 `[ ]`로 바꿔 쓴다(#47·#48).
- `#`·`;`·`!`·앞뒤 공백 패턴이 저장한 그대로 적용되고, 인자 전용 패턴 예산으로 저장을 막는 경우가 없어진다.
- 비교·미리보기·사전 확인·실제 전송·자동/OS 예약 실행이 모두 같은 필터 파일 방식을 쓴다. 사용자에게 보이는 비교 결과·진행률·남은 시간·이력·안전 확인 흐름은 그대로다.
- 명령줄 길이 검사(`assertCommandLength`)는 경로가 긴 경우를 위한 안전장치로 남긴다.

## 영향 사용자 및 시스템 (Affected users and systems)
- `src/shared/exclude-patterns.ts`(`planExcludeTransport`·`isFileSafePattern`·`excludesSaveIssue`), `src/shared/option-limits.ts`(`EXCLUDE_FILE_MIN_*`·`EXCLUDE_ARG_ONLY_BUDGET`)
- `src/main/services/effective-excludes.ts`(파일 내용·`snapshotHash`), `exclude-file.ts`(임시 파일 수명주기), `plan-token.ts`(버전)
- `src/main/rclone/command-builder.ts`(`--exclude`/`--exclude-from` → `--filter-from`, 머리 주석)
- 사용처: `compare-service.ts`, `run-service.ts`(`spawnTransfer`), `scheduler.ts`, `os-run-queue.ts`, 폴더 탐색
- 작업 편집기의 제외 패턴 저장 오류 문구
- 테스트: `tests/unit/command-builder.test.ts`·제외 패턴 단위 테스트, 통합 테스트(`excl-*` 계열), E2E
- 문서: `docs/specs/MVP_SPEC.md`, `docs/knowhow/rclone-notes.md`(#18·#20 영향 갱신), `docs/CHANGELOG.md`

## 제약 (Constraints)
- AGENTS.md 안전 규칙 1~3은 바꾸지 않는다. rclone 실행은 지금처럼 `spawn` + `shell: false`, 실제 전송 시작은 `spawnTransfer` 한 곳이다.
- 필터 파일에는 앱이 만든 `- ` 제외 규칙만 쓴다. `+`(포함)·`!`(초기화) 줄을 만들지 않는다(단위 테스트로 강제). 차단 목록(`--delete-excluded` 등)과의 관계는 지금과 같다.
- 파일은 BOM 없는 UTF-8·LF, `userData/exclude-files/` 안에 `wx`로 만들고 다시 읽어 확인한다. 실행이 끝나면 지우고, 비정상 종료 뒤에는 시작할 때 정리한다(지금 `writeExcludeFile` 방식). BOM이나 잘못된 줄은 rclone이 `malformed rule`로 실패시킨다(#49).
- 전달 방식이 바뀌면 `snapshotHash` 버전을 올린다. 계획 토큰은 이 해시를 입력으로 받으므로 토큰 버전(`4`)은 그대로 두어도 달라진다. 업데이트 직전에 만든 비교 계획은 다시 비교해야 한다.
- 필터 파일 내용(패턴)은 로그·이력·fixture에 남기지 않는다. 이력에는 패턴 수와 `snapshotHash`만 남긴다. 실패한 실행의 파일도 보관하지 않는다.
- `process.ts`의 `RCLONE_*` 환경 변수 제거는 그대로 둔다(환경 변수 전달은 쓰지 않는다).
- 최소 rclone 버전 1.65.0, 검증 버전 1.75.1에서 같은 결과가 나와야 한다.

## 미해결 질문 (Open questions)
- [x] 전달 방식 — `--filter-from` + 최소 인자. 인자 파일 미지원(#46), 환경 변수는 `RCLONE_*` 제거 방어와 충돌, rc는 범위 밖(INBOX)
- [x] rc 비동기 작업의 진행률·중지 — rc를 쓰지 않으므로 해당 없음. rc를 다시 검토할 때의 통과 조건(`core/stats`가 지금 stats 파서와 같은 정보, `job/stop` 뒤 자식 프로세스 없음)은 INBOX 항목에 적었다
- [x] 파일로 옮길 수 없는 인자 — 하위 명령·경로·`--config`·`--backup-dir`·플래그만 남는다. `assertCommandLength`는 유지하고 인자 전용 패턴 예산은 없앤다
- [x] MVP_SPEC "설정 파일" 기준 — "작업 옵션은 앱 DB에 저장하고, rclone에는 실행마다 만든 필터 파일과 최소 인자로 넘긴다. rclone에는 작업 설정 파일 기능이 없다"로 다시 쓴다(T-04)
- [x] 파일 내용 로그·보관 — 남기지 않는다(패턴 수와 해시만)
- [x] 패턴이 없을 때도 빈 필터 파일을 넘길지 — 넘기지 않는다. 빈 필터 파일은 규칙 0개·exit 0이라 넘기지 않은 것과 같다(spec §6.3·§10 Q-1)
- [ ] 최소 버전 1.65.0에서 #47~#49와 spec §6.3 F7·F8이 같은지 — T-05

## 작업 (Tasks)
- [x] T-01 [P2] probe: 인자 파일, `--filter-from`의 `- ` 접두사·뒤 공백·`[ ]`·BOM·CRLF·접두사 없는 줄·인자와 합치기 (probe `filter` 묶음, fixture `filter-*`·`argfile-at`, rclone-notes #46~#50, v1.75.1)
- [ ] T-02 [P2] 필터 파일 빌더: 모든 패턴을 `- <패턴>` 줄로(끝 공백 문자 → `[<문자>]`, 집합은 rclone이 지우는 Go `unicode.IsSpace`와 같게 — U+0085 포함, spec FR-3), 패턴이 있으면 늘 파일, `--exclude-from` → `--filter-from`, `+`·`!` 줄 금지, `snapshotHash` 버전 올림(계획 토큰 버전 `4` 유지). 단위 테스트(`#`·`;`·`!`·앞뒤 공백·`[`·유니코드 공백이 든 패턴)
- [ ] T-03 [P2] 비교·미리보기·사전 확인·실제 전송·자동/OS 예약·폴더 탐색을 새 빌더로 전환, 게이트 불변 확인. 통합 테스트(뒤 공백 패턴이 실제로 그 이름만 빼는지 포함)
- [ ] T-04 [P2] 제한 정리(`EXCLUDE_ARG_ONLY_BUDGET`·`EXCLUDE_FILE_MIN_*`·`isFileSafePattern` 제거, 저장 오류 문구), MVP_SPEC·rclone-notes #18·#20 영향·CHANGELOG 갱신, E2E
- [ ] T-05 [P3] rclone 1.65.0에서 probe `filter` 묶음 재실행, 다르면 notes 기록과 대응
