---
id: INT-005
title: rclone이 외부에서 강제 종료됐을 때 이해할 수 있는 실패 안내
status: planned
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
- rclone 오류 줄 없이 비정상 종료 코드(`-1`/0xFFFFFFFF, `0xC000013A` 등 NTSTATUS 범위)로 끝나면 "rclone이 외부에서 강제로 종료되었습니다. 오류 기록은 없습니다." 같은 문구와 할 일("다시 실행하면 남은 파일만 복사합니다", 반복되면 백신·다른 프로그램 확인)을 보여준다.
- 종료 코드는 사람이 읽을 수 있게 표시한다(예: `-1 (0xFFFFFFFF)`).
- 실패 상태·안전 게이트(재실행 시 비교 계획 토큰·삭제 확인)는 지금과 같다 — 문구와 분류만 바뀐다.

## 영향 사용자 및 시스템 (Affected users and systems)
- `src/main/parsers/run-output.ts` `decideRunOutcome`(종료 코드 → 상태·오류 코드·문구), 필요 시 새 오류 코드(예: `RCLONE_KILLED`)를 `src/shared` 타입에 추가
- `src/main/services/run-service.ts` 종료 로그 줄(`exit=` 표기), 이력 상세·실행 결과 화면·자동 실행 알림 문구
- 단위 테스트 `tests/unit` (decideRunOutcome 분기)

## 제약 (Constraints)
- AGENTS.md 안전 규칙 1·2 불변: 전송 시작 경로·게이트를 바꾸지 않는다. 자동 재시도는 하지 않는다.
- 사용자 경로·remote 이름을 문구·테스트·fixture에 넣지 않는다.
- 외부 종료 주체는 앱이 알 수 없으므로 원인을 단정하는 문구를 쓰지 않는다.

## 미해결 질문 (Open questions)
- [ ] 비정상 종료를 `failed` 그대로 둘지, 별도 상태(예: "중단됨(외부 종료)")로 나눌지 — 이력 필터·연속 실패 경고에 영향
- [ ] 어떤 종료 코드를 "외부 종료"로 볼지 범위 확정(-1, 0xC000013A, 기타 0xC0000000 이상) — probe로 taskkill·작업 관리자 종료 코드 실측 필요
- [ ] 이번 건의 실제 종료 주체(같은 시간대 백신 기록·Windows 이벤트 로그) 확인 여부

## 작업 (Tasks)
- [ ] T-01 [P2] probe: 외부 강제 종료 방식별 rclone 종료 코드 실측과 rclone-notes 기록
- [ ] T-02 [P2] decideRunOutcome 비정상 종료 분류·문구·종료 코드 표기, 단위 테스트
- [ ] T-03 [P3] 실행 결과·이력·알림 문구 반영과 CHANGELOG
