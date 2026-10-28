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

[TASK_005] : (2026-10-28) INT-001 Phase 4 — Job CRUD UI와 경로 입력 (관련 Intent: INT-001, T-03·T-04·T-09 완료 / T-11 화면 일부)
- 공용 컴포넌트: `ZBC{Button,Field,Input,Textarea,Select,Checkbox,Badge,Modal,Tabs}` + CSS(`ZBC.css` @import), 테마 토큰 `--accent-weak`·`--danger-weak`·`--warning-weak`·`--focus`
- 화면: `AppLayout`(layouts)·`TopBar`·`JobSidebar`(이름순, 모드·자동·마지막 실행)·`JobWorkspace`(헤더·탭·복제·삭제 확인, 비교·실행은 비활성+이유)·`JobEditor`·`PathField`(종류 배지·폴더 선택·WSL 도우미·remote 빠른 입력·접근 확인)·`RemotePicker`·`WslPathHelper`(모달)·`ExcludesEditor`·`JobOptionsFields`·`SettingsPage`(기본값·안전·로그·테마·앱 정보)·`DiscardChangesModal`, `HomePage` 셸로 재구성, `PathCheckPanel` 삭제
- 상태: `jobs-store` CRUD(envelope 반환·선택 보정), `job-editor-store`(draft/baseline/dirty·저장·외부 변경·guard), `ui-store`, `rclone-env-store.loadRemotes`(설정 파일별 캐시·마지막 요청만)
- 순수 로직: `lib/job-form`(검증·필드 매핑·경고·정렬·삭제 후 선택), `lib/settings-form`(범위·patch), `lib/form-utils`, `lib/path-display`, `lib/use-path-probe`, `shared/remote-name`(한 글자 remote: 목록 비활성·경고, `x:폴더`는 저장 허용+경고)
- 테스트: 단위 4파일(job-form·settings-form·remote-name·path-display), 화면 스토어 3파일(`tests/unit/renderer`, web tsconfig·가짜 API), drive-app 45항목(임시 alias remote 2개로 remote 선택·한 글자 경고·새 작업·저장 차단·변경 확인·복제·삭제·설정·재시작)
- 설정: tsconfig.node `exclude: tests/unit/renderer/**` + DOM 무의존 lib 4개 include, tsconfig.web에 renderer 테스트 include
- 문서: CHANGELOG, MVP_SPEC 구현 반영(Phase 4 행), intent T-03·T-04·T-09 체크
- 검증: check(unit 360), format:check, test:int 12(+1 skip), build, drive-app 빌드본·dev 각 45 통과
- 설계와 다름: 모달 첫 포커스는 ZBCModal `initialFocus` prop 대신 ZBCButton `initialFocus`(→ `data-autofocus`)로 지정(jsx-a11y no-autofocus 회피)
- 검증 피드백 반영: 설정 화면 미저장 변경도 이동 전 확인(`ui-store.leaveSettings`·공용 DiscardChangesModal), `syncFromJobs`는 같거나 오래된 rev 무시, ZBCModal 네이티브 close 동기화·바깥 클릭은 mousedown도 바깥일 때만, rclone.conf 라디오는 선택만(파일은 별도 버튼), 경로 버튼 aria-label에 원본/대상, 탭 id·aria-controls·tabpanel aria-labelledby 연결

[TASK_006] : (2026-10-28) INT-001 Phase 5 — 비교 서비스와 비교 UI (관련 Intent: INT-001, T-05·T-06 완료 / T-07 활동 락 선행)
- main: `services/compare-service`(경로 안전 검사 → rclone·설정 파일 → probe(대상 없음=빈 목록) → 원본·대상 lsjson 병렬 줄 단위 읽기 → diff → 경고·plan token, 한쪽 실패 시 다른 쪽 종료, exit 3 → `PATH_NOT_FOUND`, 취소 → `CANCELED`, 실패·취소 시 그 작업 캐시 삭제, rev·설정 지문 변경 시 무효화, 작업별 최대 3개 보관, `requirePlan` 게이트), `services/plan-token`, `services/activity-lock`(비교·실행 전역 단일 락), `ipc/compare`(run·cancel·get·getActive·진행 이벤트)
- 파서·빌더: `createLsjsonLineParser`(stdout을 모으지 않고 줄 단위), `buildLsjsonArgs`에 `--ask-password=false`·`--hash-type md5/sha1`(`COMPARE_HASH_TYPES`)·`--fast-list`, probe fixture `lsjson-src-hashtype.*` 추가
- 화면: `CompareView`(진행·취소·오류·stale/충돌/경고 배너·비교 방식), `CompareSummary`(모드별 카드: 복사·덮어씀·삭제/대상에만 있음(유지)·동일, 카드로 필터), `CompareToolbar`(상태·경로 검색 디바운스·동일 숨기기·표시 수), `CompareTable`(가상화·정렬·좌우 크기/수정시간), `JobWorkspace` 비교 버튼·탭 활성(실행은 비활성), `stores/compare-store`, `lib/{compare-view,virtual-rows,use-virtual-rows,use-debounced-value}`
- 테스트: 단위 7파일(compare-service·plan-token·activity-lock·lsjson-line-parser·compare-view·virtual-rows·renderer/compare-store), 통합 `compare.local.test.ts` 7건(상태별 수·바이트, md5/sha1 해시 비교, alias remote 대상 = 로컬 결과, 대상 없음, 원본 없음, 목록 직전 원본 삭제(exit 3), 목록 중 취소 → CANCELED·캐시 미보존·락 해제), drive-app 53항목(Phase 4 "저장 후 비교 비활성" 검사를 "비교 활성·실행 비활성"으로, 변경 중 검사는 헤더 비교 버튼만, API 키에 compare 추가, 비교 실행 → 요약·행·동일 숨기기·상태 필터·경로 검색·대상 파일 무변경)
- 린트 수정: `CompareTable` 스크롤 영역 `div role=region` → `section`, 가상화 spacer `tr`/`td`에 `aria-hidden` 포함
- 문서: CHANGELOG, rclone-notes 10·11, MVP_SPEC 구현 반영(Phase 5 행·해시·결과 보관·버튼), intent T-05·T-06 체크, INDEX 7/15
- 검증: check(unit 491), format:check, test:int 19(+1 skip: WSL 조건부), build, drive-app 빌드본 53 통과
- 설계와 다름: UNC 조건부 통합 테스트(`compare.unc.test.ts`)는 만들지 않음(기존 조건부 패턴은 WSL 배포판 목록만 있음). `SummaryCards`·`StatusBadge` 파일 대신 `CompareSummary`·표 안 배지

[TASK_007] : (2026-10-28) INT-001 Phase 6 — 실행 코어: dry-run, copy, 로그/stats, 취소 (관련 Intent: INT-001, T-07 copy까지 / sync 실제 실행은 Phase 7)
- 프로세스: `runProcess`에 `timeoutMs: number | null`(Number.isFinite일 때만 타이머), `onSpawn(pid)`, 결과 `closed`(close 수신·시작 전 취소 true, 종료 대기 상한 초과 false). 기존 fake 결과에 `closed: true`
- 리팩터(동작 불변): 비교의 경로·rclone·설정 파일 해석을 `services/job-context.ts` `resolveJobContext`로, BUSY 문구를 `activity-lock.ts` `busyMessageFor`로 이동 — 기존 비교 테스트로 회귀 확인
- shared: `types/run.ts`(itfRunLogLine·itfDryRunSummary·itfRunSnapshot·typRunEvent), `schemas/run.ts`(zStartRunInput strict·zRunIdInput·zActiveRunFile), `run-plan.ts`(planFromCompare: copy 삭제 0, expectedDeletes, matchPlanWithDryRun: 복사+touch == 새+변경)
- main: `parsers/run-output.ts`(dry-run 집계: touch는 size 유무로 파일만, decideRunOutcome: 취소 > exit3 > exit7 > exit0 오류 수 > 실패, parseTasklistCsv), `services/run-events.ts`(log 200ms·100줄·dropped, stats 1초, flush), `run-log-file.ts`(logs/run-YYYYMMDD-HHmmss-<job8>-<run8>.log, 원본·대상·--config 가림, redactSecrets, 쓰기 실패 무시), `run-recovery.ts`(active-run.json 원자적 기록·순서 보장 삭제, tasklist.exe로 이미지 이름이 같을 때만 kill, 확인 못하면 PID 안내), `run-service.ts`(게이트 → 락 → 이력 → spawnTransfer(buildTransferArgs 유일 호출) → 판정 → 마무리, finished는 락 해제 뒤 마지막 1회)
- IPC: run:start/cancel/getActive, run:event, jobs update/delete는 실행 중 작업이면 BUSY, index.ts 시작 순서(이력 → active-run 복구 → interrupted), before-quit(실행 취소 후 최대 10초, 재진입 방지), preload `run`·`events.onRunEvent`
- 화면: `JobWorkspace` 실행 탭 활성·헤더 "미리보기"/"복사 실행"(유효한 비교 결과 있을 때만, 확인 모달)·"동기화 실행" 비활성+이유·실행 중 비교 불가, `RunView`·`RunStatsGrid`·`RunLogTail`·`DryRunSummary`, `stores/run-store`, `lib/run-view`
- 프로브: `--only=` 필터, `copy-real`·`copy-progress`(약 3 MiB, 프로브에서만 --bwlimit 1M) fixture — normalizeStats 보완 불필요(추가 키 무시)
- 테스트: 단위 8파일 추가(run-output·run-plan·run-events·run-log-file·run-recovery·run-service 25건·run-view·renderer/run-store) + process(null 타임아웃·onSpawn·closed)·shared-boundary(buildTransferArgs 호출 위치) 보강, 통합 `run.dryrun`(3)·`run.copy`(2, 취소 포함)·공용 `run-harness.ts`, drive-app 64항목(API 키 run, 미리보기 요약·대상 불변, 복사 확인 창·완료·파일 반영, 실행 후 복사 버튼 비활성, sync 버튼 비활성·직접 IPC SAFETY_BLOCKED, 재시작 후 lastRun·active-run 없음)
- 문서: CHANGELOG, rclone-notes 12~14, MVP_SPEC 구현 반영(Phase 6 행 등), intent T-07 진행 메모(체크 안 함)
- 검증: check(unit 569), format:check, test:int 24(+1 skip: WSL 조건부), build, drive-app 빌드본 64 통과
- 설계와 다름: 실행 로그 머리말은 `--config` 경로도 `<설정 파일>`로 가림. active-run 복구는 확인 결과와 관계없이 파일을 지움(확인 못하면 PID 안내만). 실행 문맥 해석은 probe를 하지 않음(rclone exit 3 → PATH_NOT_FOUND). 앱 종료(before-quit) 경로는 자동 검증하지 못함(drive-app은 taskkill로 종료)

## Errors

- (2026-10-28) PowerShell `-ExecutionPolicy Bypass` 실행이 권한 정책으로 거부됨 → probe를 Node 스크립트로 대체 [TASK_001 해결]
- (2026-10-28) 테스트·스모크로 찾은 결함: writeJsonAtomic 폴더 생성 실패가 STORE_ERROR로 감싸지지 않음, settings.update 동기 예외, jobs:create가 알 수 없는 키를 버리고 저장, 운영 CSP meta의 frame-ancestors 콘솔 오류 → 모두 수정 [TASK_001 해결]
