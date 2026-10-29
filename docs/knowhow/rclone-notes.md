# rclone 동작 노트

형식: 날짜 · rclone 버전 · OS · 명령 · 결과 · 앱에 준 영향.
재현: `node scripts/probes/rclone-probes.mjs` (임시 폴더만 사용, 출력은 `tests/fixtures/rclone/`).

## 2026-10-28 · rclone v1.75.1 · Windows 11 x64

### 1. 수정시간만 다른 파일은 복사하지 않고 시간만 갱신한다
- 명령: `sync --modify-window 2000ms --dry-run -v --use-json-log -- <src> <dst>` (local → local, 크기·내용 같고 mtime 10분 차이)
- 결과: `{"skipped":"update modification time","object":"touch.txt"}` 1건. stats `transfers`에는 들어가지 않는다.
  (크기가 같고 mtime이 다르면 rclone이 해시를 비교하고, 같으면 시간만 맞춘다)
- 영향: diff 엔진은 이 파일을 `modified(mtime)`로 센다(MVP_SPEC §7.3 의도대로). 그래서 MVP_SPEC §8.4 preflight 비교식
  `transfers == createFiles + updateFiles`는 이 경우 **PLAN_DRIFT 오탐**이 난다. Phase 7에서
  `transfers + touch(파일) == create + update` 또는 mtime 전용 변경을 따로 세는 방식으로 고쳐야 한다.
  통합 테스트 `tests/integration/rclone-core.test.ts`가 이 동작을 고정한다.

### 2. 없는 경로의 lsjson은 stdout에 `[` 만 남기고 exit 3
- 명령: `lsjson --recursive --files-only --no-mimetype -- <없는 경로>`
- 결과: stdout `[` + 줄바꿈, stderr `ERROR : error listing: directory not found`, exit 3.
- 영향: exit code가 0이 아니면 stdout을 파싱하지 않는다. 파싱하면 `clsLsjsonParseError`.

### 3. `--max-delete 0` 은 파일 삭제를 모두 막고 exit 7
- 명령: `sync --max-delete 0 -v --use-json-log -- <src> <dst>` (삭제 대상 2개)
- 결과: 복사는 진행된 뒤 삭제 단계에서 `Got fatal error on delete: --max-delete threshold reached` 2건,
  `not deleting directories as there were IO errors`, stats `deletes:0, errors:3, fatalError:true, lastError:"failed to delete 2 files"`, exit 7.
- 영향: 실제 sync는 항상 계획 삭제 수를 `--max-delete`로 넘긴다(`buildTransferArgs`가 없으면 거부).
  복사는 이미 끝났을 수 있으므로 UI에 "일부 반영됨"을 알려야 한다. 이 경우 오류 수(errors)는 삭제 거부 수 + 1이다.

### 4. stats 줄의 로그 레벨이 dry-run과 실제 실행에서 다르다
- 결과: dry-run 최종 stats는 `level:"notice"`, 실제 실행은 `level:"info"`.
- 영향: stats는 레벨이 아니라 `stats` 키 유무로 판별한다(`parseLogLine`).

### 5. lsjson ModTime은 로컬 오프셋이 붙은 ISO
- 결과: `"ModTime":"2026-01-01T09:10:00.0000000+09:00"` (소수 7자리).
- 영향: `Date.parse`로 epoch ms 변환이 정확히 된다(테스트로 확인).

### 6. dry-run 디렉터리 이벤트
- 결과: `skipped:"set directory modification time"`(새 폴더), `skipped:"remove directory"`(빈 폴더 정리). 파일 수에는 넣지 않는다.
  삭제된 폴더 수는 stats `deletedDirs`에 있다.

## 2026-10-28 · rclone v1.75.1 · Windows 11 x64 (Phase 3: 환경 감지·경로 확인)

### 7. `config file` 출력은 두 가지 형태
- 명령: `config file --ask-password=false --config <있는 파일>` / `--config <없는 파일>`
- 결과: 있으면 `Configuration file is stored at:` + 경로, 없으면 `Configuration file doesn't exist, but rclone will use this path:` + 경로. 둘 다 exit 0, stderr 없음, 줄바꿈 LF.
- 영향: `parseConfigFileOutput`이 두 형태를 모두 읽는다. 없는 파일이면 경로를 `--config`로 넘기지 않고 "설정 파일이 없어 로컬·UNC만" 경고를 낸다. 앱은 설정 파일을 열지 않고 `fs.stat`으로 존재만 본다.

### 8. `listremotes`는 설정 파일 순서대로 나오고, 없는 설정 파일에도 exit 0
- 명령: `listremotes --ask-password=false --config <conf>` (섹션 `probe-b`, `probe-alias` 순)
- 결과: `probe-b:` / `probe-alias:` (정렬 안 됨). 없는 설정 파일이면 stdout 비어 있음, stderr `NOTICE: Config file "<경로>" not found - using defaults`, exit 0.
- 영향: `parseListRemotes`가 정렬·`:` 제거를 한다. exit 0이면 stderr NOTICE는 무시한다. 수동 지정한 설정 파일은 rclone 호출 전에 `CONFIG_NOT_FOUND`로 먼저 막는다.

### 9. 경로 확인용 `lsjson --max-depth 1`
- 명령: `lsjson --max-depth 1 --no-mimetype --no-modtime --ask-password=false -- <부모 폴더>`
- 결과: 폴더(`IsDir:true`, `Size:0`)와 파일이 함께 나오고 `Name` 필드가 있다. `--no-modtime`이면 `ModTime:""`. 부모가 없으면 stdout `[`, stderr `directory not found`, exit 3. 대상이 파일이면 `lsjson -- <파일>`은 그 파일 1건을 exit 0으로 돌려준다.
- 영향: remote 경로 확인은 대상 자체가 아니라 **부모를 나열해 이름이 정확히 같은 항목**을 찾는다(`clsPathService`). exit 3은 "경로가 없습니다", 그 밖의 exit≠0은 `RCLONE_FAILED` + 안내(토큰 만료 → `rclone config reconnect <name>:`).
- `--ask-password=false`는 `config file`·`listremotes`·`lsjson`에서 오류 없이 받아진다(통합 테스트로 확인). 새 빌더에만 붙였고 기존 `buildLsjsonArgs`/`buildTransferArgs`는 Phase 5 전에 따로 검토한다.

## 2026-10-28 · rclone v1.75.1 · Windows 11 x64 (Phase 5: 비교 목록)

### 10. `lsjson --hash`만 주면 local은 해시 13종을 모두 계산한다 → `--hash-type`으로 제한
- 명령: `lsjson --recursive --files-only --no-mimetype --ask-password=false --hash [--hash-type md5 --hash-type sha1] --skip-links -- <임시 원본>` (fixture `lsjson-src-hash.*`, `lsjson-src-hashtype.*`)
- 결과: `--hash`만이면 `Hashes`에 blake3·crc32·dropbox·hidrive·mailru·md5·quickxor·sha1·sha256·sha512·whirlpool·xxh128·xxh3 13종이 들어간다(같은 5개 파일 stdout 4,882바이트). `--hash-type md5 --hash-type sha1`이면 `Hashes`에 `md5`·`sha1`만 남는다(1,082바이트). exit 0, stderr 없음. `--hash-type`은 여러 번 줄 수 있다.
- 결과: stdout은 `[` / 항목 한 줄씩(마지막 줄 빼고 끝에 `,`) / `]` 형태로 한 줄에 한 항목이다.
- 영향: 비교 목록은 `COMPARE_HASH_TYPES`(md5·sha1, local·Drive·S3·B2 공통)만 요청해 해시 계산·출력량을 줄인다. stdout을 모으지 않고 줄 단위 파서(`createLsjsonLineParser`)로 읽는다. 해시 비교는 양쪽에 같은 알고리즘이 있을 때만 하고, 없으면 크기만 비교했다고 경고한다.

### 11. 대상을 alias remote로 지정해도 로컬과 같은 목록·같은 비교 결과
- 명령: 같은 임시 대상 폴더를 로컬 경로와 `<alias>:<하위 경로>`로 각각 `lsjson`(통합 테스트 `compare.local.test.ts`)
- 결과: 경로·크기·수정시간이 같아 비교 요약·항목 상태가 완전히 같다.
- 영향: remote 경로도 같은 비교 경로를 탄다. 취소는 프로세스 트리 종료 후 `CANCELED`로 처리하고 그 작업의 이전 비교 결과를 지운다. 목록 직전에 폴더가 사라지면 lsjson exit 3(노트 2)을 `PATH_NOT_FOUND`로 바꾸고 stdout은 쓰지 않는다.

## 2026-10-28 · rclone v1.75.1 · Windows 11 x64 (Phase 6: 실행·취소)

### 12. 실제 copy 출력은 sync와 같은 형식, 삭제 줄만 없다
- 명령: `copy --ask-password=false --config <conf> --exclude *.tmp --checkers 8 --transfers 4 --fast-list --skip-links --modify-window 2000ms -v --use-json-log --stats 1s -- <src> <dst>` (fixture `copy-real.*`)
- 결과: `Copied (new)` / `Copied (replaced existing)`(size 있음), `Updated modification time in destination`(size 없음), `Set directory modification time (using DirSetModTime)`, 최종 stats `level:"info"`(transfers 3, bytes 24, errors 0). exit 0, stdout 없음. 대상에만 있는 파일은 건드리지 않는다.
- 영향: 실제 실행 로그는 `skipped`가 없으므로 dry-run 집계(`createDryRunCollector`)는 dry-run에만 쓴다. 실행 결과는 stats·exit code로 판정한다(`decideRunOutcome`).
- dry-run의 `skipped:"update modification time"`(파일)과 `"set directory modification time"`(폴더)은 파서에서 둘 다 touch이므로 **size 유무로 파일만 센다**(폴더 줄에는 size가 없다).

### 13. 진행 중 stats는 `--stats 1s` 간격으로 오고, totalBytes는 대기열에 들어온 파일만 센다
- 명령: 1 MiB 파일 3개를 `copy --transfers 1 --bwlimit 1M -v --use-json-log --stats 1s` (fixture `copy-progress.*`, `--bwlimit`은 이 실험에서만)
- 결과: 약 1초마다 stats 줄이 와서 bytes 1→2→3 MiB로 늘어난다. 중간 줄의 `totalBytes`는 2 MiB(대기열 기준)라 진행률이 100%를 찍었다가 다시 내려갈 수 있다. 중간 stats에는 `transferring` 배열이 더 있고, 첫 줄은 `Starting bandwidth limiter` info.
- 영향: `normalizeStats`는 알 수 없는 키를 무시하므로 그대로 쓴다. 진행률은 0~100으로 자르고(`progressPercent`), 화면에는 stats를 1초에 한 번만 보낸다(`clsRunEventBatcher`).

### 14. 실행 중 취소(taskkill /T /F)와 `.partial`
- 명령: 32 KiB 파일 400개를 `copy --transfers 1 --checkers 1`로 실행하고 첫 `Copied` 로그에서 취소(통합 테스트 `run.copy.test.ts`)
- 결과: 대상에 13/400개만 복사된 채 끝났고 rclone 프로세스는 남지 않았다. 이 크기에서는 `.partial` 파일이 남지 않았다(쓰는 중이던 파일이 없었음). 이미 복사된 파일은 그대로 남는다.
- 영향: 취소하면 결과와 관계없이 상태를 `canceled`로 기록하고, 화면·확인 창에 "취소해도 이미 복사된 파일은 대상에 남습니다"를 알린다. 실제 실행은 취소·실패해도 비교 결과를 버리고 lastRun을 갱신한다. 큰 파일 도중 취소하면 `.partial`이 남는다 → #17.

## 2026-10-29 · rclone v1.75.1 · Windows 11 x64 (Phase 7: 실제 sync·삭제 한도)

### 15. `--max-delete N`을 넘으면 N개까지는 지우고 멈춘다(exit 7), 빈 폴더는 지우지 않는다
- 명령: 삭제 대상 2개(`extra.txt`, `gone/old.txt`)인 대상에 `sync --ask-password=false --config <conf> --checkers 8 --transfers 4 --fast-list --skip-links --modify-window 2000ms --max-delete 1 -v --use-json-log --stats 1s -- <src> <dst>` (fixture `sync-maxdelete1.*`, 실행 뒤 대상 목록 `lsjson-dst-after-maxdelete1.*`)
- 결과: 복사 3개·시간 맞춤 1개는 모두 끝났고, `Deleted` 1개(fixture에서는 `gone/old.txt`) 뒤 다음 삭제에서 `Got fatal error on delete: --max-delete threshold reached` → `Cancelling sync due to fatal error` → `not deleting directories as there were IO errors`(빈 폴더 `gone`은 남음) → exit 7. 최종 stats `deletes:1, errors:2, fatalError:true, lastError:"failed to delete 1 files"`. 대상에는 `extra.txt`가 남았다.
- 재확인(2026-10-29, 같은 버전·명령 7회): 매번 exit 7·`Deleted` 1개·`not deleting directories as there were IO errors`·복사 반영이 재현됐다. 다만 **어느 파일을 지울지는 실행마다 다르다**(`extra.txt` 5회, `gone/old.txt` 2회 — 삭제가 병렬로 처리됨). fixture는 그대로 두었다.
- 결과: 통합 테스트(`run.sync.test.ts`)에서 사전 확인을 끄고 비교 뒤 삭제 대상을 2개 더 만들어(계획 2, 실제 4) `--max-delete 2`로 실행하면 정확히 2개를 지우고 exit 7.
- 영향: 사전 확인을 끈 작업은 비교 뒤 삭제 대상이 늘면 **한도까지 일부 삭제된 채** `failed`/`MAX_DELETE_EXCEEDED`로 끝날 수 있다(복사도 이미 반영됨). 그래서 사전 확인을 기본으로 켜 두고, 끄면 편집기·삭제 확인 창에 경고한다. 한도는 계획 삭제 수와 같게 주므로 계획보다 많이 지우지는 않는다. 한도를 넘었을 때 어느 파일이 지워졌는지는 정해져 있지 않으므로 로그(`Deleted` 줄)로만 알 수 있다.

### 16. sync dry-run의 최종 stats `deletes`는 건너뛴 삭제 수와 같다
- 명령: `sync ... --dry-run`(fixture `sync-dryrun.*`, 통합 테스트 `run.sync.test.ts`의 사전 확인)
- 결과: `Skipped delete` 줄 2개와 최종 stats `deletes:2`, `deletedDirs:1`이 일치한다. 비교 뒤 대상에 파일을 하나 더하면 사전 확인 stats `deletes:3`.
- 영향: 사전 확인 일치 검사(`checkPreflight`)는 로그 집계 삭제 수와 stats `deletes`를 둘 다 계획과 맞춰 보고, stats `errors > 0`도 불일치로 본다. 바이트는 비교하지 않는다(노트 #1의 시간만 맞춤 파일 때문).

## 2026-10-29 · rclone v1.75.1 · Windows 11 x64 (Phase 6 보완: 큰 파일 복사 중 취소)

### 17. 큰 파일 전송 중 taskkill /T /F로 끝내면 `<이름>.<8자리 16진수>.partial`이 대상에 남는다
- 명령: 32 MiB 파일 1개를 `copy --ask-password=false --config <conf> --checkers 8 --transfers 4 --fast-list --skip-links --modify-window 2000ms --bwlimit 4M -v --use-json-log --stats 1s -- <src> <dst>`로 복사하다 첫 stats의 `bytes > 0`에서 앱과 같은 `taskkill /PID <pid> /T /F` (fixture `copy-cancel-large.*`, `--bwlimit`은 이 실험에서만). 이어서 대상 목록(`lsjson-dst-after-cancel.*`), `sync --dry-run`(`sync-dryrun-after-cancel.*`), 같은 원본 다시 copy(`copy-after-cancel.*`)
- 결과: exit 1(강제 종료). 대상에는 `big.bin.<hash>.partial`(약 5 MiB)만 남고 **대상 파일 `big.bin`은 생기지 않는다**. lsjson은 이 파일을 보통 파일로 나열하고, sync dry-run은 `Skipped delete ... big.bin.<hash>.partial`(대상에만 있음 → 삭제 대상)로 센다.
- 결과: 같은 원본·대상이면 `<hash>`가 매번 같다(2회 취소해도 `.partial` 1개). 같은 원본을 다시 copy하면 `Copied (new)`로 끝나고 `.partial`은 없어진다(같은 임시 이름을 다시 써서 이름을 바꾸는 것으로 보임). **원본 파일이 바뀐 뒤** 다시 copy하면 새 파일은 복사되지만 예전 `.partial`은 그대로 남는다. 다른 temp 폴더에서 실행하면 `<hash>`가 다르다.
- 영향: 앱에서 큰 파일 복사·동기화를 취소(또는 종료 시 취소)하면 대상에 `.partial` 찌꺼기가 남을 수 있다. 다음 비교에서 copy 작업은 "대상에만 있음(유지)", sync 작업은 삭제 대상(삭제 확인 창 샘플에 보임)으로 나온다 — sync는 다음 실행에서 지워 정리하지만 copy는 계속 남는다. 2026-10-29 TASK_011에서 비교 목록·삭제 확인 창에 ‘취소로 남은 임시 파일’로 표시하고, 실제 전송 중 취소·실패면 안내를 띄우도록 했다(정리·제외 규칙은 없음).
