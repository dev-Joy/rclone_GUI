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

## 2026-10-29 · rclone v1.75.1 · Windows 11 x64 (INT-002 Phase 2: `--exclude-from`)

### 18. `--exclude-from` 파일의 `#`·`;` 줄은 주석, `\#`는 이스케이프, 빈 줄은 무시, 줄 앞뒤 공백은 지운다
- 명령: 임시 폴더(`#a`, `;a`, `a`, ` b `, `c`, `한글.txt`, `{p,q}`, `x/y`)에 `lsjson --recursive --files-only --no-mimetype --ask-password=false --config <conf> --exclude-from <파일> -- <폴더>` (fixture `excl-comment-file`·`excl-comment-arg`·`excl-escape-file`·`excl-blank-lines`·`excl-spaces`)
- 결과: 파일 내용 `#a\n;a\n` → 아무것도 빠지지 않음(둘 다 주석). 같은 패턴을 인자 `--exclude "#a" --exclude ";a"`로 주면 두 파일이 빠진다. 파일의 `\#a`는 `#a`를 뺀다. 빈 줄은 무시된다. 파일 줄 `  a  `는 `a`를 뺀다(줄 앞뒤 공백을 지움). 모두 exit 0.
- 영향: 라이브러리 패턴은 `#`·`;` 시작과 앞뒤 공백을 막는다(DB CHECK + zod). 작업 전용 패턴 중 `#`·`;`로 시작하거나 앞뒤 공백이 있는 것은 파일을 쓸 때도 항상 `--exclude` 인자로 넘긴다(`isFileSafePattern`). 파일에는 빈 줄을 쓰지 않는다.

### 19. BOM이 있으면 첫 패턴이 깨진다, CRLF는 문제없다
- 명령: 같은 폴더에 `--exclude-from`으로 `﻿a\nc\n`(fixture `excl-bom`)과 `a\r\nc\r\n`(fixture `excl-crlf`)
- 결과: BOM 파일은 `c`만 빠지고 `a`는 남는다(첫 줄이 BOM+`a`로 읽힘). CRLF 파일은 `a`·`c` 모두 빠진다. exit 0, 경고 없음.
- 영향: 제외 파일은 BOM 없는 UTF-8·LF로만 쓰고, 쓴 뒤 다시 읽어 앞 3바이트가 `EF BB BF`가 아님을 확인한다(`writeExcludeFile`).

### 20. `--exclude`와 `--exclude-from`은 합쳐 적용되고, 200개 패턴은 인자와 파일 결과가 같다
- 명령: `--exclude a --exclude-from <c만 든 파일>`(fixture `excl-arg-and-file`). 301개 파일 폴더에 패턴 200개(파일 이름 196개, `d3/**`, `*.tmp`, `{n290,n291}.dat`, `/n299.dat`)를 인자 200개(약 3,800자)와 파일 1개로 각각 `lsjson`(`excl-many-args-lsjson`·`excl-many-file-lsjson`)·`sync --dry-run`(`excl-many-args-sync`·`excl-many-file-sync`)
- 결과: `a`·`c` 모두 빠진다(합집합). 200개는 lsjson 남은 항목 96개, sync dry-run 건너뛴 동작 103건이 두 방식에서 완전히 같다.
- 영향: 패턴이 많으면(64개 초과 또는 인자 길이 약 8,000자 초과) 파일에 넣을 수 있는 패턴은 `--exclude-from` 파일로, 나머지는 인자로 함께 넘긴다. 비교와 실행이 같은 방식을 쓰도록 방식은 패턴만으로 정한다.

### 21. 없는 `--exclude-from` 파일은 exit 1로 실패한다
- 명령: `lsjson ... --exclude-from <없는 파일> -- <폴더>` (fixture `excl-missing-file`)
- 결과: stdout 없음, stderr `CRITICAL: Failed to initialise global options: failed to reload "filter" options: open <파일>: The system cannot find the file specified.`, exit 1.
- 영향: 파일이 실행 전에 지워져도 제외 없이 진행되지 않고 실패한다. 그래도 파일은 실행 직전에 만들고(`wx`) 다시 읽어 확인하며, 실행이 끝나면 지운다. 앱 시작 때 남은 `exclude-files/excl-*.txt`를 정리한다.

## 2026-11-02 · rclone v1.75.1 · Windows 11 x64 (INT-002 Phase 4: 동기화 범위)

### 22. `--create-empty-src-dirs`가 있으면 원본에만 있는 폴더마다 `make directory`가 나온다(파일이 든 폴더 포함)
- 명령: 원본(`file.txt`, `keep/a.txt`, `newdir/sub/n.txt`, 빈 폴더 `empty-src`·`nest/a/b`·`both-empty`·`skip`), 대상(`file.txt`, `keep/a.txt`, `skip/keep.txt`, `gone/old.txt`, 빈 폴더 `both-empty`·`dst-only-empty`·`dst-only-nest/x`)에 `copy|sync ... --exclude "skip/**" [--create-empty-src-dirs] --dry-run -v --use-json-log` (fixture `scope-copy-files-dryrun`·`scope-copy-all-dryrun`·`scope-sync-all-dryrun`)
- 결과: 옵션이 없으면 `make directory`가 없다. 있으면 `empty-src`, `nest`, `nest/a`, `nest/a/b`, `newdir`, `newdir/sub` 6개가 `skipped:"make directory"`로 나온다(파일 복사 때문에 어차피 생기는 `newdir`·`newdir/sub`도 포함). 실제 copy 뒤 대상에 빈 폴더 4개가 생긴다(`scope-copy-all-real`).
- 영향: 비교 요약의 `createDirs`는 "파일이 없는 원본 전용 폴더"(옵션 때문에만 생기는 폴더)라 dry-run의 `make directory` 수와 다르다. 그래서 사전 확인은 폴더 생성 수를 비교하지 않고 화면 표시에만 쓴다.

### 23. sync는 대상에만 있는 폴더를 모두 `remove directory`로 지우고, 최종 stats `deletedDirs`가 그 수와 같다
- 명령: 같은 폴더로 `sync [--create-empty-src-dirs] --dry-run`, 실제 sync (fixture `scope-sync-files-dryrun`·`scope-sync-all-dryrun`·`scope-sync-all-real`·`scope-sync-all-dirsonly-dryrun`)
- 결과: `dst-only-empty`, `dst-only-nest`, `dst-only-nest/x`, `gone`(파일 삭제로 비게 되는 폴더) 4개가 `remove directory`, 최종 stats `deletedDirs: 4`. 파일 삭제가 없을 때는 3개·`deletedDirs: 3`. 양쪽에 다 있는 빈 폴더 `both-empty`는 지우지 않는다. **파일만 범위(옵션 없음)에서도 같은 4개를 지운다.**
- 영향: 전체 범위의 `deleteDirs`는 "대상에만 있는 폴더 전부"로 세고, 사전 확인에서 dry-run의 폴더 삭제 수와 `deletedDirs`를 함께 비교한다. 파일만 범위의 삭제 확인 창에는 "대상에만 있는 빈 폴더도 지워집니다"라고 쓴다.

### 24. `--exclude "skip/**"`는 lsjson 목록에서 `skip` 폴더 자체도 빼고, sync도 그 폴더를 건드리지 않는다
- 명령: `lsjson --recursive --no-mimetype --exclude "skip/**"` (fixture `scope-lsjson-src-all`·`scope-lsjson-dst-all`)와 위 sync
- 결과: 원본의 빈 `skip`, 대상의 `skip`(안에 `keep.txt`) 모두 목록에 없다. sync 뒤에도 대상 `skip/keep.txt`가 남는다.
- 영향: 폴더 포함 목록(`--files-only` 없음)으로 센 폴더 삭제 수가 rclone의 실제 폴더 삭제와 어긋나지 않는다.

### 25. `--max-delete`는 폴더 삭제를 세지 않는다
- 명령: `sync --create-empty-src-dirs --max-delete 0` (fixture `scope-sync-all-maxdelete0`, `scope-sync-all-dirsonly-maxdelete0`)
- 결과: 파일 삭제가 있으면 exit 7(`--max-delete threshold reached`, `not deleting directories as there were IO errors`), 폴더는 하나도 지우지 않는다(빈 폴더 생성은 이미 됨). 파일 삭제 없이 폴더 삭제만 있으면 exit 0으로 빈 폴더 3개를 모두 지운다.
- 영향: `--max-delete`에는 파일 삭제 수만 넘긴다. 폴더 삭제는 계획 토큰·확인한 폴더 삭제 수·사전 확인이 막는다. rmdir은 빈 폴더만 지우므로 파일은 잃지 않는다.

### 26. `--create-empty-src-dirs`면 기존 폴더의 `set directory modification time`에도 `size: 0`이 붙는다
- 명령: 위 `sync --create-empty-src-dirs --dry-run`(파일 삭제 없음, fixture `scope-sync-all-dirsonly-dryrun`)
- 결과: 새로 만들 폴더의 줄은 `objectType:"string"`이고 size가 없지만, 양쪽에 있는 폴더(`both-empty`, `keep`)의 줄은 `objectType:"*local.Directory"`, `size:0`이다. #6의 "폴더 줄에는 size가 없다"가 이 옵션에서는 맞지 않는다.
- 영향: 로그 파서가 `set directory modification time`을 파일 수정시간(`touch`)과 다른 종류(`dirTime`)로 나눈다. 나누지 않으면 사전 확인이 폴더를 "시간만 맞춤 파일"로 세어 전체 범위 sync가 매번 PLAN_DRIFT로 막힌다.

## 2026-11-02 · rclone v1.75.1 · Windows 11 x64 (INT-003 T-04: backend features)

### 27. `backend features`의 `Features.CanHaveEmptyDirectories` — 로컬 true, 메모리 false, alias는 감싼 대상 값
- 명령: `backend features --ask-password=false --config <빈 conf> <대상>` — 대상: 로컬 임시 폴더, `:memory:`, `:alias,remote='<로컬 임시 폴더>':`, conf에 없는 remote (fixture `features-local`·`features-memory`·`features-alias-local`·`features-missing-remote`)
- 결과: 로컬 `true`(exit 0), `:memory:` `false`(`Name: ":memory"`, `Root: ""`), alias는 `Name: "local"`로 감싼 로컬의 기능을 그대로 보여 `true`. 없는 remote는 stdout 없이 stderr `NOTICE: Failed to backend: didn't find section in config file (...)`, exit 1. 출력 `Root`·`String`에 대상 경로가 들어간다.
- 영향: T-05(FR-30)는 stdout JSON의 `Features.CanHaveEmptyDirectories`만 읽고, 실패(0이 아닌 exit·해석 실패)는 null로 둔다. alias·union은 결과를 그대로 믿는다(spec E-13). `:memory:`를 "빈 폴더를 만들 수 없는 대상"의 로컬 대용으로 테스트에 쓸 수 있다. 출력에 경로·버킷 이름이 있으므로 로그·이력에 원문을 남기지 않는다. GCS 값(`directory_markers` 꺼짐·켜짐)은 GCS 수용 테스트로 확인한다(키 제공 후).

## 2026-11-02 · rclone v1.75.1 · Windows 11 x64 (INT-003 T-03: 백업 폴더 `--backup-dir`)

공통 명령: `sync --ask-password=false --config <빈 conf> --checkers 8 --transfers 4 --fast-list --skip-links --modify-window 2000ms [--create-empty-src-dirs] --backup-dir <백업>\run1 [--dry-run | --max-delete N] -v --use-json-log --stats 1s -- <원본> <대상>`. 원본은 `same`·`touch`(시간만 다름)·`changed`·`changed2`(덮어쓰기)·`sub/new`(새 파일), 대상은 시나리오에 따라 지울 파일 2개(`extra.txt`·`gone/old.txt`)와 덮어쓸 파일 2개 (`node scripts/probes/rclone-probes.mjs --only=backup`, `--only=backup-s3`).

### 28. `--backup-dir` dry-run: 지울 파일은 `move into backup dir`, 덮어쓸 파일은 `move` + `copy`
- 명령: 위 공통 명령 + `--dry-run` (fixture `backup-delonly-dryrun`·`backup-overonly-dryrun`·`backup-both-dryrun`·`backup-dirs-dryrun`)
- 결과: 지울 파일은 `skipped:"move into backup dir"`(msg `Skipped move into backup dir as --dry-run is set (size N)`), 덮어쓸 파일은 `skipped:"move"`와 `skipped:"copy"` 두 줄. 최종 stats `deletes`는 지울 파일 수(2), `renames`는 덮어쓰기 이동 수. 폴더 삭제는 그대로 `remove directory`. dry-run은 백업 폴더를 만들지 않는다.
- 영향: 로그 파서가 `move into backup dir`를 `delete`로, `move`를 `backupMove`(세지 않음)로 분류한다. 그러지 않으면 사전 확인의 삭제 수가 0이 되어 매번 PLAN_DRIFT로 막힌다. 사전 확인 비교 규칙(삭제 수·stats.deletes = 계획)은 그대로 쓴다.

### 29. 실제 실행(Move 지원·같은 드라이브): 덮어쓰기 이동은 `--max-delete`에 들어가지 않는다
- 명령: `--max-delete 2`(삭제만·둘 다), `--max-delete 0`(덮어쓰기만), 한도 1·0 (fixture `backup-delonly-real`·`backup-overonly-real`·`backup-both-real`·`backup-both-maxdelete1`·`backup-both-maxdelete0`)
- 결과: 지울 파일은 `Moved (server-side)` → `Moved into backup dir`, 덮어쓸 파일은 `Moved (server-side)` → `Copied (new)`. 덮어쓰기만이면 `--max-delete 0`으로 exit 0. 둘 다는 한도 2로 exit 0이고 백업에 4개가 생긴다. 한도 1이면 덮어쓰기 2개와 삭제 1개만 옮기고 exit 7, 한도 0이면 덮어쓰기만 옮기고 exit 7(#3·#15와 같음). 폴더는 백업하지 않고 지운다.
- 영향: 백업 폴더가 있어도 `--max-delete <계획 파일 삭제 수>`를 그대로 준다(안전 규칙 2 유지). 단 대상이 서버 쪽 Move를 지원할 때만 맞다(#30).

### 30. Move가 없는 저장소와 다른 드라이브: 백업 이동이 "복사 + 삭제"가 되어 덮어쓰기까지 `--max-delete`를 쓴다
- 명령: 백업이 다른 드라이브(`RCLONEGUI_PROBE_OTHER_DRIVE`) / `rclone serve s3`(127.0.0.1, 임의 키) 위의 대상·백업, `backend features --ask-password=false --config <빈 conf> -- <s3 remote>` (fixture `backup-other-drive-dryrun`·`backup-other-drive-real`·`backup-s3-features`·`backup-s3-dryrun`·`backup-s3-real-maxdelete2`·`backup-s3-real-maxdelete4`)
- 결과: dry-run 출력은 #28과 같아 구분할 수 없다. 실제 실행은 덮어쓰기마다 `Copied` → `Deleted` → `Copied (new)`라 한도 2를 덮어쓰기가 다 써서 삭제가 막힌다(exit 7). S3는 `Features.Move:false, Copy:true`이고 한도 4(덮어쓰기 2 + 삭제 2)로도 exit 7 — 지울 파일 하나가 한도를 2 쓴다. 이동에 실패한 대상 파일은 그대로 남는다. `backend features`는 `--` 뒤 위치 인자를 받는다(exit 0).
- 영향: 백업 폴더는 대상과 같은 드라이브·공유·remote에만 둘 수 있고(저장 검사), remote 대상은 실행 전에 `backend features`의 `Features.Move === true`일 때만 실행한다(아니거나 조회 실패면 SAFETY_BLOCKED, INT-003 FR-36). 한도를 늘리는 방식은 쓰지 않는다.

### 31. 백업 하위 폴더에 같은 이름 파일이 있으면 예전 백업을 지우고(한도에 듦) 덮어쓴다
- 명령: 백업 `run1`에 `extra.txt`·`changed.txt`를 미리 두고 `--max-delete 2` (fixture `backup-collision-real`)
- 결과: 덮어쓸 `changed.txt`의 예전 백업이 `Deleted` → `Moved (server-side)`로 바뀐다. 이 삭제가 한도를 써서 지울 파일 2개는 `Couldn't move into backup dir: --max-delete threshold reached`로 남고 exit 7. dry-run에는 나오지 않는다.
- 영향: 실행마다 다른 하위 폴더(`YYYY-MM-DD_HHmmss_<작업 id 8자>`)를 쓰고, 같은 프로세스 안에서는 백업 시각이 1초 이상씩 늘어나게 한다(`nextBackupTime`). 그래도 겹치면 한도에 걸려 멈추지만 예전 백업 1개는 잃을 수 있다.

### 32. 대상·원본과 백업이 겹치면 dry-run에서도 fatal(exit 7)
- 명령: 백업이 대상 안 / 원본 안 + `--dry-run` (fixture `backup-overlap-dest`·`backup-overlap-src`)
- 결과: `Failed to sync: destination and parameter to --backup-dir mustn't overlap` / `source and parameter to --backup-dir mustn't overlap`, exit 7, 전송 없음.
- 영향: 앱은 저장 단계에서 같은 검사를 먼저 해 오류를 필드에 보여 준다(대상 안을 필터로 제외하면 rclone은 허용하지만 앱은 거부한다).

## 2026-11-02 · rclone v1.75.1 · Windows 11 x64 (INT-003 T-05: 빈 폴더를 만들 수 없는 대상)

### 33. 이름 있는 `type = memory` remote는 rclone 프로세스마다 비어 있다
- 명령: 임시 conf에 `[<이름>]` `type = memory`를 두고 `copy --create-empty-src-dirs --config <임시 conf> <임시 원본(파일 1 + 빈 폴더 1)> <이름>:x` → 다음 프로세스에서 `lsjson --config <임시 conf> <이름>:x`, `backend features --config <임시 conf> <이름>:`
- 결과: copy는 exit 0이지만 다음 `lsjson`은 `error listing: directory not found`, exit 3. `Features.CanHaveEmptyDirectories`는 `false`(#27의 `:memory:`와 같음).
- 영향: 앱 경로 검사가 `:memory:`·연결 문자열을 거부하므로, AC-13 로컬 대용 테스트(통합 `run.scope.test.ts`, E2E `empty-dirs.spec.ts`)는 임시 conf의 이름 있는 memory remote를 쓴다. 실행 뒤에도 대상이 비어 다시 비교하면 같은 차이가 나오므로 원본에는 빈 폴더만 둔다(파일을 두면 매번 createFiles가 남는다). 앱 실행 동안 features는 캐시하므로 conf의 `directory_markers` 등을 바꾸면 앱을 다시 시작해야 반영된다.

## 2026-11-02 · rclone v1.75.1 · Windows 11 x64 (INT-003 T-08: Google Drive 수용 테스트)

### 34. Google Drive `backend features`: 빈 폴더·서버 쪽 Move를 모두 지원한다
- 명령: `backend features --ask-password=false --config <conf> -- <drive remote>:` (`drive-acceptance.test.ts` 1번 케이스, 값은 허용 목록만 출력)
- 결과: `CanHaveEmptyDirectories`·`Move`·`DirMove`·`Copy`·`Purge` true, `CaseInsensitive` false, `DuplicateFiles` true, Precision 1000000(1ms), Hashes md5·sha1·sha256.
- 영향: Drive 대상은 `전체` 범위에서 빈 폴더를 만들고(비교 화면 구분 표시 없음, T-05), 백업 폴더 sync가 FR-36(서버 쪽 Move) 검사를 통과한다. 같은 이름 파일·폴더가 여럿 있을 수 있다(`DuplicateFiles`) — 테스트는 실행마다 새 하위 폴더를 쓴다.

### 35. Drive에서 앱의 copy·sync·전체 범위·백업 폴더·중지가 기대대로 동작한다
- 명령: 앱 실행 경로(비교 → 확인 → 실제 실행, `run-harness`)로 copy / sync 갱신 / sync 삭제 / 백업 폴더 sync / 업로드 중 중지 / 전체 범위 copy·sync / 자동 실행(AC-13)
- 결과: 모두 success(중지는 canceled). 다시 비교하면 차이 0. 전체 범위 copy는 빈 폴더 3개를 만들고 sync는 대상에만 있는 폴더·파일을 지운다. 백업 폴더 sync는 지운 파일을 `백업/<실행 하위 폴더>/`로 옮긴다. 업로드 중 중지하면 40개 중 1개만 올라가고 `.partial`은 남지 않는다(Drive는 업로드가 끝나야 파일이 생김, 로컬 #17과 다름). 케이스별 13~105초(백업 폴더가 가장 느림), 전체 약 8분.
- 영향: 수용 시나리오는 대상 파일이 2개뿐이라 삭제 1개도 대량 삭제(50%)가 되어 `confirmLargeDeletes`가 필요하다 — 첫 실측에서 sync 삭제·전체 범위 sync가 SAFETY_BLOCKED로 멈춰 테스트 도우미(Drive·GCS 둘 다)를 고쳤다. 앱 게이트는 의도대로 동작했다.

### 36. Drive sync가 지운 파일은 휴지통으로 가고, 백업 폴더로 옮긴 파일은 휴지통에 없다
- 명령: 삭제 뒤 `lsf -R --drive-trashed-only <대상>`(`f_LogTrash`, 기록만)
- 결과: sync 삭제 뒤 휴지통 파일 1개(지운 파일 있음). 전체 범위 sync(폴더 삭제) 뒤 1개. 백업 폴더 sync 뒤 0개 — 지운 파일이 백업으로 이동했기 때문. 테스트 정리(purge)도 기본 설정이라 휴지통으로 간다.
- 영향: Drive 대상 sync 삭제는 기본(`use_trash` 기본값)에서 휴지통으로 되돌릴 수 있다. 앱은 conf를 읽지 않으므로(안전 규칙 6) 사용자 remote의 휴지통 설정을 확인할 수 없어 안내 문구에 휴지통 복구를 약속하지 않는다. 이 remote는 rclone 공용 client_id를 써서 실행마다 "2026년 중 중단" NOTICE가 stderr에 나온다.

## 2026-11-03 · rclone v1.75.1 · Windows 11 x64 (INT-004 T-01: Google Drive 실행 stats)

공통 명령: `rclone copy <임시 원본> <drive remote>:rclonegui-test-it/rclonegui-it-<시각>-<난수>/ --config <conf> --use-json-log --stats 1s --log-level INFO --log-file <로그> --transfers 4 --checkers 8 --fast-list`. 원본은 작은 파일 200개(약 0.6MB) + 30MB 파일 1개(총 201개, 32,037,140바이트). fixture는 `drive-small-files-progress.stderr.txt`(stats 493줄 중 5초 간격으로 줄인 124줄, 경로·이름 가림).

### 37. 대상에 같은 파일이 없는 copy는 `totalChecks`가 끝까지 0이고, `totalBytes`는 실행 중에도 늘어난다
- 결과: 첫 stats부터 `totalTransfers` 201, `totalChecks` 0. 마지막까지 `checks` 0. `totalBytes`는 32,037,140에서 시작해 실행 중 32,117,659까지 80,519바이트 늘었다(원본 변화 또는 재시도 추정, 원인 미확인). `transferring[]` 항목은 `bytes: 0`으로 나오는 순간이 있고, `size`는 파일 크기다.
- 영향: 계획 없는 copy에서 확인(checks)만으로 분모를 확정할 수 없다 — 앱은 `totalTransfers`가 5초 동안 그대로일 때 확정한다(FR-2). 분모 바이트는 `max(계획, rclone)`으로 키워 진행률이 100%를 넘지 않게 한다. `transferring[].bytes/size`로 부분 진행률을 계산하되 `bytes`가 없으면 0으로 센다(FR-1).

### 38. Drive는 초반에 몰아서 올린 뒤 속도 제한으로 느려지고, 그 구간 rclone `eta`는 0초를 낸다
- 결과: 201개를 492.9초에 완료(오류 0). 첫 10초에 30MB 파일과 작은 파일 10여 개가 끝나 `bytes`가 98%가 되었고, 이후 작은 파일은 초당 0.3~0.5개로 떨어졌다(172초 91개, 272초 147개, 493초 201개). `transferring`은 항상 4개 안팎이었다. 대부분의 stats에서 rclone `eta`는 0초다(남은 바이트가 거의 없어서).
- 영향: 파일 수 누적 평균은 초반 폭주를 미래 속도로 외삽해 초반 남은 시간을 낮게 낸다. 실측 재생에서 "계산 중"이 풀린 11~29초의 19개 지점이 실제 남은 시간의 0.314~0.330배(최대 3.18배 과소)였고, 30초 이후에는 1/3~3배 안이었다. spec AC-8b의 하한을 1/3 → 1/4로 넓힌 근거다(spec §10 Q-4). 상한 3배·인접 2배는 그대로다.
- fixture: 가림은 `msg`를 비우고 `transferring[].name`을 `file-NNNN`, `srcFs`·`dstFs`를 `<SRC>`·`<DST>`로 바꾸는 방식. 30초 이후는 5초 간격으로 줄였다(용량 500KB 제한).

## 2026-11-03 · rclone v1.75.1 · Windows 11 x64 (INT-006 결정용 실측: remote 설정 쓰기)

모두 `%TEMP%` 아래 임시 conf(`--config <임시>\t.conf`)와 가짜 값으로 했고, 끝난 뒤 폴더를 지웠다. fixture는 아직 없다(INT-006 S1-1에서 probe 스크립트로 다시 받는다).

### 39. `obscure -`는 stdin을 받고, `config create/update`는 `--no-obscure`를 지킨다
- 명령: `rclone obscure -`(stdin에 평문), `config create <n> sftp host=h pass=<obscure 값> --no-obscure --non-interactive`, `config update <n> pass=<obscure 값> --no-obscure --non-interactive`
- 결과: 모두 exit 0, conf 값을 `reveal`하면 원래 평문. `--no-obscure` 없이 obscure 값을 넘겨도 이중 obscure 하지 않았다(이미 obscure 된 값으로 판단). 평문을 넘기면 rclone이 obscure 한다. 성공 시 stdout은 `{"State":"","Option":null,"Error":"","Result":""}`.
- 영향: 방식 자체는 동작하지만 INT-006은 쓰지 않는다(#40·#42).

### 40. obscure는 `IsPassword` 옵션에만 적용된다. `Sensitive` 옵션은 conf에 평문이다
- 명령: `rclone config providers`(69종) 집계
- 결과: `IsPassword` 옵션 36개, `IsPassword` 없이 `Sensitive`만 붙은 옵션 206개. 예: sftp `pass`·`key_file_pass`는 IsPassword, `host`·`user`·`key_pem`은 Sensitive. S3 `access_key_id`·`secret_access_key`·`session_token`, Drive `client_id`·`client_secret`·`token`·`service_account_credentials`는 Sensitive.
- 영향: `obscure -` + `--no-obscure`로는 S3 비밀 키·client_secret이 평문으로 명령줄에 나온다. obscure 값도 `rclone reveal`로 되돌릴 수 있어 프로세스 감사 로그에 남으면 평문과 같다. INT-006 Q1을 rcd HTTP 본문으로 결정한 근거.

### 41. `RCLONE_CONFIG_<NAME>_<OPT>`는 conf에 기록되지 않고, 암호화 conf는 `RCLONE_CONFIG_PASS`가 있으면 create 된다
- 명령: `RCLONE_CONFIG_<N>_PASS=<값> rclone config update <n> host=h2 --non-interactive`, 같은 환경 변수로 `config create`(pass 인자 없음). 암호화 conf: `config encryption set`(stdin에 비밀번호 두 줄) 뒤 `config create ... --ask-password=false`
- 결과: 환경 변수 값은 conf에 저장되지 않았다(update는 기존 pass 유지, create는 pass 줄 없음). 암호화 conf는 `RCLONE_CONFIG_PASS`가 있으면 create exit 0이고 `listremotes`에 보인다. 없으면 `unable to decrypt configuration and not allowed to ask for password` CRITICAL.
- 영향: 환경 변수로는 비밀 값을 conf에 쓸 수 없다. 암호화 conf도 지금 env 정책(`RCLONE_CONFIG_PASS` 통과)으로 쓰기가 된다.

### 42. `rcd --rc-addr 127.0.0.1:0`은 실제 포트를 출력하고, `config/create`는 HTTP 본문의 평문을 obscure 해 저장한다
- 명령: `RCLONE_RC_USER=<u> RCLONE_RC_PASS=<p> rclone rcd --rc-addr 127.0.0.1:0 [--ask-password=false] --config <임시>`, `POST /config/create {"name","type","parameters":{...},"opt":{"obscure":true,"nonInteractive":true}}`, `POST /core/quit`
- 결과: stderr `NOTICE: Serving remote control on http://127.0.0.1:<port>/`. 인증 헤더 없는 요청은 401. sftp `pass` 평문은 obscure 되어, S3 `secret_access_key`(Sensitive)는 평문으로 저장됐다(conf 동작은 CLI와 같음). 암호화 conf(`RCLONE_CONFIG_PASS`)에서도 됐다. `core/quit`으로 프로세스가 끝났다. **`POST /config/get`은 obscure 된 `pass` 값을 그대로 돌려준다.**
- 영향: INT-006 FR-14. 값이 명령줄에 나오지 않는다. 앱은 `config/get`·`config/dump`를 부르지 않는다.

### 43. `config redacted`는 `IsPassword`·`Sensitive`를 모두 `XXX`로 가리고, `config show`는 비밀번호를 `*** ENCRYPTED ***`로 보여 준다
- 명령: `rclone config redacted <n>`, `rclone config show <n>`
- 결과: redacted는 sftp `host`·`user`·`pass`·`key_file_pass`, S3 `access_key_id`·`secret_access_key`를 `XXX`로 바꾸고 `port`·`provider`는 그대로 보였다. 끝에 `### Double check the config for sensitive info before posting publicly`. 도움말에도 "redaction may not be perfect". `config show`는 IsPassword만 `*** ENCRYPTED ***`로 바꾸고 host·user·Sensitive 값은 그대로 보였다.
- 영향: INT-006 FR-17. 수정 화면에 채워지는 것은 비밀 아닌 옵션뿐이다. providers 정의로 한 번 더 버린다. `config show`는 계속 막는다.

### 44. remote 이름 규칙: 글자·숫자·`_ - . + @`·공백, `-`로 시작하면 플래그로 해석된다
- 명령: `config create "<이름>" memory --non-interactive`
- 결과: 허용 — `a b`, `a.b`, `a@b`, `a+b`, `a-b`, `a_b`, `한글`, `a`, `1`, `a b c`, `ab.`, `.ab`. 거부 — ` ab`, `ab `, `ab-`, `a:b`, `a/b`, `a\b`(`config name contains invalid characters - may only contain numbers, letters, _, -, ., +, @ and space, while not start with - or space, and not end with space`). `-ab`는 이름 검사 전에 `unknown shorthand flag: 'a' in -ab`.
- 영향: INT-006 FR-5. 앱은 새 이름에서 공백·한 글자·`-`로 시작·끝을 막는다. 끝 `-` 거부는 오류 문구와 다르므로 버전을 올릴 때 다시 확인한다.

### 45. Drive 비대화형 추가의 첫 질문은 공용 client_id 중단 경고이고 기본값이 false다
- 명령: `config create <n> drive --non-interactive`, 이어서 `config update <n> --continue --state client_id_warning --result <true|false> --non-interactive`
- 결과: 첫 응답 `State: client_id_warning`, `Option.Name: config_shared_client_id`, Help "rclone's shared Google Drive client_id is being retired and will stop working during 2026. ... Continue using the shared client_id anyway?", `Default: false`. false면 `State: client_id_set`(client_id 입력), true면 `State: *oauth-islocal,teamdrive,oauth,`(`config_is_local`, 기본 true). create 때 `client_id`·`client_secret`을 주면 바로 `config_is_local` 질문으로 간다. 이 단계까지는 브라우저를 열지 않았다.
- 영향: INT-006 FR-15a. 질문을 기본값으로 넘기면 Drive 추가가 client_id 입력에서 멈춘다. 앱은 범용 질문 폼으로 받는다.

## 2026-11-03 · rclone v1.75.1 · Windows 11 x64 (INT-007 T-01: `--filter-from`·뒤 공백·인자 파일)

probe `filter` 묶음(`node scripts/probes/rclone-probes.mjs rclone --only=filter`). 임시 폴더(`#a`, `;a`, ` lead`, `!a`, `a`, `c`)와 빈 임시 conf만 썼다. 필터 해석은 `--dump filters`로 봤다(probe 전용, 앱은 `--dump*`를 쓰지 않는다). 최소 버전 1.65.0에서는 아직 확인하지 않았다.

### 46. rclone은 인자 파일(`@file`)을 지원하지 않는다
- 명령: `rclone @<파일>`(파일 내용 `lsf`) (fixture `argfile-at`)
- 결과: exit 2, `Error: unknown command "@<파일>" for "rclone"`.
- 영향: 명령줄 전체를 파일로 옮기는 방법은 없다. INT-007은 필터만 파일로 옮긴다.

### 47. `--filter-from`의 `- ` 접두사 줄은 `#`·`;`·앞 공백·`!`로 시작하는 패턴도 그대로 제외 규칙이 된다
- 명령: `lsjson --recursive --files-only --no-mimetype --ask-password=false --config <conf> --filter-from <파일> -- <폴더>`, 파일 내용 `- #a\n- ;a\n-  lead\n- !a\n` (fixture `filter-from-prefixed`, 해석 `filter-from-prefixed-dump`)
- 결과: 네 파일이 모두 빠지고 `a`·`c`만 남았다. 해석 결과 `(^|/)#a$`, `(^|/);a$`, `(^|/) lead$`, `(^|/)!a$`. exit 0. (`--exclude-from`은 `#`·`;` 줄을 주석으로, 앞 공백을 지운다, #18)
- 영향: 앱이 만드는 필터 파일 줄을 모두 `- <패턴>`으로 쓰면 `#`·`;`·앞 공백 패턴을 인자로 따로 넘길 필요가 없다.

### 48. 패턴 뒤 공백은 파일·인자 모두에서 지워진다. `[ ]`로 쓰면 남는다
- 명령: `lsf ... --filter-from <파일> --dump filters`(`- trail \n- trail[ ]\n- two[ ][ ]\n`, fixture `filter-trailing-space-file-dump`), `lsf ... --exclude "trail " --dump filters`(`filter-trailing-space-arg-dump`), `--exclude " lead"`(`filter-leading-space-arg-dump`)
- 결과: 파일 `- trail ` → `(^|/)trail$`, **인자 `--exclude "trail "`도 `(^|/)trail$`**. `trail[ ]` → `(^|/)trail[ ]$`, `two[ ][ ]` → `(^|/)two[ ][ ]$`. 인자 앞 공백은 남는다(`(^|/) lead$`).
- 영향: 지금 `isFileSafePattern`은 뒤 공백 패턴을 인자로 넘기면 공백이 남는다고 보지만, 실제로는 지워져 저장한 패턴과 다른 규칙이 적용된다(버그). 필터 파일에 쓸 때 뒤 공백을 `[ ]`로 바꾼다.

### 49. `--filter-from`은 BOM·접두사 없는 줄을 `malformed rule`로 거부한다, CRLF는 문제없다
- 명령: 파일 내용 `﻿- a\n- c\n`(fixture `filter-from-bom`), `a\n`(`filter-from-no-prefix`), `- a\r\n- c\r\n`(`filter-from-crlf`)
- 결과: BOM은 exit 1 `CRITICAL: Failed to initialise global options: failed to reload "filter" options: malformed rule "﻿- a"`. 접두사 없는 줄은 exit 1 `malformed rule "a"`. CRLF는 `a`·`c`가 빠지고 exit 0.
- 영향: `--exclude-from`의 BOM은 첫 패턴만 조용히 깨지지만(#19) `--filter-from`은 실행 전에 실패한다. BOM 확인(`writeExcludeFile`)은 그대로 둔다.

### 50. `--exclude` 인자와 `--filter-from`은 합쳐 적용된다
- 명령: `--exclude a --filter-from <파일(- c)>` (fixture `filter-from-and-exclude-arg`)
- 결과: `a`·`c` 모두 빠졌다. exit 0.
- 영향: 전환 중이나 인자로 남는 패턴이 있어도 두 방식을 함께 쓸 수 있다(#20과 같음).

## 2026-11-03 · rclone v1.75.1 · Windows 11 x64 (INT-006 T-01: remote 설정 쓰기 실측)

`scripts/probes/rclone-probes.mjs --only=config`로 임시 conf에서 다시 받았다(fixture `config-*`). 값은 모두 가짜다.

### 51. `config providers`는 1MB JSON이고, 숨김·선택지·비밀 표시를 옵션마다 준다
- 명령: `config providers --ask-password=false` (fixture `config-providers`)
- 결과: 69종·옵션 968개. 옵션 필드 `Name`·`Help`·`DefaultStr`·`Required`·`Advanced`·`Hide`·`IsPassword`·`Sensitive`·`Type`·`Exclusive`·`Examples`가 온다. `Hide`는 0·1·2·3이 있고 0이 아닌 옵션은 설정 화면에 나오지 않는다. `Type`은 `string`·`bool`·`int`·`float64`·`Duration`·`SizeSuffix`·`CommaSepList` 등 14가지다. `Exclusive`는 azureblob `delete_snapshots` 하나뿐이다.
- 기본값에는 현재 OS 사용자·컴퓨터 이름(`sftp user`, `cache-backend` 경로)이 들어 있어 fixture에서 `<USER>`로 가렸다.
- 영향: INT-006 FR-2·FR-3. `Hide != 0`은 폼에서 빼고, `Exclusive`일 때만 선택지 고르기로 만든다. OAuth 판정은 `token` 옵션 유무다.

### 52. `config delete`는 없는 이름도 exit 0이다
- 명령: `config delete no-such-remote --ask-password=false` (fixture `config-delete-missing`)
- 결과: stdout·stderr 없이 exit 0.
- 영향: INT-006 FR-22. 지우기 전에 `listremotes`로 이름이 있는지 확인해야 `REMOTE_NOT_FOUND`를 구분할 수 있다.

### 53. rcd 응답은 `State`·`Option`·`Error`·`Result`이고, Drive 질문 흐름은 그대로 재현된다
- 명령: `rcd --rc-addr 127.0.0.1:0 --ask-password=false --config <임시>` + `POST /config/create`·`/config/update`·`/core/quit` (fixture `config-rcd-requests`)
- 결과: 인증 없는 요청은 401. 성공 응답은 `{"Error":"","Option":null,"Result":"","State":""}`. Drive 첫 질문은 `State: client_id_warning`, `Option.Name: config_shared_client_id`(bool, Exclusive, Default false)이고, `result=false`로 이어 가면 `State: client_id_set`, `Option.Name: client_id`(Required)가 온다. `core/quit` 응답은 `{}`이고 프로세스가 끝난다. `config/update`도 같은 형식이다.
- 영향: INT-006 FR-14·FR-15a. 질문 Option은 providers와 같은 모양이라 파서를 함께 쓴다.

### 54. `config redacted`는 sftp의 host·user·pass를 모두 XXX로 가린다
- 명령: `config redacted it-sftp --ask-password=false` (fixture `config-redacted`)
- 결과: `type = sftp`만 보이고 `host`·`user`·`pass`는 `XXX`. 끝에 `### Double check the config for sensitive info before posting publicly`.
- 영향: INT-006 FR-17. `Sensitive`(host·user)까지 가려지므로 수정 화면에서 채워지는 값은 비밀이 아닌 옵션뿐이다. providers 정의로 `XXX`를 한 번 더 걸러 `secretsSet`으로만 알린다.
