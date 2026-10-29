---
id: INT-002
title: rcloneGUI 스케줄·SQLite·리모트/제외 패턴 UX 개선
status: active
priority: P2
created: 2026-10-29
updated: 2026-10-29
---

# Intent: rcloneGUI 스케줄·SQLite·리모트/제외 패턴 UX 개선

## 문제 (Problem)
- 작업이 3개만 늘어도 제외 패턴을 매번 한 줄씩 입력해야 해 재사용이 어렵고, 어떤 패턴을 이미 썼는지 찾기 힘들다.
- 왼쪽 작업 목록에 원본·대상·자동화 여부·주기·최근 실행 시각이 한눈에 보이지 않아 작업을 열어야 확인할 수 있다. GoodSync처럼 목록에서 바로 실행할 수 있는 흐름이 필요하다.
- 리모트를 등록해 두고 그 안의 폴더를 탐색·선택하는 기능이 없어, 작업마다 remote 이름과 경로를 직접 입력해야 한다.
- 예약 실행이 앱이 켜져 있을 때만 동작한다. Windows 작업 스케줄러나 WSL cron으로 앱이 꺼져 있어도 실행할 수 있어야 하고, WSL `/mnt` 경로와 UNC 경로의 일관된 처리가 필요하다.
- 작업·설정·이력이 JSON 파일로 나뉘어 있어 리모트·제외 패턴 같은 구조화된 데이터를 함께 관리하기 어렵다. SQLite로 통합 저장하려 한다.
- 폴더만/파일만/전체 중 무엇을 동기화할지 작업별로 정할 수 없어, 빈 폴더나 파일만 따로 다루기 어렵다.
- `--ignore-errors`는 동기화(sync)에서 백업 폴더 없이는 쓸 수 없게 막혀 있어(복사는 이미 허용), 실패 파일을 확인하면서 진행하려는 사용자가 우회해야 한다.
- 비교·동기화·중지와 미리보기·복사 실행·비교 결과·실행 기록이 한 화면에 섞여 있어 처음 쓰는 사람이 어떤 순서로 눌러야 하는지 헷갈린다.
- 일부 UI 문구가 AI가 만든 듯 어색해 뜻이 바로 와닿지 않는다(예: "기타:상태칩대로").
- rclone 옵션 값의 길이 제한이 없고, rclone.conf에 이미 있는 옵션 값을 화면 기본값으로 활용하지 못한다.
- GCP 테스트 remote로 실제 동기화가 되는지 확인한 수용 테스트가 없다.
- exe 배포 형태(설치본 외 단일 실행 exe 필요 여부)가 불명확하다.

## 제안 결과 (Proposed outcome)
- 왼쪽 작업 목록에 원본·대상·자동화 여부·주기·최근 동기화 시각·상태 텍스트(표시 체크박스)가 보이고, 작업을 열지 않고도 실행할 수 있다.
- 작업 추가/편집에서 등록된 리모트를 고르고 그 안의 폴더를 탐색해 선택할 수 있다. 리모트 등록·수정·삭제·연결 테스트가 가능하다.
- 제외 패턴을 전역 로컬 DB에 유일하게 저장하고, 작업 편집 시 체크박스로 여러 개를 한 번에 선택하거나 새 패턴을 추가할 수 있다. 기존 한 줄 입력도 유지한다.
- 작업별로 폴더만/파일만/전체 범위를 저장하고 비교·미리보기·실행에 일관되게 적용한다.
- 앱 안 스케줄러를 유지하고 주기·매일 HH:MM·요일 스케줄을 지원한다. 자동 실행 작업이 있는데 트레이에서 종료하면 다음 예약 시각과 함께 경고하고, 로그인 시 시작이 꺼져 있으면 자동 작업을 저장할 때 안내한다. Windows 작업 스케줄러·헤드리스 실행(`--run-job`)·WSL cron은 P3 보류(T-13).
- 작업·설정·이력·리모트·제외 패턴·스케줄을 SQLite에 저장하고, 기존 JSON 데이터는 백업 후 자동 마이그레이션한다.
- 백업 없는 sync `--ignore-errors` 허용은 P3 보류(T-07). 동기화에서 오류 무시를 고르면 이미 허용된 백업 폴더 + `--ignore-errors` 조합을 안내한다.
- 비교/미리보기 → 실행 → 결과/이력 순서로 화면을 재배치하고, 중지는 실행 중 공통 동작으로 분리한다. UI 용어를 사용자 관점으로 전수 검토한다.
- rclone 옵션 값에 옵션별 최대 길이 검증을 넣고, rclone.conf의 값을 안전한 방식으로 기본값에 활용한다(파일 직접 읽기 금지 원칙과 충돌하지 않도록 CLI 조회 또는 rclone 기본 동작 활용).
- 전용 GCP 테스트 버킷/remote로 임시 파일 동기화·삭제·취소를 확인하는 수용 테스트를 통과한다.
- 배포 형태를 NSIS 설치본 하나로 확정한다(헤드리스 `--run-job` 스모크는 P3, T-13).

## 영향 사용자 및 시스템 (Affected users and systems)
- 사용자: Windows에서 rcloneGUI를 쓰는 단일 사용자(개발자 본인). WSL `/mnt` 경로와 Windows 로컬/UNC/remote를 함께 쓰는 사용자.
- 시스템: Electron main/preload/renderer, shared 스키마·IPC, JSON 저장소 → SQLite, rclone CLI·rclone.conf, GCP 테스트 remote, NSIS 설치본. (Windows 작업 스케줄러·헤드리스 실행은 P3)
- 화면: 작업 목록(JobSidebar), 작업 편집기(JobEditor·PathField·RemotePicker·ExcludesEditor), 비교/실행(JobWorkspace·CompareView·RunView), 설정(SettingsPage), 이력(HistoryView).
- 검증: 단위·통합·Playwright E2E, 설치 스모크, GCP 수용 테스트.

## 제약 (Constraints)
- 기존 안전 규칙 유지: rclone은 `spawn`/`execFile` + `shell:false`로만 실행하고 명령 문자열 조립·`shell:true` 금지. 실제 전송은 `run-service.ts`의 `spawnTransfer` 한 곳에서만 시작. 비교 계획 토큰·삭제 확인·사전 확인·`--max-delete` 백스톱 유지.
- (P3, T-07 착수 시) `--ignore-errors` 허용은 사용자 확인·경고·이력 기록을 전제로 하며, sync의 다른 안전 게이트(빈 원본·형식 충돌·대소문자 충돌·중첩 경로)는 그대로 둔다.
- rclone.conf는 경로로만 넘기는 현재 원칙을 유지한다. 옵션 기본값을 위해 파일 내용을 직접 읽어야 한다면, rclone CLI 조회 등 안전한 대안을 먼저 검토하고 안전 규칙 변경은 별도 승인받는다.
- 테스트·수용은 임시 폴더와 전용 GCP 테스트 버킷/remote만 사용한다. 실제 사용자 경로(`E:\...`, `\\wsl.localhost\...`)와 실제 업무 remote·실데이터는 쓰지 않는다.
- SQLite 드라이버는 Electron 45·asar 패키징과 호환되어야 하며, 네이티브 모듈을 쓰면 재빌드·asar unpack 설정과 설치 스모크를 갱신한다.
- JSON→SQLite 마이그레이션은 기존 데이터를 보존하고, 실패 시 원본 JSON과 `.bak`으로 되돌릴 수 있어야 한다.
- (P3, T-13 착수 시) OS 스케줄러 등록은 사용자 권한 범위에서 동작해야 하며, 등록 실패·권한 부족을 화면에 명확히 알린다.
- renderer에서 Node API를 쓰지 않고 `contextIsolation`·`sandbox`를 유지한다. TypeScript strict·`any` 금지·zod 검증·`@/` import·LF 등 기존 컨벤션을 따른다.
- 커밋은 한 변경에 한 가지, 사용자에게 보이는 변경은 CHANGELOG, rclone 동작은 rclone-notes, 작업 내역은 docs/works에 기록한다.

### 보안·데이터 손실 주의 (2026-10-29 검토)
- **리모트 = 북마크**: 앱의 "리모트"는 rclone.conf에 이미 있는 remote 이름 + 기준 경로 + 별칭만 저장한다. `rclone config create/update/delete`는 쓰지 않는다(토큰·비밀번호가 명령 인자로 프로세스 목록·실행 로그에 노출됨, `run-log-file`이 args 전체를 기록). remote 생성은 터미널 `rclone config`로 안내한다. 연결 테스트는 이미 허용 목록(`command-builder.ts` `ALLOWED_COMMANDS`)에 있는 읽기 명령(`lsjson --max-depth 1`, `--ask-password=false` 포함)을 재사용하고 새 명령을 추가하지 않는다.
- **목록에서 실행**도 비교 → 삭제 확인(계획 토큰) 흐름 또는 자동 실행 게이트(`startAuto`)를 그대로 거친다. 확인 없이 바로 실제 전송하지 않는다.
- **전역 제외 패턴 수정·삭제**는 그 패턴을 쓰는 모든 sync 작업의 삭제 범위를 바꾼다(제외가 빠지면 대상 파일이 삭제 대상이 됨). 수정·삭제 시 사용 중인 작업을 보여 주고 확인받는다. 실행 시점의 패턴 스냅샷은 계획 토큰에 포함한다. 정규화는 앞뒤 공백 제거·완전 중복 제거만 하고 유니코드 정규화는 하지 않는다. 줄바꿈이 들어간 패턴은 저장을 막는다.
- **패턴 파일 전달**은 `--filter-from`이 아니라 `--exclude-from`을 쓴다(`--filter-from`은 줄 앞 `+ `/`- `를 규칙으로 읽어 `+ **` 같은 패턴이 포함 규칙이 됨). 임시 파일은 userData 아래 앱 전용 폴더에 고유 이름·배타 생성(`wx`)으로 만들고 실행이 끝나면 지우며, 내용 해시를 계획 토큰에 넣는다.
- **WSL 경로**: `/mnt/x` → `X:\` 변환은 WSL 없이 된다. `\\wsl.localhost\…`는 WSL이 꺼져 있으면 실패하거나 WSL을 띄우므로 헤드리스 실패 안내에 포함한다.
- **SQLite 이전**: 이전 전체를 한 트랜잭션으로 묶고 `PRAGMA user_version`으로 버전을 기록한다. 커밋한 뒤 JSON을 `.migrated`로 이름을 바꿔 두 번 가져오지 않게 한다. 시작 시 `integrity_check`를 하고, 스키마를 바꾸기 전에 DB를 백업한다. 구버전은 `.migrated`가 된 JSON을 찾지 못해 빈 작업 목록으로 시작하므로, 되돌리려면 `.migrated`를 원래 이름으로 바꿔야 하고 그 내용은 이전 시점 상태라는 점을 문서에 적는다. 열린 WAL DB는 파일 복사로 백업하지 않고 `VACUUM INTO` 또는 `node:sqlite`의 `backup()`을 쓴다(파일 복사는 `-wal` 내용이 빠짐).
- **DB 내용**: 자격 증명·rclone.conf 내용은 저장하지 않는다(평문 파일). 모든 쿼리는 prepared statement로 하고, `json_extract` 경로·정렬 컬럼을 입력값으로 조립하지 않는다.
- **`전체` 범위**: sync의 `--create-empty-src-dirs`는 대상의 빈 폴더도 삭제한다. 폴더 삭제가 diff·삭제 확인·`autoMaxDeletes`에 포함되는지 probe로 확인한다.
- **GCP 수용 테스트**: 서비스 계정 키·테스트 conf는 저장소 밖에 두고, 로그·fixture에 버킷명·키 경로를 남기지 않는다. remote 이름·버킷 경로가 테스트 접두사(예: `rclonegui-test-`)가 아니면 테스트가 실행을 거부하고, 실행마다 고유 하위 경로를 쓴 뒤 정리한다.

### 추가 검토 (2026-10-29, 코드 대조)
- **`--exclude-from` 주석 줄 (probe 필요)**: rclone은 필터 파일에서 `#`·`;`로 시작하는 줄을 주석으로 무시한다. 지금은 `--exclude P` 인자로 넘겨(`command-builder.ts`) `#tmp`도 적용되지만, 파일로 바꾸면 조용히 빠져 sync 삭제 대상이 된다. `#`·`;`로 시작하는 패턴은 저장을 막거나 이스케이프하고, 빈 줄을 쓰지 않으며, 파일은 UTF-8(BOM 없음)·LF로 쓴다. 인자 방식과 파일 방식의 결과가 같은지 probe로 확인해 rclone-notes에 기록한다.
- **OAuth 토큰 갱신 경합**: gdrive 등은 토큰 갱신 시 rclone이 rclone.conf를 다시 쓴다. 폴더 탐색·연결 테스트는 동시에 하나만 돌리고, 실행 중에는 같은 remote 탐색을 막거나 순서대로 처리한다.
- **제외 패턴 변경과 비교 캐시**: 전역 패턴 수정·삭제 시 그 패턴을 쓰는 작업의 비교 캐시를 무효화하고, 확인 창에 자동 실행 작업을 따로 표시한다(사람 없이 삭제 범위가 바뀜).
- **계획 토큰 범위**: 동기화 범위(전체/파일만)도 계획 토큰에 넣어, 범위를 바꾼 뒤 이전 비교 결과로 실행되지 않게 한다.
- **`node:sqlite`는 동기 API**: main 스레드를 막으므로 이력은 페이지 단위 조회·인덱스로 하고, 마이그레이션은 창을 띄우기 전에 한 번 한다.
- **JSON으로 남길 것**: `active-run.json`(실행 복구)은 DB 장애와 분리하도록 JSON으로 유지하고, 실행 로그 파일·앱 로그도 파일로 둔다.
- **GCS 빈 폴더**: 버킷 remote에는 폴더가 없어 `전체`(`--create-empty-src-dirs`)가 기대대로 동작하지 않을 수 있다. T-05 probe와 T-10 수용 테스트에 넣는다.
- **진행 순서**: 아래 "진행 순서" 절을 따른다. T-01을 먼저 단독 Phase로 끝낸다(나머지가 의존).

### P3 OS 예약·`--ignore-errors` 착수 시 적용 (2026-10-29 보류)
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

## 미해결 질문 (Open questions)
- [x] exe 형태 → NSIS 설치본 하나만 유지. 헤드리스는 같은 exe의 `rcloneGUI.exe --run-job <id>`. portable exe는 만들지 않는다(exe 위치가 바뀌면 OS 예약 경로가 깨짐). (2026-10-29 결정)
- [x] 옵션 값 길이 → 초과 시 저장 차단(zod, 필드별 오류 문구). 경로 1024자, 패턴 한 줄 512자·최대 500개, 일반 문자열 256자, 숫자·크기·시간 옵션은 형식 검증. 명령 전체 길이(Windows 32,767자)도 검사하고, 패턴이 많으면 `--exclude-from` 임시 파일로 넘긴다. (2026-10-29 결정)
- [x] rclone.conf 값 → 파일 직접 읽기 예외 불허, `rclone config dump`도 쓰지 않음(토큰·비밀번호 노출). conf의 remote 옵션은 rclone이 자동 적용하므로 화면은 빈 값 = "rclone.conf 값 사용"으로 표시만 한다. remote 종류는 `rclone listremotes --long`. 안전 규칙 6 변경 없음. (2026-10-29 결정)
- [x] 동기화 범위 → 1차는 `전체`(빈 폴더 포함, `--create-empty-src-dirs`)·`파일만`(rclone 기본, 빈 폴더 무시) 2개. sync 삭제도 같은 범위를 따르고 `--delete-excluded` 금지는 유지. `폴더만`은 probe(`--filter "- *"` + `--create-empty-src-dirs`, GCS 포함) 후 P3로 결정. (2026-10-29 결정)
- [x] GCP 테스트 환경 → GCS 전용 버킷 + 그 버킷에만 권한 있는 서비스 계정 + 저장소 밖 테스트 전용 rclone.conf(환경 변수로 경로 전달). 없으면 skip. SFTP VM은 쓰지 않는다. (2026-10-29 결정)
- [x] OS 스케줄 실행 주체 → `rcloneGUI.exe --run-job <id>` → run-service `startAuto`(같은 안전 게이트). rclone 직접 호출 금지(안전 규칙 2). 앱이 켜져 있으면 `second-instance`로 기존 프로세스에 넘기고, 아니면 창 없이 실행 후 종료. Windows 작업 스케줄러는 사용자 권한·"로그온한 경우에만 실행"(비밀번호 저장 없음). WSL cron은 WSL이 꺼지면 돌지 않으므로 제외(P3 보류). `/mnt` 경로는 실행 시 기존 경로 변환으로 처리. (P3 착수 시 적용) (2026-10-29 결정)
- [x] 상태 텍스트 체크박스 → 전역 표시 설정. (2026-10-29 결정)
- [x] 스케줄 표현 → 주기(분/시간) + 매일 HH:MM + 요일 선택. cron 5필드는 Windows 작업 스케줄러로 옮길 수 없어 허용하지 않는다. (2026-10-29 결정)
- [x] SQLite 드라이버 → Electron 45 내장 `node:sqlite`(`DatabaseSync`) 사용. probe 결과 Electron 45.0.0 / Node 24.22.0 / SQLite 3.53.4에서 플래그 없이 동작(파일 DB·WAL·트랜잭션·한글·`json_extract`·FTS5 확인). 네이티브 모듈·재빌드·asar unpack·THIRD_PARTY_NOTICES 추가 불필요. API가 아직 안정 단계가 아니므로 `src/main/store/`의 얇은 어댑터 한 곳에서만 쓰고, DB 파일은 userData에 두며 main 프로세스에서만 연다. WAL + `busy_timeout` 기본 적용(single-instance 락으로 동시 접근은 없지만 방어용). electron-vite가 `node:sqlite`를 외부 모듈로 두는지와 빌드본·설치본 동작은 T-01 첫 단계에서 확인. (2026-10-29 결정)
- [x] sync + `--ignore-errors`(백업 없음) → 자동·OS 예약 실행에서 차단 유지, 수동 실행만 허용. `--max-delete`는 삭제 순서가 정해져 있지 않아 한도에 닿기 전 잘못된 삭제를 막지 못하므로, 지켜보는 사람이 없는 실행에서는 허용하지 않는다. 자동 실행에서 오류를 무시하려면 이미 허용된 백업 폴더 + `--ignore-errors` 조합을 안내한다. (P3 착수 시 적용) (2026-10-29 결정)
- [x] 리모트 관리 → 북마크(remote 이름 + 기준 경로 + 별칭)로 한정, rclone.conf 쓰기(`rclone config create/update/delete`)는 범위에서 뺀다. 암호화된 rclone.conf에서 비밀번호 입력 대기로 멈추지 않도록 헤드리스 실행·연결 테스트에는 `--ask-password=false`를 붙이고 실패로 기록한다. (2026-10-29 결정)
- [x] 놓친 OS 예약 → `StartWhenAvailable` 켬(여러 번 놓쳐도 한 번만 실행, 자동 실행 게이트 그대로). 로그온 직후 네트워크 드라이브·VPN·WSL 미준비 실패에 대비해 XML에 실패 시 재시도(예: 5분 간격 3회)를 넣고, 이력에 "로그온 직후 실행"을 표시한다. 작업별 "놓친 예약 건너뛰기" 옵션은 1차 범위 밖. (P3 착수 시 적용) (2026-10-29 결정)
- [x] 앱 제거 시 예약 작업 → NSIS 제거 스크립트에서 `\rcloneGUI\` 예약 작업을 지운다(PowerShell `Get-ScheduledTask -TaskPath "\rcloneGUI\" | Unregister-ScheduledTask`). 업데이트할 때도 이전 버전 제거 스크립트가 실행되므로 `${isUpdated}`이면 건너뛴다. DB는 보존되므로 재설치 후 앱을 처음 열 때 예약이 복원된다(그 전까지는 예약이 돌지 않음, 문서에 기록). (P3 착수 시 적용) (2026-10-29 결정)
- [x] 1차 범위 → OS 예약·헤드리스(T-13), 백업 없는 sync `--ignore-errors`(T-07)는 P3 보류. 근거: 로그인 시 트레이 시작(`--hidden`)으로 앱이 꺼지는 경우가 사용자가 직접 종료할 때뿐이고, 안전 규칙 3을 바꾸지 않는다. SQLite(T-01)는 첫 Phase로 단독 진행. (2026-10-29 결정)

## 작업 (Tasks)
- [x] T-01 [P1] SQLite 저장 계층 도입 — jobs/settings/history/remotes/exclude_patterns/schedules 스키마·마이그레이션, JSON→SQLite 이전(단일 트랜잭션·`user_version`·커밋 후 `.migrated`)·백업·롤백·`integrity_check`, 자격 증명 저장 금지, 기존 store API 유지, WAL 백업은 `VACUUM INTO`/`backup()`, 이력 페이지 조회(동기 API로 main 스레드 정지 방지), `active-run.json`·로그 파일은 파일 유지, 단위·통합 테스트
- [ ] T-02 [P1] 리모트 등록·폴더 탐색 — 리모트 북마크(rclone.conf의 remote 이름 + 기준 경로 + 별칭) CRUD·읽기 전용 연결 테스트, rclone.conf 쓰기 없음, 등록된 리모트 선택 후 폴더 목록 탐색·선택, SQLite 저장, rclone.conf 경로만 전달, 연결 테스트·폴더 탐색에 `--ask-password=false`
- [ ] T-03 [P1] 제외 패턴 라이브러리 — 전역 DB에 유일 저장, 작업별 체크박스 다중 선택, 새 패턴 추가, 한 줄 입력 유지, 중복 제거·앞뒤 공백만 정규화(줄바꿈 차단), 수정·삭제 시 사용 중인 작업 표시·확인, 패턴 스냅샷을 계획 토큰에 포함, `#`·`;`로 시작하는 패턴 차단(또는 이스케이프), 변경 시 관련 작업 비교 캐시 무효화·자동 실행 작업 별도 표시, 테스트
- [ ] T-04 [P1] 작업 목록·편집기 확장 — 원본·대상·자동화 여부·주기·최근 동기화 시각·상태 텍스트 표시, 목록에서 실행(비교·삭제 확인 또는 자동 실행 게이트를 그대로 거침), GoodSync 참고 레이아웃
- [ ] T-05 [P1] 작업별 동기화 범위 — 전체/파일만을 스키마·diff·명령 빌더·미리보기·실행·삭제 확인에 일관 적용(`전체`의 대상 빈 폴더 삭제를 삭제 수에 포함하는지 probe), 범위를 계획 토큰에 포함, GCS 빈 폴더 동작 probe, 범위별 테스트 (폴더만은 probe 후 P3)
- [ ] T-06 [P1] 앱 스케줄러 보완 — 주기·매일 HH:MM·요일 스케줄 모델, 자동 실행 작업이 있을 때 트레이 종료 경고(다음 예약 시각 표시), 로그인 시 시작 꺼짐 안내, WSL `/mnt` 경로 변환 확인, 안전 게이트 재사용
- [ ] T-07 [P3] (보류) `--ignore-errors` 단독 허용 — (T-12 안전 규칙 3 승인 선행) sync 수동 실행에서만 경고·확인 후 허용, `--max-delete`를 사전 확인 삭제 수로 고정, 자동·OS 예약 실행은 차단 유지, 이력·로그에 위험 옵션 기록, 명령 빌더 차단 목록·run gate·문서 갱신
- [ ] T-08 [P2] 실행 화면 재구성 — 비교/미리보기 → 실행 → 결과/이력 흐름으로 그룹화, 중지는 공통 실행 제어로 분리, 화면 용어 전수 검토·수정, 동기화에서 오류 무시 선택 시 백업 폴더 지정 안내
- [ ] T-09 [P2] rclone 옵션 검증·config 기본값 — 옵션별 글자 수 제한(저장 차단)·명령 전체 길이 검사·`--exclude-from` 전환(임시 파일 `wx` 생성·UTF-8(BOM 없음)·LF·실행 후 삭제·해시를 계획 토큰에 포함, 인자 방식과 결과 동일한지 probe), 빈 값 = "rclone.conf 값 사용" 표시, schema·UI·테스트
- [ ] T-10 [P2] GCP 테스트 수용 — 전용 테스트 버킷/remote로 임시 파일 copy/sync/삭제/취소 확인, 테스트 접두사가 아니면 실행 거부, 실행마다 고유 하위 경로 후 정리, 키·conf는 저장소 밖, 실제 데이터 미사용, 결과를 rclone-notes·CHANGELOG에 기록
- [ ] T-11 [P2] 배포 형태 확정 — NSIS 설치본 하나 유지(portable 없음) 확인, 기존 설치 스모크 통과, 문서 갱신
- [ ] T-12 [P2] 문서 갱신 — README/AGENTS/MVP_SPEC/CHANGELOG에 SQLite·앱 스케줄·범위·리모트/패턴 UX 반영 (기존 안전 규칙 변경 없음)
- [ ] T-13 [P3] (보류) Windows 작업 스케줄러·`--run-job` 헤드리스 — Windows 작업 스케줄러(schtasks `\rcloneGUI\<jobId>`·`/XML` 우선·`/RL LIMITED`·비밀번호 저장 없음), `--run-job <id>` 헤드리스 실행 모드(id zod 검증·다른 플래그 거부, 실행 중이면 기존 인스턴스로 전달, 헤드리스 중 GUI 요청 시 창 생성), 작업별 스케줄러 하나만 활성화(이중 실행 방지), 앱 시작 시 복원·고아 예약 정리, 작업 삭제·비활성화 시 정리, 권한·실패 안내, 안전 게이트 재사용, XML에 `StartWhenAvailable`·실패 시 재시도, 이력에 "로그온 직후 실행" 표시, 헤드리스 rclone에 `--ask-password=false`, 헤드리스 진입 시 OS 백엔드·켜짐·전역 일시정지 확인·이력 trigger 구분, XML 전원 조건·실행 시간 제한·`IgnoreNew` 명시·UTF-16·이스케이프, `RestartOnFailure` 동작 probe(종료 코드로 재시도 안 되면 앱 내 재시도), `app.isPackaged`에서만 OS 등록·exe 경로 변경 시 재등록, `additionalData`로 second-instance 전달, 암호화 conf 미지원 경고 (WSL cron은 P3 보류); 설치 스모크에 `--run-job` 추가, 제거 시 `\rcloneGUI\` 예약 작업 삭제(`installer.nsh`, `${isUpdated}`이면 건너뜀), Electron fuses 적용. 착수 시 "P3 OS 예약·`--ignore-errors` 착수 시 적용" 절을 따른다

## 진행 순서 (Phases)
1. T-01 SQLite — 단독 Phase. 착수 전 실제 userData를 따로 백업하고, 현재 버전 JSON으로 만든 fixture로 이전·롤백·`.migrated`를 테스트한다. 첫 실행은 임시 userData(`scripts/dev/drive-app.mjs`)로 확인한다.
2. T-03 제외 패턴 + T-09 길이 검증·`--exclude-from` — 같은 명령 빌더 변경이라 함께 한다. `#`·`;` 패턴 probe를 첫 단계로 한다.
3. T-02 리모트 북마크·폴더 탐색
4. T-05 동기화 범위 → T-04 작업 목록 (범위·스케줄 표시가 목록에 들어감)
5. T-06 앱 스케줄러 보완 → T-08 화면 재구성·용어
6. T-10 GCP 수용(키가 없으면 skip) → T-11 배포 확인 → T-12 문서
- Phase마다 `pnpm run check`·`format:check`, 빌더·파서 변경은 `test:int`, 화면 변경은 `test:e2e`를 통과한 뒤 커밋한다.
- `node:sqlite`는 안정 단계 API가 아니므로 Electron을 올릴 때마다 어댑터 테스트를 다시 돌린다.
