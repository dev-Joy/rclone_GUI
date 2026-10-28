# WORKS HISTORY

## Tasks

[TASK_001] : (2026-10-28) INT-001 Phase 0~2 구현 (관련 Intent: INT-001, T-01 완료 / T-04·T-05·T-08 일부)
- Phase 0: pnpm 프로젝트, electron-vite 6(main/preload CJS, sandbox preload), tsconfig node/web 분리, oxlint·oxfmt·ESLint(shell:true·접두사), vitest unit/int 설정, electron-builder.yml 초안
- Phase 1: `src/shared` — errors, zod 스키마(job·settings·run), 기본값, path-utils(S1~S4a, WSL 별칭), diff-engine, format, ipc-contract / `src/main` — command-builder(차단 목록), lsjson·log 파서
- Phase 2: json-store(tmp+fsync+.bak+rename 재시도, 손상·버전 복구), settings·job·history store, IPC handle(sender·zod·envelope), app-paths(RCLONEGUI_USER_DATA), window·CSP·권한 차단, preload API, 화면(HomePage, ZBCToast, zustand 스토어, 테마)
- 도구: scripts/probes/rclone-probes.mjs(실측 fixture 9종), scripts/dev/drive-app.mjs(빌드본·개발 서버 CDP 스모크)
- 문서: rclone-notes(실측 6건), CHANGELOG, THIRD_PARTY_NOTICES, MVP_SPEC "구현 반영", AGENTS.md 경로 2곳, intent planned→active
- 검증: check(typecheck+oxlint+eslint+unit 191), format:check, test:int 6, build, drive-app(빌드본·dev 각 13)

[TASK_002] : (2026-10-28) AGENTS.md 정리
- import 규칙 모순 수정(`../`는 상위 폴더이며 oxlint가 금지 → 같은/하위 폴더만 `./`)
- 중복 통합: 상단 개발 규칙·작업 원칙을 4장(4.1~4.6)·5장으로 합침, 프로젝트 소개를 맨 위로, 제목 1개
- 모호한 문구 정리: `zbc<Name>`은 ZBC를 뺀 이름, 큰따옴표, 들여쓰기, propsDefault 적용 범위
- 추가: 명령은 Windows PowerShell에서 실행(WSL에 node 없음), 완료 기준에 format:check·docs/works 기록, oxfmt LF 명시
- 섹션 번호 변경에 맞춰 eslint.config.mjs, src/shared/ipc-contract.ts 주석의 AGENTS.md 참조 갱신

[TASK_003] : (2026-10-28) 줄바꿈 통일 (.gitattributes)
- `.gitattributes` 추가: 텍스트 `eol=lf`, `*.bat`·`*.cmd`·`*.ps1`은 CRLF, `tests/fixtures/**`는 `-text`(원본 보존), 이미지·폰트·실행 파일은 binary
- CRLF였던 AGENTS.md·.gitignore를 LF로 변환하고 `git add --renormalize .` 적용 (추적 파일 전체 LF)
- AGENTS.md 10장에 줄바꿈 규칙 한 줄 추가

[TASK_004] : (2026-10-28) INT-001 Phase 3 — rclone 환경, WSL, 경로 검증 (관련 Intent: INT-001, T-02 완료 / T-03·T-09 백엔드·검증)
- 실행: `main/rclone/process.ts` — `runProcess`(shell:false, StringDecoder 줄 분리, stdout 상한·stderr tail 20KB, timeout/AbortSignal → taskkill /T /F, close 대기 상한 5초), `buildRcloneEnv`(RCLONE_* 제거, CONFIG_PASS·PASSWORD_COMMAND 유지), `runRclone`(허용 명령·차단 목록 재확인)
- 빌더: `buildVersionArgs`/`buildConfigFileArgs`/`buildListRemotesArgs`/`buildProbeListArgs`(새 빌더만 `--ask-password=false`), `ALLOWED_COMMANDS`+`assertAllowedCommand`(config는 file만). 기존 빌더 반환값 그대로
- 감지: `main/rclone/{config,detect}.ts` — 수동 rclone.exe(fallback 없음) → PATH → WinGet Links/Packages → Program Files → scoop, 1.65.0 미만 거부·1.75.1 초과 경고, 설정 파일 manual → RCLONE_CONFIG → `config file` → %APPDATA% → none, remote 목록, 설정 키 캐시·동시 호출 공유
- 파서: `rclone-env-parser.ts`(version·config file 두 형태·listremotes·stderr 요약·오류 안내), `wsl-parser.ts`(UTF-16LE/UTF-8 판별), `parseLsjsonEntries`
- 서비스: `clsPathService`(로컬·UNC stat 15초 제한·opendir 읽기 확인, remote 부모 listing·exit 3·대소문자 차이 안내), `clsWslService`(`wsl.exe -l -q`)
- IPC: rclone:detect/listRemotes/testPath, wsl:listDistros, dialog:pickDirectory/pickFile, system:openExternal(https://rclone.org/만), `WSL_NOT_AVAILABLE` 코드, preload 확장
- 화면: `OnboardingBanner`, `RcloneSetupPanel`, `PathCheckPanel`(WSL 도우미), `rclone-env-store`, HomePage 배치
- 테스트: 단위 6파일 추가·3파일 보강(282), 통합 `rclone-env.test.ts`(alias remote, WSL은 RCLONEGUI_TEST_WSL=1), fixture 6종(probe 스크립트), drive-app 20항목(임시 RCLONE_CONFIG)
- 문서: rclone-notes 7~9, CHANGELOG, MVP_SPEC 구현 반영, intent T-02 체크
- 검증: check, format:check, test:int 12(+WSL 1), build, drive-app 20 통과
- 리뷰 수정: detect·경로 확인에 마지막 요청만 반영(`shared/latest-request.ts`), lsjson·listremotes 출력 잘림 → RCLONE_FAILED(목록이 너무 큼), BOM 없는 UTF-16LE 판정 보강(짝수 길이+끝 0A 00 또는 0 비율), WSL 도우미 버튼 문구 "입력란에 넣기" — check 287, drive-app 21 통과

## Errors

- (2026-10-28) PowerShell `-ExecutionPolicy Bypass` 실행이 권한 정책으로 거부됨 → probe를 Node 스크립트로 대체 [TASK_001 해결]
- (2026-10-28) 테스트·스모크로 찾은 결함: writeJsonAtomic 폴더 생성 실패가 STORE_ERROR로 감싸지지 않음, settings.update 동기 예외, jobs:create가 알 수 없는 키를 버리고 저장, 운영 CSP meta의 frame-ancestors 콘솔 오류 → 모두 수정 [TASK_001 해결]
