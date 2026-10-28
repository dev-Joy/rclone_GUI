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
