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

[TASK_008] : (2026-10-29) INT-001 Phase 7 — 파괴적 실행과 안전 게이트 (관련 Intent: INT-001, T-07·T-08 완료)
- 결정(사용자 승인 D1~D7): 실제 실행 = 비교 planToken + 확인한 삭제 수(+대량이면 confirmLargeDeletes), 사전 확인은 같은 runId 안에서 main이 자동, 사전 확인 끄면 --max-delete만 백스톱, 일치 = 복사+touch==새+변경·삭제 수(수집기·stats)·오류 0(바이트 제외), sync+ignoreErrors 계속 차단, 대량 = 엄격한 초과(기준 0이면 1개도), 락 전 차단은 이력 없음·PLAN_DRIFT는 blocked 이력, 삭제 0 sync는 사전 확인 없이 --max-delete 0
- shared: `run-gates.ts`(itfGateBlock·isLargeDelete·checkPlanSafety S5·S6·S7·S15·needsPreflight), `run-plan.ts` checkPreflight, `schemas/run.ts` confirmLargeDeletes
- main: run-service 게이트 순서(토큰 → requirePlan → checkPlanSafety → 삭제 수 → 대량), typRealGate.preflight, spawnTransfer(step dryRun|preflight|real, buildTransferArgs 1곳 유지), runPreflight(취소 canceled·exit≠0 failed·불일치 blocked PLAN_DRIFT, record.preflight), onSpawn 단계 인자(사전 확인 PID도 active-run), 로그 파일 머리말 1회 + 단계 구획(`run-log-file.ts` section·stage)
- 화면: `run-view` canStartRun의 sync 차단 제거·checkPlanSafety 재사용·바꿀 것 없으면 막음, deleteSamples·deleteConfirmInfo, `DeleteConfirmModal`·`PlanDriftModal`(+module.css), run-store start(confirm)·driftNotice·dismissDrift·sync 취소 토스트, JobWorkspace 동기화 실행 활성·모달 분기·삭제 0 문구, RunView 사전 확인 단계·PLAN_DRIFT 차이 목록, JobOptionsFields·job-form 사전 확인 끔 경고, DryRunSummary 문구
- 프로브: `sync-maxdelete1`·`lsjson-dst-after-maxdelete1` fixture (rclone-notes 15·16)
- 테스트: 단위 run-gates(11)·run-plan checkPreflight·schemas·run-service(차단 매트릭스 6건 추가, Phase 7 묶음 8건)·run-view·renderer run-store(대량 확인·drift·sync 취소), 통합 `run.sync`(3)·`run.gates`(4)·run.dryrun 차단 케이스 갱신, drive-app sync 시나리오 교체(삭제 확인 모달·체크 전 비활성·drift 모달·대상 불변·다시 비교·반영)
- 문서: AGENTS.md 안전 규칙 2, CHANGELOG, MVP_SPEC 구현 반영(Phase 7 파일·D1~D7·로그·화면), rclone-notes 15·16, intent T-07·T-08 체크, INDEX 9/15
- 검증: check(unit 603), format:check, test:int 31(+1 skip: WSL 조건부), build, drive-app 빌드본 71 통과
- 설계와 다름: SafetyBanner는 만들지 않음(버튼 이유·모달로 대신). 락 전 차단은 비교 결과를 무효화하지 않음. 사전 확인 통과 뒤에도 취소 요청을 다시 확인해 실제 실행을 시작하지 않음(canceled). finished의 dryRunSummary는 실제 실행이면 사전 확인을 했어도 null

[TASK_009] : (2026-10-29) Phase 6·7 남은 문제 재검증과 보완 (관련 Intent: INT-001)
- --max-delete 재확인: 프로브 `sync-maxdelete1` 7회 — 매번 exit 7·`Deleted` 1개·빈 폴더 미삭제(`not deleting directories`)·복사 반영. 지우는 파일은 실행마다 다름(extra.txt 5회·gone/old.txt 2회). fixture는 원래대로 두고 notes #15에 기록
- "다시 비교" 수정: run-store `recompareDrift`(안내 닫기 → 막힌 작업이 지워졌으면 경고 토스트 → ui-store leaveSettings → job-editor guard → jobs select·view job·tab compare → compare run). PlanDriftModal은 이것만 호출, JobWorkspace는 다시 비교 차단 이유를 진행 중 비교·실행만으로 계산(지금 보이는 작업의 미저장·경로 오류로 막지 않음)
- 큰 파일 취소: 프로브 `copy-cancel-large`(32 MiB, --bwlimit 4M, 첫 stats bytes>0에서 taskkill /T /F) + `lsjson-dst-after-cancel`·`sync-dryrun-after-cancel`·`copy-after-cancel` fixture. `<이름>.<hash>.partial`이 남고 대상 파일은 안 생김, sync 다음 실행에서는 삭제 대상, 같은 원본 재복사면 정리, 원본이 바뀌면 계속 남음(notes #14·#17)
- 대응안(미구현): ① 실제 실행이 canceled·failed로 끝나면 대상에 `*.partial`이 남을 수 있다고 토스트·실행 결과에 안내 ② 비교 결과에서 `.<8hex>.partial` 패턴의 대상 전용 파일을 "취소로 남은 임시 파일"로 표시(삭제 확인 창 샘플 포함) ③ copy 작업용으로 해당 파일만 지우는 정리 동작(사용자 확인 후 `deletefile`) — 기본 제외 규칙에 `*.partial`을 넣는 안은 sync에서 정리되지 않게 만들어 비추천
- before-quit 검증: drive-app 2회차에 파일 3000개 copy(transfers 1)를 API로 시작 → `window.close()` → 앱 종료(약 0.4초)·active-run.json의 rclone PID가 tasklist에 없음·active-run.json 없음·history.json 레코드 canceled·대상 일부만 복사, 3회차 재시작에서 중단됨 안내 없음·lastRun canceled. 버그 없음
- 테스트: 단위 run-store recompareDrift 4건, drive-app "다시 비교" 시나리오(다른 작업 고친 채 → 변경 버리기 확인 → 막힌 작업·비교 탭) + 종료 시나리오 4건 + 3회차 실행
- 검증: check(unit 607), format:check, test:int 31(+1 skip), build, drive-app 빌드본 77 통과

[TASK_010] : (2026-10-29) INT-001 Phase 8 — 스케줄러, 이력/로그 UI, 트레이/테마/로그인 (관련 Intent: INT-001, T-10·T-11·T-13·T-14 완료)
- 결정(사용자 승인 D1~D10): 실제 전송은 spawnTransfer 한 곳(수동 = planToken+확인한 삭제 수, 자동 = 같은 실행 안 새 비교 + 자동 조건), 창 X → 트레이(세션당 1회 안내), 자동 삭제 엄격(allowDeletes·autoMaxDeletes(0=금지)·대량 아님·사전 확인, 하나라도 어기면 blocked 이력+알림), 로그인 시 --hidden(설치본만), 실행 중 종료 확인 창·10초 후 재질문·session-end 무확인 취소, 단일 인스턴스 show, 로그 30일·이력 500건 정리(시작·24시간), noop은 이력·알림 없이 lastRun만
- shared: `schedule.ts`(nextRunAfterEdit·reconcileNextRun·rescheduleOnUnpause·pickDue·nextAutoRun·nextAfterFinish), `schemas/{history,scheduler}.ts`(strict), `types/{history,scheduler}.ts`, ipc-contract(history·scheduler 채널, scheduler:state·app:notify 이벤트, appInfo.isPackaged)
- main: run-service `startAuto`(락 동기 획득 → comparing → compareForAuto → rev 재확인 → `f_CheckAutoGate` → 수동과 같은 execute/finalize, `finishEarly`), start는 createActive·beginRecord로 공통화(동작 불변), compare-service `compareForAuto`(락·캐시·이벤트 없음), `scheduler.ts`(tick·선기록·BUSY 유지·일시정지·onResume·알림·연속 실패 3회), `log-retention.ts`(이름 정규식·경로 탈출 방지·보관 정리·끝부분 읽기), `tray.ts`+`assets/tray.png`(직접 만듦), window hidden, index.ts(종료 흐름 f_RequestQuit·session-end·트레이 숨김·nativeTheme·로그인 항목·powerMonitor·보관 정리), ipc history·scheduler, settings:update의 scheduler 키 거부, history-store prune/clear(로그 이름 반환)/runningLogFiles, settings-store onChange, job-store nextRunAfterEdit
- 화면: HistoryView(종류·결과 필터)·HistoryDetail·ClearHistoryModal, stores history·scheduler, lib/history-view, TopBar 다음 자동 실행·일시정지 토글, JobWorkspace 이력 탭, SettingsPage(자동 삭제 조건 안내·이력 비우기·트레이·로그인 시작), JobEditor 자동 실행 안내, run-store 자동 실행 토스트 생략(app:notify → 토스트), RunView "비교 중(자동 실행)"
- 테스트: 단위 schedule·scheduler·log-retention·history-view·renderer history/scheduler-store + run-service 자동 실행 18건·compareForAuto 4건·stores(예약·prune·clear·onChange)·schemas·settings-form·run-store, 통합 `auto-run`(4)·`history-log`(1), drive-app 94항목(이력 탭·상세·비우기, 설정 토글, 일시정지·재시작 유지, 1분 주기 자동 실행 copy·blocked, 트레이 숨김·second-instance 표시·종료 확인 뒤 취소 종료, 재시작 후 예약 유지·중복 0, --hidden 미표시)
- 문서: AGENTS.md 안전 규칙 2, CHANGELOG, MVP_SPEC 구현 반영(Phase 8 파일·D1~D10·스케줄러·IPC·화면·개발 환경 변수), intent T-10·T-11·T-13·T-14 체크, INDEX 13/15. rclone-notes는 새로 안 rclone 동작이 없어 그대로
- 검증: check(unit 678), format:check, test:int 36(+1 skip), build, drive-app 빌드본 94 통과
- 설계와 다름: compare-service는 기존 private `execute`를 공통 core로 그대로 쓰고 `silent` 플래그로 이벤트만 막음. launch 대신 `createActive`·`beginRecord`로 공통화. 자동 실행의 비교 단계에서 종료하면 묻지 않고 취소. 개발 전용 환경 변수 `RCLONEGUI_DEV_TICK_MS`·`RCLONEGUI_DEV_QUIT_CHOICE` 추가. 화면의 `window.close()`는 페이지만 닫아 종료 흐름을 타지 않으므로 drive-app은 `taskkill`(/F 없음, WM_CLOSE)과 두 번째 실행으로 확인

[TASK_011] : (2026-10-29) 취소·실패로 남은 rclone 임시 파일(.partial) 표시·안내 (관련 Intent: INT-001)
- 결정: TASK_009 대응안 중 ① 취소·실패 안내 ② 비교 결과 표시만 구현(사용자 결정). ③ 정리 동작·기본 제외 규칙 `*.partial`은 하지 않음, 실행 동작은 바꾸지 않음
- 판정 기준: 최종 이력의 phase는 항상 finalizing이고 pid는 사전 확인에서 멈춰도 남아 구분할 수 없음 → 이력에 `transferStarted`(선택, 예전 기록은 없음) 추가. 실제 전송(step real) rclone의 onSpawn에서 true, 시작값 false. `mayLeavePartial` = 실제 실행 && transferStarted === true && status canceled·failed (dry-run·사전 확인 중 멈춤·rclone 시작 전 실패·성공·partial·blocked는 false)
- shared `partial-files.ts`: `isRclonePartial`(마지막 경로 요소가 `/^.+\.[0-9a-f]{8}\.partial$/i`, fixture lsjson-dst-after-cancel로 확인), `mayLeavePartial`, 안내·배지 문구 상수
- main: run-service(createActive transferStarted false, onSpawn real이면 true·이력 patch, finalize patch, 자동 실행 결과 `transferStarted`), scheduler `autoOutcomeNotice` 실패·취소 문구에 짧은 안내(경로 없음, 취소는 warning)
- 화면: CompareTable 대상에만 있는 .partial 행 경로 앞 ZBCBadge(warning) "취소로 남은 임시 파일", DeleteConfirmModal 삭제 샘플 같은 배지, RunView 결과·HistoryDetail에 경고(role=note), run-store 결과 토스트 뒤 warning 토스트(자동 실행은 main 알림)
- 테스트: 단위 partial-files(fixture·맞는/안 맞는 이름·report.partial 오탐 없음·예전 기록 파싱), run-service(실제 copy 취소 true·실제 실행 ENOENT·dry-run·사전 확인 취소/실패 false·자동 실행 결과), scheduler 알림, renderer run-store 토스트 2건. drive-app: 가짜 `x.bin.0123abcd.partial`·`report.partial` sync 비교 목록·삭제 확인 창 표시(대상 불변), 종료 취소 이력 transferStarted, 3회차 이력 상세 안내
- 검증: check(unit 708), format:check, test:int 36(+1 skip), build, drive-app 빌드본 98 통과
- 후속: 실행 중 앱 비정상 종료로 `interrupted`가 된 기록도 전송이 시작됐다면 안내 대상에 포함(`mayLeavePartial`)

[TASK_012] : (2026-10-29) INT-001 Phase 9 — 패키징·E2E·문서·실제 환경 수용 (관련 Intent: INT-001, T-12·T-15 완료)
- 패키징: `electron-builder.yml` — NSIS x64 사용자 단위, asar, 언어 팩 ko/en-US, `build/icon.ico`, `artifactName`, 바탕 화면·시작 메뉴 바로가기, `uninstallDisplayName`, `deleteAppDataOnUninstall: false`, `build/installer.nsh`(로그인 항목 정리), `extraResources`에 `THIRD_PARTY_NOTICES.md`, `npmRebuild: false`. `build/icon.ico`·`scripts/dev/make-icon.mjs`(도형만 그림), `scripts/dev/installer-smoke.mjs`(임시 설치 → asar 구성·언어 팩·바로가기·Uninstall 키 → 설치본 실행·`drive-app --exe` → 무인 제거 → userData 보존·로그인 항목 제거·실제 `%APPDATA%` 불변), `drive-app`에 `--exe`·`--login-item` 모드
- E2E: `@playwright/test` 1.64.1, `playwright.config.ts`(worker 1, 120초, trace retain-on-failure), `tests/e2e/app-harness.ts`(임시 userData·빈 rclone.conf·`RCLONEGUI_E2E=1`·콘솔 오류 수집·재시작), `smoke.spec.ts`(창·preload·getInfo·새 작업 저장·재시작·설정), `compare-copy.spec.ts`(비교 2/1/1 → 복사 확인 창 → 대상 파일 → 이력, rclone 없으면 skip). main `RCLONEGUI_E2E`: 트레이 없음·창 닫기 종료·로그인 항목 변경 없음·`--hidden`도 창 표시
- 스크립트/설정: `build:win`(= build + electron-builder `--publish never`), `dist`= `build:win`, `smoke:installer`, `test:e2e`(build + playwright). `tsconfig.node.json`·`.oxlintrc.json`에 Playwright·e2e 예외. React·ReactDOM·zustand를 devDependencies로 옮겨 설치본에는 zod만 포함
- 문서: README(설치·첫 실행·WSL/remote·copy/sync·안전 동작·데이터·개발 명령·E2E·설치 스모크·문제 해결·제한), AGENTS(명령·구조·E2E 규칙·완료 기준·도구), MVP_SPEC Phase 9 구현 반영, `.gitignore` 주석 정정
- 검증: `pnpm run check`(unit 707), `format:check`, `test:int` 36(+1 skip), `test:e2e` 3, `build:win`(설치 파일 113,606,102 bytes), `smoke:installer` 15/15(`--login-item` 포함), 패키징 `drive-app --exe` 89/89
- 설계와 다름: electron-builder 출력은 계획의 `release/` 대신 기존 `dist/`; 트레이 아이콘은 루트 `resources/tray.png` 대신 `src/main/assets/tray.png`를 `?asset`으로 asar에 번들; README 명령은 계획의 npm이 아니라 실제 pnpm; `test:e2e`가 `build`를 먼저 실행
- 오류/해결: E2E 설정 화면 제목 셀렉터가 'rclone 설정'과 겹쳐 strict mode 실패 → `exact: true`. 기존 rcloneGUI 설치로 installer-smoke가 중단 → 사용자 승인 후 기존 설치를 제거하고 재실행해 통과

[TASK_013] : (2026-10-29) INT-002 Phase 1 — T-01 SQLite 저장 계층과 JSON 이전 (관련 Intent: INT-002, T-01)
- probe: (a) vitest(Windows Node 24.20)에서 `node:sqlite` 해석·동작, ExperimentalWarning 없음. Electron 45 런타임(Node 24.22, SQLite 3.53.4)에서도 `DatabaseSync` 동작 (b) `pnpm run build` 결과 `out/main/index.js`에 `require("node:sqlite")` 유지 → electron.vite 설정 변경 불필요 (c) `VACUUM INTO $target` 바인딩 동작, `wal_autocheckpoint=0`으로 체크포인트 전 WAL 내용도 사본에 포함(사본은 journal_mode delete, -wal 없음), 대상이 있으면 "output file already exists", 트랜잭션 안에서는 거부 → backup() 대신 VACUUM INTO 사용
- 신규: `src/main/store/sqlite-db.ts`(clsSqliteDb, 이름 있는 파라미터, statement 캐시, BEGIN IMMEDIATE 트랜잭션·중첩/Promise 거부, clsSqliteError(sqliteCode)·isSqliteCorruption), `db-schema.ts`(MIGRATIONS v1·SCHEMA_VERSION·migrateSchema), `json-import.ts`(importLegacyJson: marker·clsJsonStore 재사용·중복 정리·단일 트랜잭션·개수 확인·.migrated rename), `app-db.ts`(openAppDb·backupAppDb, 손상 격리·백업 복구, daily 5개 회전)
- 변경: job/settings/history store 내부를 DB로(public API 유지, 생성자 db), `json-store.ts` `renameWithRetry` export, `zHistoryListInput.offset`, `index.ts`(창 전 openAppDb·will-quit close·시작 실패 오류 창, E2E는 창 생략), `run-harness.ts`(openAppDb + onTestFinished close), `drive-app.mjs`(이력 확인을 DB 읽기 전용 조회로)
- 테스트: 단위 sqlite-db 8·db-schema 5·json-import 10·app-db 7·stores +7(재오픈·offset·손상 행·쓰기 실패 시 캐시 유지·rclone.conf 내용 없음)·shared-boundary node:sqlite 경계 1, fixture `tests/fixtures/store-v1/`(가짜 경로), E2E `migration.spec.ts` 2
- 검증: `pnpm run check`(unit 50파일 745), `format:check`, `test:int` 36(+1 skip, WSL), `build`(node:sqlite external 유지), `test:e2e` 5 통과. build:win·smoke:installer·drive-app은 검증 단계에서 실행
- 설계와 다름: 손상과 다른 열기 오류(권한 등)를 구분하려고 `clsSqliteError`(sqliteCode)·`isSqliteCorruption` 추가(SQLITE_CORRUPT/NOTADB만 격리·복구). `transaction()`은 본문 예외(ZodError 등)를 감싸지 않고 그대로 다시 던진다(VALIDATION 유지). daily 백업의 "마지막 백업 시각"은 파일 mtime이 아니라 파일 이름의 시각으로 판단(now 주입 테스트). 이력 UPDATE는 job_id도 함께 쓴다

[TASK_014] : (2026-10-29) INT-002 Phase 2 — T-03 공용 제외 패턴 라이브러리 + T-09 길이 검증·--exclude-from, Phase 1 보강 (관련 Intent: INT-002, T-03·T-09)
- Step 2.0(Phase 1 보강): `app-db.ts` 복구 시작 표시 `db-recovery.pending`({stamp}, wx)을 옮기기 전에 만들고 복구 DB가 열린 뒤에만 지움, 시작 때 표시가 있으면 본 파일 유무와 관계없이 이어서 복구(남은 db/-wal/-shm → `.corrupt-<stamp>`), rename 실패는 STORE_ERROR(표시 유지). `settings-store.ts` 읽을 수 없는 설정 원본을 meta `settings_unreadable:<ISO>`에 보관(최신 3개), 알림에 "원래 값은 저장소에 보관했습니다"
- Step 2.1 probe(`--only=excl`, fixture `excl-*`, notes #18~21): 기본안 확인 — 파일의 `#`·`;` 줄은 주석(인자는 적용), `\#`는 이스케이프, 인자+파일 합집합, 200개 인자(약 3,800자)와 파일의 lsjson·sync dry-run 결과 동일, 없는 파일 exit 1. 추가: BOM이면 첫 패턴이 깨짐, CRLF는 정상, 파일 줄 앞뒤 공백은 지워짐, 빈 줄 무시
- 신규: `src/shared/option-limits.ts`, `exclude-patterns.ts`(정규화·공용 검사·file-safe·코드포인트 정렬 병합·전달 방식·저장 합계 검사), `schemas/excludes.ts`, `src/main/store/exclude-store.ts`, `services/effective-excludes.ts`(snapshotHash), `exclude-file.ts`(wx·재읽기·BOM 확인·시작 정리), `exclude-service.ts`(confirmedJobIds 집합 비교·BUSY·invalidate·로그는 id·수만), `ipc/excludes.ts`, `src/stores/excludes-store.ts`, `src/lib/exclude-view.ts`, `src/pages/ExcludeLibraryPicker`·`ExcludeChangeConfirmModal`(+module.css)
- 변경: 스키마 v2(`exclude_patterns` 재생성 CHECK, `job_exclude_patterns` RESTRICT/CASCADE), `job.ts`(zJobStoredDraft 읽기 4096 / zJobDraft·zJobPatch 저장 1024·합계 500, excludePatternIds), `settings.ts`(zSettingsPathInput), `errors.ts`(CONFIRM_REQUIRED), `job-store.ts`(연결 테이블이 원본·data JSON에서 제외·한 트랜잭션·FK→VALIDATION·update 재검사·refreshExcludeLinks), `command-builder.ts`(itfExcludeArgs·--exclude-from·assertCommandLength), `process.ts`(runRclone 길이 검사), `job-context.ts`(ctx.excludes), `compare-service.ts`(비교 파일 1개 공용·excludeHash·get/requirePlan 비교), `run-service.ts`(실행 파일 1개를 dry-run·사전 확인·실제 실행이 공용·runAuto 해시 비교), `plan-token.ts`(v2·excludeSnapshotHash), `run-log-file.ts`(--exclude-from 값 가림), `index.ts`(시작 시 exclude-files 정리·서비스 연결), IPC 계약·preload, 화면(JobEditor·ExcludesEditor·SettingsPage hint·RcloneSetupPanel 경로 오류·job-editor-store 연결만 바뀐 경우 반영·rclone-env-store pathError), `json-import.ts`(data에 연결 넣지 않음), `drive-app.mjs`(v1 DB 시드 → v2 확인, excludes IPC), `tsconfig.node.json`
- 테스트: 단위 exclude-patterns·exclude-store·exclude-service·exclude-file·effective-excludes·exclude-view·renderer excludes-store 신규, app-db·stores·db-schema·schemas·command-builder·process·plan-token·compare-service·run-service·job-form·settings-form·job-editor-store 갱신. 통합 `excludes-file.test.ts`(공용 100+작업 전용 100: 파일 방식 비교·sync = 인자 방식, exclude-files 비움, 로그에 --exclude-from), `run.gates`(비교 → 공용 패턴 삭제 → 실행 PLAN_STALE). E2E `excludes.spec.ts`
- 검증: `pnpm run check`(unit 57파일 819), `format:check`, `test:int` 38(+1 skip), `test:e2e` 6(콘솔 오류 0), `build:win`, `drive-app` 102 통과
- 설계와 다름: (1) wx 충돌 때 남의 파일을 지우던 결함을 테스트로 찾아 "이 호출이 만든 파일만 dispose"로 고침 (2) 실행 로그에서 `--exclude-from` 값(userData 경로)을 `<제외 파일>`로 가림 (3) run-service의 제외 파일은 execute의 finally에서만 지움(finishEarly는 파일을 만들기 전 단계라 해당 없음) (4) 저장소 연결이 바뀌었을 때 편집기 저장본·초안에서 지워진 id를 빼는 처리를 job-editor-store syncFromJobs에 추가(같은 rev) (5) 화면 순수 도우미를 `src/lib/exclude-view.ts`로 분리 (6) RcloneSetupPanel 1024자 오류는 rclone-env-store가 고른 경로를 저장 전에 검사해 패널에 표시

[TASK_015] : (2026-11-01) INT-002 Phase 3 — T-02 리모트 북마크·폴더 탐색 (관련 Intent: INT-002, T-02)
- 신규: `src/shared/remote-path.ts`(정규화·조합·조각 검사), `schemas/remotes.ts`, `types/remotes.ts`, `src/main/parsers`의 listremotes --long·lsjson dirs 파서, `src/main/store/remote-store.ts`(remotes v1 DDL CRUD·검증), `services/remote-ops.ts`(전역 직렬 큐·같은 remote BUSY), `services/remote-service.ts`(북마크 CRUD·probe·listDir), `ipc/remotes.ts`, `src/stores/remotes-store.ts`, `src/lib/remote-browser.ts`, `src/pages/RemoteBrowser`·`RemoteBookmarkEditor`·`RemoteBookmarksPanel`(+module.css)
- 변경: `option-limits`(REMOTE_*·LIST_DIR_*), `ipc-contract`(remotes·rclone.listDir·remoteTypes), `path-utils.remoteParentOf` 이동, `rclone-env-parser`·`lsjson-parser`, `command-builder`(listremotes --long·lsjson dirs), `config`(listRemotesLong·listDir 60초), `detect`(remoteTypes·long 실패 시 short 폴백), `activity-lock`(beginBrowse/assertNoBrowse), `job-context`(remoteNamesOfJob), `compare-service`·`run-service`(탐색 중 BUSY), `ipc/rclone`·`register`·`index`·preload, `RemotePicker`(북마크 select·탐색·자동 선택)·`PathField`(value 전달)·`SettingsPage`(패널 삽입), `ZBCButton`(id prop)
- 테스트: 단위 remote-path·remote-store·remote-ops·remote-service·activity-lock browse·rclone-env-parser long·command-builder·renderer remotes-store·remote-browser 신규/갱신, fixture `listremotes-long.stdout.txt`. 통합 `remote-bookmarks.test.ts`(실제 rclone alias remote: listDir·PATH_NOT_FOUND·probe·BUSY·인자 캡처), `rclone-env.test.ts`(remoteTypes). E2E `remote-bookmarks.spec.ts`(설정에서 북마크 추가·연결 테스트 → 작업 편집기에서 두 단계 탐색·저장, 콘솔 오류 0)
- 검증: `pnpm run check`(unit 63파일 879), `format:check`, `test:int` 42(+1 skip), `test:e2e` 7, `build` 통과
- 설계와 다름: (1) `clsRemoteService`의 `run` 의존성을 optional로 두고 기본 `runRclone` 주입(테스트 대체) (2) `ZBCButton`에 optional `id`(E2E·drive 스크립트) (3) `RemoteBrowser`에 `configPath` prop을 더해 작업별 rclone.conf로 listDir (4) `RemotePicker`에 `value` prop을 더해 빈 값·북마크 1개일 때만 1회 자동 선택 (5) React `set-state-in-effect` 린트 대응으로 모달 내용을 key로 다시 마운트(`RemoteBookmarkEditor`·`RemoteBrowser`)하고, `RemotePicker` 자동 선택은 파생값+ref로 처리(동작 동일)

[TASK_016] : (2026-11-02) INT-002 Phase 4 — T-05 동기화 범위 → T-04 작업 목록 (관련 Intent: INT-002, T-05·T-04)
- probe: `rclone-probes.mjs` 묶음 `scope`(fixture `scope-*` 19종), rclone-notes #22~#26. 판정 R1(폴더 삭제 4=4)·R1b(`deletedDirs` 일치)·R3(`--max-delete`는 폴더 미집계)·R4(`skip/**`는 목록·sync 모두 제외)·R5(파일만 sync도 대상 전용 빈 폴더 삭제) 일치, R2는 `make directory`가 파일이 든 원본 전용 폴더도 포함해 `createDirs`와 정의가 달라 비교하지 않고 표시만
- 신규: `src/lib/job-list-view.ts`(STATUS_LABEL·scheduleSummary·jobListItem), `src/lib/use-run-flow.ts`(ask·compareThenAsk·confirm, 항상 수동 흐름), `src/pages/RunConfirmModals.tsx`(간단 확인·삭제 확인 모달 공용), 테스트 `tests/integration/run.scope.test.ts`·`tests/e2e/job-list.spec.ts`·`tests/unit/job-list-view.test.ts`
- 변경: `schemas/job`(zSyncScope, 저장 입력 필수·읽기 default files), `schemas/run`(plan createDirs·deleteDirs default 0, start confirmedDeleteDirs), `schemas/settings`·`defaults`(ui.showJobStatusText), `types/compare`(createDirs·deleteDirs·itfDirChange·scope·dirChanges), `diff-engine`(폴더 목록·충돌·caseOnly·CASE_COLLISION), `run-plan`(expectedDeleteDirs·plannedDeleteCount·checkPreflight compareDirs), `run-gates`(needsPreflight 폴더 포함), `command-builder`(lsjson `--files-only`는 files만, transfer all이면 `--create-empty-src-dirs`), `lsjson-parser`(listing), `log-parser`·`run-output`(dirTime 분리), `compare-service`·`plan-token`(v3, scope·폴더 수), `run-service`(confirmedDeleteDirs 검사, 자동 게이트 파일+폴더 합산·문구, `--max-delete`는 파일 수만, noop에 createDirs, 사전 확인 compareDirs, dryRunPlan scope 일치), `job-store`·`job-form`·`run-store`·`run-view`(RUN_LABEL 이동·deleteDirSamples)·`compare-view`(dirSummaryText)·`path-display`(shortenPath)·`settings-form`, 화면 `JobEditor`(범위 fieldset)·`CompareView`·`DeleteConfirmModal`·`JobSidebar`(+css, li 안 선택 버튼과 "지금 실행" 형제)·`JobWorkspace`(훅 사용)·`SettingsPage`·`ZBCButton`(aria-describedby), `tsconfig.node.json`, E2E `app-harness`(mode·scope), `drive-app.mjs`
- 검증: `pnpm run check`(unit 64파일 927), `format:check`, `test:int` 47(+1 skip), `test:e2e` 9, `build:win` 통과
- 설계와 다름: (1) R2 불일치로 makeDir 파서·사전 확인 폴더 생성 비교는 넣지 않음 (2) **로그 파서 `set directory modification time`을 `dirTime`으로 분리** — 전체 범위에서 기존 폴더 줄에 size 0이 붙어 touch로 세져 사전 확인이 매번 PLAN_DRIFT가 되던 문제(rclone-notes #26) (3) diff 폴더 충돌은 폴더 자신뿐 아니라 조상 경로도 다른 쪽 파일과 겹치는지 본다 (4) 같은 쪽 폴더 키가 같은 쪽 파일 키와 겹쳐도 CASE_COLLISION (5) `ZBCButton`에 optional `aria-describedby` (6) `job-list-view.test.ts`는 node 테스트라 `tsconfig.node.json` include에 `job-list-view.ts`를 더하고 작업 생성 도우미를 파일 안에 둠 (7) scheduleSummary 다음 실행은 "MM-DD HH:mm"
- 남은 것: GCS 버킷의 빈 폴더 동작은 T-10에서 확인(E-6). `COMPONENTS.md` 갱신 권고(`/z_skill_code_asset_indexer`)

[TASK_017] : (2026-11-02) INT-002 Phase 5 — T-06 앱 스케줄러 → T-08 실행 화면 재구성 (관련 Intent: INT-002, T-06·T-08)
- 스케줄: `schemas/job` autoSync에 `kind`(interval/daily/weekly)·`timeOfDay`(HH:MM)·`weekdays`(bit0=일) — 저장 입력은 필수(기본값 없음), 읽기(zAutoSync)는 interval·09:00·평일 기본값으로 예전 데이터 호환, weekly 요일 0개는 zJobDraft superRefine으로 거부. DB 스키마 변경 없음(Q8, jobs.data JSON)
- `src/shared/schedule.ts`: parseTimeOfDay·nextLocalTimeOfDay(로컬 생성자, DST 안전)·nextOccurrence(항상 기준 시각보다 뒤, 계산 불가 시 +24h)·isSameSchedule·weekdaysText·scheduleText·quitScheduleWarning, nextRunAfterEdit(스케줄 변경 판정)·reconcileNextRun(daily·weekly 미래 예약 재정렬)·nextAfterFinish(spec) 시그니처 변경
- `scheduler.ts`: 시작 직후·시작 실패·종료 후 예약을 nextOccurrence로(게이트·startAuto·pickDue 불변)
- 종료 경고: `main/index.ts` 트레이 ‘종료’에서만(실행 중 아님·일시정지 아님·예약 있음) "다음 예약" 확인 창, f_AskQuit에 schedule 종류. 로그인 안내: `ui-store.loginHintShown`, `job-form.shouldShowLoginHint`, 편집기 저장 토스트 1회 + 고정 안내
- 편집 UI: `JobEditor` 예약 방식 라디오·간격 분/시간(`job-form` 단위 도우미)·시각(`ZBCInput` type time)·요일 체크박스·"저장하면 다음 실행" 미리보기. 목록·배지 `scheduleText`("1시간마다", "매일 09:00", "매주 월·수 09:00")
- 화면 재구성: 탭 "비교·미리보기 → 실행 → 결과·이력 → 작업 설정", 헤더 1단계/2단계 묶음, 미리보기 결과는 1단계 탭(RunView kind preview/real), 탭별 취소 버튼 제거 → 공통 중지 막대 `JobActivityBar`(+css, `run-view.activityStop`)
- 용어(`ui-terms.md`): 진행 중 활동 멈춤은 "중지"(상태·토스트·오류·종료 확인), remote → 리모트(화면·오류 문구), noop "바꿀 것 없음", FR-28 기본안 A로 동기화+오류 무시 안내 통일(`run-gates.SYNC_IGNORE_ERRORS_TEXT`, 차단 그대로)
- 테스트: `schedule.test.ts`(Asia/Seoul 고정, AC-12, 불변식 400×7), `schedule-dst.test.ts`(America/New_York 봄·가을), `scheduler.test.ts` daily·weekly 5건, `schemas`·`job-form`·`job-list-view`·`run-view`(activityStop)·`ui-store`·`path-utils`(/mnt/x FR-25) 추가, E2E `schedule.spec.ts`, drive-app 탭 셀렉터·API 목록(remotes) 갱신
- 검증: `pnpm run check`(unit 65파일 974), `format:check`, `test:int` 47(+1 skip), `test:e2e` 10, `build:win`, drive-app(빌드본) 102 PASS
- 설계와 다름: (1) 미리보기 시각은 렌더 중 Date를 읽지 않도록 스케줄을 바꾼 시각(previewAt) 기준이고, 바꾸기 전에는 미리보기 문구를 숨김 (2) 단계 묶음은 role=group 대신 `<fieldset>`(jsx-a11y) (3) drive-app API 목록 실패(Phase 3에서 remotes 추가 후 남아 있던 것)도 함께 수정 (4) 종료 확인 문구도 "중지"로 통일 (5) 리모트 용어를 main 서비스·저장소 오류 문구까지 적용
- 남은 것: 트레이 ‘종료’ 경고 창은 E2E에 트레이가 없고 drive-app도 트레이 메뉴를 누를 수 없어 수동 확인 필요(`pnpm run dev` → 자동 작업 1개 → 트레이 ‘종료’). `COMPONENTS.md` 갱신 권고

[TASK_018] : (2026-11-02) INT-002 Phase 6 — T-10 GCS 수용 → T-11 배포 → T-12 문서 (관련 Intent: INT-002, T-10·T-11·T-12)
- 6.0 예약 보정: `schedule.ts` `NEAR_SLOT_SKIP_MS`(60분)·`nextAfterFinish(finishedAt, spec, succeeded)` — daily·weekly가 성공(noop 포함)으로 끝나면 1시간 안의 정시를 건너뜀(놓친 예약을 08:59에 실행하면 09:00 중복 실행 방지), 실패·차단·중지는 바로 다음 정시. `scheduler.ts` `onFinished` 연결. 단위 `schedule.test.ts`·`scheduler.test.ts` 추가
- 6.1 GCS: `run-harness.ts` `waitFinished(runId, timeoutMs)`, 신규 `tests/integration/gcs-acceptance.test.ts` — 환경 변수 `RCLONEGUI_TEST_GCS_CONFIG`·`_REMOTE`·`_BUCKET`, 대상 검사(skip/reject/ok, 항상 실행), copy·sync 갱신·삭제·중지·전체 범위 copy/sync 시나리오, 고유 경로 정규식 확인 후 purge. 이번 실행은 키가 없어 GCS 시나리오 6건 skip(실측·rclone-notes 기록 없음, T-10 미체크)
- 6.2 배포: `dist/*.exe`는 `rcloneGUI-Setup-0.1.0.exe` 하나(portable 없음), `smoke:installer` 14건·설치본 drive-app 91건 통과(기존 설치 없음)
- 6.3 문서: README(배포 형태, 첫 실행, 리모트 북마크, 단계 탭·중지, 동기화 범위, 공용 제외 패턴, 자동 실행 예약·놓친 예약·종료 경고, 목록에서 실행, exclude-files, drive-app 명령, E2E 목록, 구조, 5.6 GCS 수용 테스트, 문제 해결, 알려진 제한), AGENTS(test:int 환경 변수, 구조, 4.8 통합·수용 테스트, node:sqlite 경계), MVP_SPEC "구현 반영 (INT-002)" 표·헤더, CHANGELOG(경로 1024→4096 정정, 2줄 추가), spec AC-15 판정 기준·E-6 실측 대기, intent T-03·T-09·T-11·T-12 체크
- 검증: `pnpm run check`(unit 65파일 977), `format:check`, `test:int` 51(+7 skip), `test:e2e` 10, `build:win`, `smoke:installer` 통과
- 설계와 다름: (1) 정리 후 남은 파일 확인과 조건 분기 단언은 lint(`no-standalone-expect`·`no-conditional-expect`) 때문에 throw·`toContainEqual`(허용 결과 목록)로 표현 (2) 건너뛸 때도 describe 본문이 수집되므로 GCS 임시 폴더는 beforeAll에서 만듦 (3) `electron-builder.yml` 주석은 바꾸지 않음

[TASK_019] : (2026-11-02) INT-003 Phase 1 — T-04 GCS 실측 중 S1-1 (관련 Intent: INT-003, T-04)
- S1-1 probe: `scripts/probes/rclone-probes.mjs`에 `features` 묶음(로컬·`:memory:`·alias로 감싼 로컬·없는 remote의 `backend features`), fixture `tests/fixtures/rclone/features-*` 12개, rclone-notes #27
- S1-1 GCS: `gcs-acceptance.test.ts`에 `f_CanHaveEmptyDirs`(값만 반환, 출력 원문은 버킷 이름 때문에 남기지 않음)와 케이스 "backend features: directory_markers 꺼짐·켜짐" 추가, 전체 범위 copy 출력에 CanHaveEmptyDirectories 함께 기록
- S1-2 보류: GCS 테스트 환경 변수 3개가 없어 실측·CHANGELOG 기록 안 함(T-04 미체크). Phase 4(T-05)는 GCS 값을 보고 판정 방법을 확정해야 함(spec R-4)
- 검증: `pnpm run check`(unit 977), `format:check`, `test:int` 51(+8 skip: GCS 7·기존 1) 통과
- 설계와 다름: FR-2의 "같은 conf 안 두 번째 remote" 대신 연결 문자열(`<remote>,directory_markers=true:<bucket>`)로 비교 — 테스트 conf를 바꿀 필요 없음

[TASK_020] : (2026-11-02) INT-003 Phase 2 — T-01 Windows 작업 스케줄러·헤드리스 (관련 Intent: INT-003, T-01)
- S2-1 probe: `scripts/probes/schtasks-probes.mjs`(임시 `\rcloneGUI-probe\` 작업만 만들고 지움), fixture `tests/fixtures/schtasks/`(query-csv-probe.bin·query-xml-nonascii.bin·probe-results.json), `docs/knowhow/windows-task-scheduler-notes.md` — `/Query /XML` 파이프 출력이 콘솔 코드페이지라는 점(Q-1), 0이 아닌 종료 코드로는 재시작하지 않음(Q-2), `ExecutionTimeLimit` 강제 종료 뒤 자식 프로세스(Q-8)
- shared: `zScheduleBackend`·`autoSync.backend`(읽기 기본 `"app"`)·`zRunJobAdditionalData`, `isAppScheduled()` — OS 백엔드 작업은 앱 스케줄러가 `nextRunAt`을 두지 않도록 `pickDue`·`nextAutoRun`·`reconcileNextRun`·`rescheduleOnUnpause`·`nextRunAfterEdit`에 반영
- `services/os-scheduler.ts`: `\rcloneGUI\<jobId>` 하나만 `/XML`로 등록, `<Description>spec=<hash>`(XML 틀·exe·jobId·예약 값)로 재등록 판정, `StartBoundary`는 항상 다음 미래 시각, `PT13H`·배터리 조건 끔·`IgnoreNew`·`StartWhenAvailable`, `RestartOnFailure` 없음, `schtasks.exe`는 `%SystemRoot%\System32` 절대 경로 + `execFile(shell:false)`(사용자 문자열 인자 금지), 임시 XML은 userData에 `wx`로 만든 뒤 등록 후 삭제, 시작 시 reconcile(고아 삭제·exe 경로 변경 재등록·목록은 ASCII 이름 정규식), `app.isPackaged`에서만 활성
- `launch-args.ts`: `--hidden`·`--run-job <uuid>` 파싱(값 없음·uuid 아님·`=` 형식·중복·위치 인자 4종 invalid, 그 밖의 `--xxx` 무시)
- `services/os-run-queue.ts`: FIFO 1건씩, 같은 jobId 중복 무시, 시작할 때마다 진입 검사 재확인(작업 없음=이력 없음, 그 밖의 차단=`SCHEDULE_SKIPPED` blocked 이력), BUSY 5초 폴링·60분 초과 blocked, 전송 전 경로 확인 2분 간격 3회, 시작 12시간 초과 시 `cancel(timeLimit)`, 대기열이 비면 종료 — 실제 전송은 `startAuto`만 거침
- `run-service.ts`: `startAuto` trigger `"os-scheduler"`, `recordAutoBlocked`(락 없이 blocked 이력), 취소 사유 `timeLimit` 문구(`TIME_LIMIT_CANCELED_TEXT`, 코드는 CANCELED 유지)
- `main/index.ts`: gui/headless 모드 분기, `f_HeadlessExit`(알림 대기·OS 대기 확인·재진입), `f_EnterGui`·second-instance `additionalData`, OS 예약 상태 IPC(`scheduler:osStatus`·이벤트)
- 화면: 편집기 예약 방식 선택(개발 실행 비활성·이유·암호화 conf 안내·등록 실패 표시), 작업 목록 배지, 이력 "Windows 예약"
- 패키징: `build/installer.nsh`가 `${isUpdated}`가 아닐 때 Schedule.Service COM으로 작업과 빈 `\rcloneGUI` 폴더 삭제(실패해도 제거 진행), `electron-builder.yml` `electronFuses`(runAsNode·NODE_OPTIONS·--inspect 차단, asar 무결성), `installer-smoke`·`drive-app --os-schedule`에 등록·`--run-job` 직접 실행·제거 정리 확인
- 문서: AGENTS 안전 규칙 1·2와 명령·구조, README, MVP_SPEC 구현 반영, CHANGELOG 1줄, `docs/code-asset-index/COMPONENTS.md`
- 검증: `pnpm run check`(단위 68파일 1066), `format:check`(322파일), `test:int` 55(+8 skip, GCS 환경 변수 없음 사유 출력), `test:e2e`, `build:win`, `smoke:installer -- --login-item` 125항목(asar·바로가기·데이터 보존·OS 예약 XML·헤드리스 정상/잘못된 id/예약 아님 `SCHEDULE_SKIPPED`/동시 실행·로그인 항목·fuses·제거 뒤 예약 0건) 통과
- 특이: 이전 중단 스모크가 남긴 `\rcloneGUI\` 예약 1건(이미 지워진 임시 설치 폴더를 가리킴)이 검증 착수 때 있었고 실행 전에 사라져 확인 후 진행했다 — 앱 시작 reconcile과 제거 스크립트가 정리하는 경로로 보이며 결함은 아니다

[TASK_021] : (2026-11-02) INT-003 Phase 3 — T-03 백업 폴더 `--backup-dir` (관련 Intent: INT-003, T-03)
- S3-1 probe: `rclone-probes.mjs` `backup` 묶음(다른 드라이브는 `RCLONEGUI_PROBE_OTHER_DRIVE`가 있을 때만)·`backup-s3`(serve s3, `--only`일 때만), fixture `backup-*` 51개(가림 `<TMP>`·`<TMP2>`·포트·키), rclone-notes #28~#32 — dry-run에서 지울 파일은 `move into backup dir`, 덮어쓸 파일은 `move`+`copy`. 서버 쪽 Move가 있으면 덮어쓰기 이동은 `--max-delete`에 세지 않지만, Move가 없는 저장소·다른 드라이브는 복사+삭제가 되어 한도를 넘겨 exit 7. 같은 하위 폴더 파일은 경고 없이 덮어씀. 겹침은 rclone이 fatal로 거부
- spec·plan: FR-23·25·26·35·E-11·E-15·§6·Q-6 정정, FR-36(remote 대상 `backend features`의 Move가 true가 아니면 SAFETY_BLOCKED)·AC-18·AC-19 추가, S4-1의 features 빌더·파서·캐시를 Phase 3으로 당김
- 스키마·검사: 작업 최상위 `backupDir`(저장 입력 필수, 예전 데이터 null)·이력 `backupDir`, `checkBackupDir`·`joinBackupPath`(같은 remote·같은 드라이브/UNC 공유/WSL 표기, 같음·안·상위·루트 금지), job-store 저장 검증(sync만)·job-form
- 실행: 로그 파서 `move into backup dir`→삭제, `move`→`backupMove`(세지 않음). 빌더 `--backup-dir`, `BLOCKED_FLAGS` 백업 판정을 플래그 영역+값 있음으로 좁힘(빈 값·`--` 뒤·다음 인자가 플래그면 백업 아님). `checkPlanSafety`는 백업이 없을 때만 sync+오류 무시 차단. 계획 토큰 v4. `backend-features-parser`·`clsRemoteService.features`(캐시, 실패는 캐시 안 함, 10초)·`assertBackupMovable`. `backup-dir.ts` `buildBackupSubdir`·`nextBackupTime`(프로세스 안 1초 이상 증가), run-service `assignBackupDir`(사전 확인과 실제 실행이 같은 값), 로그 `# 백업 위치:`·인자 `<백업 폴더>` 가림
- 화면: 편집기 백업 폴더 필드(sync만)·PathField `required`, JobOptionsFields 오류 무시 안내, 삭제 확인 창·실행 결과·이력 상세에 백업 위치, E2E `backup-dir.spec.ts` 2건
- 문서: CHANGELOG·README·MVP_SPEC(차단표·§8.1·구현 반영)·AGENTS 규칙 2 한 문장(규칙 3 그대로)·COMPONENTS.md
- 검증: `pnpm run check`(단위 69파일 1169), `format:check`(326), `test:int` 63(+9 skip: GCS 8·rclone-env 1), `test:e2e` 13, `build:win` 통과. 독립 검증 Pass, 낮음 결함 2건(빈 `--backup-dir` 백스톱 빈틈, copy 모드 경고 id 중복)을 바로 고치고 단위·backup-dir E2E 재확인
- 남은 것: GCS가 서버 쪽 Move를 지원하는지는 키가 없어 미확인(지원하지 않으면 GCS 대상 백업 폴더 sync는 FR-36으로 막힘). 대안(`--max-delete` 상향)은 안전 규칙 2 변경이라 채택하지 않음

[TASK_022] : (2026-11-02) INT-003 Phase 4 — T-05 빈 폴더를 만들 수 없는 대상 (관련 Intent: INT-003, T-05)
- 조회: IPC `remotes:features`(`.strict()` 입력, 기존 `handle()` 응답 형식), `clsRemoteService.canHaveEmptyDirs`·`emptyDirSupport`(Phase 3의 features 캐시 재사용, rclone 없음·conf 해석 실패는 null, 던지지 않음). 로컬·UNC는 true, remote는 `전체` 범위일 때만 조회(D-3), 비교 시작 때 probe와 병렬
- 비교·판정: `destCanHaveEmptyDirs`를 비교 결과에 담고, `hasPlannedChanges(plan, destCanHaveEmptyDirs)`는 false일 때 만들 폴더만 0으로 센다(삭제는 항상 셈). 자동 게이트의 삭제 수·한도·대량·사전 확인 판정은 그대로이고 noop 판정에만 영향. 수동은 화면 `canStartRun`만 막고 main 게이트는 그대로(D-5). 계획 토큰·DB·rclone 인자 변경 없음
- 화면: `use-empty-dir-support`(400ms 디바운스·최신 요청만)로 편집기 `전체` 범위 경고(저장은 막지 않음), 비교 요약·목록에서 빈 폴더 차이를 "이 저장소는 빈 폴더를 만들 수 없음"으로 따로 표시, E2E `empty-dirs.spec.ts`
- 문서: MVP_SPEC "구현 반영 (INT-003 Phase 4)" 표(INT-002 E-6 해소), CHANGELOG 1줄, rclone-notes #33(memory remote는 프로세스마다 비어 있음), spec·plan 주석, COMPONENTS.md
- 검증: `pnpm run check`(단위 70파일 1198), `format:check`, `test:int` 66(+10 skip), `test:e2e` 14, `build:win` 통과. 독립 검증 Pass(차단 결함 0). 세션이 끊겨 E2E 1건 실패 원인을 보던 중이었으나 재실행에서 재현되지 않음
- 남은 것: `directory_markers`가 `CanHaveEmptyDirectories`에 반영되는지는 GCS 실측(T-04) 전까지 미확인(R-4)

[TASK_023] : (2026-11-02) INT-003 T-08 — Google Drive 수용 테스트(T-04 GCS 실측 대체), INT-003 완료 (관련 Intent: INT-003, T-08)
- 문서(07e1b24): T-04 취소·T-08 추가, spec FR-37~41·AC-20·21·R-7·R-8, plan Phase 6, INT-003 planned→active
- 테스트(3f47713): `tests/integration/remote-acceptance.ts` 도우미(실행 폴더 이름·정확한 형식 경로만 purge), `drive-acceptance.test.ts`(`RCLONEGUI_TEST_DRIVE_REMOTE` 있을 때만, drive 종류·conf 위치·사전 부재 확인 뒤 9개 시나리오, 휴지통은 기록만), AGENTS.md 2·3·4.8. 독립 검증 Pass(Low 4건: `..` 접두 판정, 이름 정규식이 `.`·`@` 거부, 시간 초과 뒤 정리 겹침, `RCLONE_*` 환경 상속 — 실측 전 `RCLONE_*` 없음 확인)
- 실측: 첫 실행 14개 중 2개 실패(sync 삭제·전체 범위 sync) — 대상 파일 2개 중 1개 삭제가 대량 삭제(50%)로 SAFETY_BLOCKED. 앱 게이트는 의도대로이고 도우미가 `confirmLargeDeletes`를 넘기지 않은 테스트 결함 → Drive 도우미와 GCS `f_RunPlan`에 같은 한 줄 수정. 재실행 14/14(skip 0, 약 8분), 실행 폴더 잔여 0
- 기록: rclone-notes #34(Drive features), #35(앱 시나리오·중지 시 `.partial` 없음), #36(sync 삭제는 휴지통, 백업 이동은 휴지통 아님, 공용 client_id 중단 NOTICE), CHANGELOG 1줄, INT-003 결과 섹션·done 이동·INDEX 재작성, MVP_SPEC 경로
- 검증: `pnpm run check`(단위 1198), `format:check`, `test:int` 71(+19 skip), Drive 수용 14/14
- 남은 것: GCS `directory_markers` 반영 여부(R-4) 미검증. `gdrive-test`가 rclone 공용 client_id를 써서 2026년 중 중단 예정(개인 client_id 권장)

## Errors

- (2026-10-28) PowerShell `-ExecutionPolicy Bypass` 실행이 권한 정책으로 거부됨 → probe를 Node 스크립트로 대체 [TASK_001 해결]
- (2026-10-28) 테스트·스모크로 찾은 결함: writeJsonAtomic 폴더 생성 실패가 STORE_ERROR로 감싸지지 않음, settings.update 동기 예외, jobs:create가 알 수 없는 키를 버리고 저장, 운영 CSP meta의 frame-ancestors 콘솔 오류 → 모두 수정 [TASK_001 해결]
- (2026-10-29) E2E 설정 화면 제목 셀렉터(`getByRole("heading", { name: "설정" })`)가 'rclone 설정'과 겹쳐 strict mode 위반 → `exact: true` [TASK_012 해결]
- (2026-10-29) 기존 rcloneGUI 0.1.0 설치로 installer-smoke 사전 확인 중단 → 사용자 승인 후 기존 설치를 제거하고 재실행, 15건 통과 [TASK_012 해결]
- (2026-11-02) Drive 수용 첫 실측에서 sync 삭제·전체 범위 sync가 대량 삭제 게이트(SAFETY_BLOCKED)로 실패 — 테스트 도우미가 `confirmLargeDeletes`를 넘기지 않음 → 수정 후 14/14 [TASK_023 해결]

[TASK_024] : (2026-11-03) INT-004 작은 파일이 많은 실행에서도 믿을 수 있는 남은 시간 표시 (관련 Intent: INT-004, T-01~T-03)
- fixture(T-01): 2026-11-03 중단 실행 로그 2,302초·667/1,815에서 stats만 남기고 `msg`·`transferring[].name`·`srcFs`/`dstFs`를 가려 `drive-small-files-progress-partial.stderr.txt`(486줄). 테스트 remote에 작은 파일 200개 + 30MB 1개를 copy해 492.9초·201/201·오류 0으로 끝낸 로그를 같은 방식으로 가리고 30초 뒤 5초 간격으로 줄여 `drive-small-files-progress.stderr.txt`(124줄). 두 파일 모두 remote 이름·사용자 경로·원래 파일 이름 0건 확인
- 계산(T-02): `run-eta.ts`에 `etaTotals`(계획+stats max, 계획 없으면 checks 완료 또는 totalTransfers 5초 불변으로 확정)·`rawEtaSeconds`(완료 파일=transfers+partialFiles, 완료 바이트=bytes, 10초·5개/5%·분모 확정 전 pending, 파일·바이트 누적 평균 중 긴 쪽)·`nextEta`(예상 총 소요에 τ=30초 지수 평활, Δt≤0이면 갱신 안 함, 완료 시 0초). `zRunStats`에 `partialFiles`·`etaPending` 기본값 추가(예전 이력 호환), 파서가 `transferring[].bytes/size`만 읽어 `min(bytes/size, 0.999)` 합을 내고 이름은 버림
- 연결·화면(T-03): run-service가 rclone 단계마다 `etaState=null`로 초기화하고 `onLine`에서 stats마다 계산값을 덮어써 snapshot·batcher에 넣음(화면·이력 동일 값). `RunStatsGrid`에 `live` prop(기본 false), `etaText`가 진행 중 pending이면 "계산 중", 아니면 `formatDuration`, 끝난 실행·이력은 "-". `RunView`만 live 전달
- 테스트: AC-2~AC-8b, AC-10~AC-13 단위 테스트, 파서 AC-1·깨진 `transferring` 케이스, run-service 계산값 전달·사전 확인→실제 실행 초기화, `etaText` 표시 규칙. AC-12는 `command-builder.ts`·게이트·`spawnTransfer` 시작 조건 diff 0으로 확인
- 측정: 완료 fixture는 초반 10초에 30MB와 작은 파일 10여 개가 끝나 바이트 98%가 된 뒤 Drive 속도 제한으로 초당 0.3~0.5개로 느려졌다. 재생 결과 11~29초 19개 지점이 실제 남은 시간의 0.314~0.330배, 30초 이후는 1/3~3배, 인접 비율 최대 1.11배. 분모·부분 진행률·평활 결함이 아니라 누적 평균의 알려진 한계(FR-5)로 진단해 AC-8b 하한만 1/4로 넓히고 spec §10 Q-4에 근거 기록
- 문서: CHANGELOG 1줄, rclone-notes #37(`totalChecks` 0·`totalBytes` 실행 중 증가)·#38(Drive 초반 폭주→속도 제한, rclone eta 0초, AC-8b 하한 근거), spec AC-8b/Q-4, plan DoD 체크, intent T-01~T-03 완료·active 이동, INDEX 재작성
- 검토 보완: 완료 stats에서 평활값 때문에 0초가 아닌 값이 남던 FR-7 결함을 찾아, 원시 남은 시간이 0이면 평활과 관계없이 0초를 내도록 고치고 단위 테스트를 추가했다(단위 1,218)
- 검증: `pnpm run check`(단위 71파일 1,218), `format:check`, `test:int` 71 통과(+19 skip: GCS 9·Drive 10), `test:e2e` 14(콘솔 오류 0), `build:win` 통과
- 특이: 완료 fixture 첫 시도는 실행 중이던 다른 앱 rclone과 같은 Drive remote를 동시에 써 20분간 진행이 멈췄다(로그 0바이트). 두 프로세스를 정리하고 테스트 폴더를 지운 뒤 다시 실행해 8분 만에 완료했다. 생성한 테스트 폴더는 purge로 정리
- 남은 것: 사용자 완료 확인 후 INT-004 done 이동

[TASK_025] : (2026-11-03) INT-006 미해결 질문 Q1~Q8 결정과 결정용 rclone 실측 (관련 Intent: INT-006, Phase 0 S0-1·S0-2)
- 실측(임시 conf·가짜 값, 끝난 뒤 폴더 삭제): `obscure -` stdin·`--no-obscure` 동작, obscure는 IsPassword 36개에만 적용(Sensitive 206개 평문), `RCLONE_CONFIG_<NAME>_<OPT>` conf 미기록, 암호화 conf는 `RCLONE_CONFIG_PASS`로 create 가능, `rcd --rc-addr 127.0.0.1:0` 포트 출력·인증 없으면 401·`config/create` 본문 저장·`config/get`은 obscure 값 반환, `config redacted`는 IsPassword+Sensitive 가림, 이름 규칙(`-ab`는 플래그로 해석), Drive 첫 질문 `config_shared_client_id` 기본값 false → rclone-notes #39~#45
- 결정: Q1 rcd HTTP 본문(원래 제안 obscure 대체), Q2 redacted + 이중 제거(안전 규칙 6 예외), Q3 10분, Q4 미지원(INBOX), Q5 `remoteConfig:*`, Q6 범위 밖(기본 conf 작업만 집계), Q7 공백·한 글자·`-` 시작/끝 금지, Q8 범용 질문 폼(`config_is_local`만 자동)
- 문서: AGENTS.md 안전 규칙 1(rcd 조건)·6(redacted 예외), spec FR-5·6·9·11·13~15a·17·18·NFR·§6.4·AC-3·15·16·§10, plan S0 완료·S1-1/S1-2/S2-2/S4 갱신, intent 질문 체크, INBOX 이름 변경 캡처
- 남은 것: Phase 1 probe 스크립트·fixture(S1-1), OAuth 수동 실측(S1-2, 사람이 로그인)

[TASK_026] : (2026-11-03) INT-007 범위 재검토와 `--filter-from` 실측 (관련 Intent: INT-007, T-01)
- 검토: 명령줄 한도가 막는 것은 제외 패턴의 인자 전용 예산(`EXCLUDE_ARG_ONLY_BUDGET`)뿐이고, rclone에는 작업 설정 파일·인자 파일이 없어 "모든 옵션 파일 전달"은 rc 전환만 가능 → 범위를 `--filter-from` 전환으로 축소, rc 방식은 INBOX(2026-11-03-02)
- 실측(probe `filter` 묶음, v1.75.1): `@file` 미지원, `- ` 접두사 줄은 `#`·`;`·앞 공백·`!` 패턴 유지, 뒤 공백은 파일·인자 모두 지워짐(현재 인자 경로 버그)·`[ ]`로 유지, BOM·접두사 없는 줄은 `malformed rule` exit 1, CRLF 정상, 인자와 합집합 → rclone-notes #46~#50, fixture `filter-*`·`argfile-at` 30개
- 문서: intent 제목·문제·제안·제약·질문·태스크(T-01 완료, T-02~T-05) 재작성, INDEX 행 갱신
- 참고: probe의 INT-006 `config` 묶음이 `--only` 조건 없이 실행돼 `config-rcd-requests` fixture를 같은 버전 출력으로 다시 씀(INT-006 S1-1에서 조건 추가 필요)
- spec 미해결 질문 결정(Q-1~Q-5): 빈 필터 파일 안 넘김, 공용 `#`·`;` 해제는 INBOX(2026-11-03-03), T-02 P2, 계획 토큰 버전 4 유지, 공백만 패턴 그대로. 사전 실측(v1.75.1 일회성, spec §6.3): rclone이 지우는 끝 공백은 Go `unicode.IsSpace` 집합(U+0085 포함·U+FEFF 제외)이라 FR-3을 JS `\s`에서 명시 집합으로 수정·AC-3b 추가, 끝 `a\ `는 `a\$` 규칙이 됨, 빈 파일·`--exclude ""`는 규칙 0개. Q-6(1.65.0)은 zip SHA256 확인까지만, 실행은 T-05

[TASK_027] : (2026-11-03) INT-006 앱에서 remote 추가·수정·삭제·재인증 구현 (관련 Intent: INT-006, T-01~T-06)
- probe(T-01): `scripts/probes/rclone-probes.mjs`에 `config` 묶음 추가 — `config providers`(69종·옵션 968개, Hide 0/1/2/3, Exclusive는 azureblob 하나, 기본값의 OS 사용자 이름은 `<USER>`로 가림), `config delete` 없는 이름 exit 0, rcd `config/create`·`update`·`core/quit` 응답과 401, Drive `client_id_warning`→`client_id_set` 질문, `config redacted`의 sftp host·user·pass XXX. rclone-notes #51~#54, fixture `config-*` 30개. rcd 묶음은 `--only=config`일 때만 실행하도록 가드(다른 묶음 실행 때 덮어쓰지 않게)
- 기반(T-02): `command-builder` 허용 명령 확장(show/dump/edit/password/encryption·CLI create/update는 계속 차단)과 builders, `rc-session.ts`(loopback·임의 포트·실행별 Basic 토큰 env·허용 경로 3개·시작 줄 파서·종료 보장), `secret-redact.ts`, `rclone-providers-parser`(숨김 제외·IsPassword/Sensitive 비밀·token=OAuth·Exclusive enum), `rclone-config-parser`(시작 줄·rc 응답·redacted), shared 타입·zod·오류 코드, `validateNewRemoteName`
- 추가·수정·삭제(T-03·T-05): `remote-config-service`가 providers 캐시·이름 검증·옵션 재검증·rcd 본문 전송·비밀 비보관·redacted 이중 제거·참조 수 계산·삭제 순서(자동 실행 끄기→osScheduler.idle→예약 확인→config delete)를 담당. `remote-auth-session`은 OAuth 한 건·10분·취소·질문 폼(`config_is_local` 자동 true)·반쪽 remote 정리·`config reconnect --non-interactive` 재인증. IPC `remoteConfig:*` 9채널·이벤트·preload
- 화면: `RemoteConfigPanel`(목록·연결 테스트·추가/수정/재인증/삭제), `RemoteConfigEditor`(종류 검색·OAuth 표시·이름 읽기 전용), `RemoteConfigForm`(bool/enum/비밀/고급 접기), `RemoteAuthModal`(남은 시간·주소·질문), `RemoteDeleteModal`(참조 수·버튼 문구), `remote-config-store`. 작업 목록·화면·북마크에 “remote 없음”
- 실행 전 확인: `resolveJobContext`가 conf의 listremotes로 remote 존재를 확인해 `REMOTE_NOT_FOUND`(비교·수동·자동·OS 예약 공통), `clsRcloneEnv.listRemotesAt` 추가
- 테스트: 단위 76파일 1,274(providers/redacted/rc 응답 파서, 이름, 비밀 가림, 서비스 인자·본문·삭제 순서, OAuth 질문·자동 답·취소·재인증, job-context), 통합 75(+19 skip: 임시 conf local/memory/alias/sftp·rcd 401/허용 경로/종료·예약 끄기), E2E 15(설정에서 추가·수정·삭제, 콘솔 오류 0)
- 검증: `pnpm run check`, `format:check`, `test:int`, `test:e2e`, `build:win` 통과
- 남은 것: OAuth 실제 계정 로그인 수동 확인(S1-2, 사람이 로그인), INT-006 done 이동
