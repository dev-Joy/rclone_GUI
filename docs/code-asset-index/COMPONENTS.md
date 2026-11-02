# Project Code Asset Index: rclonegui

- 생성일시: 2026-11-02 16:11:11
- 감지된 환경: React / TypeScript
- 스캔 대상 디렉터리: `src/components`, `src/lib`, `src/main/lib`, `src/main/services`, `src/shared`, `src/shared/schemas`, `src/shared/types`
- 총 인덱싱 자산: 320 건

> 이 카탈로그는 AI 에이전트와 개발자가 기존 공통 자산을 재사용하고 중복 구현을 방지하기 위한 인덱스입니다.
> 신규 컴포넌트/함수/훅 작성 전 반드시 아래 목록을 대조하고 적극 재사용하십시오.

---

## 1. UI Components

| 컴포넌트명 | 정의 파일 | 시그니처 / 주요 설명 |
| :--- | :--- | :--- |
| `ZBCBadge` | [`src/components/ZBCBadge.tsx`](src/components/ZBCBadge.tsx) | ZBCBadge(props: itfZBCBadgeProps) - UI 컴포넌트 |
| `ZBCButton` | [`src/components/ZBCButton.tsx`](src/components/ZBCButton.tsx) | ZBCButton(props: itfZBCButtonProps) - UI 컴포넌트 |
| `ZBCCheckbox` | [`src/components/ZBCCheckbox.tsx`](src/components/ZBCCheckbox.tsx) | ZBCCheckbox(props: itfZBCCheckboxProps) - UI 컴포넌트 |
| `ZBCField` | [`src/components/ZBCField.tsx`](src/components/ZBCField.tsx) | ZBCField(props: itfZBCFieldProps) - UI 컴포넌트 |
| `ZBCInput` | [`src/components/ZBCInput.tsx`](src/components/ZBCInput.tsx) | ZBCInput(props: itfZBCInputProps) - UI 컴포넌트 |
| `ZBCModal` | [`src/components/ZBCModal.tsx`](src/components/ZBCModal.tsx) | ZBCModal(props: itfZBCModalProps) - UI 컴포넌트 |
| `ZBCSelect` | [`src/components/ZBCSelect.tsx`](src/components/ZBCSelect.tsx) | ZBCSelect(props: itfZBCSelectProps) - UI 컴포넌트 |
| `ZBCTextarea` | [`src/components/ZBCTextarea.tsx`](src/components/ZBCTextarea.tsx) | ZBCTextarea(props: itfZBCTextareaProps) - UI 컴포넌트 |
| `ZBCToast` | [`src/components/ZBCToast.tsx`](src/components/ZBCToast.tsx) | ZBCToast(props: itfZBCToastProps) - UI 컴포넌트 |

## 2. Custom Hooks

| 훅 명칭 | 정의 파일 | 시그니처 / 반환 요약 |
| :--- | :--- | :--- |
| `usePathProbe` | [`src/lib/use-path-probe.ts`](src/lib/use-path-probe.ts) | usePathProbe() - 커스텀 훅 |
| `useRunFlow` | [`src/lib/use-run-flow.ts`](src/lib/use-run-flow.ts) | useRunFlow() - 커스텀 훅 |

## 3. Utilities & Helpers

| 함수 / 심볼 | 정의 파일 | 시그니처 / 요약 |
| :--- | :--- | :--- |
| `errorText` | [`src/lib/api.ts`](src/lib/api.ts) | errorText(e: unknown) - 사용자에게 보일 오류 문구 |
| `getApi` | [`src/lib/api.ts`](src/lib/api.ts) | getApi() - 공통 함수/유틸리티 |
| `reasonText` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | reasonText(reasons: readonly typModifiedReason[]) - 변경 사유 문구. 예: ["size", "mtime"] → "크기, 수정시간" |
| `statusLabel` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | statusLabel(status: typCompareStatus, mode: typRunMode) - 상태 라벨. onlyDest: copy "대상만(유지)", sync "대상만(삭제 예정)" |
| `statusTone` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | statusTone(status: typCompareStatus, mode: typRunMode) - 공통 함수/유틸리티 |
| `summaryCards` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | summaryCards(s: itfCompareSummary, mode: typRunMode) - 요약 카드. 문구는 일어날 일: "대상에 12개 복사", "8개 덮어씀", sync "3개 삭제" / copy "3개 대상에만 있음(유지)" |
| `excludeChangeConfirmText` | [`src/lib/exclude-view.ts`](src/lib/exclude-view.ts) | excludeChangeConfirmText(kind: typExcludeChangeKind, userCount: number) - 확인 버튼 문구(일어날 일). 예: "패턴 지우고 작업 3개의 비교 결과 버리기" |
| `jobOnlyCommentLike` | [`src/lib/exclude-view.ts`](src/lib/exclude-view.ts) | jobOnlyCommentLike(patterns: readonly string[]) - 이 작업 전용 패턴 중 공용으로 둘 수 없는 줄(#·; 시작) |
| `togglePatternId` | [`src/lib/exclude-view.ts`](src/lib/exclude-view.ts) | togglePatternId(selected: readonly string[], id: string, on: boolean) - 선택 토글. 결과는 정렬한다(저장소가 정렬해 돌려주므로 변경 여부 비교가 맞게) |
| `numberIssueText` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | numberIssueText(value: unknown, range: itfNumberRange) - 숫자 필드 오류 문구 |
| `numberText` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | numberText(value: number) - number → 입력란 문자열. NaN은 빈칸 |
| `stableStringify` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | stableStringify(value: unknown) - 키 순서와 무관한 JSON 직렬화 (NaN은 null로 같아진다) |
| `toNumber` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | toNumber(text: string) - 숫자 입력란 문자열 → number. 빈칸·숫자가 아니면 NaN (저장 전 검증에서 막힌다) |
| `historyCounts` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | historyCounts(r: Pick<typRunRecord, "stats" \| "plan" \| "dryRun">) - 표의 결과 요약. 예: "복사 3 · 삭제 1 · 1.5 KB · 오류 0". 통계가 없으면 계획, 둘 다 없으면 "-" |
| `historyKind` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | historyKind(r: Pick<typRunRecord, "dryRun" \| "trigger">) - 미리보기 > 자동(앱·Windows 예약) > 수동 |
| `statusTone` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | statusTone(status: typRunStatus) - 공통 함수/유틸리티 |
| `excludesToText` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | excludesToText(excludes: readonly string[]) - 공통 함수/유틸리티 |
| `isDraftEqual` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | isDraftEqual(a: typJobDraft, b: typJobDraft) - 편집 가능한 값이 같은지 (dirty 판정). excludes 순서까지 비교 |
| `jobToDraft` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | jobToDraft(job: typJob) - 저장된 Job에서 편집 가능한 필드만 뽑는다 (id·rev·lastRun·nextRunAt 등 제외) |
| `parseExcludesText` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | parseExcludesText(text: string) - textarea 문자열 → excludes (trim, 빈 줄 제거, 순서 유지) |
| `serverErrorToCheck` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | serverErrorToCheck(error: typAppErrorPayload) - main 오류 envelope를 폼 오류로. SAFETY_BLOCKED/PATH_INVALID 메시지의 "원본:"/"대상:" 접두사는 해당 필드로, 나머지는 formErrors |
| `sortJobs` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | sortJobs(jobs: readonly typJob[]) - 사이드바 정렬: 이름(ko, base) → createdAt |
| `validateJobDraft` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | validateJobDraft(draft: typJobDraft, caseInsensitive: boolean) - 화면 검증: zJobDraft.safeParse + checkPathPair + 경고 규칙 |
| `jobListItem` | [`src/lib/job-list-view.ts`](src/lib/job-list-view.ts) | jobListItem(job: typJob, opts: { showStatus: boolean }) - 작업 목록 한 줄의 문구 |
| `scheduleSummary` | [`src/lib/job-list-view.ts`](src/lib/job-list-view.ts) | scheduleSummary(job: Pick<typJob, "autoSync">) - 자동 실행 요약. 꺼져 있으면 null, 켜져 있으면 "30분마다 · 다음 11-02 10:30", "매일 09:00 · 다음 …", "매주 월·수 09:00 · 다음 …". |
| `pathKindBadge` | [`src/lib/path-display.ts`](src/lib/path-display.ts) | pathKindBadge(raw: string) - 입력 원문의 배지. 빈 값은 null, 형식 오류는 { text: "형식 오류", kind: null } |
| `shortenPath` | [`src/lib/path-display.ts`](src/lib/path-display.ts) | shortenPath(path: string, max = 36) - 긴 경로를 가운데를 "…"로 줄여 앞뒤를 남긴다(작업 목록 표시용). max 이하면 그대로. 앞 ceil((max-1)/2)자, 뒤 floor((max-1)/2)자를 남긴다. |
| `browserParent` | [`src/lib/remote-browser.ts`](src/lib/remote-browser.ts) | browserParent(bookmark: itfRemoteBookmark, path: string) - 기준 경로 위로 올라간 부모. 기준 경로에 닿았거나 밖이면 null |
| `isBrowserRoot` | [`src/lib/remote-browser.ts`](src/lib/remote-browser.ts) | isBrowserRoot(path: string) - remote 루트("name:")인지. 루트는 작업 경로로 고를 수 없다 |
| `visibleDirEntries` | [`src/lib/remote-browser.ts`](src/lib/remote-browser.ts) | visibleDirEntries(entries: readonly itfDirEntry[], shown: number) - 더 보기: 앞에서 shown개만 |
| `canStartRun` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | canStartRun(input: itfCanStartRunInput) - 미리보기·실제 실행 버튼 가능 여부와 이유. 공통: 저장 안 됨 → 미저장 변경 → 경로 오류 → 비교 중 → 실행 중. |
| `deleteDirSamples` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | deleteDirSamples(result: itfCompareResult, limit = 20) - 삭제 예정(대상에만 있음) 폴더 샘플. 경로 오름차순으로 최대 limit개 (전체 범위만) |
| `deleteSamples` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | deleteSamples(result: itfCompareResult, limit = 20) - 삭제 예정(대상에만 있음) 파일 샘플. 비교 결과 순서(경로 오름차순)로 최대 limit개 |
| `dryRunHeadline` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | dryRunHeadline(s: itfDryRunSummary) - dry-run 요약 한 줄. 예: "실행하면 대상에 3개 복사(24 B), 1개 수정시간만 맞춤, 2개 삭제" |
| `progressPercent` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | progressPercent(stats: typRunStats \| null) - 진행률(0~100). 바이트 기준, 바이트를 모르면 파일 수 기준. 계산할 수 없으면 null |
| `runStatusText` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | runStatusText(status: typRunStatus, dryRun: boolean, mode: typRunMode) - 상태 문구. 예: 미리보기 완료, 복사 완료, 복사 중지됨 |
| `isSettingsEqual` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | isSettingsEqual(a: typSettings, b: typSettings) - 공통 함수/유틸리티 |
| `settingsToPatch` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | settingsToPatch(s: typSettings) - 화면에 노출된 섹션만 patch로 (defaults, compare, safety, logs, ui). scheduler(일시정지)는 넣지 않는다: settings:update가 거부하며 scheduler:setPaused로만 바꾼다. |
| `validateSettingsDraft` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | validateSettingsDraft(s: typSettings) - 공통 함수/유틸리티 |
| `fail` | [`src/main/lib/app-error.ts`](src/main/lib/app-error.ts) | fail(e: unknown) - 공통 함수/유틸리티 |
| `toErrorPayload` | [`src/main/lib/app-error.ts`](src/main/lib/app-error.ts) | toErrorPayload(e: unknown) - 공통 함수/유틸리티 |
| `redactSecrets` | [`src/main/lib/logger.ts`](src/main/lib/logger.ts) | redactSecrets(text: string) - 공통 함수/유틸리티 |
| `fileStamp` | [`src/main/lib/time.ts`](src/main/lib/time.ts) | fileStamp(d = new Date() - 파일 이름용 시각. 예: 20261028-173500 (로컬 시각) |
| `nowIso` | [`src/main/lib/time.ts`](src/main/lib/time.ts) | nowIso() - 공통 함수/유틸리티 |
| `checkDestProbe` | [`src/main/services/compare-service.ts`](src/main/services/compare-service.ts) | checkDestProbe(p: itfParsedPath, probe: itfPathProbe) - 대상 폴더 확인 결과 판정. 대상이 없으면 true(빈 목록으로 비교). 접근할 수 없거나 파일이면 막는다 |
| `checkSourceProbe` | [`src/main/services/compare-service.ts`](src/main/services/compare-service.ts) | checkSourceProbe(p: itfParsedPath, probe: itfPathProbe) - 원본 폴더 확인 결과 판정(비교·OS 예약 경로 사전 확인 공용). 읽을 수 없거나 없거나 폴더가 아니면 던진다. 로컬·UNC는 폴더를 열어 본 경우만 통과(시간 초과·확인 대기 중이면 막는다). |
| `cleanupExcludeFiles` | [`src/main/services/exclude-file.ts`](src/main/services/exclude-file.ts) | cleanupExcludeFiles(dir: string) - 시작 때 남은 제외 파일(excl-*.txt)만 지운다. 지운 수 |
| `isExcludeFileName` | [`src/main/services/exclude-file.ts`](src/main/services/exclude-file.ts) | isExcludeFileName(name: string) - 앱이 만든 제외 파일 이름인지(테스트·로그 확인용) |
| `remoteNameOf` | [`src/main/services/job-context.ts`](src/main/services/job-context.ts) | remoteNameOf(p: itfParsedPath) - remote 경로면 remote 이름("gdrive"), 아니면 null (오류 안내 문구용) |
| `remoteNamesOfJob` | [`src/main/services/job-context.ts`](src/main/services/job-context.ts) | remoteNamesOfJob(job: Pick<typJob, "source" \| "destination">) - 작업의 원본·대상이 쓰는 remote 이름(중복 제거). 로컬·UNC만 쓰면 빈 배열 |
| _(외 52 건 생략)_ | - | 상세 항목은 소스 파일 직접 참조 |

## 4. Shared Services & Clients

| 클래스 / 서비스 | 정의 파일 | 설명 / 주요 메서드 |
| :--- | :--- | :--- |
| `clsApiError` | [`src/lib/api.ts`](src/lib/api.ts) | class clsApiError - 공유 서비스/클라이언트 클래스 |
| `clsAppError` | [`src/main/lib/app-error.ts`](src/main/lib/app-error.ts) | class clsAppError - 공유 서비스/클라이언트 클래스 |
| `clsLogger` | [`src/main/lib/logger.ts`](src/main/lib/logger.ts) | class clsLogger - 공유 서비스/클라이언트 클래스 |
| `clsMutex` | [`src/main/lib/mutex.ts`](src/main/lib/mutex.ts) | class clsMutex - 공유 서비스/클라이언트 클래스 |
| `clsActivityLock` | [`src/main/services/activity-lock.ts`](src/main/services/activity-lock.ts) | class clsActivityLock - 공유 서비스/클라이언트 클래스 |
| `clsCompareService` | [`src/main/services/compare-service.ts`](src/main/services/compare-service.ts) | class clsCompareService - 공유 서비스/클라이언트 클래스 |
| `clsExcludeService` | [`src/main/services/exclude-service.ts`](src/main/services/exclude-service.ts) | class clsExcludeService - 공유 서비스/클라이언트 클래스 |
| `clsFsGate` | [`src/main/services/path-service.ts`](src/main/services/path-service.ts) | class clsFsGate - 응답 없는 fs 호출 제한. 시간 제한은 기다림만 끊고 fs.stat/opendir은 libuv 스레드풀(기본 4)에 남는다. 응답 없는 UNC·WSL 경로를 |
| `clsPathService` | [`src/main/services/path-service.ts`](src/main/services/path-service.ts) | class clsPathService - 공유 서비스/클라이언트 클래스 |
| `clsRemoteOps` | [`src/main/services/remote-ops.ts`](src/main/services/remote-ops.ts) | class clsRemoteOps - 공유 서비스/클라이언트 클래스 |
| `clsRemoteService` | [`src/main/services/remote-service.ts`](src/main/services/remote-service.ts) | class clsRemoteService - 공유 서비스/클라이언트 클래스 |
| `clsRunEventBatcher` | [`src/main/services/run-events.ts`](src/main/services/run-events.ts) | class clsRunEventBatcher - 공유 서비스/클라이언트 클래스 |
| `clsRunLogFile` | [`src/main/services/run-log-file.ts`](src/main/services/run-log-file.ts) | class clsRunLogFile - 공유 서비스/클라이언트 클래스 |
| `clsActiveRunStore` | [`src/main/services/run-recovery.ts`](src/main/services/run-recovery.ts) | class clsActiveRunStore - 공유 서비스/클라이언트 클래스 |
| `clsRunService` | [`src/main/services/run-service.ts`](src/main/services/run-service.ts) | class clsRunService - 공유 서비스/클라이언트 클래스 |
| `clsScheduler` | [`src/main/services/scheduler.ts`](src/main/services/scheduler.ts) | class clsScheduler - 공유 서비스/클라이언트 클래스 |
| `clsWslService` | [`src/main/services/wsl.ts`](src/main/services/wsl.ts) | class clsWslService - 공유 서비스/클라이언트 클래스 |

## 5. Types & Interfaces

| 타입 / 인터페이스 | 정의 파일 | 정의 요약 |
| :--- | :--- | :--- |
| `itfZBCBadgeProps` | [`src/components/ZBCBadge.tsx`](src/components/ZBCBadge.tsx) | interface itfZBCBadgeProps - 인터페이스 정의 |
| `typZBCBadgeTone` | [`src/components/ZBCBadge.tsx`](src/components/ZBCBadge.tsx) | type typZBCBadgeTone - ========== Props & Types ========== |
| `itfZBCButtonProps` | [`src/components/ZBCButton.tsx`](src/components/ZBCButton.tsx) | interface itfZBCButtonProps - 인터페이스 정의 |
| `typZBCButtonVariant` | [`src/components/ZBCButton.tsx`](src/components/ZBCButton.tsx) | type typZBCButtonVariant - ========== Props & Types ========== |
| `itfZBCCheckboxProps` | [`src/components/ZBCCheckbox.tsx`](src/components/ZBCCheckbox.tsx) | interface itfZBCCheckboxProps - ========== Props & Types ========== |
| `itfZBCFieldProps` | [`src/components/ZBCField.tsx`](src/components/ZBCField.tsx) | interface itfZBCFieldProps - ========== Props & Types ========== |
| `itfZBCInputProps` | [`src/components/ZBCInput.tsx`](src/components/ZBCInput.tsx) | interface itfZBCInputProps - ========== Props & Types ========== |
| `itfZBCModalProps` | [`src/components/ZBCModal.tsx`](src/components/ZBCModal.tsx) | interface itfZBCModalProps - ========== Props & Types ========== |
| `itfZBCSelectOption` | [`src/components/ZBCSelect.tsx`](src/components/ZBCSelect.tsx) | interface itfZBCSelectOption - ========== Props & Types ========== |
| `itfZBCSelectProps` | [`src/components/ZBCSelect.tsx`](src/components/ZBCSelect.tsx) | interface itfZBCSelectProps - 인터페이스 정의 |
| `itfZBCTab` | [`src/components/ZBCTabs.tsx`](src/components/ZBCTabs.tsx) | interface itfZBCTab - ========== Props & Types ========== |
| `itfZBCTabsProps` | [`src/components/ZBCTabs.tsx`](src/components/ZBCTabs.tsx) | interface itfZBCTabsProps - 인터페이스 정의 |
| `itfZBCTextareaProps` | [`src/components/ZBCTextarea.tsx`](src/components/ZBCTextarea.tsx) | interface itfZBCTextareaProps - ========== Props & Types ========== |
| `itfZBCToastProps` | [`src/components/ZBCToast.tsx`](src/components/ZBCToast.tsx) | interface itfZBCToastProps - ========== Props & Types ========== |
| `itfCompareViewState` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | interface itfCompareViewState - 인터페이스 정의 |
| `itfSummaryCard` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | interface itfSummaryCard - 인터페이스 정의 |
| `typCompareFilterStatus` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | type typCompareFilterStatus - 타입 별칭 정의 |
| `typCompareSortKey` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | type typCompareSortKey - 타입 별칭 정의 |
| `typCompareTone` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | type typCompareTone - ZBCBadge의 tone과 같은 값 (컴포넌트 파일을 node 환경에 끌어오지 않으려고 따로 둔다) |
| `typSortDir` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | type typSortDir - 타입 별칭 정의 |
| `typExcludeChangeKind` | [`src/lib/exclude-view.ts`](src/lib/exclude-view.ts) | type typExcludeChangeKind - 타입 별칭 정의 |
| `itfNumberRange` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | interface itfNumberRange - 인터페이스 정의 |
| `itfHistoryFilter` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | interface itfHistoryFilter - 인터페이스 정의 |
| `typHistoryKind` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | type typHistoryKind - 타입 별칭 정의 |
| `typHistoryKindFilter` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | type typHistoryKindFilter - 타입 별칭 정의 |
| `typHistoryStatusFilter` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | type typHistoryStatusFilter - failed에는 일부 실패·중단됨도 들어간다 |
| `typHistoryTone` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | type typHistoryTone - ZBCBadge tone과 같은 값 |
| `itfJobFormCheck` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | interface itfJobFormCheck - 인터페이스 정의 |
| `typIntervalUnit` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | type typIntervalUnit - 자동 실행 간격 입력 단위 |
| `typJobFormField` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | type typJobFormField - 타입 별칭 정의 |
| `itfJobListItem` | [`src/lib/job-list-view.ts`](src/lib/job-list-view.ts) | interface itfJobListItem - 인터페이스 정의 |
| `itfPathKindBadge` | [`src/lib/path-display.ts`](src/lib/path-display.ts) | interface itfPathKindBadge - 인터페이스 정의 |
| `itfCanStartRunInput` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | interface itfCanStartRunInput - 인터페이스 정의 |
| `itfDeleteConfirmInfo` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | interface itfDeleteConfirmInfo - 인터페이스 정의 |
| `itfDeleteSample` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | interface itfDeleteSample - 인터페이스 정의 |
| `typCheck` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | type typCheck - 타입 별칭 정의 |
| `itfSettingsFormCheck` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | interface itfSettingsFormCheck - 인터페이스 정의 |
| `typSettingsFormField` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | type typSettingsFormField - 타입 별칭 정의 |
| `itfPathProbeState` | [`src/lib/use-path-probe.ts`](src/lib/use-path-probe.ts) | interface itfPathProbeState - 인터페이스 정의 |
| `itfRunFlow` | [`src/lib/use-run-flow.ts`](src/lib/use-run-flow.ts) | interface itfRunFlow - 인터페이스 정의 |
| `itfRunFlowPending` | [`src/lib/use-run-flow.ts`](src/lib/use-run-flow.ts) | interface itfRunFlowPending - 인터페이스 정의 |
| `itfVirtualRows` | [`src/lib/use-virtual-rows.ts`](src/lib/use-virtual-rows.ts) | interface itfVirtualRows - 인터페이스 정의 |
| `itfRowWindow` | [`src/lib/virtual-rows.ts`](src/lib/virtual-rows.ts) | interface itfRowWindow - 인터페이스 정의 |
| `typAppLogLevel` | [`src/main/lib/logger.ts`](src/main/lib/logger.ts) | type typAppLogLevel - 타입 별칭 정의 |
| `typActivity` | [`src/main/services/activity-lock.ts`](src/main/services/activity-lock.ts) | type typActivity - 타입 별칭 정의 |
| `itfCompareServiceDeps` | [`src/main/services/compare-service.ts`](src/main/services/compare-service.ts) | interface itfCompareServiceDeps - 인터페이스 정의 |
| `itfEffectiveExcludes` | [`src/main/services/effective-excludes.ts`](src/main/services/effective-excludes.ts) | interface itfEffectiveExcludes - 인터페이스 정의 |
| `itfExcludeFileHandle` | [`src/main/services/exclude-file.ts`](src/main/services/exclude-file.ts) | interface itfExcludeFileHandle - 인터페이스 정의 |
| `itfExcludeServiceDeps` | [`src/main/services/exclude-service.ts`](src/main/services/exclude-service.ts) | interface itfExcludeServiceDeps - 인터페이스 정의 |
| `itfJobContext` | [`src/main/services/job-context.ts`](src/main/services/job-context.ts) | interface itfJobContext - 인터페이스 정의 |
| _(외 140 건 생략)_ | - | 상세 항목은 소스 파일 직접 참조 |

