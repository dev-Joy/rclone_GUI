# Spec: 작은 파일이 많은 실행에서도 믿을 수 있는 남은 시간 표시

- Intent: [INT-004](intent.md) | Status: planned | 작성일: 2026-11-03

> 결정 근거는 intent의 D-01~D-03이다. 이 문서는 그 결정을 코드 위치·인터페이스·수용 기준으로 상세화한다.

## 1. 개요

- 지금 실행 화면의 "남은 시간"은 rclone stats의 `eta`를 그대로 보여 준다.
  - `src/main/parsers/log-parser.ts:125`에서 `etaSeconds`로 받는다.
  - `src/pages/RunStatsGrid.tsx:47`에서 그 값을 표시한다.
- rclone `eta`는 "남은 바이트 ÷ 최근 속도"라서, 파일당 처리 비용이 큰 대상(Google Drive)에서는 5시간~104시간~3분 사이를 오간다.
- 바꾸는 점: main이 stats 줄마다 남은 시간을 직접 계산해 `etaSeconds`에 넣는다.
  - 계산 방식: 누적 평균으로 파일 기준과 바이트 기준을 따로 구하고 긴 쪽을 쓴다(D-02). 진행 중인 파일의 부분 전송분을 반영하고(D-03), 표시값은 평활화한다.
  - 값이 안정되기 전에는 "계산 중"을 표시한다(D-01).
- 표시 전용 변경이다. 실행·게이트·명령 인자는 바꾸지 않는다.

## 2. 범위 (In-scope / Out-of-scope)

### 2.1 In-scope

- stats 파서: `transferring[]`에서 진행 중 파일의 부분 진행률 합(스칼라)을 뽑는다. 파일 이름은 버린다.
- 남은 시간 계산 순수 함수: 분모 결정, 누적 평균, 긴 쪽 선택, "계산 중" 판정, 표시값 평활화.
- run-service: rclone 단계(사전 확인·실제·dry-run)마다 계산 상태를 새로 만들고, stats 줄마다 계산값을 `etaSeconds`·`etaPending`에 넣는다.
- 화면: `RunStatsGrid`가 진행 중이면 "계산 중"·계산값을, 끝난 실행이면 "-"를 보여 준다.
- 실제 Google Drive 실행에서 얻은 stats fixture(경로·이름 가림)와 그 fixture로 하는 단위 테스트.
- `docs/CHANGELOG.md` 한 줄.

### 2.2 Out-of-scope

- 파일당 비용·대역폭 회귀 모델(D-02 한계).
- 확인(checks) 단계 소요 시간 예측. 바꿀 파일은 적고 확인할 파일만 많은 sync는 지금처럼 남은 시간이 잘 나오지 않을 수 있다.
- 진행률 막대(`progressPercent`)의 계산 방식 변경.
- 자동 실행·OS 예약 알림 문구 변경(이력에 남는 값만 같은 규칙을 따른다).
- rclone 명령 인자(`--stats 1s` 포함)와 이벤트 전달 간격(`run-events.ts` `statsIntervalMs` 기본 1000ms) 변경.

## 3. 영향 시스템 · 모듈 · 데이터

| 위치 | 현재 | 변경 |
| :--- | :--- | :--- |
| `src/main/parsers/log-parser.ts:89-106` `zRawStats` | `transferring` 미파싱 | `transferring`을 선택 항목으로 받는다(`bytes`·`size`만) |
| `src/main/parsers/log-parser.ts:108-130` `normalizeStats` | `etaSeconds` = rclone `eta` | `partialFiles`(부분 진행률 합)를 추가한다. `etaSeconds`는 rclone 값 그대로 두고 run-service가 덮어쓴다 |
| `src/shared/schemas/run.ts:38-55` `zRunStats` | `etaSeconds` nullable | `partialFiles`·`etaPending` 필드 추가(기본값이 있어 예전 이력도 읽힘) |
| `src/main/services/run-eta.ts` (신규) | — | 계산 순수 함수와 평활화 상태 타입 |
| `src/main/services/run-service.ts:1028-1035` `onLine` | 파싱한 stats를 그대로 snapshot·batcher에 넣음 | 활성 단계의 계산 상태로 `etaSeconds`·`etaPending`을 채운 stats를 넣는다 |
| `src/main/services/run-service.ts:962-1000` `spawnTransfer` | 단계마다 rclone 실행 | 단계 시작 때 계산 상태를 초기화한다(경과 시간이 프로세스마다 0부터 시작) |
| `src/main/services/run-service.ts:713`, `:420`, `:803-809` | 실제는 `gate.plan`, dry-run은 `dryRunPlan(job)`(없으면 null) | 분모 계산에 `active.record.plan`을 넘긴다 |
| `src/pages/RunStatsGrid.tsx:47` | `etaSeconds` null이면 "-" | `live` prop 추가: 진행 중이면 "계산 중" 또는 값, 끝났으면 "-" |
| `src/pages/RunView.tsx:94` | 진행 중 실행 | `live` 전달 |
| `src/pages/RunView.tsx:181`, `src/pages/HistoryDetail.tsx:120` | 끝난 실행 | 변경 없음(기본값 `live: false`) |
| `src/shared/format.ts:23` `formatDuration` | 시·분·초 | 변경 없음(재사용) |
| `tests/fixtures/rclone/` | 로컬 2파일 진행 fixture(`copy-progress.stderr.txt`) | Drive 실행 stats fixture 2개 추가(중단된 실행 `drive-small-files-progress-partial.stderr.txt`, 완료한 실행 `drive-small-files-progress.stderr.txt`) |
| `tests/unit/rclone-parsers.test.ts:161` | `normalizeStats` 테스트 | `partialFiles` 케이스 추가 |
| `tests/unit/run-eta.test.ts` (신규) | — | 계산·평활화·fixture 재생 테스트 |

- 데이터: 이력(`history`) 레코드의 `stats`·`preflight`에 필드 두 개가 늘어난다. 읽을 때 기본값을 채우므로 마이그레이션은 없다.
- 안전 규칙 1~3번 해당 코드(`command-builder.ts`, 게이트, `spawnTransfer` 시작 조건)는 건드리지 않는다.

## 4. 기능 요구사항 (FR-n)

- **FR-1 부분 진행률**: 파서는 `transferring[]`의 각 항목에서 `bytes`·`size`가 모두 유한한 수이고 `size > 0`일 때만 `min(bytes / size, 0.999)`를 구해 합한 값을 `partialFiles`로 낸다. 조건을 벗어난 항목(`bytes` 없음, `size` 0 또는 -1)은 0으로 센다. `transferring`이 없거나 형식이 틀리면 `partialFiles`는 0이다(stats 전체를 버리지 않는다).
- **FR-2 분모**: 전체 파일 수 = `max(plan.createFiles + plan.updateFiles, stats.totalTransfers)`, 전체 바이트 = `max(plan.transferBytes, stats.totalBytes)`.
  - 계획이 있으면 처음부터 분모가 확정된 것으로 본다.
  - 계획이 없으면(dry-run에 유효한 비교 결과 없음) rclone 값만 쓰고, 아래 중 하나가 될 때까지는 분모가 확정되지 않은 것으로 본다.
    - `totalChecks > 0`이고 `checks >= totalChecks`
    - `stats.totalTransfers`가 마지막으로 바뀐 뒤 경과 5초 동안 그대로임
  - 근거(2026-11-03 Drive 실측): 대상에 같은 파일이 없는 copy는 `totalChecks`가 끝까지 0이라 첫 조건만으로는 확정되지 않는다. `totalBytes`는 원본 변화 등으로 실행 중에도 오르내려 안정 판정에 쓰지 않는다.
- **FR-3 완료량**: 완료 파일 = `stats.transfers + stats.partialFiles`, 완료 바이트 = `stats.bytes`. 둘 다 분모를 넘지 않게 자른다.
- **FR-4 "계산 중" 해제(D-01)**: 아래를 모두 만족할 때만 숫자를 낸다. 그전에는 `etaPending = true`, `etaSeconds = null`이다.
  - 경과 10초 이상
  - 완료 파일 5개 이상 또는 바이트 진행률 5% 이상
  - 분모 확정(FR-2)
- **FR-5 원시 남은 시간(D-02)**: 경과를 `T`라 할 때 아래 두 값 중 큰 쪽을 원시 남은 시간으로 쓴다.
  - 파일 기준: `T × (전체 파일 − 완료 파일) / 완료 파일`. 완료 파일이 0이면 계산하지 않는다.
  - 바이트 기준: `T × (전체 바이트 − 완료 바이트) / 완료 바이트`. 완료 바이트가 0이면 계산하지 않는다.
  - 한쪽만 계산되면 그 값을 쓴다.
  - 해당 축의 분모가 0이면 그 축은 계산하지 않는다(예: 0바이트 파일만 있는 실행은 파일 기준만 쓴다).
- **FR-6 표시값 평활화(D-02)**: 평활화는 남은 시간이 아니라 **예상 총 소요(`T + 원시 남은 시간`)**에 지수 평균(시간 상수 30초)으로 건다.
  - 계수 `α = 1 − exp(−Δt / 30초)`. `Δt`는 직전 계산 이후 경과 차이이며 0 이하이면 갱신하지 않는다.
  - 표시 남은 시간 = `max(0, 평활 총 소요 − T)`.
  - 숫자가 처음 나오는 순간에는 평활값을 원시 총 소요로 초기화한다.
  - 남은 시간 자체를 평활하면 줄어드는 값을 계속 뒤따라가서 항상 약 30초 길게 나오기 때문이다.
- **FR-7 완료**: 남은 파일과 남은 바이트가 모두 0이면 평활과 관계없이 0초를 낸다.
- **FR-8 바꿀 것 없음**: 전체 파일·전체 바이트가 모두 0이면(삭제만 있는 sync 등) `etaPending = false`, `etaSeconds = null`로 내서 화면에 "-"를 표시한다.
- **FR-9 단계별 초기화**: 사전 확인 dry-run과 실제 실행은 각각 새 계산 상태로 시작한다. 이전 단계의 평활값과 분모 안정 판정(FR-2)을 이어 쓰지 않는다.
- **FR-10 화면**: `RunStatsGrid`의 "남은 시간" 칸 표시 규칙은 다음과 같다.
  - `live`이고 `etaPending`이면 "계산 중"
  - `live`이고 `etaSeconds`가 있으면 `formatDuration(etaSeconds × 1000)`
  - 그 밖(끝난 실행, 이력, 값 없음)은 "-"
- **FR-11 계산 위치**: 계산은 main의 `onLine`에서 stats 줄마다(이벤트 묶음 전에) 한다. 그래서 renderer에 전달하는 값과 이력에 남는 값이 같다.

## 5. 비기능 요구사항 (NFR-n)

- **NFR-1 순수성**: `run-eta.ts`의 함수는 입력만으로 결과를 내며 시계·I/O·전역 상태를 쓰지 않는다. 평활 상태는 호출자가 들고 다닌다.
- **NFR-2 비용**: stats 한 줄당 계산은 O(전송 중 항목 수)이고, 새 의존성을 들이지 않는다.
- **NFR-3 개인정보**: 파서는 `transferring[]`의 `name`·`srcFs`·`dstFs`를 결과에 남기지 않는다. fixture에는 실제 경로·remote 이름·파일 이름을 넣지 않는다(AGENTS 1장 4번).
- **NFR-4 호환성**: 예전 이력 레코드(새 필드 없음)를 읽어도 스키마 검증이 실패하지 않는다.
- **NFR-5 안전 규칙 불변**: 실행 시작·게이트·명령 인자 관련 코드에는 변경이 없다(diff로 확인).

## 6. 인터페이스 · 데이터 스키마

### 6.1 스키마 (초안)

```ts
// src/shared/schemas/run.ts — zRunStats에 추가
/** 진행 중 파일들의 부분 진행률 합(0 이상, 파일 이름 없음). 예전 기록에는 없어 0으로 읽는다 */
partialFiles: z.number().min(0).default(0),
/** 남은 시간을 아직 계산할 수 없음("계산 중"). 예전 기록에는 없어 false로 읽는다 */
etaPending: z.boolean().default(false),
// etaSeconds: 의미 변경 — main의 앱 계산값(진행 중), rclone 값은 run-service에서 덮어쓴다
```

```ts
// src/main/parsers/log-parser.ts — zRawStats에 추가 (확정: 필드 형태는 tests/fixtures/rclone/copy-progress.stderr.txt 확인)
transferring: z
    .array(z.object({ bytes: zNum.optional(), size: zNum.optional() }))
    .optional()
    .catch(undefined),
```

### 6.2 함수 (초안, `src/main/services/run-eta.ts`)

```ts
export interface itfEtaTotals {
    totalFiles: number;
    totalBytes: number;
    /** 분모가 더 늘지 않는다고 볼 수 있는지 */
    settled: boolean;
}

/** FR-2: 계획과 rclone stats로 분모를 정한다. stableMs는 totalTransfers가 그대로인 시간(호출자가 계산) */
export function etaTotals(stats: typRunStats, plan: typRunPlan | null, stableMs: number): itfEtaTotals;

/** FR-3~FR-5, FR-7, FR-8: 원시 남은 시간(초). "계산 중"이면 "pending", 바꿀 것 없음이면 null */
export function rawEtaSeconds(stats: typRunStats, totals: itfEtaTotals): number | "pending" | null;

export interface itfEtaState {
    /** 평활한 예상 총 소요(ms). 숫자가 처음 나오기 전에는 null */
    totalMs: number | null;
    /** 마지막으로 반영한 경과(ms) */
    atMs: number;
    /** 마지막으로 본 rclone totalTransfers (FR-2 안정 판정) */
    lastTotalTransfers: number;
    /** lastTotalTransfers가 그 값이 된 경과(ms) */
    stableSinceMs: number;
}

export interface itfEtaStep {
    state: itfEtaState;
    etaSeconds: number | null;
    etaPending: boolean;
}

/** FR-2, FR-6: 이전 상태와 이번 stats로 다음 상태와 표시값을 낸다 (tauMs 기본 30000, 단계 첫 줄은 prev null) */
export function nextEta(
    prev: itfEtaState | null,
    stats: typRunStats,
    plan: typRunPlan | null,
    tauMs?: number,
): itfEtaStep;
```

- 상수: 분모 안정 판정 시간 5,000ms, 평활 시간 상수 30,000ms.

- 확정: `typRunStats`·`typRunPlan`(`src/shared/schemas/run.ts`), `formatDuration`(`src/shared/format.ts:23`), `parseLogLine`·`normalizeStats`(`log-parser.ts`).
- 초안: 위 함수 이름·시그니처, `RunStatsGrid`의 `live` prop(기본값은 `propsDefault`로 `false`).

### 6.3 IPC

- 채널 추가·변경 없음. 기존 stats 이벤트의 `typRunStats` 모양만 필드 두 개가 늘어난다(`src/shared/ipc-contract.ts` 변경 없음).

## 7. 예외 · 엣지 케이스

| 상황 | 동작 |
| :--- | :--- |
| 큰 파일 하나뿐인 실행 | 완료 파일은 0이지만 `partialFiles`와 바이트 5%로 FR-4를 통과한다. 바이트 기준 값을 쓴다 |
| 작은 파일만 있고 바이트 진행이 거의 없음 | 파일 기준 값이 길어서 그쪽을 쓴다 |
| `transferring` 항목에 `bytes` 없음(대기 상태) | 0으로 센다(FR-1) |
| `size` -1·0(크기 모름, 빈 파일) | 0으로 센다 |
| rclone 합계가 계획보다 큼(재시도·비교 뒤 변경) | `max`로 분모를 키운다(FR-2) |
| 완료량이 분모를 넘음 | 분모로 자른다. 남은 양은 0 미만이 되지 않는다 |
| dry-run이고 유효한 비교 결과 없음 | rclone 합계만 쓰고 확인이 끝나거나 `totalTransfers`가 5초 동안 그대로일 때까지 "계산 중"으로 둔다 |
| `totalChecks`가 0으로 남는 copy(대상에 같은 파일 없음, 계획 없음) | `totalTransfers` 안정 조건(FR-2)으로 확정한다 |
| 실제 전송 바이트가 계획보다 훨씬 큼(2026-11-03 실측: 계획 약 434MB, rclone `totalBytes` 약 685MB까지 증가) | `max`로 분모를 키운다. 바이트 진행률이 일찍 100% 가까이 가서 바이트 기준이 거의 0이 되고 파일 기준이 표시된다 |
| 사전 확인 → 실제 실행 전환 | 계산 상태를 초기화한다(FR-9) |
| 같은 경과 시간의 stats가 두 번 옴 | `Δt ≤ 0`이므로 평활을 갱신하지 않고 직전 표시값을 다시 계산한다 |
| 취소·실패로 끝난 실행 | 이력에는 마지막 계산값이 남지만 화면은 `live`가 아니므로 "-"를 보인다 |
| 예전 이력(rclone `eta`가 든 `etaSeconds`) | `live`가 아니므로 "-"를 보인다 |
| stats 형식 오류 | 지금처럼 `normalizeStats`가 null을 내고 계산하지 않는다 |

## 8. 수용 기준 (AC-n)

- **AC-1** Given `transferring`에 `{bytes: 512, size: 1024}`와 `{size: 1024}`(bytes 없음)가 있는 stats, When `normalizeStats`, Then `partialFiles`는 0.5이고 결과 어디에도 파일 이름이 없다.
- **AC-2** Given 경과 9초·완료 50개인 stats, When `nextEta`, Then `etaPending`은 true이고 `etaSeconds`는 null이다.
- **AC-3** Given 경과 20초·완료 3개·바이트 2%·계획 있음, When `nextEta`, Then `etaPending`은 true이다. Given 같은 조건에서 바이트 6%, Then 숫자가 나온다.
- **AC-4** Given 경과 100초, 파일 50/1000개 완료, 바이트 50%, When 원시 계산, Then 파일 기준 1,900초와 바이트 기준 100초 중 1,900초를 쓴다.
- **AC-5** Given 계획 `createFiles+updateFiles = 1000`, rclone `totalTransfers = 200`, When `etaTotals`, Then `totalFiles`는 1000이고 `settled`는 true이다.
- **AC-6** Given 원시 총 소요가 3,600초로 일정한 연속 stats, When 1초 간격으로 `nextEta`를 반복, Then 표시값은 매번 `3,600 − 경과`와 1초 이내로 같다(뒤따름 지연 없음).
- **AC-7** Given 원시 총 소요가 한 틱에서 3,600초 → 36,000초로 튐, When 그 틱에 `nextEta`, Then 표시 총 소요는 `3,600 + (36,000 − 3,600) × (1 − e^(−1/30))`(약 4,662초) 이내로만 움직인다.
- **AC-8a 안정성** Given 2026-11-03 Drive 실행 fixture(1,815개 중 667개에서 중단, `drive-small-files-progress-partial.stderr.txt`)를 처음부터 재생, When "계산 중"이 풀린 뒤 표시값이 60초 이상인 인접한 두 지점, Then 두 표시값의 비율은 2배를 넘지 않는다. (spec 작성 때 원본 로그 재생 결과 최대 1.03배, 표시값 1.1~1.5시간, 같은 구간 rclone `eta`는 20초~5.7시간)
- **AC-8b 정확도** Given 끝까지 완료한 Drive 실행 fixture(작은 파일 200개 + 30MB 파일 1개, `drive-small-files-progress.stderr.txt`)를 처음부터 재생, When "계산 중"이 풀린 뒤 남은 시간이 60초 이상인 모든 지점, Then 표시값은 그 지점의 실제 남은 시간(마지막 stats 경과 − 현재 경과)의 1/3배 이상 3배 이하이고(intent "같은 자릿수"), 인접한 두 표시값의 비율은 2배를 넘지 않는다.
- **AC-8 허용 범위 고정**: 위 범위(1/3~3배, 인접 2배)는 fixture를 재생하기 전에 고정한다. 테스트 결과를 보고 범위를 맞추지 않는다. 바꿔야 하면 넓히는 방향만 허용하고 §10에 사유를 남긴다.
- **AC-9** Given 진행 중 실행 화면, When stats의 `etaPending`이 true, Then "남은 시간" 칸에 "계산 중"이 보인다. Given 끝난 실행·이력 화면, Then "-"가 보인다.
- **AC-10** Given 새 필드가 없는 예전 이력 JSON, When `zRunRecord`로 파싱, Then 성공하고 `partialFiles` 0, `etaPending` false로 읽힌다.
- **AC-11** Given 전체 파일·바이트 0인 sync(삭제만), When `nextEta`, Then `etaPending`은 false이고 `etaSeconds`는 null이다.
- **AC-12** Given 이 변경의 diff, Then `command-builder.ts`, 게이트(`f_CheckRealGate`·`checkPlanSafety`), `spawnTransfer`의 시작 조건은 바뀌지 않았다.
- **AC-13** Given 계획 없음, `totalChecks` 0, 완료 파일 20개, `totalTransfers`가 경과 6초부터 200으로 그대로인 연속 stats, When 경과 10초에 `nextEta`, Then `etaPending`은 true이다(그대로인 시간 4초). When 경과 11초, Then 숫자가 나온다. Given 경과 11초 직전에 `totalTransfers`가 늘었으면, Then `etaPending`은 true이다.

## 9. 가정과 리스크

- **가정**: 비교 계획의 `createFiles + updateFiles`는 rclone이 실제로 전송할 파일 수와 거의 같다. 비교와 실행 사이에 원본이 바뀌면 어긋나며, FR-2의 `max`로 줄이기만 한다.
- **실측(2026-11-03)**: 바이트는 이 가정이 맞지 않을 수 있다. Drive 실행에서 rclone `totalBytes`는 계획(약 434MB)에서 380초에 약 685MB로 뛰었고, 이후 바이트 진행률이 거의 100%에 머물렀다(원인 미확인: 원본 변화 또는 업로드 재시도 추정). 이런 실행에서는 바이트 기준이 사실상 0이 되고 파일 기준만 의미가 있다. "긴 쪽" 규칙으로 처리되므로 설계는 바꾸지 않는다.
- **가정**: rclone `transfers`는 완료한 전송만 센다. 실패한 파일은 `errors`로 가고 남은 파일로 남아 남은 시간이 약간 길게 나올 수 있다(허용).
- **리스크**: 파일 순서가 치우치면(큰 파일이 끝에 몰림) 누적 평균이 빗나간다(D-02 한계). AC-8의 3배 범위는 이 한계를 감수한 값이다.
- **리스크**: `etaSeconds`의 의미가 바뀐다. 예전 이력은 rclone 값, 새 이력은 앱 계산값이 들어 있다. 끝난 실행은 화면에 "-"만 보이므로 사용자에게는 차이가 없다.
- **리스크**: 완료한 Drive 실행 fixture를 확보하지 못하면 AC-8b(정확도)를 검증할 수 없다. 2026-11-03 로그는 중단된 실행이라 AC-8a(안정성)에만 쓴다 → §10 Q-1.
- **설계 보완**: 평활화 대상을 "남은 시간"이 아니라 "예상 총 소요"로 정했다(FR-6). intent D-02의 "표시값에만 지수 평균"을 구체화한 것이며, 계산값은 누적값 그대로 두는 원칙은 같다.

## 10. 미해결 질문 (Open questions)

- [x] **Q-1** 2026-11-03 Drive 실행의 rclone 로그 파일(이력의 `logFile`)이 끝까지 남아 있나? → 남아 있지만 끝까지 간 실행이 아니다(2026-11-03 확인). stats 2,302줄, 경과 2,302초, 1,815개 중 667개에서 멈췄다.
  - 그래서 AC-8을 둘로 나눴다. 이 로그는 가려서 AC-8a(안정성) fixture로 쓴다.
  - AC-8b(정확도)는 Drive 수용 테스트와 같은 조건(`RCLONEGUI_TEST_DRIVE_REMOTE`, `rclonegui-test-it/` 아래)으로 작은 파일 200개와 30MB 파일 하나를 올리는 실행을 한 번 해서 로그를 받는다(초당 약 0.3개 기준 15분 안팎).
- [x] **Q-2** 계획 없는 copy에서 `totalChecks`가 0으로 남으면 FR-2의 확정 조건이 끝까지 안 풀릴 수 있나? → 그렇다(2026-11-03 확인). 위 Drive 실제 copy에서도 `totalChecks`는 처음부터 끝까지 0이었다. dry-run에 한정된 문제가 아니라, 대상에 같은 파일이 없는 copy면 늘 생긴다.
  - "경과 10초 뒤 확정"은 목록 작성이 10초보다 오래 걸리면 분모가 늘어나는 중에 확정해 버려 채택하지 않았다.
  - 대신 FR-2에 "`totalTransfers`가 5초 동안 그대로이면 확정"을 추가했다(AC-13).
- [x] **Q-3** AC-8의 허용 범위(1/3~3배, 인접 2배)는 fixture로 처음 재생해 본 뒤 조정할 수 있나? → 조정하지 않고 지금 고정한다(2026-11-03). 결과를 보고 범위를 맞추면 테스트가 의미를 잃는다.
  - 원본 로그 재생에서 인접 비율은 최대 1.03배였다. 다만 남은 시간이 1~2분인 끝 구간은 작은 변화도 비율이 커서 2배를 유지한다.
  - 바꿔야 하면 넓히는 방향만 허용하고 사유를 여기에 남긴다(AC-8 허용 범위 고정).
