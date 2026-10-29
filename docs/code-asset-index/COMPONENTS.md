# Project Code Asset Index: rclonegui

- 생성일시: 2026-10-29 19:52:40
- 감지된 환경: React / TypeScript
- 스캔 대상 디렉터리: `src/components`, `src/lib`, `src/main/lib`, `src/main/services`, `src/shared`, `src/shared/schemas`, `src/shared/types`
- 총 인덱싱 자산: 236 건

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

## 3. Utilities & Helpers

| 함수 / 심볼 | 정의 파일 | 시그니처 / 요약 |
| :--- | :--- | :--- |
| `errorText` | [`src/lib/api.ts`](src/lib/api.ts) | errorText(e: unknown) - 사용자에게 보일 오류 문구 |
| `getApi` | [`src/lib/api.ts`](src/lib/api.ts) | getApi() - 공통 함수/유틸리티 |
| `reasonText` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | reasonText(reasons: readonly typModifiedReason[]) - 변경 사유 문구. 예: ["size", "mtime"] → "크기, 수정시간" |
| `statusLabel` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | statusLabel(status: typCompareStatus, mode: typRunMode) - 상태 라벨. onlyDest: copy "대상만(유지)", sync "대상만(삭제 예정)" |
| `statusTone` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | statusTone(status: typCompareStatus, mode: typRunMode) - 공통 함수/유틸리티 |
| `summaryCards` | [`src/lib/compare-view.ts`](src/lib/compare-view.ts) | summaryCards(s: itfCompareSummary, mode: typRunMode) - 요약 카드. 문구는 일어날 일: "대상에 12개 복사", "8개 덮어씀", sync "3개 삭제" / copy "3개 대상에만 있음(유지)" |
| `numberIssueText` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | numberIssueText(value: unknown, range: itfNumberRange) - 숫자 필드 오류 문구 |
| `numberText` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | numberText(value: number) - number → 입력란 문자열. NaN은 빈칸 |
| `stableStringify` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | stableStringify(value: unknown) - 키 순서와 무관한 JSON 직렬화 (NaN은 null로 같아진다) |
| `toNumber` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | toNumber(text: string) - 숫자 입력란 문자열 → number. 빈칸·숫자가 아니면 NaN (저장 전 검증에서 막힌다) |
| `historyCounts` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | historyCounts(r: Pick<typRunRecord, "stats" \| "plan" \| "dryRun">) - 표의 결과 요약. 예: "복사 3 · 삭제 1 · 1.5 KB · 오류 0". 통계가 없으면 계획, 둘 다 없으면 "-" |
| `historyKind` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | historyKind(r: Pick<typRunRecord, "dryRun" \| "trigger">) - 미리보기 > 자동 > 수동 |
| `statusTone` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | statusTone(status: typRunStatus) - 공통 함수/유틸리티 |
| `excludesToText` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | excludesToText(excludes: readonly string[]) - 공통 함수/유틸리티 |
| `isDraftEqual` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | isDraftEqual(a: typJobDraft, b: typJobDraft) - 편집 가능한 값이 같은지 (dirty 판정). excludes 순서까지 비교 |
| `jobToDraft` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | jobToDraft(job: typJob) - 저장된 Job에서 편집 가능한 필드만 뽑는다 (id·rev·lastRun·nextRunAt 등 제외) |
| `parseExcludesText` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | parseExcludesText(text: string) - textarea 문자열 → excludes (trim, 빈 줄 제거, 순서 유지) |
| `serverErrorToCheck` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | serverErrorToCheck(error: typAppErrorPayload) - main 오류 envelope를 폼 오류로. SAFETY_BLOCKED/PATH_INVALID 메시지의 "원본:"/"대상:" 접두사는 해당 필드로, 나머지는 formErrors |
| `sortJobs` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | sortJobs(jobs: readonly typJob[]) - 사이드바 정렬: 이름(ko, base) → createdAt |
| `validateJobDraft` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | validateJobDraft(draft: typJobDraft, caseInsensitive: boolean) - 화면 검증: zJobDraft.safeParse + checkPathPair + 경고 규칙 |
| `pathKindBadge` | [`src/lib/path-display.ts`](src/lib/path-display.ts) | pathKindBadge(raw: string) - 입력 원문의 배지. 빈 값은 null, 형식 오류는 { text: "형식 오류", kind: null } |
| `canStartRun` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | canStartRun(input: itfCanStartRunInput) - 미리보기·실제 실행 버튼 가능 여부와 이유. 공통: 저장 안 됨 → 미저장 변경 → 경로 오류 → 비교 중 → 실행 중. |
| `deleteSamples` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | deleteSamples(result: itfCompareResult, limit = 20) - 삭제 예정(대상에만 있음) 파일 샘플. 비교 결과 순서(경로 오름차순)로 최대 limit개 |
| `dryRunHeadline` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | dryRunHeadline(s: itfDryRunSummary) - dry-run 요약 한 줄. 예: "실행하면 대상에 3개 복사(24 B), 1개 수정시간만 맞춤, 2개 삭제" |
| `progressPercent` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | progressPercent(stats: typRunStats \| null) - 진행률(0~100). 바이트 기준, 바이트를 모르면 파일 수 기준. 계산할 수 없으면 null |
| `realRunConfirmText` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | realRunConfirmText(s: itfCompareSummary, mode: typRunMode) - 실제 실행 확인 문구(비교 결과 기준). 예: "대상에 3개 복사, 1개 덮어씀 (총 1.2 MB)" |
| `runStatusText` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | runStatusText(status: typRunStatus, dryRun: boolean, mode: typRunMode) - 상태 문구. 예: 미리보기 완료, 복사 완료, 복사 취소됨 |
| `isSettingsEqual` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | isSettingsEqual(a: typSettings, b: typSettings) - 공통 함수/유틸리티 |
| `settingsToPatch` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | settingsToPatch(s: typSettings) - 화면에 노출된 섹션만 patch로 (defaults, compare, safety, logs, ui). scheduler(일시정지)는 넣지 않는다: settings:update가 거부하며 scheduler:setPaused로만 바꾼다. |
| `validateSettingsDraft` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | validateSettingsDraft(s: typSettings) - 공통 함수/유틸리티 |
| `fail` | [`src/main/lib/app-error.ts`](src/main/lib/app-error.ts) | fail(e: unknown) - 공통 함수/유틸리티 |
| `toErrorPayload` | [`src/main/lib/app-error.ts`](src/main/lib/app-error.ts) | toErrorPayload(e: unknown) - 공통 함수/유틸리티 |
| `redactSecrets` | [`src/main/lib/logger.ts`](src/main/lib/logger.ts) | redactSecrets(text: string) - 공통 함수/유틸리티 |
| `fileStamp` | [`src/main/lib/time.ts`](src/main/lib/time.ts) | fileStamp(d = new Date() - 파일 이름용 시각. 예: 20261028-173500 (로컬 시각) |
| `nowIso` | [`src/main/lib/time.ts`](src/main/lib/time.ts) | nowIso() - 공통 함수/유틸리티 |
| `remoteNameOf` | [`src/main/services/job-context.ts`](src/main/services/job-context.ts) | remoteNameOf(p: itfParsedPath) - remote 경로면 remote 이름("gdrive"), 아니면 null (오류 안내 문구용) |
| `runLogPath` | [`src/main/services/log-retention.ts`](src/main/services/log-retention.ts) | runLogPath(logsDir: string, fileName: string) - logs 폴더 안의 실행 로그 경로. 이름이 실행 로그 모양이 아니거나 폴더 밖이면 null |
| `remoteParentOf` | [`src/main/services/path-service.ts`](src/main/services/path-service.ts) | remoteParentOf(p: itfParsedPath) - remote 경로의 부모와 이름. 맨 앞 / 는 보존한다. "rr:a/b" → { parent: "rr:a", name: "b" }, "rr:/a" → { parent: "rr:/", name: "a" }, "rr:" → null |
| `computePlanToken` | [`src/main/services/plan-token.ts`](src/main/services/plan-token.ts) | computePlanToken(input: itfPlanTokenInput) - sha256(고정 순서 배열의 JSON) hex 앞 32자 |
| `runLogFileName` | [`src/main/services/run-log-file.ts`](src/main/services/run-log-file.ts) | runLogFileName(at: Date, jobId: string, runId: string) - 실행 로그 파일 이름. 예: run-20261028-173500-1a2b3c4d-5e6f7a8b.log |
| `recoverActiveRun` | [`src/main/services/run-recovery.ts`](src/main/services/run-recovery.ts) | recoverActiveRun(deps: itfRecoverDeps) - 앱 시작 때 한 번. 결과와 관계없이 active-run.json은 지운다(이력은 markInterrupted가 정리) |
| `autoOutcomeNotice` | [`src/main/services/scheduler.ts`](src/main/services/scheduler.ts) | autoOutcomeNotice(o: itfAutoOutcome) - 자동 실행 결과 알림 문구(작업 이름·수만). noop이면 null |
| `createDefaultSettings` | [`src/shared/defaults.ts`](src/shared/defaults.ts) | createDefaultSettings() - 공통 함수/유틸리티 |
| `createJobDraft` | [`src/shared/defaults.ts`](src/shared/defaults.ts) | createJobDraft(settings: typSettings) - 설정의 기본 옵션으로 빈 Job 초안을 만든다. 화면의 "새 작업"에서 쓴다. |
| `emptySummary` | [`src/shared/diff-engine.ts`](src/shared/diff-engine.ts) | emptySummary() - 공통 함수/유틸리티 |
| `formatBytes` | [`src/shared/format.ts`](src/shared/format.ts) | formatBytes(bytes: number) - 1024 단위. 예: 1536 → "1.5 KB" |
| `formatDuration` | [`src/shared/format.ts`](src/shared/format.ts) | formatDuration(ms: number) - 예: 3_723_000 → "1시간 2분 3초", 450 → "0.5초" |
| `formatLocalDateTime` | [`src/shared/format.ts`](src/shared/format.ts) | formatLocalDateTime(iso: string \| null) - UTC ISO 문자열을 로컬 시각 "YYYY-MM-DD HH:mm:ss"로. 잘못된 값이면 "-" |
| `formatModTime` | [`src/shared/format.ts`](src/shared/format.ts) | formatModTime(ms: number \| null) - 파일 수정시간(ms)을 로컬 "YYYY-MM-DD HH:mm:ss"로. 모르면(null·잘못된 값) "—" |
| `formatPercent` | [`src/shared/format.ts`](src/shared/format.ts) | formatPercent(part: number, total: number) - 예: (1, 3) → "33%". total이 0이면 "-" |
| _(외 22 건 생략)_ | - | 상세 항목은 소스 파일 직접 참조 |

## 4. Shared Services & Clients

| 클래스 / 서비스 | 정의 파일 | 설명 / 주요 메서드 |
| :--- | :--- | :--- |
| `clsApiError` | [`src/lib/api.ts`](src/lib/api.ts) | class clsApiError - 공유 서비스/클라이언트 클래스 |
| `clsAppError` | [`src/main/lib/app-error.ts`](src/main/lib/app-error.ts) | class clsAppError - 공유 서비스/클라이언트 클래스 |
| `clsLogger` | [`src/main/lib/logger.ts`](src/main/lib/logger.ts) | class clsLogger - 공유 서비스/클라이언트 클래스 |
| `clsMutex` | [`src/main/lib/mutex.ts`](src/main/lib/mutex.ts) | class clsMutex - 공유 서비스/클라이언트 클래스 |
| `clsActivityLock` | [`src/main/services/activity-lock.ts`](src/main/services/activity-lock.ts) | class clsActivityLock - 공유 서비스/클라이언트 클래스 |
| `clsCompareService` | [`src/main/services/compare-service.ts`](src/main/services/compare-service.ts) | class clsCompareService - 공유 서비스/클라이언트 클래스 |
| `clsFsGate` | [`src/main/services/path-service.ts`](src/main/services/path-service.ts) | class clsFsGate - 응답 없는 fs 호출 제한. 시간 제한은 기다림만 끊고 fs.stat/opendir은 libuv 스레드풀(기본 4)에 남는다. 응답 없는 UNC·WSL 경로를 |
| `clsPathService` | [`src/main/services/path-service.ts`](src/main/services/path-service.ts) | class clsPathService - 공유 서비스/클라이언트 클래스 |
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
| `itfNumberRange` | [`src/lib/form-utils.ts`](src/lib/form-utils.ts) | interface itfNumberRange - 인터페이스 정의 |
| `itfHistoryFilter` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | interface itfHistoryFilter - 인터페이스 정의 |
| `typHistoryKind` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | type typHistoryKind - 타입 별칭 정의 |
| `typHistoryKindFilter` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | type typHistoryKindFilter - 타입 별칭 정의 |
| `typHistoryStatusFilter` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | type typHistoryStatusFilter - failed에는 일부 실패·중단됨도 들어간다 |
| `typHistoryTone` | [`src/lib/history-view.ts`](src/lib/history-view.ts) | type typHistoryTone - ZBCBadge tone과 같은 값 |
| `itfJobFormCheck` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | interface itfJobFormCheck - 인터페이스 정의 |
| `typJobFormField` | [`src/lib/job-form.ts`](src/lib/job-form.ts) | type typJobFormField - 타입 별칭 정의 |
| `itfPathKindBadge` | [`src/lib/path-display.ts`](src/lib/path-display.ts) | interface itfPathKindBadge - 인터페이스 정의 |
| `itfCanStartRunInput` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | interface itfCanStartRunInput - 인터페이스 정의 |
| `itfDeleteConfirmInfo` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | interface itfDeleteConfirmInfo - 인터페이스 정의 |
| `itfDeleteSample` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | interface itfDeleteSample - 인터페이스 정의 |
| `typCheck` | [`src/lib/run-view.ts`](src/lib/run-view.ts) | type typCheck - 타입 별칭 정의 |
| `itfSettingsFormCheck` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | interface itfSettingsFormCheck - 인터페이스 정의 |
| `typSettingsFormField` | [`src/lib/settings-form.ts`](src/lib/settings-form.ts) | type typSettingsFormField - 타입 별칭 정의 |
| `itfPathProbeState` | [`src/lib/use-path-probe.ts`](src/lib/use-path-probe.ts) | interface itfPathProbeState - 인터페이스 정의 |
| `itfVirtualRows` | [`src/lib/use-virtual-rows.ts`](src/lib/use-virtual-rows.ts) | interface itfVirtualRows - 인터페이스 정의 |
| `itfRowWindow` | [`src/lib/virtual-rows.ts`](src/lib/virtual-rows.ts) | interface itfRowWindow - 인터페이스 정의 |
| `typAppLogLevel` | [`src/main/lib/logger.ts`](src/main/lib/logger.ts) | type typAppLogLevel - 타입 별칭 정의 |
| `typActivity` | [`src/main/services/activity-lock.ts`](src/main/services/activity-lock.ts) | type typActivity - 타입 별칭 정의 |
| `itfCompareServiceDeps` | [`src/main/services/compare-service.ts`](src/main/services/compare-service.ts) | interface itfCompareServiceDeps - 인터페이스 정의 |
| `itfJobContext` | [`src/main/services/job-context.ts`](src/main/services/job-context.ts) | interface itfJobContext - 인터페이스 정의 |
| `itfJobContextDeps` | [`src/main/services/job-context.ts`](src/main/services/job-context.ts) | interface itfJobContextDeps - 인터페이스 정의 |
| `itfFsGateOptions` | [`src/main/services/path-service.ts`](src/main/services/path-service.ts) | interface itfFsGateOptions - 인터페이스 정의 |
| `itfPathServiceDeps` | [`src/main/services/path-service.ts`](src/main/services/path-service.ts) | interface itfPathServiceDeps - 인터페이스 정의 |
| `typPathServiceInit` | [`src/main/services/path-service.ts`](src/main/services/path-service.ts) | type typPathServiceInit - 타입 별칭 정의 |
| `itfPlanTokenInput` | [`src/main/services/plan-token.ts`](src/main/services/plan-token.ts) | interface itfPlanTokenInput - 인터페이스 정의 |
| `itfBatcherTimers` | [`src/main/services/run-events.ts`](src/main/services/run-events.ts) | interface itfBatcherTimers - 인터페이스 정의 |
| `itfRunEventBatcherOptions` | [`src/main/services/run-events.ts`](src/main/services/run-events.ts) | interface itfRunEventBatcherOptions - 인터페이스 정의 |
| `itfRunLogHeader` | [`src/main/services/run-log-file.ts`](src/main/services/run-log-file.ts) | interface itfRunLogHeader - 인터페이스 정의 |
| _(외 90 건 생략)_ | - | 상세 항목은 소스 파일 직접 참조 |

