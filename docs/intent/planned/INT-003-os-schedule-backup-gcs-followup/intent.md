---
id: INT-003
title: OS 예약·헤드리스 실행·sync 오류 무시/백업 폴더·GCS 실측 후속
status: planned
priority: P3
created: 2026-11-02
updated: 2026-11-02
---

# Intent: OS 예약·헤드리스 실행·sync 오류 무시/백업 폴더·GCS 실측 후속

> INT-002에서 P3로 미루거나 실측이 남은 항목을 모은 후속 intent다. 출처: INT-002 T-07·T-13·T-10 잔여, spec FR-28·E-6·§2.2 Out-of-scope(`폴더만` 범위, WSL cron). (2026-11-02 분리)

## 문제 (Problem)
- 예약 실행이 앱이 켜져 있을 때만 동작한다. 사용자가 트레이에서 앱을 종료하면 예약이 돌지 않는다(INT-002 T-13).
- 동기화(sync)에서 `--ignore-errors`는 백업 폴더 없이 쓸 수 없게 막혀 있고, 앱에는 백업 폴더(`--backup-dir`)를 지정하는 필드도 없다. 그래서 sync + 오류 무시는 화면에서 고를 방법이 없다(INT-002 T-07, spec FR-28 기본안 A).
- GCS 수용 테스트(`tests/integration/gcs-acceptance.test.ts`)는 코드만 있고 테스트 키가 없어 실측하지 못했다(INT-002 T-10 잔여).
- 버킷형 리모트(GCS 등, 폴더 개념 없음)에서 `전체` 범위를 쓰면 빈 폴더가 대상에 생기지 않아 비교 때마다 `createDirs` 차이가 영구히 남을 것으로 예상된다(spec E-6).
- 동기화 범위에 `폴더만`이 없고, WSL cron 예약은 1차에서 제외됐다. (2026-11-02 둘 다 채택하지 않기로 결정)

## 제안 결과 (Proposed outcome)
- 작업별로 Windows 작업 스케줄러 예약을 켜면 앱이 꺼져 있어도 `rcloneGUI.exe --run-job <id>`가 같은 자동 실행 안전 게이트로 실행되고, 결과가 이력에 남는다.
- 작업에 백업 폴더(`--backup-dir`)를 지정해 sync + `--ignore-errors`를 수동·자동 실행에서 쓸 수 있다. 덮어쓰거나 지운 파일은 실행마다 백업 폴더 아래 타임스탬프 하위 폴더로 옮겨져 복구할 수 있다. 백업 없는 `--ignore-errors`는 계속 막는다.
- 전용 GCS 테스트 버킷으로 수용 테스트를 실측해 결과를 rclone-notes·CHANGELOG에 남긴다.
- 빈 폴더를 만들 수 없는 리모트에서 `전체` 범위를 고르면 편집기에서 안내하고, 비교 화면에서 빈 폴더 차이를 따로 표시해 영구 차이처럼 보이지 않게 한다.
- `폴더만` 범위와 WSL cron은 채택하지 않는다(2026-11-02 결정).

## 영향 사용자 및 시스템 (Affected users and systems)
- 사용자: Windows에서 rcloneGUI를 쓰는 단일 사용자. 노트북·로그온 직후 실행, GCS 등 버킷형 리모트 사용자.
- 시스템: Electron main(`index.ts` single-instance·argv, `scheduler.ts`, `run-service.ts` `startAuto`, `run-gates.ts`), `command-builder.ts` 차단 목록, shared 스키마(작업 옵션·스케줄 백엔드·이력 trigger), Windows 작업 스케줄러(`schtasks /XML`), NSIS `installer.nsh`·electron-builder(fuses), `smoke:installer`, GCS 테스트 remote.
- 문서: AGENTS.md 안전 규칙 3, MVP_SPEC 금지 목록, README, CHANGELOG, rclone-notes.

## 제약 (Constraints)
- 기존 안전 규칙 유지: rclone은 `spawn`/`execFile` + `shell:false`만, 실제 전송은 `run-service.ts`의 `spawnTransfer` 한 곳, OS 예약도 `startAuto` 게이트를 그대로 거친다. `schtasks`·`powershell`도 `execFile` + `shell:false` + 고정 인자 배열로만 실행한다.
- 안전 규칙 3(차단 목록)은 바꾸지 않는다. 백업 없는 `--ignore-errors`는 계속 차단하고, 백업 폴더가 있을 때만 허용하는 현 규칙을 유지한다. sync의 다른 안전 게이트(빈 원본·형식 충돌·대소문자 충돌·중첩 경로)는 그대로 둔다.
- 백업 폴더는 대상과 같은 remote에만 두고, 대상·원본과 겹치는 경로는 모두 막는다. 앱이 백업 폴더를 직접 지우지 않는다(보관 기간 자동 정리 없음).
- OS 스케줄러 등록은 사용자 권한(`/RL LIMITED`, 비밀번호 저장 없음)에서 동작하고, 등록 실패·권한 부족을 화면에 알린다.
- GCS 실측은 전용 버킷·서비스 계정·저장소 밖 테스트 conf만 쓴다. 로그·fixture에 버킷명·키 경로를 남기지 않는다.
- rclone.conf는 경로로만 넘긴다(안전 규칙 6). 암호화된 conf는 헤드리스에서 지원하지 않는다.

### 이관: P3 OS 예약·`--ignore-errors` 착수 시 적용 (INT-002, 2026-10-29 검토)
> INT-002 intent.md에서 원문 그대로 옮겼다(2026-11-02). 본문의 태스크 번호는 INT-002 기준이다: INT-002 T-13 → 이 intent T-01, INT-002 T-07 → T-02, "T-12 승인"은 안전 규칙 3 변경에 대한 사용자 승인을 뜻한다.
> 백업 없는 `--ignore-errors` 관련 항목은 2026-11-02 결정으로 적용하지 않는다.

- 1차 범위에서 뺀 T-07·T-13을 다시 꺼낼 때 그대로 적용할 검토 결과다.
- **sync + `--ignore-errors` + 백업 없음**은 원본 읽기 오류가 나도 대상 파일을 삭제한다. 미리보기 삭제 수 확인은 실제 실행 중 IO 오류를 막지 못하므로, 수동 실행에서만 허용하고 `--max-delete`를 사전 확인 삭제 수로 고정한다. 자동·OS 예약 실행에서는 차단을 유지한다. 안전 규칙 3 변경이므로 T-12 승인 후 T-07을 시작한다.
- **schtasks 등록**: 작업 이름은 `\rcloneGUI\<jobId>`(사용자가 입력한 작업 이름 사용 금지)로 하고, jobId는 엄격한 형식으로 검증한다. `/TR` 문자열은 작업 스케줄러가 다시 파싱하므로 따옴표 문제를 피하려면 `/XML` 등록을 우선 검토한다. `/RU`·`/RP`(비밀번호 저장)는 쓰지 않고 `/RL LIMITED`로 한다.
- **`--run-job <id>`**는 처음 실행할 때의 argv와 `second-instance` argv 모두 zod로 id 형식을 검증하고, 다른 앱 플래그(삭제 허용 등)는 받지 않는다. 예약 작업이 exe를 직접 실행하므로 패키징 빌드에서 Electron fuses(`RunAsNode`, `EnableNodeCliInspectArguments` 끄기) 적용을 검토한다.
- **이중 실행 방지**: 작업마다 앱 안 스케줄러와 OS 예약 중 하나만 켠다. 실행 중(BUSY)일 때 이력 기록과 재시도 여부를 정한다.
- **헤드리스 중 GUI 실행**: 헤드리스 프로세스가 single-instance 락을 잡고 있으면 사용자가 연 GUI 요청은 `second-instance`로 넘어오므로 창을 만들어 보여 준다. 락 때문에 두 프로세스가 같은 DB를 동시에 열지 않는다(WAL·`busy_timeout`은 방어용으로 유지).
- **남는 예약 작업 정리**: 앱 시작 시 `\rcloneGUI\` 폴더에서 DB에 없는 예약 작업을 지운다. 앱을 제거하면 예약 작업이 없는 exe를 가리킨 채 남으므로 제거 시 처리를 정한다.
- **`--run-job` 실행 조건**: `startAuto`는 작업의 자동 실행 켜짐·전역 일시정지를 확인하지 않는다(일시정지는 앱 스케줄러 tick에서만 확인). 헤드리스 진입 시 "작업 존재 + 스케줄 백엔드 = OS + 켜짐 + 전역 일시정지 아님"을 확인하고, 아니면 실행하지 않고 이력에 사유를 남긴다. 이력 trigger는 앱 스케줄러(`scheduler`)와 구분되는 값(예: `os-scheduler`)으로 둔다.
- **작업 스케줄러 XML 기본값**: `DisallowStartIfOnBatteries`·`StopIfGoingOnBatteries`가 기본으로 켜져 있어 노트북에서 예약이 조용히 건너뛰거나 실행 중 강제 종료된다(`.partial` 잔존·rclone 자식 고아 가능). 전원 조건·`ExecutionTimeLimit`·`MultipleInstancesPolicy`(`IgnoreNew`)를 명시하고, 강제 종료 후 `run-recovery`가 정리하는지 확인한다.
- **XML 재시도 한계 (probe 필요)**: `RestartOnFailure`는 작업 시작 실패에만 동작하고 프로그램의 0이 아닌 종료 코드로는 재시도하지 않는 것으로 보인다. 그렇다면 로그온 직후 네트워크·WSL 미준비 재시도는 앱 안(경로 준비 확인 후 지연 재시도)에서 구현한다.
- **XML 파일 형식 (probe 필요)**: `schtasks /XML`은 UTF-16(BOM) 파일을 기대한다. exe 경로·인자는 XML 이스케이프(`&`·`<`)하고, 임시 XML은 userData 앱 폴더에 `wx`로 만든 뒤 등록 후 지운다. `schtasks`·`powershell`도 `execFile` + `shell:false` + 고정 인자 배열로만 실행한다.
- **개발 모드 등록 차단**: 개발 실행의 `process.execPath`는 `electron.exe`라 잘못된 exe가 등록된다. OS 백엔드는 `app.isPackaged`일 때만 허용하고, 시작 시 복원 때 등록된 exe 경로가 현재 `execPath`와 다르면 다시 등록한다.
- **second-instance 인자**: Windows에서 `second-instance` argv에 Chromium 스위치가 끼어 순서가 바뀔 수 있다. `requestSingleInstanceLock(additionalData)`로 `{ runJob: id }`를 넘겨 zod로 검증한다(argv 파싱은 첫 실행에만).
- **Electron fuses 범위**: `RunAsNode`·`EnableNodeCliInspectArguments` 끄기에 더해 `EnableNodeOptionsEnvironmentVariable` 끄기, `EnableEmbeddedAsarIntegrityValidation`·`OnlyLoadAppFromAsar` 켜기를 함께 검토한다.
- **암호화된 rclone.conf**: 실행 래퍼가 `RCLONE_*` 환경 변수를 지우므로 `RCLONE_CONFIG_PASS`로도 풀 수 없다. 헤드리스·OS 예약은 암호화된 conf를 지원하지 않는다고 명시하고 등록 시 경고한다.

## 이관된 결정 (INT-002 미해결 질문에서 확정, 2026-10-29)
> 아래는 INT-002에서 "(P3 착수 시 적용)"으로 확정한 결정의 사본이다. 원본 이력은 INT-002에 남아 있다.

- [x] OS 스케줄 실행 주체 → `rcloneGUI.exe --run-job <id>` → run-service `startAuto`(같은 안전 게이트). rclone 직접 호출 금지(안전 규칙 2). 앱이 켜져 있으면 `second-instance`로 기존 프로세스에 넘기고, 아니면 창 없이 실행 후 종료. Windows 작업 스케줄러는 사용자 권한·"로그온한 경우에만 실행"(비밀번호 저장 없음). WSL cron은 WSL이 꺼지면 돌지 않으므로 제외(P3 보류). `/mnt` 경로는 실행 시 기존 경로 변환으로 처리. (P3 착수 시 적용) (2026-10-29 결정)
- [x] sync + `--ignore-errors`(백업 없음) → 자동·OS 예약 실행에서 차단 유지, 수동 실행만 허용. `--max-delete`는 삭제 순서가 정해져 있지 않아 한도에 닿기 전 잘못된 삭제를 막지 못하므로, 지켜보는 사람이 없는 실행에서는 허용하지 않는다. 자동 실행에서 오류를 무시하려면 이미 허용된 백업 폴더 + `--ignore-errors` 조합을 안내한다. (P3 착수 시 적용) (2026-10-29 결정)
- [x] 놓친 OS 예약 → `StartWhenAvailable` 켬(여러 번 놓쳐도 한 번만 실행, 자동 실행 게이트 그대로). 로그온 직후 네트워크 드라이브·VPN·WSL 미준비 실패에 대비해 XML에 실패 시 재시도(예: 5분 간격 3회)를 넣고, 이력에 "로그온 직후 실행"을 표시한다. 작업별 "놓친 예약 건너뛰기" 옵션은 1차 범위 밖. (P3 착수 시 적용) (2026-10-29 결정)
- [x] 앱 제거 시 예약 작업 → NSIS 제거 스크립트에서 `\rcloneGUI\` 예약 작업을 지운다(PowerShell `Get-ScheduledTask -TaskPath "\rcloneGUI\" | Unregister-ScheduledTask`). 업데이트할 때도 이전 버전 제거 스크립트가 실행되므로 `${isUpdated}`이면 건너뛴다. DB는 보존되므로 재설치 후 앱을 처음 열 때 예약이 복원된다(그 전까지는 예약이 돌지 않음, 문서에 기록). (P3 착수 시 적용) (2026-10-29 결정)
- [x] 동기화 범위 → 1차는 `전체`(빈 폴더 포함, `--create-empty-src-dirs`)·`파일만`(rclone 기본, 빈 폴더 무시) 2개. sync 삭제도 같은 범위를 따르고 `--delete-excluded` 금지는 유지. `폴더만`은 probe(`--filter "- *"` + `--create-empty-src-dirs`, GCS 포함) 후 P3로 결정. (2026-10-29 결정)

## 결정 (2026-11-02)
- [x] 백업 없는 sync `--ignore-errors`(T-02) → 허용하지 않음, T-02 취소. 원본 읽기 오류에도 대상 삭제가 일어나고 되돌릴 수 없다. `--max-delete`는 삭제 순서가 정해져 있지 않아 한도 전 잘못된 삭제를 막지 못하고, 실행 중 IO 오류는 미리보기로 잡히지 않는다. 백업 폴더(T-03)가 같은 필요를 복구 가능하게 채우므로 안전 규칙 3(차단 목록)은 바꾸지 않는다. (2026-11-02 결정)
- [x] `--backup-dir` 위치 제약 → (a) 대상과 같은 remote만 허용한다. rclone도 서버 쪽 move가 가능한 같은 remote를 요구한다. 로컬에서 서로 다른 드라이브일 때 동작은 probe로 확인한다. (b) 대상·원본과 겹치는 경로는 모두 막는다. rclone은 필터로 백업 폴더를 제외하면 겹침을 허용하지만, 제외 패턴·범위·`--delete-excluded` 금지와 얽혀 지원하지 않는다. (c) 실행마다 타임스탬프 하위 폴더(예: `백업폴더/YYYY-MM-DD_HHmmss/`)를 써서 이전 백업을 덮어쓰지 않는다. (d) 보관 기간 자동 정리는 1차 범위 밖이다. 앱이 직접 지우는 경로가 생겨 안전 규칙 2 취지와 충돌하므로 1차는 백업 폴더 안내만 한다. (e) 계획 토큰에 backupDir를 넣어 바뀌면 다시 비교하게 한다. (2026-11-02 결정)
- [x] E-6 대응 → `전체` 범위를 막지 않고 안내 + 비교 화면 구분 표시. `directory_markers`를 켠 버킷은 정상 동작하므로 일괄 차단은 맞지 않다. 안전 규칙 6 때문에 rclone.conf를 읽지 않으므로 `rclone backend features remote:`의 `CanHaveEmptyDirectories`로 판정한다(`directory_markers` 반영 여부는 T-04에서 실측). false면 편집기에서 경고하고, 비교 화면에서 빈 폴더 차이를 "이 저장소는 빈 폴더를 만들 수 없음"으로 따로 표시해 영구 차이처럼 보이지 않게 한다. (2026-11-02 결정)
- [x] WSL cron → 폐기, T-07 취소. WSL이 꺼져 있으면 돌지 않는 문제는 그대로이고, Windows 작업 스케줄러(T-01)가 WSL 경로(`\\wsl.localhost`, `/mnt` 변환)도 처리하므로 cron만의 가치가 없다. 예약 방식이 셋으로 늘면 이중 실행 방지·정리 로직이 복잡해진다. (2026-11-02 결정)
- [x] `폴더만` 범위 → 채택하지 않음, T-06 취소(probe 생략). 쓰임새가 좁고(폴더 구조만 복제) 버킷형 remote에서는 의미가 없어 E-6과 겹친다. sync에서 제외 파일이 든 폴더의 삭제 동작이 복잡한 데 비해 스키마·diff·명령 빌더·계획 토큰·삭제 확인을 모두 고쳐야 한다. 필요해지면 copy 전용으로 새 아이디어로 다시 검토한다. (2026-11-02 결정)

## 미해결 질문 (Open questions)
- 없음 (2026-11-02 모두 결정)

## 작업 (Tasks)
- [x] T-01 [P3] Windows 작업 스케줄러·`rcloneGUI.exe --run-job <id>` 헤드리스 실행 (INT-002 T-13 이관) — schtasks `\rcloneGUI\<jobId>`·`/XML` 우선(UTF-16 BOM·이스케이프·`wx` 임시 파일)·`/RL LIMITED`·비밀번호 저장 없음, `--run-job` id zod 검증·다른 플래그 거부, `additionalData`로 second-instance 전달, 헤드리스 중 GUI 요청 시 창 생성, 작업별 스케줄러 하나만 활성화, 헤드리스 진입 시 OS 백엔드·켜짐·전역 일시정지 확인·이력 trigger `os-scheduler`, `StartWhenAvailable`·전원 조건·`ExecutionTimeLimit`·`IgnoreNew`, `RestartOnFailure` probe(안 되면 앱 내 재시도), `app.isPackaged`에서만 등록·exe 경로 변경 시 재등록, 시작 시 고아 예약 정리, 작업 삭제·비활성화 시 정리, `--ask-password=false`, 암호화 conf 미지원 경고, 설치 스모크에 `--run-job`, 제거 시 `\rcloneGUI\` 예약 삭제(`${isUpdated}`이면 건너뜀), Electron fuses
- [-] T-02 [P3] 백업 없는 sync `--ignore-errors` 단독 허용 (INT-002 T-07 이관) — 안전 규칙 3 변경 승인 선행, sync 수동 실행에서만 경고·확인 후 허용, `--max-delete`를 사전 확인 삭제 수로 고정, 자동·OS 예약 실행은 차단 유지, 이력·로그에 위험 옵션 기록, 차단 목록·run gate·AGENTS·MVP_SPEC·테스트 갱신 — 취소: 원본 읽기 오류에도 되돌릴 수 없는 삭제가 일어나고, 백업 폴더(T-03)로 복구 가능하게 대체 (2026-11-02)
- [ ] T-03 [P3] `--backup-dir` 백업 폴더 지원 (spec FR-28 후속) — 작업 옵션에 백업 폴더 필드·검증(대상과 같은 remote만, 대상·원본과 겹치는 경로 전부 금지, 로컬 다른 드라이브 동작 probe), 실행마다 타임스탬프 하위 폴더(`백업폴더/YYYY-MM-DD_HHmmss/`), 계획 토큰에 backupDir 포함(변경 시 재비교), 게이트 재설계, 백업 폴더 + `--ignore-errors` 조합 허용, 보관 기간 자동 정리 제외(백업 폴더 안내만), `SYNC_IGNORE_ERRORS_TEXT` 안내 갱신, MVP_SPEC 갱신, 테스트 (차단 목록은 백업 폴더 있는 경우만 허용하는 현 규칙 유지)
- [ ] T-04 [P3] GCS 수용 테스트 실측 (INT-002 T-10 잔여) — 환경 변수 `RCLONEGUI_TEST_GCS_CONFIG`·`RCLONEGUI_TEST_GCS_REMOTE`·`RCLONEGUI_TEST_GCS_BUCKET`을 주고 `tests/integration/gcs-acceptance.test.ts`(`pnpm run test:int`) 실행, skip 없이 통과 확인, `전체` 범위 빈 폴더 동작 기록, `rclone backend features`의 `CanHaveEmptyDirectories`가 `directory_markers` 설정을 반영하는지 확인, 결과를 rclone-notes·CHANGELOG에 기록(버킷명·키 경로 미기재)
- [ ] T-05 [P3] spec E-6 대응: 버킷형 리모트 `전체` 범위 빈 폴더 영구 차이 — 차단 대신 안내 + 비교 화면 구분 표시, `rclone backend features`의 `CanHaveEmptyDirectories` 기반 판정(false면 편집기 경고, 비교 화면에서 빈 폴더 차이를 "이 저장소는 빈 폴더를 만들 수 없음"으로 따로 표시), 테스트 (depends: T-04)
- [-] T-06 [P3] `폴더만` 동기화 범위 — probe(`--filter "- *"` + `--create-empty-src-dirs`, GCS 포함) 후 채택 시 스키마·diff·명령 빌더·계획 토큰·삭제 확인에 적용, 아니면 취소 사유 기록 (depends: T-04) — 취소: 쓰임새가 좁고 버킷형 remote에서 의미가 없는 데 비해 수정 범위가 커서 채택하지 않음, probe 생략 (2026-11-02)
- [-] T-07 [P3] WSL cron 예약 검토 — WSL 미기동 시 미실행 문제 재검토, 채택 시 `--run-job` 경로 재사용, 아니면 취소 사유 기록 (depends: T-01) — 취소: WSL이 꺼지면 돌지 않고 T-01이 WSL 경로도 처리해 cron만의 가치가 없음 (2026-11-02)

> 진행 순서: T-04 → T-01 → T-03 → T-05. T-04는 테스트 버킷·키 제공이 필요하다.
