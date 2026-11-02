# Windows 작업 스케줄러 동작 노트

형식: 날짜 · Windows 빌드 · 명령 · 결과 · 앱에 준 영향 (rclone-notes.md와 같은 형식).
재현: `node scripts/probes/schtasks-probes.mjs [--quick]` (Windows node, 약 4분). 작업은 `\rcloneGUI-probe\<랜덤>`에만 만들고 끝나면 모두 지운다(실제 `\rcloneGUI\`는 건드리지 않음). 결과는 `tests/fixtures/schtasks/`(임시 경로는 `C:\probe`, 계정·작성자·컴퓨터 이름은 가림).

## 2026-11-02 · Windows 11 x64 (빌드 10.0.26300, 한국어) · node v24.20.0 (INT-003 Phase 2 S2-1)

### 1. 파이프로 받은 schtasks 출력은 UTF-16이 아니라 콘솔 코드페이지(CP949)다 (Q-1)
- 명령: `schtasks /Query /TN \rcloneGUI-probe\<id> /XML`, `schtasks /Query /FO CSV /NH` — `execFile(..., { encoding: "buffer", shell: false, windowsHide: true })`. 작업 동작은 임시 폴더의 `한글\dummy.cmd`, 작업 이름 하나는 `한글-<id>` (fixture `query-xml-nonascii.bin`·`query-csv-probe.bin`)
- 결과: 둘 다 BOM 없음, UTF-16 아님. XML은 첫 줄이 `<?xml version="1.0" encoding="UTF-16"?>`인데 실제 바이트는 CP949다(`한글` → `C7 D1 B1 DB`). CSV의 다음 실행 시각(`오후`)·상태(`준비`)도 CP949, 줄바꿈 CRLF. 비ASCII가 없는 출력은 ASCII 그대로라 UTF-8로도 읽힌다.
- 영향: `decodeSchtasksOutput`은 UTF-16(BOM 유무)만 확실히 해독하고, 그 밖에 비ASCII 바이트가 있으면 `reliable: false`(UTF-8 BOM이 있을 때만 예외). CP949 2바이트가 우연히 올바른 UTF-8이 될 수 있어 엄격한 UTF-8 판정도 믿지 않는다. 불확실하면 `<Command>`의 exe 경로를 비교하지 않고(`exeMatches: null`) 그것만으로는 다시 등록하지 않는다(무한 재등록 방지). 재등록 판단은 ASCII인 `<Description>rcloneGUI;spec=<hash></Description>`(exe 경로 포함 해시)로 한다. 목록은 언어와 무관하게 줄 첫 필드 `"\rcloneGUI\<uuid>"`만 정규식으로 뽑는다.

### 2. 폴더 이름 Query는 폴더 안 작업만 나열하고, 없는 폴더·작업은 exit 1
- 명령: `schtasks /Query /TN \rcloneGUI-probe\ /FO CSV /NH`, 없는 폴더 `\rcloneGUI-probe-none-<hex>\`, 없는 작업 `\rcloneGUI-probe\none-<hex>`
- 결과: 폴더 Query는 exit 0, 그 폴더 작업 2줄만 나온다(머리글 없음). 없는 폴더·작업은 exit 1, stderr `오류: 지정된 파일을 찾을 수 없습니다.`(CP949).
- 영향: 설계(M-6)대로 전체 `/Query /FO CSV /NH`에서 우리 이름만 뽑는다. 폴더 Query로 바꿔도 되지만 폴더가 없을 때 exit 1을 "목록 실패"와 구분해야 하므로 바꾸지 않았다. 삭제 실패 뒤 `/Query /TN <이름>`이 exit≠0이면 "이미 없음"으로 본다(`/Delete` 다시 하면 exit 1).

### 3. `/Create /XML`은 `<UserId>`·비밀번호 없이 `InteractiveToken`·`LeastPrivilege`로 등록된다 (A-2)
- 명령: 앱 XML 틀(설계 S2-3)과 같은 작업을 UTF-16LE(BOM) 파일로 써서 `schtasks /Create /XML <파일> /TN <이름> /F`
- 결과: exit 0, 관리자 권한·비밀번호 묻지 않음. 내보낸 XML에는 `<UserId>`(현재 사용자 SID)와 `<URI>`가 채워진다. 앱 트리거 3종 — `TimeTrigger`+`Repetition`(PT5M), `CalendarTrigger`+`ScheduleByDay`, `CalendarTrigger`+`ScheduleByWeek`(`<Sunday /><Monday /><Saturday />`) — 모두 등록되고 내보낸 XML에 반복 간격·요일·`ExecutionTimeLimit PT13H`·`StartWhenAvailable true`가 남는다.
- 영향: 등록에 사용자 계정 정보를 다루지 않는다. 요일 요소는 일요일부터 써도 된다.

### 4. `RestartOnFailure`는 동작이 exit 1로 끝나도 다시 실행하지 않는다 (Q-2)
- 명령: `RestartOnFailure`(Interval PT1M, Count 2) + 매번 로그에 한 줄 쓰고 `exit 1`하는 node 더미, `schtasks /Run` 뒤 200초 관찰
- 결과: 실행 1회뿐. (`RestartOnFailure`는 작업 시작 자체가 실패할 때만 적용된다.)
- 영향: OS 쪽 재시도에 기대지 않고 앱이 경로 확인을 2분 간격 3번 다시 한다(FR-22). 작업 XML에 `RestartOnFailure`를 넣지 않는다.

### 5. `ExecutionTimeLimit`이 지나면 동작 프로세스와 자식 프로세스가 함께 끝난다 (Q-8)
- 명령: `ExecutionTimeLimit PT1M` + 자식 node 프로세스를 띄우고 끝없이 기다리는 더미, `schtasks /Run` 뒤 `tasklist /FI "PID eq …"`로 관찰
- 결과: 부모는 약 63초 뒤 끝났고, 그때 자식도 이미 없었다.
- 영향: OS 제한(13시간)에 걸리면 rclone도 함께 끝나 이력이 `running`으로 남을 수 있다(다음 시작 때 `markInterrupted`가 정리). 그래서 앱이 먼저 12시간에 `cancel(runId, "timeLimit")`으로 정상 종료한다(FR-34). OS 제한은 마지막 방어선이다.

### 6. 지난 `StartBoundary` + `StartWhenAvailable`로 새로 등록해도 곧바로 실행되지 않았다
- 명령: `StartBoundary` = 지금 − 10분인 매일 `CalendarTrigger`, `StartWhenAvailable true`, 등록 뒤 150초 관찰
- 결과: 실행 0회.
- 영향: 이 빌드에서는 위험이 드러나지 않았지만 동작이 문서화되어 있지 않으므로 설계대로 항상 다음 미래 시각을 `StartBoundary`로 쓴다(M-19).

### 7. 실행 중 인스턴스가 있을 때 `/Create /F`나 `/Delete`를 해도 실행 중 프로세스는 끝나지 않는다
- 명령: 오래 도는 더미를 `schtasks /Run`으로 띄운 뒤 같은 이름으로 `/Create /XML … /F`, 이어서 `/Delete /F`
- 결과: 둘 다 exit 0, 두 경우 모두 더미 프로세스는 계속 살아 있었다.
- 영향: 실행·대기 중인 작업을 다시 등록해도 진행 중 실행은 끊기지 않는다. 그래도 reconcile은 실행·대기 중 jobId의 재등록을 건너뛴다(M-12, 다음 변경 때 반영). 작업을 지우거나 OS 예약을 꺼도 이미 시작한 실행은 끝까지 돈다(앱 대기열이 진입 검사로 다음 실행만 막는다).
