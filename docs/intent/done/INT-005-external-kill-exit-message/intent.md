---
id: INT-005
title: rclone이 외부에서 강제 종료됐을 때 이해할 수 있는 실패 안내
status: done
priority: P2
created: 2026-11-03
updated: 2026-11-03
---

# Intent: rclone이 외부에서 강제 종료됐을 때 이해할 수 있는 실패 안내

> 출처: 2026-11-03 Google Drive 대상 수동 copy 실행(647개 중 435개 복사, 29분 17초)이 "복사 실패: rclone이 오류로 끝났습니다(exit 4294967295)."로 끝난 건. 실행 로그·app.log를 확인한 결과.

## 문제 (Problem)
- 종료 코드 `4294967295`는 Windows 종료 코드 `-1`(0xFFFFFFFF)을 부호 없는 값으로 표시한 것이다. rclone 자체 종료 코드(0~10)가 아니다.
- 해당 실행 로그에는 warning·error가 0건이고, 종료 0.6초 전까지 `Copied (new)`가 정상 기록됐다. 앱의 중지 요청 기록도 없다(앱 중지는 taskkill로 exit 1). 즉 rclone이 오류를 낸 것이 아니라 **바깥에서 강제로 끝났다**(다른 프로그램·백신·작업 관리자·OS 등, 정확한 주체는 미확인).
- 그런데 화면은 일반 "rclone 오류"로만 보여 사용자는 설정·경로를 고쳐야 하는지, 다시 실행하면 되는지 판단할 수 없다. `-1` 대신 큰 숫자가 나와 더 혼란스럽다.
- 영향: 수동·자동·Windows 예약 실행을 쓰는 모든 사용자(실행 결과 화면, 이력, 알림).

## 제안 결과 (Proposed outcome)
- rclone 오류 줄과 Go 충돌 메시지 없이 외부 종료 코드(2026-11-03 T-01 probe 실측으로 `-1` 확정)로 끝나면 "rclone이 외부에서 종료된 것으로 보입니다. 오류 기록은 없습니다." 같은 문구와 할 일("다시 비교한 뒤 실행하면 남은 파일만 복사합니다", 반복되면 백신·다른 프로그램 확인)을 보여준다.
- 그 밖의 NTSTATUS 범위(0xC0000005·0xC00000FD·0xC0000409 등)는 외부 종료가 아니라 "rclone이 비정상 종료했습니다(충돌 가능)"로 따로 안내하고 NTSTATUS 이름을 함께 보여준다.
- 종료 코드는 int32로 정규화해 사람이 읽을 수 있게 표시하고 이력에도 남긴다(예: `-1 (0xFFFFFFFF)`).
- 실행 상태는 `failed` 그대로이고 오류 코드(`RCLONE_KILLED`)로만 구분한다. 안전 게이트(재실행 시 비교 계획 토큰·삭제 확인)와 연속 실패 경고 집계는 지금과 같다 — 문구와 분류만 바뀐다.

## 영향 사용자 및 시스템 (Affected users and systems)
- `src/main/parsers/run-output.ts` `decideRunOutcome`(종료 코드 → 오류 코드·문구, stderr 끝부분 Go 충돌 메시지 확인), 새 오류 코드 `RCLONE_KILLED`(필요 시 충돌용 코드 하나)를 `src/shared` 타입에 추가 — `zRunStatus`는 바꾸지 않는다
- `src/main/services/run-service.ts` 종료 로그 줄(`exit=` 표기), 이력 상세·실행 결과 화면·자동 실행 알림 문구
- `src/main/services/scheduler.ts` 연속 실패 경고 문구(마지막 실패가 `RCLONE_KILLED`이면 외부 종료 반복 안내, 집계 조건은 불변)
- `scripts/probes/rclone-probes.mjs` `kill` 묶음과 `tests/fixtures/rclone/` 실측 fixture
- 단위 테스트 `tests/unit` (decideRunOutcome 분기)

## 제약 (Constraints)
- AGENTS.md 안전 규칙 1·2 불변: 전송 시작 경로·게이트를 바꾸지 않는다. 자동 재시도는 하지 않는다.
- 사용자 경로·remote 이름을 문구·테스트·fixture에 넣지 않는다.
- 외부 종료 주체는 앱이 알 수 없으므로 원인을 단정하는 문구를 쓰지 않는다.
- exit 1은 `taskkill /F`·작업 관리자·앱 자신의 중지와 rclone 자체 오류(사용법 오류)를 구분할 수 없으므로(T-01 실측: taskkill = exit 1) 외부 종료로 분류하지 않는다. CIM `Terminate`(Reason 생략)처럼 exit 0으로 끝나는 외부 종료도 정상 종료와 구분할 수 없다. 이 한계를 rclone-notes와 spec에 남긴다.

## 미해결 질문 (Open questions)
- [x] 비정상 종료를 `failed` 그대로 둘지, 별도 상태로 나눌지 → **결정(2026-11-03): `failed` 유지 + 오류 코드 `RCLONE_KILLED`로 구분.**
  - 근거: 외부 종료가 반복되는 경우야말로 연속 실패 경고(`scheduler.ts` `countFailure`, `failed`/`partial`만 집계)가 떠야 한다. `zRunStatus`는 SQLite에 저장되는 enum이라 상태를 늘리면 이력 필터·`history-view`/`run-view` 색 분기·`partial-files.ts`·스케줄러를 모두 고쳐야 해 "문구와 분류만" 범위를 넘는다. 판별 신호도 일부만 잡히므로(아래 Q2) 영구 상태로 만들 근거가 약하다.
  - 기존 `interrupted`(앱이 실행 도중 종료, 결과 알 수 없음, `INTERNAL`)는 뜻이 달라 재사용하지 않는다.
  - 화면은 `error.code`로 문구·배지만 바꾸고, 연속 실패 알림은 마지막 실패가 `RCLONE_KILLED`이면 외부 종료 반복 안내로 바꾼다.
- [x] 어떤 종료 코드를 "외부 종료"로 볼지 → **결정(2026-11-03): 아래 규칙으로 분류하고 코드 값은 T-01 probe 실측으로 `-1` 확정.**
  - 0~10: 지금처럼 rclone 종료 코드로 처리.
  - `-1`(0xFFFFFFFF)이면서 오류 줄이 없고 stderr 끝부분에 Go 충돌 메시지(`panic:`·`fatal error:`)가 없음 → `RCLONE_KILLED`("외부에서 종료된 것으로 보입니다").
  - 그 밖의 0xC0000000 이상(0xC0000005·0xC00000FD·0xC0000409 등) → 충돌로 따로 안내(NTSTATUS 이름 표시), 외부 종료 아님.
  - exit 1은 표지 없이는 분류하지 않는다(제약 참고). Ctrl+C는 exit 1 + `Signal received: interrupt` 로그로 끝나(실측) 그 표지가 있으면 외부 종료로 본다.
  - 실측(v1.75.1 Windows, `--only=kill`): `Stop-Process -Force`·.NET `Process.Kill()` = `4294967295`(-1), `taskkill /F`·`/T /F` = 1, CIM `Terminate`(Reason 생략) = 0, Ctrl+C = 1 + `Signal received: interrupt`. `0xC000013A`는 재현되지 않았다. 앱 자신의 경로(`killProcessTree`, `taskkill /T /F`)는 1이다.
- [x] 이번 건의 실제 종료 주체 확인 여부 → **결정(2026-11-03): 사용자가 30분 안에서 확인하고 결과는 "출처"에 붙인다. 구현(T-01·T-02)을 막는 조건이 아니다.**
  - 볼 곳(종료 시각 ±2분): `Microsoft-Windows-Windows Defender/Operational` 1116/1117, 응용 프로그램 로그 1000/1001(WER — rclone 기록이 있으면 외부 종료가 아니라 충돌이므로 가설 재검토), 시스템 로그 1074/6008, 같은 시각에 실행된 예약 작업·스크립트(-1이면 .NET 계열 종료 도구 후보).
  - 반복되면 선택적으로 Sysmon 이벤트 10(ProcessAccess, `rclone.exe`에 PROCESS_TERMINATE 요청)으로 종료 주체를 기록한다.

## 작업 (Tasks)
- [x] T-01 [P2] probe `kill` 묶음: 임시 폴더에서 `--bwlimit`로 느린 copy를 띄워 `taskkill /F`·`taskkill /T /F`·`Stop-Process -Force`·.NET `Process.Kill()`·CIM `Terminate()`·앱 `killProcessTree`로 종료하고 `exitCode`·`signal`·stderr 끝부분을 `tests/fixtures/rclone/`에 저장(작업 관리자 종료는 수동 1회), rclone-notes 기록 — 완료: probe `kill` 6방식 실측, fixture 18개, rclone-notes #58~#62. `0xC000013A` 미재현, exit 1·0은 외부 종료와 구분 불가한 한계를 notes·spec에 문서화
- [x] T-02 [P2] decideRunOutcome 분류(`RCLONE_KILLED`·충돌·exit 1 불변, Go 충돌 메시지 확인)·문구·int32/16진 종료 코드 표기, T-01 fixture 값으로 단위 테스트 — 완료: shared `exit-code.ts`, `RCLONE_KILLED`·`RCLONE_CRASHED`, `decideRunOutcome` 분기, run-service exitCode 정규화·로그 표기, AC-1~AC-8·AC-15~AC-17 테스트
- [x] T-03 [P3] 실행 결과·이력·알림 문구(연속 실패 경고 포함) 반영, `drive-app`으로 실행 중 rclone을 밖에서 `Stop-Process`로 종료해 화면·이력·알림 확인, CHANGELOG — 완료: 스케줄러 연속 실패 문구, HistoryDetail 종료 코드 표기, drive-app AC-13 실측(Stop-Process로 실행 중 종료 → 외부 종료 문구·exitCode -1·로그 `exit=-1(0xFFFFFFFF)`·콘솔 오류 0) 112건 통과, CHANGELOG·MVP_SPEC 갱신

## 결과 (Result)
- 외부 종료(`-1`)·충돌(NTSTATUS)·rclone 오류를 나눠 안내하고 종료 코드를 int32/16진으로 표기한다(T-01~T-03).
- 최종 검증: unit 1,312·통합 77(+19 skip)·E2E 15·`build:win`·drive-app 112 통과.
- 남은 것: exit 1(`taskkill /F`·작업 관리자)과 exit 0(CIM `Terminate`)은 외부 종료로 구분할 수 없다(spec R-1 한계).
- 완료일: 2026-11-03
