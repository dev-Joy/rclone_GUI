# Project Code Asset Index: rclonegui

- 생성일시: 2026-11-04 16:54:25
- 감지된 환경: React / TypeScript
- 스캔 대상 디렉터리: `src/components`, `src/lib`, `src/main/lib`, `src/main/services`, `src/shared`, `src/shared/schemas`, `src/shared/types`
- 총 인덱싱 자산: 449 건

> 이 카탈로그는 AI 에이전트와 개발자가 기존 공통 자산을 재사용하고 중복 구현을 방지하기 위한 인덱스입니다.
> 신규 컴포넌트/함수/훅 작성 전 반드시 아래 목록을 대조하고 적극 재사용하십시오.

---

## 1. UI Components

| 컴포넌트명 | 정의 파일 | 시그니처 / 주요 설명 |
| :--- | :--- | :--- |
| `ZBCBadge` | [`src/components/ZBCBadge.tsx`](../../src/components/ZBCBadge.tsx) | ZBCBadge(props: itfZBCBadgeProps) - UI 컴포넌트 |
| `ZBCButton` | [`src/components/ZBCButton.tsx`](../../src/components/ZBCButton.tsx) | ZBCButton(props: itfZBCButtonProps) - UI 컴포넌트 |
| `ZBCCheckbox` | [`src/components/ZBCCheckbox.tsx`](../../src/components/ZBCCheckbox.tsx) | ZBCCheckbox(props: itfZBCCheckboxProps) - UI 컴포넌트 |
| `ZBCField` | [`src/components/ZBCField.tsx`](../../src/components/ZBCField.tsx) | ZBCField(props: itfZBCFieldProps) - UI 컴포넌트 |
| `ZBCInput` | [`src/components/ZBCInput.tsx`](../../src/components/ZBCInput.tsx) | ZBCInput(props: itfZBCInputProps) - UI 컴포넌트 |
| `ZBCModal` | [`src/components/ZBCModal.tsx`](../../src/components/ZBCModal.tsx) | ZBCModal(props: itfZBCModalProps) - UI 컴포넌트 |
| `ZBCSelect` | [`src/components/ZBCSelect.tsx`](../../src/components/ZBCSelect.tsx) | ZBCSelect(props: itfZBCSelectProps) - UI 컴포넌트 |
| `ZBCTabs` | [`src/components/ZBCTabs.tsx`](../../src/components/ZBCTabs.tsx) | ZBCTabs<T extends string>(props: itfZBCTabsProps<T>) - UI 컴포넌트 |
| `ZBCTextarea` | [`src/components/ZBCTextarea.tsx`](../../src/components/ZBCTextarea.tsx) | ZBCTextarea(props: itfZBCTextareaProps) - UI 컴포넌트 |
| `ZBCToast` | [`src/components/ZBCToast.tsx`](../../src/components/ZBCToast.tsx) | ZBCToast(props: itfZBCToastProps) - UI 컴포넌트 |

## 2. Custom Hooks

| 훅 명칭 | 정의 파일 | 시그니처 / 반환 요약 |
| :--- | :--- | :--- |
| `useDebouncedValue` | [`src/lib/use-debounced-value.ts`](../../src/lib/use-debounced-value.ts) | useDebouncedValue<T>(value: T, ms: number) - 커스텀 훅 |
| `useEmptyDirSupport` | [`src/lib/use-empty-dir-support.ts`](../../src/lib/use-empty-dir-support.ts) | useEmptyDirSupport(...) - 대상이 빈 폴더를 만들 수 있는지. enabled가 아니면 null, 로컬·UNC는 조회하지 않고 true, remote는 조회 결과(실패·알 수 없음·조회 중은 null). 실패는 알리지 않는다(경고를 띄우지 않을 뿐) |
| `usePathProbe` | [`src/lib/use-path-probe.ts`](../../src/lib/use-path-probe.ts) | usePathProbe() - 커스텀 훅 |
| `useRunFlow` | [`src/lib/use-run-flow.ts`](../../src/lib/use-run-flow.ts) | useRunFlow() - 커스텀 훅 |
| `useVirtualRows` | [`src/lib/use-virtual-rows.ts`](../../src/lib/use-virtual-rows.ts) | useVirtualRows<T extends HTMLElement>(...) - 커스텀 훅 |

## 3. Utilities & Helpers

| 함수 / 심볼 | 정의 파일 | 시그니처 / 요약 |
| :--- | :--- | :--- |
| `errorText` | [`src/lib/api.ts`](../../src/lib/api.ts) | errorText(e: unknown) - 사용자에게 보일 오류 문구 |
| `getApi` | [`src/lib/api.ts`](../../src/lib/api.ts) | getApi() - 공통 함수/유틸리티 |
| `unwrap` | [`src/lib/api.ts`](../../src/lib/api.ts) | unwrap<T>(pending: Promise<typApiResult<T>>) - 실패 envelope를 clsApiError로 바꾼다 |
| `canStartCompare` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | canStartCompare(...) - 비교 버튼 가능 여부와 이유. 저장 안 됨 → 미저장 변경 → 경로 오류(드라이브 상대 포함) → 진행 중 |
| `compareStaleReason` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | compareStaleReason(...) - 화면 배너용. 작업 rev가 바뀌었으면 "작업 설정이 바뀌었습니다. 다시 비교하세요.", 나이가 넘었으면 "비교한 지 N분 지났습니다. 실행 전 다시 비교하세요.", 아니면 null. |
| `dirSummaryText` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | dirSummaryText(...) - 전체 범위의 폴더 변화 한 줄. 예: "빈 폴더 3개 생성, 폴더 2개 삭제", copy: "빈 폴더 3개 생성, 대상에만 있는 폴더 2개(유지)". 둘 다 0이면 null. |
| `emptyDirsUnsupportedText` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | emptyDirsUnsupportedText(...) - 빈 폴더를 만들 수 없는 대상의 폴더 생성 안내(INT-003 FR-31). false이고 createDirs > 0일 때만, 아니면 null |
| `reasonText` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | reasonText(reasons: readonly typModifiedReason[]) - 변경 사유 문구. 예: ["size", "mtime"] → "크기, 수정시간" |
| `selectRowIndexes` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | selectRowIndexes(...) - 필터·검색(부분 일치, 대소문자 무시·NFC)·정렬 결과를 entries 인덱스 배열로 돌려준다(객체 복사 없음). entries는 경로 키 오름차순이므로 보조 키(경로 오름차순)는 인덱스 순서로 대신한다. |
| `statusLabel` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | statusLabel(status: typCompareStatus, mode: typRunMode) - 상태 라벨. onlyDest: copy "대상만(유지)", sync "대상만(삭제 예정)" |
| `statusTone` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | statusTone(status: typCompareStatus, mode: typRunMode) - 공통 함수/유틸리티 |
| `summaryCards` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | summaryCards(s: itfCompareSummary, mode: typRunMode) - 요약 카드. 문구는 일어날 일: "대상에 12개 복사", "8개 덮어씀", sync "3개 삭제" / copy "3개 대상에만 있음(유지)" |
| `excludeChangeConfirmText` | [`src/lib/exclude-view.ts`](../../src/lib/exclude-view.ts) | excludeChangeConfirmText(kind: typExcludeChangeKind, userCount: number) - 확인 버튼 문구(일어날 일). 예: "패턴 지우고 작업 3개의 비교 결과 버리기" |
| `jobOnlyCommentLike` | [`src/lib/exclude-view.ts`](../../src/lib/exclude-view.ts) | jobOnlyCommentLike(patterns: readonly string[]) - 이 작업 전용 패턴 중 공용으로 둘 수 없는 줄(#·; 시작) |
| `missingPatternIds` | [`src/lib/exclude-view.ts`](../../src/lib/exclude-view.ts) | missingPatternIds(...) - 선택한 id 중 라이브러리에 없는 것(편집 중 지워진 패턴) |
| `togglePatternId` | [`src/lib/exclude-view.ts`](../../src/lib/exclude-view.ts) | togglePatternId(selected: readonly string[], id: string, on: boolean) - 선택 토글. 결과는 정렬한다(저장소가 정렬해 돌려주므로 변경 여부 비교가 맞게) |
| `excludesIssueText` | [`src/lib/form-utils.ts`](../../src/lib/form-utils.ts) | excludesIssueText(...) - 제외 규칙(zExcludes) 오류 문구. issue.path는 excludes 기준 상대 경로 |
| `numberIssueText` | [`src/lib/form-utils.ts`](../../src/lib/form-utils.ts) | numberIssueText(value: unknown, range: itfNumberRange) - 숫자 필드 오류 문구 |
| `numberText` | [`src/lib/form-utils.ts`](../../src/lib/form-utils.ts) | numberText(value: number) - number → 입력란 문자열. NaN은 빈칸 |
| `stableStringify` | [`src/lib/form-utils.ts`](../../src/lib/form-utils.ts) | stableStringify(value: unknown) - 키 순서와 무관한 JSON 직렬화 (NaN은 null로 같아진다) |
| `toNumber` | [`src/lib/form-utils.ts`](../../src/lib/form-utils.ts) | toNumber(text: string) - 숫자 입력란 문자열 → number. 빈칸·숫자가 아니면 NaN (저장 전 검증에서 막힌다) |
| `filterHistory` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | filterHistory(...) - 공통 함수/유틸리티 |
| `historyCounts` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | historyCounts(r: Pick<typRunRecord, "stats" \| "plan" \| "dryRun">) - 표의 결과 요약. 예: "복사 3 · 삭제 1 · 1.5 KB · 오류 0". 통계가 없으면 계획, 둘 다 없으면 "-" |
| `historyKind` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | historyKind(r: Pick<typRunRecord, "dryRun" \| "trigger">) - 미리보기 > 자동(앱·Windows 예약) > 수동 |
| `nextAutoRunText` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | nextAutoRunText(...) - 다음 자동 실행 문구(상단 막대). formatTime은 ISO → 표시 시각 |
| `statusTone` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | statusTone(status: typRunStatus) - 공통 함수/유틸리티 |
| `convertIntervalUnit` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | convertIntervalUnit(minutes: number, to: typIntervalUnit) - 단위를 바꿀 때 분 값. 분 → 시간은 가장 가까운 시간(최소 1시간)으로 맞춘다 |
| `excludesToText` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | excludesToText(excludes: readonly string[]) - 공통 함수/유틸리티 |
| `intervalDisplay` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | intervalDisplay(minutes: number, unit: typIntervalUnit) - 분 값을 입력 단위로 보여 줄 숫자 |
| `intervalMinutesFrom` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | intervalMinutesFrom(value: number, unit: typIntervalUnit) - 입력 단위의 숫자를 분으로(NaN은 그대로 두어 검증이 잡게 한다) |
| `intervalUnitOf` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | intervalUnitOf(minutes: number) - 저장된 분 값에 맞는 입력 단위: 60의 배수면 시간 |
| `isDraftEqual` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | isDraftEqual(a: typJobDraft, b: typJobDraft) - 편집 가능한 값이 같은지 (dirty 판정). excludes 순서까지 비교 |
| `jobToDraft` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | jobToDraft(job: typJob) - 저장된 Job에서 편집 가능한 필드만 뽑는다 (id·rev·lastRun·nextRunAt 등 제외) |
| `nextSelectionAfterRemove` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | nextSelectionAfterRemove(...) - 삭제 후 선택할 id (정렬 순서의 다음 → 이전 → null) |
| `parseExcludesText` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | parseExcludesText(text: string) - textarea 문자열 → excludes (trim, 빈 줄 제거, 순서 유지) |
| `serverErrorToCheck` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | serverErrorToCheck(error: typAppErrorPayload) - main 오류 envelope를 폼 오류로. SAFETY_BLOCKED/PATH_INVALID 메시지의 "원본:"/"대상:"/"백업 폴더:" 접두사는 해당 필드로, 나머지는 formErrors |
| `shouldShowLoginHint` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | shouldShowLoginHint(...) - 자동 실행을 새로 켜고 저장했는데 로그인 시 시작이 꺼져 있으면 한 번 안내한다 |
| `sortJobs` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | sortJobs(jobs: readonly typJob[]) - 사이드바 정렬: 이름(ko, base) → createdAt |
| `validateJobDraft` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | validateJobDraft(draft: typJobDraft, caseInsensitive: boolean) - 화면 검증: zJobDraft.safeParse + checkPathPair + 경고 규칙 |
| `isOsTaskMissing` | [`src/lib/job-list-view.ts`](../../src/lib/job-list-view.ts) | isOsTaskMissing(...) - Windows 예약이 켜진 작업인데 등록되지 않았거나 등록·삭제 실패 문구가 있는지(배지 "OS 예약 미등록"). OS 예약을 쓸 수 없는 환경이거나 아직 상태를 모르면(목록에 없음) false. |
| `jobListItem` | [`src/lib/job-list-view.ts`](../../src/lib/job-list-view.ts) | jobListItem(job: typJob, opts: { showStatus: boolean }) - 작업 목록 한 줄의 문구 |
| `missingRemoteNames` | [`src/lib/job-list-view.ts`](../../src/lib/job-list-view.ts) | missingRemoteNames(...) - 기본 conf를 쓰는 작업이 가리키는 remote 중 목록에 없는 이름(FR-25). remotes가 null이면(아직 못 읽음) 표시하지 않는다. 작업별 conf를 쓰는 작업도 확인하지 않는다. |
| `scheduleSummary` | [`src/lib/job-list-view.ts`](../../src/lib/job-list-view.ts) | scheduleSummary(job: Pick<typJob, "autoSync">) - 자동 실행 요약. 꺼져 있으면 null, 켜져 있으면 "30분마다 · 다음 11-02 10:30", "매일 09:00 · 다음 …", "매주 월·수 09:00 · 다음 …". |
| `pathKindBadge` | [`src/lib/path-display.ts`](../../src/lib/path-display.ts) | pathKindBadge(raw: string) - 입력 원문의 배지. 빈 값은 null, 형식 오류는 { text: "형식 오류", kind: null } |
| `shortenPath` | [`src/lib/path-display.ts`](../../src/lib/path-display.ts) | shortenPath(path: string, max = 36) - 긴 경로를 가운데를 "…"로 줄여 앞뒤를 남긴다(작업 목록 표시용). max 이하면 그대로. 앞 ceil((max-1)/2)자, 뒤 floor((max-1)/2)자를 남긴다. |
| `browserChild` | [`src/lib/remote-browser.ts`](../../src/lib/remote-browser.ts) | browserChild(...) - 현재 경로 아래 폴더 이름 하나를 덧붙인 경로. 이름이 안전하지 않거나 기준 밖이면 null |
| `browserParent` | [`src/lib/remote-browser.ts`](../../src/lib/remote-browser.ts) | browserParent(bookmark: itfRemoteBookmark, path: string) - 기준 경로 위로 올라간 부모. 기준 경로에 닿았거나 밖이면 null |
| `isBrowserRoot` | [`src/lib/remote-browser.ts`](../../src/lib/remote-browser.ts) | isBrowserRoot(path: string) - remote 루트("name:")인지. 루트는 작업 경로로 고를 수 없다 |
| `visibleDirEntries` | [`src/lib/remote-browser.ts`](../../src/lib/remote-browser.ts) | visibleDirEntries(entries: readonly itfDirEntry[], shown: number) - 더 보기: 앞에서 shown개만 |
| `activityStop` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | activityStop(...) - 이 작업에 진행 중인 활동의 중지 버튼 정보. 없으면 null(실행이 비교보다 우선) |
| `appendTail` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | appendTail(...) - 로그 tail 뒤에 줄을 붙이고 최근 max줄만 남긴다(새 배열) |
| `canStartRun` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | canStartRun(input: itfCanStartRunInput) - 미리보기·실제 실행 버튼 가능 여부와 이유. 공통: 저장 안 됨 → 미저장 변경 → 경로 오류 → 비교 중 → 실행 중. |
| `deleteConfirmInfo` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | deleteConfirmInfo(...) - 삭제 확인 모달에 보일 수와 대량 여부 (main 재검증과 같은 isLargeDelete) |
| `deleteDirSamples` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | deleteDirSamples(result: itfCompareResult, limit = 20) - 삭제 예정(대상에만 있음) 폴더 샘플. 경로 오름차순으로 최대 limit개 (전체 범위만) |
| `deleteSamples` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | deleteSamples(result: itfCompareResult, limit = 20) - 삭제 예정(대상에만 있음) 파일 샘플. 비교 결과 순서(경로 오름차순)로 최대 limit개 |
| `dryRunHeadline` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | dryRunHeadline(s: itfDryRunSummary) - dry-run 요약 한 줄. 예: "실행하면 대상에 3개 복사(24 B), 1개 수정시간만 맞춤, 2개 삭제" |
| `etaText` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | etaText(stats: typRunStats \| null, live: boolean) - 남은 시간 칸 문구(INT-004 FR-10). 진행 중일 때만 "계산 중"·계산값을 보여 준다 |
| `progressPercent` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | progressPercent(stats: typRunStats \| null) - 진행률(0~100). 바이트 기준, 바이트를 모르면 파일 수 기준. 계산할 수 없으면 null |
| `realRunConfirmText` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | realRunConfirmText(...) - 실제 실행 확인 문구(비교 결과 기준). 예: "대상에 3개 복사, 1개 덮어씀 (총 1.2 MB)". 전체 범위면 "빈 폴더 N개 생성", sync면 "폴더 N개 삭제"도 붙인다. |
| `runStatusText` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | runStatusText(status: typRunStatus, dryRun: boolean, mode: typRunMode) - 상태 문구. 예: 미리보기 완료, 복사 완료, 복사 중지됨 |
| `isSettingsEqual` | [`src/lib/settings-form.ts`](../../src/lib/settings-form.ts) | isSettingsEqual(a: typSettings, b: typSettings) - 공통 함수/유틸리티 |
| `settingsToPatch` | [`src/lib/settings-form.ts`](../../src/lib/settings-form.ts) | settingsToPatch(s: typSettings) - 화면에 노출된 섹션만 patch로 (defaults, compare, safety, logs, ui). scheduler(일시정지)는 넣지 않는다: settings:update가 거부하며 scheduler:setPaused로만 바꾼다. |
| `validateSettingsDraft` | [`src/lib/settings-form.ts`](../../src/lib/settings-form.ts) | validateSettingsDraft(s: typSettings) - 공통 함수/유틸리티 |
| `emptyDirQueryRoot` | [`src/lib/use-empty-dir-support.ts`](../../src/lib/use-empty-dir-support.ts) | emptyDirQueryRoot(destination: string) - 조회 키: 해석되는 remote 경로면 remote 루트("name:"), 아니면 null(로컬·UNC·입력 중). 순수 |
| `computeRowWindow` | [`src/lib/virtual-rows.ts`](../../src/lib/virtual-rows.ts) | computeRowWindow(...) - 공통 함수/유틸리티 |
| `fail` | [`src/main/lib/app-error.ts`](../../src/main/lib/app-error.ts) | fail(e: unknown) - 공통 함수/유틸리티 |
| `ok` | [`src/main/lib/app-error.ts`](../../src/main/lib/app-error.ts) | ok<T>(data: T) - 공통 함수/유틸리티 |
| `toErrorPayload` | [`src/main/lib/app-error.ts`](../../src/main/lib/app-error.ts) | toErrorPayload(e: unknown) - 공통 함수/유틸리티 |
| `redactSecrets` | [`src/main/lib/logger.ts`](../../src/main/lib/logger.ts) | redactSecrets(text: string) - 공통 함수/유틸리티 |
| `collectSecretValues` | [`src/main/lib/secret-redact.ts`](../../src/main/lib/secret-redact.ts) | collectSecretValues(...maps: ReadonlyArray<Record<string, string>>) - 값을 모아 가림 목록을 만든다(빈 값 제외) |
| `redactSecrets` | [`src/main/lib/secret-redact.ts`](../../src/main/lib/secret-redact.ts) | redactSecrets(text: string, secrets: readonly string[]) - text에서 비밀 값을 `***`로 바꾼다 |
| `redactedStderrTail` | [`src/main/lib/secret-redact.ts`](../../src/main/lib/secret-redact.ts) | redactedStderrTail(...) - 오류 detail·안내 문구에 쓸 stderr 요약. 비밀 값을 지운 뒤 끝부분만 남긴다 |
| `fileStamp` | [`src/main/lib/time.ts`](../../src/main/lib/time.ts) | fileStamp(d = new Date() - 파일 이름용 시각. 예: 20261028-173500 (로컬 시각) |
| `nowIso` | [`src/main/lib/time.ts`](../../src/main/lib/time.ts) | nowIso() - 공통 함수/유틸리티 |
| `busyMessageFor` | [`src/main/services/activity-lock.ts`](../../src/main/services/activity-lock.ts) | busyMessageFor(...) - BUSY 안내 문구. 작업 이름을 찾지 못하면 "다른 작업을"으로 쓴다. 예: "‘백업’ 작업을 실행하는 중입니다. 끝나거나 취소한 뒤 다시 시도하세요." |
| `buildBackupSubdir` | [`src/main/services/backup-dir.ts`](../../src/main/services/backup-dir.ts) | buildBackupSubdir(at: Date, jobId: string) - 실행별 하위 폴더 이름. 예: 2026-11-02_103000_1a2b3c4d |
| `nextBackupTime` | [`src/main/services/backup-dir.ts`](../../src/main/services/backup-dir.ts) | nextBackupTime(now: Date, last: Date \| null) - 이번 실행의 백업 시각. last(같은 프로세스에서 마지막으로 쓴 시각)가 없거나 now가 초 단위로 더 늦으면 now, 아니면(같은 초·시계가 뒤로 감) last + 1초. 초 아래는 버린다. |
| `checkDestProbe` | [`src/main/services/compare-service.ts`](../../src/main/services/compare-service.ts) | checkDestProbe(p: itfParsedPath, probe: itfPathProbe) - 대상 폴더 확인 결과 판정. 대상이 없으면 true(빈 목록으로 비교). 접근할 수 없거나 파일이면 막는다 |
| `checkSourceProbe` | [`src/main/services/compare-service.ts`](../../src/main/services/compare-service.ts) | checkSourceProbe(p: itfParsedPath, probe: itfPathProbe) - 원본 폴더 확인 결과 판정(비교·OS 예약 경로 사전 확인 공용). 읽을 수 없거나 없거나 폴더가 아니면 던진다. 로컬·UNC는 폴더를 열어 본 경우만 통과(시간 초과·확인 대기 중이면 막는다). |
| `resolveEffectiveExcludes` | [`src/main/services/effective-excludes.ts`](../../src/main/services/effective-excludes.ts) | resolveEffectiveExcludes(...) - 공통 함수/유틸리티 |
| `cleanupExcludeFiles` | [`src/main/services/exclude-file.ts`](../../src/main/services/exclude-file.ts) | cleanupExcludeFiles(dir: string) - 시작 때 남은 제외 파일(excl-*.txt)만 지운다. 지운 수 |
| `isExcludeFileName` | [`src/main/services/exclude-file.ts`](../../src/main/services/exclude-file.ts) | isExcludeFileName(name: string) - 앱이 만든 제외 파일 이름인지(테스트·로그 확인용) |
| `writeExcludeFile` | [`src/main/services/exclude-file.ts`](../../src/main/services/exclude-file.ts) | writeExcludeFile(...) - 제외 파일을 만들고 확인한다. 실패하면 지우고 STORE_ERROR |
| `assertBackupMovable` | [`src/main/services/job-context.ts`](../../src/main/services/job-context.ts) | assertBackupMovable(...) - 백업 폴더를 쓸 수 있는 저장소인지(INT-003 FR-36). 백업 폴더가 없으면 통과. 로컬·UNC는 checkBackupDir(같은 드라이브·공유)로 충분해 조회하지 않는다. |
| `remoteNameOf` | [`src/main/services/job-context.ts`](../../src/main/services/job-context.ts) | remoteNameOf(p: itfParsedPath) - remote 경로면 remote 이름("gdrive"), 아니면 null (오류 안내 문구용) |
| `remoteNamesOfJob` | [`src/main/services/job-context.ts`](../../src/main/services/job-context.ts) | remoteNamesOfJob(job: Pick<typJob, "source" \| "destination">) - 작업의 원본·대상이 쓰는 remote 이름(중복 제거). 로컬·UNC만 쓰면 빈 배열 |
| `resolveJobContext` | [`src/main/services/job-context.ts`](../../src/main/services/job-context.ts) | resolveJobContext(...) - 작업의 경로·rclone·설정 파일을 확인해 실행 문맥을 만든다. 실패: 경로 오류(PATH_INVALID·SAFETY_BLOCKED 등), RCLONE_*, CONFIG_REQUIRED. |
| `deleteRunLogs` | [`src/main/services/log-retention.ts`](../../src/main/services/log-retention.ts) | deleteRunLogs(...) - 이름이 맞는 실행 로그만 지운다. 지운 개수 |
| `pruneRunLogs` | [`src/main/services/log-retention.ts`](../../src/main/services/log-retention.ts) | pruneRunLogs(...) - 보관 일수가 지난 실행 로그를 지운다. 지운 개수를 돌려준다(폴더가 없거나 지우지 못한 파일은 건너뜀). |
| `readRunLogTail` | [`src/main/services/log-retention.ts`](../../src/main/services/log-retention.ts) | readRunLogTail(...) - 실행 로그 끝부분을 읽는다. 이름이 잘못되면 VALIDATION 대신 빈 결과(exists:false)를 돌려준다 (이력 레코드에서 온 이름만 넘어오므로 정상 경로에서는 일어나지 않는다). |
| `runLogPath` | [`src/main/services/log-retention.ts`](../../src/main/services/log-retention.ts) | runLogPath(logsDir: string, fileName: string) - logs 폴더 안의 실행 로그 경로. 이름이 실행 로그 모양이 아니거나 폴더 밖이면 null |
| `checkOsRunEntry` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | checkOsRunEntry(job: typJob \| null, paused: boolean) - FR-12 진입 검사: 작업 있음 → 켜짐 → 예약 방식 os → 일시정지 아님 |
| `entryBlockError` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | entryBlockError(reason: typOsRunBlockReason) - 차단 이유 → 이력 오류(SCHEDULE_SKIPPED, 문구에 경로 없음) |
| `exitCodeForStatus` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | exitCodeForStatus(status: typRunStatus) - FR-17: success·noop 0, failed·partial·canceled 1(running·interrupted도 1), blocked 2 |
| `headlessExitDecision` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | headlessExitDecision(...) - 헤드리스 종료를 이어갈지(index.ts f_HeadlessExit가 대기 전후에 본다). 헤드리스가 아니거나(GUI로 바뀜) 이미 종료 중이면 stay. 대기열이 비지 않았으면(대기 중 새 요청) stay — |
| `isRetryablePathError` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | isRetryablePathError(code: typErrorCode) - 재시도할 경로 오류: PATH_NOT_FOUND(없음·시간 초과·권한 대기)·RCLONE_FAILED(네트워크). 형식·설정·rclone 없음은 아님 |
| `precheckJobPaths` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | precheckJobPaths(...) - 전송 전 경로 접근 확인: checkRunPaths(형식) → 원본·대상 probe → 비교와 같은 판정(checkSourceProbe/checkDestProbe) |
| `buildTaskXml` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | buildTaskXml(i: itfTaskXmlInput) - 작업 XML(UTF-16으로 저장한다). 비밀번호·UserId·RestartOnFailure 없음, 인자는 `--run-job <id>`뿐 |
| `decodeSchtasksOutput` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | decodeSchtasksOutput(buf: Uint8Array) - schtasks 출력 해독. UTF-16이 아니고 비ASCII 바이트가 있으면 reliable false — 코드페이지(CP949) 바이트가 우연히 올바른 UTF-8로 읽힐 수 있어 UTF-8 판정도 믿지 않는다(notes #1). |
| `desiredTasks` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | desiredTasks(jobs: readonly typJob[], execPath: string) - OS 예약을 원하는 작업: 켜짐 + 예약 방식 os → jobId(소문자) → spec 해시 |
| `formatTaskDateTime` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | formatTaskDateTime(d: Date) - 로컬 "YYYY-MM-DDTHH:mm:ss"(오프셋 없음 = 작업 스케줄러가 로컬로 해석) |
| `osSchedulerAvailability` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | osSchedulerAvailability(...) - OS 예약을 쓸 수 있는지(순수). 설치본 + Windows + E2E 아님 + 임시 프로필이 아니어야 한다. 임시 프로필(RCLONEGUI_USER_DATA)에서 reconcile하면 사용자의 실제 예약을 고아로 지울 수 있고, |
| `parseTaskNames` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | parseTaskNames(text: string) - `/Query /FO CSV /NH` 출력에서 줄 첫 필드가 `"\rcloneGUI\<uuid>"`인 jobId만(소문자, 중복 제거, 순서 유지) |
| `parseTaskXml` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | parseTaskXml(text: string) - `/Query /TN … /XML` 출력에서 Command·Arguments·spec 해시. 없으면 null |
| `planReconcile` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | planReconcile(...) - 앱 시작 때 맞출 등록·삭제(FR-10). - 원하지 않는데 있는 작업 → 삭제(skip에 있어도 지운다: 실행 중 인스턴스는 끝나지 않는다, notes #8) |
| `registerFailText` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | registerFailText(code: number \| null) - 화면에 보일 등록 실패 문구(경로 없음) |
| `schtasksPath` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | schtasksPath() - schtasks.exe 절대 경로(killProcessTree와 같은 방식) |
| `taskNameOf` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | taskNameOf(jobId: string) - 작업 이름 `\rcloneGUI\<id>`. id가 uuid가 아니면 VALIDATION(인자에 다른 문자열이 들어가지 않도록) |
| `taskSpecHash` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | taskSpecHash(exePath: string, jobId: string, spec: typTaskSpec) - 등록 스펙 해시(sha256 앞 16hex). XML 틀 버전·exe(대소문자 무시)·jobId·종류에 따라 쓰는 예약 값만 |
| `unregisterFailText` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | unregisterFailText(code: number \| null) - 공통 함수/유틸리티 |
| `weekdaysXml` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | weekdaysXml(mask: number) - 요일 마스크(bit0 = 일요일, schedule.ts와 같음) → `<Sunday /><Monday />…` |
| `xmlEscape` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | xmlEscape(text: string) - 공통 함수/유틸리티 |
| `computePlanToken` | [`src/main/services/plan-token.ts`](../../src/main/services/plan-token.ts) | computePlanToken(input: itfPlanTokenInput) - sha256(고정 순서 배열의 JSON) hex 앞 32자 |
| `autoSyncCount` | [`src/main/services/remote-config-service.ts`](../../src/main/services/remote-config-service.ts) | autoSyncCount(usage: itfRemoteUsage) - 삭제 확인 창의 버튼 문구에 쓰는 수 |
| `mergeRemoteParameters` | [`src/main/services/remote-config-service.ts`](../../src/main/services/remote-config-service.ts) | mergeRemoteParameters(...) - providers 정의에 맞춰 값·비밀을 합치고 모양을 검사한다. 문제가 있으면 VALIDATION |
| `etaTotals` | [`src/main/services/run-eta.ts`](../../src/main/services/run-eta.ts) | etaTotals(...) - FR-2: 계획과 rclone stats로 분모를 정한다. - 계획이 있으면 처음부터 확정으로 본다(비교와 실행 사이에 늘어난 값은 max로 따라간다). |
| `nextEta` | [`src/main/services/run-eta.ts`](../../src/main/services/run-eta.ts) | nextEta(...) - FR-1~FR-8: 이번 stats와 이전 평활 상태로 다음 상태·표시값을 낸다. - `prev`가 null이면 이번 stats가 단계의 첫 줄이다(FR-9: 단계마다 새 상태). |
| `rawEtaSeconds` | [`src/main/services/run-eta.ts`](../../src/main/services/run-eta.ts) | rawEtaSeconds(stats: typRunStats, totals: itfEtaTotals) - FR-3~FR-5, FR-7, FR-8: 원시 남은 시간(초). - 전체 파일·바이트가 모두 0이면 바꿀 것이 없으므로 null(화면 "-", FR-8). |
| `maskArgsForLog` | [`src/main/services/run-log-file.ts`](../../src/main/services/run-log-file.ts) | maskArgsForLog(...) - 로그 머리말용 인자. "--" 뒤의 원본·대상과 --config·--filter-from·--backup-dir 값을 가린다. 제외 패턴은 명령 인자에 없으므로 로그에 남지 않는다. 옵션 값은 그대로 둔다. |
| `runLogFileName` | [`src/main/services/run-log-file.ts`](../../src/main/services/run-log-file.ts) | runLogFileName(at: Date, jobId: string, runId: string) - 실행 로그 파일 이름. 예: run-20261028-173500-1a2b3c4d-5e6f7a8b.log |
| `recoverActiveRun` | [`src/main/services/run-recovery.ts`](../../src/main/services/run-recovery.ts) | recoverActiveRun(deps: itfRecoverDeps) - 앱 시작 때 한 번. 결과와 관계없이 active-run.json은 지운다(이력은 markInterrupted가 정리) |
| `autoOutcomeNotice` | [`src/main/services/scheduler.ts`](../../src/main/services/scheduler.ts) | autoOutcomeNotice(o: itfAutoOutcome) - 자동 실행 결과 알림 문구(작업 이름·수만). noop이면 null |
| `createDefaultSettings` | [`src/shared/defaults.ts`](../../src/shared/defaults.ts) | createDefaultSettings() - 공통 함수/유틸리티 |
| `createJobDraft` | [`src/shared/defaults.ts`](../../src/shared/defaults.ts) | createJobDraft(settings: typSettings) - 설정의 기본 옵션으로 빈 Job 초안을 만든다. 화면의 "새 작업"에서 쓴다. |
| `diffFileLists` | [`src/shared/diff-engine.ts`](../../src/shared/diff-engine.ts) | diffFileLists(...) - dirs가 null이면 파일만 범위(폴더 수 0, dirChanges []). dirs가 있으면 원본 폴더가 대상 파일(또는 그 반대)과 겹치는 곳을 충돌로 더하고, |
| `emptySummary` | [`src/shared/diff-engine.ts`](../../src/shared/diff-engine.ts) | emptySummary() - 공통 함수/유틸리티 |
| `buildFilterFileContent` | [`src/shared/exclude-patterns.ts`](../../src/shared/exclude-patterns.ts) | buildFilterFileContent(patterns: readonly string[]) - 적용 순서 패턴 → 필터 파일 내용(LF, 마지막 LF). 패턴이 없으면 null (INT-007 FR-1·2) |
| `excludesSaveIssue` | [`src/shared/exclude-patterns.ts`](../../src/shared/exclude-patterns.ts) | excludesSaveIssue(jobOnly: readonly string[], libraryCount: number) - 작업 저장 전 제외 패턴 합계 검사. 문제가 없으면 null (공용 + 작업 전용 > EXCLUDES_TOTAL_MAX) |
| `libraryPatternIssue` | [`src/shared/exclude-patterns.ts`](../../src/shared/exclude-patterns.ts) | libraryPatternIssue(p: string) - 공용 라이브러리 패턴 오류 문구. 문제가 없으면 null |
| `mergeExcludePatterns` | [`src/shared/exclude-patterns.ts`](../../src/shared/exclude-patterns.ts) | mergeExcludePatterns(...) - 적용할 패턴 목록: 공용(코드포인트 오름차순) 뒤에 작업 전용(입력 순서). 완전히 같은 패턴은 처음 것만 남긴다. |
| `normalizeExcludePattern` | [`src/shared/exclude-patterns.ts`](../../src/shared/exclude-patterns.ts) | normalizeExcludePattern(raw: string) - 입력 정규화: 앞뒤 공백만 지운다(NFC 변환 없음) |
| `toFilterExcludeLine` | [`src/shared/exclude-patterns.ts`](../../src/shared/exclude-patterns.ts) | toFilterExcludeLine(pattern: string) - 패턴 하나를 --filter-from 제외 줄로 바꾼다: "- " + 끝 공백 문자 → "[c]" (INT-007 FR-3). 끝 공백 직전의 연속 역슬래시가 홀수면 그 역슬래시 하나를 지운다(사용자가 쓴 "\ " 이스케이프). |
| `classifyAbnormalExit` | [`src/shared/exit-code.ts`](../../src/shared/exit-code.ts) | classifyAbnormalExit(code: number \| null) - 외부 종료 집합 → "killed", 0xC0000000 이상(0xC000013A 제외) → "crash", 그 밖 → null. 0~10·0xC000013A·null은 null이다. |
| `formatExitCode` | [`src/shared/exit-code.ts`](../../src/shared/exit-code.ts) | formatExitCode(code: number \| null) - 화면용: "3", "-1 (0xFFFFFFFF)", "-1073741819 (0xC0000005 STATUS_ACCESS_VIOLATION)" (FR-2) |
| `formatExitCodeForLog` | [`src/shared/exit-code.ts`](../../src/shared/exit-code.ts) | formatExitCodeForLog(code: number \| null) - 로그용: "3", "-1(0xFFFFFFFF)", null → "-" (FR-11, 공백 없음) |
| `toInt32ExitCode` | [`src/shared/exit-code.ts`](../../src/shared/exit-code.ts) | toInt32ExitCode(code: number \| null) - 정수면 int32로, null·정수가 아니면 null (FR-1, ToInt32) |
| `formatBytes` | [`src/shared/format.ts`](../../src/shared/format.ts) | formatBytes(bytes: number) - 1024 단위. 예: 1536 → "1.5 KB" |
| `formatDuration` | [`src/shared/format.ts`](../../src/shared/format.ts) | formatDuration(ms: number) - 예: 3_723_000 → "1시간 2분 3초", 450 → "0.5초" |
| `formatLocalDateTime` | [`src/shared/format.ts`](../../src/shared/format.ts) | formatLocalDateTime(iso: string \| null) - UTC ISO 문자열을 로컬 시각 "YYYY-MM-DD HH:mm:ss"로. 잘못된 값이면 "-" |
| `formatModTime` | [`src/shared/format.ts`](../../src/shared/format.ts) | formatModTime(ms: number \| null) - 파일 수정시간(ms)을 로컬 "YYYY-MM-DD HH:mm:ss"로. 모르면(null·잘못된 값) "—" |
| `formatPercent` | [`src/shared/format.ts`](../../src/shared/format.ts) | formatPercent(part: number, total: number) - 예: (1, 3) → "33%". total이 0이면 "-" |
| `createLatestGate` | [`src/shared/latest-request.ts`](../../src/shared/latest-request.ts) | createLatestGate() - 공통 함수/유틸리티 |
| `isRclonePartial` | [`src/shared/partial-files.ts`](../../src/shared/partial-files.ts) | isRclonePartial(path: string) - 상대 경로의 마지막 요소가 rclone 임시 파일 이름인지 (`report.partial` 같은 사용자 파일은 아님) |
| `mayLeavePartial` | [`src/shared/partial-files.ts`](../../src/shared/partial-files.ts) | mayLeavePartial(rec: typPartialCheckInput) - 실제 실행이 전송 단계에서 멈춰(취소·실패·비정상 종료) 대상에 `.partial`이 남을 수 있는지. dry-run·사전 확인 단계에서 멈춤·rclone 시작 전 실패(transferStarted가 true가 아님)·성공은 false. |
| `canonicalLocation` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | canonicalLocation(...) - 같은 위치를 가리키는 다른 표기를 하나로 모은다. - UNC host `wsl$` → `wsl.localhost` |
| `checkBackupDir` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | checkBackupDir(...) - 백업 폴더 검사(INT-003 FR-24, E-8·E-9). 통과하면 null. 문구는 "백업 폴더: …". 순서: 형식 → 루트 금지 → 드라이브 상대(`x:folder`) → 대상과 같은 위치(같은 드라이브·UNC 공유·remote, |
| `checkPathPair` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | checkPathPair(...) - 원본·대상 한 쌍의 형식·안전 규칙(S1~S4a)을 검사한다. 로컬·UNC는 Windows 규칙에 따라 항상 대소문자를 무시하고, |
| `checkRunPaths` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | checkRunPaths(...) - 비교·실행 시작 전 검사. checkPathPair(S1~S4a)에 더해 드라이브 상대 경로(`x:folder`, `C:foo`)를 거부한다. Windows의 rclone은 이 형태를 드라이브의 현재 폴더 기준 경로로 해석해 위치가 정해지지 않는다. |
| `isRemoteAbsolute` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | isRemoteAbsolute(p: itfParsedPath) - remote 경로가 맨 앞 / 로 시작하는지(절대 경로). local·UNC는 false |
| `joinBackupPath` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | joinBackupPath(base: itfParsedPath, subdir: string) - 백업 기준 경로 + 실행별 하위 폴더 이름 → rclone에 넘길 경로. 로컬·UNC는 "\\", remote는 "/" |
| `linuxPathToWslUnc` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | linuxPathToWslUnc(distro: string, linuxPath: string) - WSL 리눅스 절대 경로를 UNC로 바꾼다. 예: ("Distro", "/home/a") → \\wsl.localhost\Distro\home\a |
| `mntPathToWindows` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | mntPathToWindows(linuxPath: string) - `/mnt/<drive>/...` 를 Windows 경로로 바꾼다. 해당하지 않으면 null |
| `parsePath` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | parsePath(raw: string) - 경로 원문을 분류하고 정규화한다. 지원하지 않는 형태는 이유와 함께 거부한다. |
| `pathKey` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | pathKey(p: itfParsedPath, caseInsensitive: boolean) - 비교·중복 검사용 키 |
| `remoteParentOf` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | remoteParentOf(p: itfParsedPath) - remote 경로의 부모와 이름. 맨 앞 / 는 보존한다. "rr:a/b" → { parent: "rr:a", name: "b" }, "rr:/a" → { parent: "rr:/", name: "a" }, "rr:" → null |
| `driveLetterRemoteWarning` | [`src/shared/remote-name.ts`](../../src/shared/remote-name.ts) | driveLetterRemoteWarning(names: readonly string[]) - 경고 문구. 빈 배열이면 null |
| `findDriveLetterRemotes` | [`src/shared/remote-name.ts`](../../src/shared/remote-name.ts) | findDriveLetterRemotes(remotes: readonly string[]) - 목록 중 한 글자 이름만 원래 순서대로 |
| `isDriveLetterRemoteName` | [`src/shared/remote-name.ts`](../../src/shared/remote-name.ts) | isDriveLetterRemoteName(name: string) - Windows에서 rclone이 드라이브 문자로 해석하는 remote 이름(영문 한 글자)인지 |
| `looksLikeDriveLetterRemotePath` | [`src/shared/remote-name.ts`](../../src/shared/remote-name.ts) | looksLikeDriveLetterRemotePath(raw: string) - 입력 경로가 "x:..." (한 글자 + ":" 뒤가 \ 또는 / 가 아님) 형태인지. parsePath는 remote로 분류하지만 Windows의 rclone은 드라이브로 해석한다. |
| `validateNewRemoteName` | [`src/shared/remote-name.ts`](../../src/shared/remote-name.ts) | validateNewRemoteName(...) - 앱에서 새로 만드는 remote 이름을 검사한다(INT-006 FR-5). 문제가 없으면 null, 있으면 이유. - 두 글자 이상(Windows 드라이브 문자와 겹치지 않게) |
| `composeRemotePath` | [`src/shared/remote-path.ts`](../../src/shared/remote-path.ts) | composeRemotePath(remoteName: string, basePath: string) - "name:" + 기준 경로. 기준 경로는 normalizeRemoteBasePath 결과를 쓴다 |
| `isRemoteSegmentName` | [`src/shared/remote-path.ts`](../../src/shared/remote-path.ts) | isRemoteSegmentName(name: string) - 폴더 목록에서 받은 이름 하나를 경로 조각으로 쓸 수 있는지 |
| `joinRemotePath` | [`src/shared/remote-path.ts`](../../src/shared/remote-path.ts) | joinRemotePath(remoteName: string, basePath: string, segment: string) - 기준 경로 아래에 폴더 이름 하나를 덧붙인다. 이름은 isRemoteSegmentName을 통과해야 한다 |
| `normalizeRemoteBasePath` | [`src/shared/remote-path.ts`](../../src/shared/remote-path.ts) | normalizeRemoteBasePath(remoteName: string, raw: string) - remote 기준 경로를 정규화한다. "name:" 뒤의 경로만 돌려준다(선두 "/"는 보존). 빈 값은 remote 루트("")다. "."·".."·제어문자·잘못된 remote 이름은 거부한다. |
| `checkPlanSafety` | [`src/shared/run-gates.ts`](../../src/shared/run-gates.ts) | checkPlanSafety(plan: typRunPlan, job: typGateJob) - 확인으로 넘길 수 없는 차단. 통과하면 null. 순서: S5 → S6 → S7 → S15 |
| `isLargeDelete` | [`src/shared/run-gates.ts`](../../src/shared/run-gates.ts) | isLargeDelete(...) - 대량 삭제인지(S11). deleteFiles > 기준 개수 또는 대상 파일 수 대비 비율 > 기준 %. 대상 파일이 0개인데 삭제가 있으면(있을 수 없는 계획) 대량으로 본다. |
| `needsPreflight` | [`src/shared/run-gates.ts`](../../src/shared/run-gates.ts) | needsPreflight(...) - 실제 sync 직전에 사전 확인 dry-run을 할지: sync + 삭제(파일 또는 폴더) 있음 + 작업 옵션 켜짐 |
| `checkPreflight` | [`src/shared/run-plan.ts`](../../src/shared/run-plan.ts) | checkPreflight(...) - 실제 sync 직전 사전 확인(dry-run)이 계획과 같은지 (MVP_SPEC §8.4, S14). matchPlanWithDryRun + stats.deletes == 계획 삭제 수 + stats.errors == 0. stats가 없으면 불일치로 본다. |
| `expectedDeleteDirs` | [`src/shared/run-plan.ts`](../../src/shared/run-plan.ts) | expectedDeleteDirs(summary: itfCompareSummary, mode: typRunMode) - 실행하면 대상에서 지울 폴더 수 (전체 범위 sync만, 확인한 수와 맞춰 본다) |
| `expectedDeletes` | [`src/shared/run-plan.ts`](../../src/shared/run-plan.ts) | expectedDeletes(summary: itfCompareSummary, mode: typRunMode) - 실행하면 대상에서 지울 파일 수 (실제 실행 전 확인한 수와 맞춰 본다) |
| `hasPlannedChanges` | [`src/shared/run-plan.ts`](../../src/shared/run-plan.ts) | hasPlannedChanges(...) - 실행하면 바뀌는 것이 있는지(자동 noop·수동 "바꿀 것 없음" 판정, INT-003 FR-33). 대상이 빈 폴더를 만들 수 없으면(false) 폴더 생성은 세지 않는다(실행해도 생기지 않아 매번 남음). |
| `matchPlanWithDryRun` | [`src/shared/run-plan.ts`](../../src/shared/run-plan.ts) | matchPlanWithDryRun(plan: typRunPlan, dry: itfDryRunSummary) - 계획(비교)과 dry-run 결과가 같은 일을 하는지 |
| `planFromCompare` | [`src/shared/run-plan.ts`](../../src/shared/run-plan.ts) | planFromCompare(summary: itfCompareSummary, mode: typRunMode) - 비교 요약으로 실행 계획을 만든다. copy는 삭제 0 |
| `plannedDeleteCount` | [`src/shared/run-plan.ts`](../../src/shared/run-plan.ts) | plannedDeleteCount(plan: Pick<typRunPlan, "deleteFiles" \| "deleteDirs">) - 지울 파일 + 폴더 수(삭제가 있는지·자동 삭제 한도 판단용) |
| `addMinutes` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | addMinutes(at: Date, minutes: number) - 공통 함수/유틸리티 |
| `addMs` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | addMs(at: Date, ms: number) - 공통 함수/유틸리티 |
| `isAppScheduled` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | isAppScheduled(a: Pick<typAutoSyncOptions, "enabled" \| "backend">) - 앱 안 스케줄러가 돌릴 작업인지(켜짐 + 예약 방식 app). OS 예약 작업은 nextRunAt을 두지 않는다 |
| `isSameSchedule` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | isSameSchedule(a: typScheduleSpec, b: typScheduleSpec) - 다음 예약을 정하는 값이 같은지(종류에 따라 쓰는 값만 비교) |
| `nextAfterFinish` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | nextAfterFinish(...) - 자동 실행이 끝난 뒤의 다음 예약: interval은 끝난 시각 + 주기, daily·weekly는 끝난 뒤 다음 정시. daily·weekly가 성공했으면 끝난 뒤 NEAR_SLOT_SKIP_MS 안의 정시는 건너뛴다. 실패·차단·중지면 바로 다음 정시를 재시도 기회로 남긴다. |
| `nextAutoRun` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | nextAutoRun(jobs: readonly itfScheduleJob[]) - 다음 자동 실행(켜진 작업 중 가장 이른 예약). 없으면 null |
| `nextLocalTimeOfDay` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | nextLocalTimeOfDay(from: Date, hhmm: string, weekdays: number) - from보다 엄격히 뒤인 첫 로컬 HH:MM(weekdays bit가 켜진 요일만). 요일이 없거나 시각이 틀리면 null. 로컬 생성자로 날짜마다 만들어 DST에도 벽시계 시각을 지킨다(최대 8일 탐색). |
| `nextOccurrence` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | nextOccurrence(spec: typScheduleSpec, from: Date) - from 다음의 예약 시각. 결과는 항상 from보다 뒤다(계산이 안 되면 from + 24시간으로 방어) |
| `nextRunAfterEdit` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | nextRunAfterEdit(...) - 작업을 만들거나 고친 뒤의 nextRunAt. prev가 null이면 새 작업·복제. |
| `parseTimeOfDay` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | parseTimeOfDay(hhmm: string) - "HH:MM"을 시·분으로. 형식이 틀리면 null |
| `pickDue` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | pickDue<T extends itfScheduleJob>(jobs: readonly T[], now: Date) - 지금 실행할 작업: 켜져 있고 예약 시각이 지난 것 중 가장 이른 1건. 없으면 null |
| `quitScheduleWarning` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | quitScheduleWarning(...) - 트레이에서 종료할 때 띄울 경고. 일시정지했거나 예약이 없으면 null. formatAt은 표시용 시각 문자열을 만든다(호출하는 쪽이 로컬 형식을 정한다). |
| `reconcileNextRun` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | reconcileNextRun(...) - 앱 시작·절전 재개 때 맞출 nextRunAt. 켜졌는데 없거나 지났으면 now + delayMs, 꺼졌거나 OS 예약이면 null. 미래 예약: interval은 그대로, daily·weekly는 delayMs 이내면 그대로, 더 멀면 지금 기준 다음 정시. |
| `rescheduleOnUnpause` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | rescheduleOnUnpause(auto: typAutoSyncState, now: Date) - 일시정지 해제: 지난 예약만 now + 30초. 없거나 미래면 그대로 |
| `scheduleText` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | scheduleText(spec: typScheduleSpec) - 예약 표시: "30분마다", "2시간마다", "매일 09:00", "매주 월·수 09:00", "평일 09:00" |
| `weekdaysText` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | weekdaysText(mask: number) - 요일 마스크 표시: "매일", "평일", "주말", 그 밖에는 "월·수"(월요일부터) |

## 4. Shared Services & Clients

| 클래스 / 서비스 | 정의 파일 | 설명 / 주요 메서드 |
| :--- | :--- | :--- |
| `clsApiError` | [`src/lib/api.ts`](../../src/lib/api.ts) | class clsApiError - 공유 서비스/클라이언트 클래스 |
| `clsAppError` | [`src/main/lib/app-error.ts`](../../src/main/lib/app-error.ts) | class clsAppError - 공유 서비스/클라이언트 클래스 |
| `clsLogger` | [`src/main/lib/logger.ts`](../../src/main/lib/logger.ts) | class clsLogger - 공유 서비스/클라이언트 클래스 |
| `clsMutex` | [`src/main/lib/mutex.ts`](../../src/main/lib/mutex.ts) | class clsMutex - 공유 서비스/클라이언트 클래스 |
| `clsActivityLock` | [`src/main/services/activity-lock.ts`](../../src/main/services/activity-lock.ts) | class clsActivityLock - 공유 서비스/클라이언트 클래스 |
| `clsCompareService` | [`src/main/services/compare-service.ts`](../../src/main/services/compare-service.ts) | class clsCompareService - 공유 서비스/클라이언트 클래스 |
| `clsExcludeService` | [`src/main/services/exclude-service.ts`](../../src/main/services/exclude-service.ts) | class clsExcludeService - 공유 서비스/클라이언트 클래스 |
| `clsOsRunQueue` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | class clsOsRunQueue - 메인 클래스 |
| `clsOsScheduler` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | class clsOsScheduler - OS 예약 등록 수명주기. 모든 schtasks 호출은 내부 큐로 직렬화한다. available이 false면 schtasks를 한 번도 부르지 않는다. |
| `clsFsGate` | [`src/main/services/path-service.ts`](../../src/main/services/path-service.ts) | class clsFsGate - 응답 없는 fs 호출 제한. 시간 제한은 기다림만 끊고 fs.stat/opendir은 libuv 스레드풀(기본 4)에 남는다. 응답 없는 UNC·WSL 경로를 |
| `clsPathService` | [`src/main/services/path-service.ts`](../../src/main/services/path-service.ts) | class clsPathService - 공유 서비스/클라이언트 클래스 |
| `clsRemoteAuthSession` | [`src/main/services/remote-auth-session.ts`](../../src/main/services/remote-auth-session.ts) | class clsRemoteAuthSession - 공유 서비스/클라이언트 클래스 |
| `clsRemoteConfigService` | [`src/main/services/remote-config-service.ts`](../../src/main/services/remote-config-service.ts) | class clsRemoteConfigService - 공유 서비스/클라이언트 클래스 |
| `clsRemoteOps` | [`src/main/services/remote-ops.ts`](../../src/main/services/remote-ops.ts) | class clsRemoteOps - 공유 서비스/클라이언트 클래스 |
| `clsRemoteService` | [`src/main/services/remote-service.ts`](../../src/main/services/remote-service.ts) | class clsRemoteService - 공유 서비스/클라이언트 클래스 |
| `clsRunEventBatcher` | [`src/main/services/run-events.ts`](../../src/main/services/run-events.ts) | class clsRunEventBatcher - 공유 서비스/클라이언트 클래스 |
| `clsRunLogFile` | [`src/main/services/run-log-file.ts`](../../src/main/services/run-log-file.ts) | class clsRunLogFile - 공유 서비스/클라이언트 클래스 |
| `clsActiveRunStore` | [`src/main/services/run-recovery.ts`](../../src/main/services/run-recovery.ts) | class clsActiveRunStore - 공유 서비스/클라이언트 클래스 |
| `clsRunService` | [`src/main/services/run-service.ts`](../../src/main/services/run-service.ts) | class clsRunService - 공유 서비스/클라이언트 클래스 |
| `clsScheduler` | [`src/main/services/scheduler.ts`](../../src/main/services/scheduler.ts) | class clsScheduler - 공유 서비스/클라이언트 클래스 |
| `clsWslService` | [`src/main/services/wsl.ts`](../../src/main/services/wsl.ts) | class clsWslService - 공유 서비스/클라이언트 클래스 |

## 5. Types & Interfaces

| 타입 / 인터페이스 | 정의 파일 | 정의 요약 |
| :--- | :--- | :--- |
| `itfZBCBadgeProps` | [`src/components/ZBCBadge.tsx`](../../src/components/ZBCBadge.tsx) | interface itfZBCBadgeProps - 인터페이스 정의 |
| `typZBCBadgeTone` | [`src/components/ZBCBadge.tsx`](../../src/components/ZBCBadge.tsx) | type typZBCBadgeTone - ========== Props & Types ========== |
| `itfZBCButtonProps` | [`src/components/ZBCButton.tsx`](../../src/components/ZBCButton.tsx) | interface itfZBCButtonProps - 인터페이스 정의 |
| `typZBCButtonVariant` | [`src/components/ZBCButton.tsx`](../../src/components/ZBCButton.tsx) | type typZBCButtonVariant - ========== Props & Types ========== |
| `itfZBCCheckboxProps` | [`src/components/ZBCCheckbox.tsx`](../../src/components/ZBCCheckbox.tsx) | interface itfZBCCheckboxProps - ========== Props & Types ========== |
| `itfZBCFieldProps` | [`src/components/ZBCField.tsx`](../../src/components/ZBCField.tsx) | interface itfZBCFieldProps - ========== Props & Types ========== |
| `itfZBCInputProps` | [`src/components/ZBCInput.tsx`](../../src/components/ZBCInput.tsx) | interface itfZBCInputProps - ========== Props & Types ========== |
| `itfZBCModalProps` | [`src/components/ZBCModal.tsx`](../../src/components/ZBCModal.tsx) | interface itfZBCModalProps - ========== Props & Types ========== |
| `itfZBCSelectOption` | [`src/components/ZBCSelect.tsx`](../../src/components/ZBCSelect.tsx) | interface itfZBCSelectOption - ========== Props & Types ========== |
| `itfZBCSelectProps` | [`src/components/ZBCSelect.tsx`](../../src/components/ZBCSelect.tsx) | interface itfZBCSelectProps - 인터페이스 정의 |
| `itfZBCTab` | [`src/components/ZBCTabs.tsx`](../../src/components/ZBCTabs.tsx) | interface itfZBCTab - ========== Props & Types ========== |
| `itfZBCTabsProps` | [`src/components/ZBCTabs.tsx`](../../src/components/ZBCTabs.tsx) | interface itfZBCTabsProps - 인터페이스 정의 |
| `itfZBCTextareaProps` | [`src/components/ZBCTextarea.tsx`](../../src/components/ZBCTextarea.tsx) | interface itfZBCTextareaProps - ========== Props & Types ========== |
| `itfZBCToastProps` | [`src/components/ZBCToast.tsx`](../../src/components/ZBCToast.tsx) | interface itfZBCToastProps - ========== Props & Types ========== |
| `itfCanStartCompareInput` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | interface itfCanStartCompareInput - 인터페이스 정의 |
| `itfCompareViewState` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | interface itfCompareViewState - 인터페이스 정의 |
| `itfSummaryCard` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | interface itfSummaryCard - 인터페이스 정의 |
| `typCompareFilterStatus` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | type typCompareFilterStatus - 타입 별칭 정의 |
| `typCompareSortKey` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | type typCompareSortKey - 타입 별칭 정의 |
| `typCompareTone` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | type typCompareTone - ZBCBadge의 tone과 같은 값 (컴포넌트 파일을 node 환경에 끌어오지 않으려고 따로 둔다) |
| `typSortDir` | [`src/lib/compare-view.ts`](../../src/lib/compare-view.ts) | type typSortDir - 타입 별칭 정의 |
| `typExcludeChangeKind` | [`src/lib/exclude-view.ts`](../../src/lib/exclude-view.ts) | type typExcludeChangeKind - 타입 별칭 정의 |
| `itfNumberRange` | [`src/lib/form-utils.ts`](../../src/lib/form-utils.ts) | interface itfNumberRange - 인터페이스 정의 |
| `itfHistoryFilter` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | interface itfHistoryFilter - 인터페이스 정의 |
| `typHistoryKind` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | type typHistoryKind - 타입 별칭 정의 |
| `typHistoryKindFilter` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | type typHistoryKindFilter - 타입 별칭 정의 |
| `typHistoryStatusFilter` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | type typHistoryStatusFilter - failed에는 일부 실패·중단됨도 들어간다 |
| `typHistoryTone` | [`src/lib/history-view.ts`](../../src/lib/history-view.ts) | type typHistoryTone - ZBCBadge tone과 같은 값 |
| `itfJobFormCheck` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | interface itfJobFormCheck - 인터페이스 정의 |
| `typIntervalUnit` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | type typIntervalUnit - 자동 실행 간격 입력 단위 |
| `typJobFormField` | [`src/lib/job-form.ts`](../../src/lib/job-form.ts) | type typJobFormField - 타입 별칭 정의 |
| `itfJobListItem` | [`src/lib/job-list-view.ts`](../../src/lib/job-list-view.ts) | interface itfJobListItem - 인터페이스 정의 |
| `itfPathKindBadge` | [`src/lib/path-display.ts`](../../src/lib/path-display.ts) | interface itfPathKindBadge - 인터페이스 정의 |
| `itfActivityStop` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | interface itfActivityStop - 작업 화면의 공통 중지 컨트롤(INT-002 T-08). 이 작업의 비교·미리보기·실행 중 하나만 멈춘다 |
| `itfCanStartRunInput` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | interface itfCanStartRunInput - 인터페이스 정의 |
| `itfDeleteConfirmInfo` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | interface itfDeleteConfirmInfo - 인터페이스 정의 |
| `itfDeleteSample` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | interface itfDeleteSample - 인터페이스 정의 |
| `typCheck` | [`src/lib/run-view.ts`](../../src/lib/run-view.ts) | type typCheck - 타입 별칭 정의 |
| `itfSettingsFormCheck` | [`src/lib/settings-form.ts`](../../src/lib/settings-form.ts) | interface itfSettingsFormCheck - 인터페이스 정의 |
| `typSettingsFormField` | [`src/lib/settings-form.ts`](../../src/lib/settings-form.ts) | type typSettingsFormField - 타입 별칭 정의 |
| `itfPathProbeState` | [`src/lib/use-path-probe.ts`](../../src/lib/use-path-probe.ts) | interface itfPathProbeState - 인터페이스 정의 |
| `itfRunFlow` | [`src/lib/use-run-flow.ts`](../../src/lib/use-run-flow.ts) | interface itfRunFlow - 인터페이스 정의 |
| `itfRunFlowPending` | [`src/lib/use-run-flow.ts`](../../src/lib/use-run-flow.ts) | interface itfRunFlowPending - 인터페이스 정의 |
| `itfVirtualRows` | [`src/lib/use-virtual-rows.ts`](../../src/lib/use-virtual-rows.ts) | interface itfVirtualRows - 인터페이스 정의 |
| `itfRowWindow` | [`src/lib/virtual-rows.ts`](../../src/lib/virtual-rows.ts) | interface itfRowWindow - 인터페이스 정의 |
| `typAppLogLevel` | [`src/main/lib/logger.ts`](../../src/main/lib/logger.ts) | type typAppLogLevel - 타입 별칭 정의 |
| `typActivity` | [`src/main/services/activity-lock.ts`](../../src/main/services/activity-lock.ts) | type typActivity - 타입 별칭 정의 |
| `itfCompareServiceDeps` | [`src/main/services/compare-service.ts`](../../src/main/services/compare-service.ts) | interface itfCompareServiceDeps - 인터페이스 정의 |
| `itfEffectiveExcludes` | [`src/main/services/effective-excludes.ts`](../../src/main/services/effective-excludes.ts) | interface itfEffectiveExcludes - 인터페이스 정의 |
| `itfExcludeFileHandle` | [`src/main/services/exclude-file.ts`](../../src/main/services/exclude-file.ts) | interface itfExcludeFileHandle - 인터페이스 정의 |
| `itfExcludeServiceDeps` | [`src/main/services/exclude-service.ts`](../../src/main/services/exclude-service.ts) | interface itfExcludeServiceDeps - 인터페이스 정의 |
| `itfJobContext` | [`src/main/services/job-context.ts`](../../src/main/services/job-context.ts) | interface itfJobContext - 인터페이스 정의 |
| `itfJobContextDeps` | [`src/main/services/job-context.ts`](../../src/main/services/job-context.ts) | interface itfJobContextDeps - 인터페이스 정의 |
| `itfOsRunClock` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | interface itfOsRunClock - 인터페이스 정의 |
| `itfOsRunLimits` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | interface itfOsRunLimits - 인터페이스 정의 |
| `itfOsRunQueueDeps` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | interface itfOsRunQueueDeps - 인터페이스 정의 |
| `typHeadlessExitCode` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | type typHeadlessExitCode - 헤드리스 종료 코드: 0 성공·바꿀 것 없음, 1 실패·일부 실패·중지, 2 인자 오류·차단, 3 시작 실패 |
| `typOsRunBlockReason` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | type typOsRunBlockReason - 타입 별칭 정의 |
| `typOsRunEntry` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | type typOsRunEntry - 타입 별칭 정의 |
| `typPathCheck` | [`src/main/services/os-run-queue.ts`](../../src/main/services/os-run-queue.ts) | type typPathCheck - 타입 별칭 정의 |
| `itfExistingTask` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | interface itfExistingTask - 인터페이스 정의 |
| `itfOsAvailability` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | interface itfOsAvailability - 인터페이스 정의 |
| `itfOsSchedulerDeps` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | interface itfOsSchedulerDeps - 인터페이스 정의 |
| `itfParsedTaskXml` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | interface itfParsedTaskXml - 인터페이스 정의 |
| `itfReconcilePlan` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | interface itfReconcilePlan - 인터페이스 정의 |
| `itfTaskXmlInput` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | interface itfTaskXmlInput - 인터페이스 정의 |
| `typExecBuffer` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | type typExecBuffer - 타입 별칭 정의 |
| `typTaskSpec` | [`src/main/services/os-scheduler.ts`](../../src/main/services/os-scheduler.ts) | type typTaskSpec - 타입 별칭 정의 |
| `itfFsGateOptions` | [`src/main/services/path-service.ts`](../../src/main/services/path-service.ts) | interface itfFsGateOptions - 인터페이스 정의 |
| `itfPathServiceDeps` | [`src/main/services/path-service.ts`](../../src/main/services/path-service.ts) | interface itfPathServiceDeps - 인터페이스 정의 |
| `typPathServiceInit` | [`src/main/services/path-service.ts`](../../src/main/services/path-service.ts) | type typPathServiceInit - 타입 별칭 정의 |
| `itfPlanTokenInput` | [`src/main/services/plan-token.ts`](../../src/main/services/plan-token.ts) | interface itfPlanTokenInput - 인터페이스 정의 |
| `itfAuthSessionHandle` | [`src/main/services/remote-auth-session.ts`](../../src/main/services/remote-auth-session.ts) | interface itfAuthSessionHandle - 인터페이스 정의 |
| `itfRemoteAuthSessionOptions` | [`src/main/services/remote-auth-session.ts`](../../src/main/services/remote-auth-session.ts) | interface itfRemoteAuthSessionOptions - 인터페이스 정의 |
| `itfRemoteConfigServiceDeps` | [`src/main/services/remote-config-service.ts`](../../src/main/services/remote-config-service.ts) | interface itfRemoteConfigServiceDeps - 인터페이스 정의 |
| `itfRemoteOpsDeps` | [`src/main/services/remote-ops.ts`](../../src/main/services/remote-ops.ts) | interface itfRemoteOpsDeps - 인터페이스 정의 |
| `itfRemoteServiceDeps` | [`src/main/services/remote-service.ts`](../../src/main/services/remote-service.ts) | interface itfRemoteServiceDeps - 인터페이스 정의 |
| `itfEtaState` | [`src/main/services/run-eta.ts`](../../src/main/services/run-eta.ts) | interface itfEtaState - 인터페이스 정의 |
| `itfEtaStep` | [`src/main/services/run-eta.ts`](../../src/main/services/run-eta.ts) | interface itfEtaStep - 인터페이스 정의 |
| `itfEtaTotals` | [`src/main/services/run-eta.ts`](../../src/main/services/run-eta.ts) | interface itfEtaTotals - 인터페이스 정의 |
| `typRawEta` | [`src/main/services/run-eta.ts`](../../src/main/services/run-eta.ts) | type typRawEta - `rawEtaSeconds`가 숫자를 낼 수 없을 때의 값 |
| `itfBatcherTimers` | [`src/main/services/run-events.ts`](../../src/main/services/run-events.ts) | interface itfBatcherTimers - 인터페이스 정의 |
| `itfRunEventBatcherOptions` | [`src/main/services/run-events.ts`](../../src/main/services/run-events.ts) | interface itfRunEventBatcherOptions - 인터페이스 정의 |
| `itfRunLogHeader` | [`src/main/services/run-log-file.ts`](../../src/main/services/run-log-file.ts) | interface itfRunLogHeader - 인터페이스 정의 |
| `itfRecoverDeps` | [`src/main/services/run-recovery.ts`](../../src/main/services/run-recovery.ts) | interface itfRecoverDeps - 인터페이스 정의 |
| `typQueryTasks` | [`src/main/services/run-recovery.ts`](../../src/main/services/run-recovery.ts) | type typQueryTasks - tasklist 출력(stdout). 실행하지 못하면 null |
| `typRecoverResult` | [`src/main/services/run-recovery.ts`](../../src/main/services/run-recovery.ts) | type typRecoverResult - 타입 별칭 정의 |
| `itfAutoOutcome` | [`src/main/services/run-service.ts`](../../src/main/services/run-service.ts) | interface itfAutoOutcome - 자동 실행 결과(스케줄러가 예약·알림에 쓴다). recorded가 false면 이력에 없다(noop 등) |
| `itfRunServiceDeps` | [`src/main/services/run-service.ts`](../../src/main/services/run-service.ts) | interface itfRunServiceDeps - 인터페이스 정의 |
| `typCancelReason` | [`src/main/services/run-service.ts`](../../src/main/services/run-service.ts) | type typCancelReason - 취소 사유: 사용자(화면·종료) 또는 실행 시간 제한(OS 예약 대기열) |
| `itfSchedulerDeps` | [`src/main/services/scheduler.ts`](../../src/main/services/scheduler.ts) | interface itfSchedulerDeps - 인터페이스 정의 |
| `itfSchedulerTimers` | [`src/main/services/scheduler.ts`](../../src/main/services/scheduler.ts) | interface itfSchedulerTimers - 인터페이스 정의 |
| `itfWslDeps` | [`src/main/services/wsl.ts`](../../src/main/services/wsl.ts) | interface itfWslDeps - 인터페이스 정의 |
| `itfDiffOptions` | [`src/shared/diff-engine.ts`](../../src/shared/diff-engine.ts) | interface itfDiffOptions - 인터페이스 정의 |
| `itfDirLists` | [`src/shared/diff-engine.ts`](../../src/shared/diff-engine.ts) | interface itfDirLists - 전체 범위의 폴더 목록(lsjson IsDir 항목의 Path) |
| `typDiffResult` | [`src/shared/diff-engine.ts`](../../src/shared/diff-engine.ts) | type typDiffResult - 타입 별칭 정의 |
| `typErrorCode` | [`src/shared/errors.ts`](../../src/shared/errors.ts) | type typErrorCode - 타입 별칭 정의 |
| `typAbnormalExit` | [`src/shared/exit-code.ts`](../../src/shared/exit-code.ts) | type typAbnormalExit - 코드만 본 분류. 오류 줄·Go 충돌 표지는 decideRunOutcome이 함께 판단한다 |
| `itfAppInfo` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | interface itfAppInfo - 인터페이스 정의 |
| `itfAppNotice` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | interface itfAppNotice - 시작 시 저장 파일 복구 등 사용자에게 알려야 할 일 |
| `itfJobsChangedEvent` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | interface itfJobsChangedEvent - 인터페이스 정의 |
| `itfPathProbe` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | interface itfPathProbe - rclone:testPath 결과 |
| `itfRcloneEnvironment` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | interface itfRcloneEnvironment - rclone:detect 결과. 감지 실패도 오류 envelope가 아니라 problem으로 돌려준다(화면이 온보딩을 그림). |
| `itfRcloneGuiApi` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | interface itfRcloneGuiApi - preload가 window.rclonegui로 노출하는 API |
| `itfWslDistros` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | interface itfWslDistros - 인터페이스 정의 |
| `typBinarySource` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | type typBinarySource - 타입 별칭 정의 |
| `typConfigSource` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | type typConfigSource - 타입 별칭 정의 |
| `typIpcChannel` | [`src/shared/ipc-contract.ts`](../../src/shared/ipc-contract.ts) | type typIpcChannel - 타입 별칭 정의 |
| `itfLatestGate` | [`src/shared/latest-request.ts`](../../src/shared/latest-request.ts) | interface itfLatestGate - 인터페이스 정의 |
| `typPartialCheckInput` | [`src/shared/partial-files.ts`](../../src/shared/partial-files.ts) | type typPartialCheckInput - mayLeavePartial 입력. 자동 실행 결과처럼 레코드 일부만 있어도 된다 |
| `itfParsedPath` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | interface itfParsedPath - 인터페이스 정의 |
| `itfPathIssue` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | interface itfPathIssue - 인터페이스 정의 |
| `itfPathPairCheck` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | interface itfPathPairCheck - 인터페이스 정의 |
| `typParseResult` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | type typParseResult - 타입 별칭 정의 |
| `typPathKind` | [`src/shared/path-utils.ts`](../../src/shared/path-utils.ts) | type typPathKind - 타입 별칭 정의 |
| `typRemoteBasePathResult` | [`src/shared/remote-path.ts`](../../src/shared/remote-path.ts) | type typRemoteBasePathResult - 타입 별칭 정의 |
| `itfGateBlock` | [`src/shared/run-gates.ts`](../../src/shared/run-gates.ts) | interface itfGateBlock - 게이트에 걸린 이유 (IPC 오류로 그대로 쓴다) |
| `typDeleteThresholds` | [`src/shared/run-gates.ts`](../../src/shared/run-gates.ts) | type typDeleteThresholds - 타입 별칭 정의 |
| `itfPlanMatch` | [`src/shared/run-plan.ts`](../../src/shared/run-plan.ts) | interface itfPlanMatch - 인터페이스 정의 |
| `itfPreflightOptions` | [`src/shared/run-plan.ts`](../../src/shared/run-plan.ts) | interface itfPreflightOptions - 인터페이스 정의 |
| `itfNextAutoRun` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | interface itfNextAutoRun - 다음 자동 실행(표시용) |
| `itfScheduleJob` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | interface itfScheduleJob - 예약 고르기·표시에 필요한 작업 정보 |
| `typScheduleSpec` | [`src/shared/schedule.ts`](../../src/shared/schedule.ts) | type typScheduleSpec - 다음 예약을 정하는 값 |
| `typApiResult` | [`src/shared/schemas/common.ts`](../../src/shared/schemas/common.ts) | type typApiResult - 타입 별칭 정의 |
| `typAppErrorPayload` | [`src/shared/schemas/common.ts`](../../src/shared/schemas/common.ts) | type typAppErrorPayload - 타입 별칭 정의 |
| `typAutoTrigger` | [`src/shared/schemas/common.ts`](../../src/shared/schemas/common.ts) | type typAutoTrigger - 자동 실행 trigger(수동 제외) |
| `typDeepPartial` | [`src/shared/schemas/common.ts`](../../src/shared/schemas/common.ts) | type typDeepPartial - 하위 객체까지 선택 입력으로 만든다. 배열은 통째로 교체한다. |
| `typIsoDateString` | [`src/shared/schemas/common.ts`](../../src/shared/schemas/common.ts) | type typIsoDateString - 타입 별칭 정의 |
| `typRunMode` | [`src/shared/schemas/common.ts`](../../src/shared/schemas/common.ts) | type typRunMode - 타입 별칭 정의 |
| `typRunPhase` | [`src/shared/schemas/common.ts`](../../src/shared/schemas/common.ts) | type typRunPhase - 타입 별칭 정의 |
| `typRunStatus` | [`src/shared/schemas/common.ts`](../../src/shared/schemas/common.ts) | type typRunStatus - 타입 별칭 정의 |
| `typRunTrigger` | [`src/shared/schemas/common.ts`](../../src/shared/schemas/common.ts) | type typRunTrigger - 타입 별칭 정의 |
| `typCompareJobInput` | [`src/shared/schemas/compare.ts`](../../src/shared/schemas/compare.ts) | type typCompareJobInput - 타입 별칭 정의 |
| `itfExcludePatternUsage` | [`src/shared/schemas/excludes.ts`](../../src/shared/schemas/excludes.ts) | interface itfExcludePatternUsage - 인터페이스 정의 |
| `itfExcludeUser` | [`src/shared/schemas/excludes.ts`](../../src/shared/schemas/excludes.ts) | interface itfExcludeUser - 패턴을 쓰는 작업 |
| `typExcludeDeleteInput` | [`src/shared/schemas/excludes.ts`](../../src/shared/schemas/excludes.ts) | type typExcludeDeleteInput - 타입 별칭 정의 |
| `typExcludePattern` | [`src/shared/schemas/excludes.ts`](../../src/shared/schemas/excludes.ts) | type typExcludePattern - 타입 별칭 정의 |
| `typExcludeUpdateInput` | [`src/shared/schemas/excludes.ts`](../../src/shared/schemas/excludes.ts) | type typExcludeUpdateInput - 타입 별칭 정의 |
| `typHistoryClearInput` | [`src/shared/schemas/history.ts`](../../src/shared/schemas/history.ts) | type typHistoryClearInput - 타입 별칭 정의 |
| `typHistoryGetInput` | [`src/shared/schemas/history.ts`](../../src/shared/schemas/history.ts) | type typHistoryGetInput - 타입 별칭 정의 |
| `typHistoryListInput` | [`src/shared/schemas/history.ts`](../../src/shared/schemas/history.ts) | type typHistoryListInput - 타입 별칭 정의 |
| `typHistoryReadLogInput` | [`src/shared/schemas/history.ts`](../../src/shared/schemas/history.ts) | type typHistoryReadLogInput - 타입 별칭 정의 |
| `typAutoSyncOptions` | [`src/shared/schemas/job.ts`](../../src/shared/schemas/job.ts) | type typAutoSyncOptions - 타입 별칭 정의 |
| `typJob` | [`src/shared/schemas/job.ts`](../../src/shared/schemas/job.ts) | type typJob - 타입 별칭 정의 |
| `typJobDraft` | [`src/shared/schemas/job.ts`](../../src/shared/schemas/job.ts) | type typJobDraft - 타입 별칭 정의 |
| `typJobPatch` | [`src/shared/schemas/job.ts`](../../src/shared/schemas/job.ts) | type typJobPatch - 타입 별칭 정의 |
| `typJobRunOptions` | [`src/shared/schemas/job.ts`](../../src/shared/schemas/job.ts) | type typJobRunOptions - 타입 별칭 정의 |
| `typJobsFile` | [`src/shared/schemas/job.ts`](../../src/shared/schemas/job.ts) | type typJobsFile - 타입 별칭 정의 |
| `typScheduleBackend` | [`src/shared/schemas/job.ts`](../../src/shared/schemas/job.ts) | type typScheduleBackend - 타입 별칭 정의 |
| `typScheduleKind` | [`src/shared/schemas/job.ts`](../../src/shared/schemas/job.ts) | type typScheduleKind - 타입 별칭 정의 |
| `typSyncScope` | [`src/shared/schemas/job.ts`](../../src/shared/schemas/job.ts) | type typSyncScope - 타입 별칭 정의 |
| `typListRemotesInput` | [`src/shared/schemas/rclone.ts`](../../src/shared/schemas/rclone.ts) | type typListRemotesInput - 타입 별칭 정의 |
| `typRcloneDetectInput` | [`src/shared/schemas/rclone.ts`](../../src/shared/schemas/rclone.ts) | type typRcloneDetectInput - 타입 별칭 정의 |
| `typTestPathInput` | [`src/shared/schemas/rclone.ts`](../../src/shared/schemas/rclone.ts) | type typTestPathInput - 타입 별칭 정의 |
| `typRemoteConfigAnswerInput` | [`src/shared/schemas/remote-config.ts`](../../src/shared/schemas/remote-config.ts) | type typRemoteConfigAnswerInput - 타입 별칭 정의 |
| `typRemoteConfigCreateInput` | [`src/shared/schemas/remote-config.ts`](../../src/shared/schemas/remote-config.ts) | type typRemoteConfigCreateInput - 타입 별칭 정의 |
| `typRemoteConfigDeleteInput` | [`src/shared/schemas/remote-config.ts`](../../src/shared/schemas/remote-config.ts) | type typRemoteConfigDeleteInput - 타입 별칭 정의 |
| `typRemoteConfigNameInput` | [`src/shared/schemas/remote-config.ts`](../../src/shared/schemas/remote-config.ts) | type typRemoteConfigNameInput - 타입 별칭 정의 |
| `typRemoteConfigUpdateInput` | [`src/shared/schemas/remote-config.ts`](../../src/shared/schemas/remote-config.ts) | type typRemoteConfigUpdateInput - 타입 별칭 정의 |
| `typListDirInput` | [`src/shared/schemas/remotes.ts`](../../src/shared/schemas/remotes.ts) | type typListDirInput - 타입 별칭 정의 |
| `typRemoteCreateInput` | [`src/shared/schemas/remotes.ts`](../../src/shared/schemas/remotes.ts) | type typRemoteCreateInput - 타입 별칭 정의 |
| `typRemoteFeaturesInput` | [`src/shared/schemas/remotes.ts`](../../src/shared/schemas/remotes.ts) | type typRemoteFeaturesInput - 타입 별칭 정의 |
| `typRemoteIdInput` | [`src/shared/schemas/remotes.ts`](../../src/shared/schemas/remotes.ts) | type typRemoteIdInput - 타입 별칭 정의 |
| `typRemoteUpdateInput` | [`src/shared/schemas/remotes.ts`](../../src/shared/schemas/remotes.ts) | type typRemoteUpdateInput - 타입 별칭 정의 |
| `typActiveRunFile` | [`src/shared/schemas/run.ts`](../../src/shared/schemas/run.ts) | type typActiveRunFile - 타입 별칭 정의 |
| `typHistoryFile` | [`src/shared/schemas/run.ts`](../../src/shared/schemas/run.ts) | type typHistoryFile - 타입 별칭 정의 |
| `typRunIdInput` | [`src/shared/schemas/run.ts`](../../src/shared/schemas/run.ts) | type typRunIdInput - 타입 별칭 정의 |
| `typRunPlan` | [`src/shared/schemas/run.ts`](../../src/shared/schemas/run.ts) | type typRunPlan - 타입 별칭 정의 |
| `typRunRecord` | [`src/shared/schemas/run.ts`](../../src/shared/schemas/run.ts) | type typRunRecord - 타입 별칭 정의 |
| `typRunStats` | [`src/shared/schemas/run.ts`](../../src/shared/schemas/run.ts) | type typRunStats - 타입 별칭 정의 |
| `typStartRunInput` | [`src/shared/schemas/run.ts`](../../src/shared/schemas/run.ts) | type typStartRunInput - 타입 별칭 정의 |
| `typRunJobAdditionalData` | [`src/shared/schemas/scheduler.ts`](../../src/shared/schemas/scheduler.ts) | type typRunJobAdditionalData - 타입 별칭 정의 |
| `typSchedulerSetPausedInput` | [`src/shared/schemas/scheduler.ts`](../../src/shared/schemas/scheduler.ts) | type typSchedulerSetPausedInput - 타입 별칭 정의 |
| `typJobDefaults` | [`src/shared/schemas/settings.ts`](../../src/shared/schemas/settings.ts) | type typJobDefaults - 타입 별칭 정의 |
| `typSettings` | [`src/shared/schemas/settings.ts`](../../src/shared/schemas/settings.ts) | type typSettings - 타입 별칭 정의 |
| `typSettingsPatch` | [`src/shared/schemas/settings.ts`](../../src/shared/schemas/settings.ts) | type typSettingsPatch - 타입 별칭 정의 |
| `typThemeMode` | [`src/shared/schemas/settings.ts`](../../src/shared/schemas/settings.ts) | type typThemeMode - 타입 별칭 정의 |
| `typDialogFilter` | [`src/shared/schemas/system.ts`](../../src/shared/schemas/system.ts) | type typDialogFilter - 타입 별칭 정의 |
| `typOpenExternalInput` | [`src/shared/schemas/system.ts`](../../src/shared/schemas/system.ts) | type typOpenExternalInput - 타입 별칭 정의 |
| `typPickDirectoryInput` | [`src/shared/schemas/system.ts`](../../src/shared/schemas/system.ts) | type typPickDirectoryInput - 타입 별칭 정의 |
| `typPickFileInput` | [`src/shared/schemas/system.ts`](../../src/shared/schemas/system.ts) | type typPickFileInput - 타입 별칭 정의 |
| `itfCompareActive` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | interface itfCompareActive - 진행 중인 비교(앱 전역 하나) |
| `itfCompareMethod` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | interface itfCompareMethod - 결과에 비교 방식을 남긴다(화면 표시·Phase 7 게이트) |
| `itfCompareProgress` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | interface itfCompareProgress - compare:progress 이벤트 |
| `itfCompareResult` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | interface itfCompareResult - 인터페이스 정의 |
| `itfCompareSummary` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | interface itfCompareSummary - 인터페이스 정의 |
| `itfDiffEntry` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | interface itfDiffEntry - 인터페이스 정의 |
| `itfDiffSide` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | interface itfDiffSide - 인터페이스 정의 |
| `itfDirChange` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | interface itfDirChange - 전체 범위의 폴더 변화(파일 5상태와 섞지 않는다, spec Q4) |
| `itfFileMeta` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | interface itfFileMeta - lsjson 한 항목에서 비교에 쓰는 값만 남긴 것 |
| `typCompareEventPhase` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | type typCompareEventPhase - 진행 이벤트 단계(종료 3종 포함) |
| `typComparePhase` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | type typComparePhase - 비교 진행 단계: 경로 확인 → 목록 읽기 → 차이 계산 |
| `typCompareStatus` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | type typCompareStatus - 타입 별칭 정의 |
| `typModifiedReason` | [`src/shared/types/compare.ts`](../../src/shared/types/compare.ts) | type typModifiedReason - 타입 별칭 정의 |
| `itfRunLogView` | [`src/shared/types/history.ts`](../../src/shared/types/history.ts) | interface itfRunLogView - 실행 로그 파일 끝부분 |
| `itfRemoteAuthAnswerResult` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteAuthAnswerResult - 인터페이스 정의 |
| `itfRemoteAuthProgress` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteAuthProgress - remoteConfig:authProgress 이벤트. 비밀 값·토큰은 담지 않는다 |
| `itfRemoteConfigView` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteConfigView - remoteConfig:get 결과. 비밀 값은 빠지고 값이 있는 비밀 옵션 이름만 온다 |
| `itfRemoteDeleteResult` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteDeleteResult - 인터페이스 정의 |
| `itfRemoteOption` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteOption - providers 옵션 하나(숨김 옵션은 파서가 뺀다) |
| `itfRemoteOptionChoice` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteOptionChoice - 인터페이스 정의 |
| `itfRemoteProvider` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteProvider - 인터페이스 정의 |
| `itfRemoteQuestion` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteQuestion - rclone이 비대화형 흐름에서 돌려준 질문 하나(FR-15a) |
| `itfRemoteUsage` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteUsage - 인터페이스 정의 |
| `itfRemoteUsageBookmark` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteUsageBookmark - 인터페이스 정의 |
| `itfRemoteUsageJob` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | interface itfRemoteUsageJob - 인터페이스 정의 |
| `typRemoteAuthPhase` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | type typRemoteAuthPhase - 타입 별칭 정의 |
| `typRemoteOptionKind` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | type typRemoteOptionKind - 폼 입력 종류. providers의 Type을 화면이 다루기 쉬운 값으로 줄인 것 |
| `typRemoteUsageAutoSync` | [`src/shared/types/remote-config.ts`](../../src/shared/types/remote-config.ts) | type typRemoteUsageAutoSync - remoteConfig:usage 결과(FR-19). 대소문자를 무시하고 센다 |
| `itfDirEntry` | [`src/shared/types/remotes.ts`](../../src/shared/types/remotes.ts) | interface itfDirEntry - 인터페이스 정의 |
| `itfDirListing` | [`src/shared/types/remotes.ts`](../../src/shared/types/remotes.ts) | interface itfDirListing - 인터페이스 정의 |
| `itfRemoteBookmark` | [`src/shared/types/remotes.ts`](../../src/shared/types/remotes.ts) | interface itfRemoteBookmark - 인터페이스 정의 |
| `itfRemoteFeatures` | [`src/shared/types/remotes.ts`](../../src/shared/types/remotes.ts) | interface itfRemoteFeatures - remotes:features 결과(INT-003 FR-32, 편집기 경고용) |
| `itfDryRunSummary` | [`src/shared/types/run.ts`](../../src/shared/types/run.ts) | interface itfDryRunSummary - dry-run에서 rclone이 건너뛰었다고 알린 동작을 센 것 |
| `itfRunLogLine` | [`src/shared/types/run.ts`](../../src/shared/types/run.ts) | interface itfRunLogLine - 화면 로그 한 줄 (원문 전체는 실행 로그 파일에 있다) |
| `itfRunSnapshot` | [`src/shared/types/run.ts`](../../src/shared/types/run.ts) | interface itfRunSnapshot - 진행 중인 실행 (run:getActive, started 이벤트) |
| `typRunEvent` | [`src/shared/types/run.ts`](../../src/shared/types/run.ts) | type typRunEvent - run:event. finished는 실행마다 맨 마지막에 한 번 온다 |
| `typRunLogLevel` | [`src/shared/types/run.ts`](../../src/shared/types/run.ts) | type typRunLogLevel - 타입 별칭 정의 |
| `itfAppNotify` | [`src/shared/types/scheduler.ts`](../../src/shared/types/scheduler.ts) | interface itfAppNotify - app:notify 이벤트: 창이 보이고 포커스가 있을 때 main이 보내는 알림(화면은 토스트로 표시) |
| `itfOsScheduleStatus` | [`src/shared/types/scheduler.ts`](../../src/shared/types/scheduler.ts) | interface itfOsScheduleStatus - scheduler:osStatus 결과와 scheduler:osStatusChanged 이벤트 |
| `itfOsTaskStatus` | [`src/shared/types/scheduler.ts`](../../src/shared/types/scheduler.ts) | interface itfOsTaskStatus - Windows 작업 스케줄러에 등록한 작업 하나의 상태 (INT-003 T-01) |
| `itfSchedulerState` | [`src/shared/types/scheduler.ts`](../../src/shared/types/scheduler.ts) | interface itfSchedulerState - scheduler:getState 결과와 scheduler:state 이벤트 |
| `typAppNotifyLevel` | [`src/shared/types/scheduler.ts`](../../src/shared/types/scheduler.ts) | type typAppNotifyLevel - 타입 별칭 정의 |

