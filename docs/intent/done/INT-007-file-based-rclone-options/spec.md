# Spec: 제외 패턴을 --filter-from 파일로 전달해 명령줄 전용 패턴 제한과 뒤 공백 버그 해소

- Intent: [INT-007](intent.md) | Status: done | 작성일: 2026-11-03

> 이 spec은 intent를 구현할 수 있는 수준으로 풀어 쓴 문서다. 내용이 서로 다르면 intent가 우선한다.
> 심볼과 경로는 커밋 `d457138` 기준이다(작업 트리의 INT-006 미커밋 변경은 이 범위와 겹치지 않는다). rclone 동작 근거는 `docs/knowhow/rclone-notes.md` #18~#21, #46~#50, 그리고 §6.3의 2026-11-03 사전 실측(v1.75.1).

## 1. 개요

| 영역 | 지금 | 목표 |
| :--- | :--- | :--- |
| 전달 방식 | 패턴이 64개 이하이고 인자 길이 합이 8,000자 이하면 모두 `--exclude` 인자. 넘으면 `isFileSafePattern`인 것만 `--exclude-from` 파일, 나머지는 인자 | 패턴이 하나라도 있으면 늘 `--filter-from` 파일 하나. 인자 `--exclude`는 만들지 않는다 |
| 파일 줄 형식 | 패턴 그대로(`#`·`;` 줄은 주석, 앞뒤 공백 삭제, #18) | `- <패턴>`. 패턴 끝의 공백 문자는 `[<문자>]`로 바꾼다(#47·#48) |
| 저장 제한 | 공용+작업 전용 500개, 그리고 인자 전용 작업 패턴 길이 합 16,000자(`EXCLUDE_ARG_ONLY_BUDGET`) | 500개만 남긴다 |
| 뒤 공백 패턴 | 인자로 넘기지만 rclone이 공백을 지운다(#48). 저장한 것과 다른 규칙이 적용된다 | 저장한 그대로 적용된다 |

### 1.1 뒤 공백 버그의 실제 영향 범위 (조사 결과)
- 작업 편집기 입력란은 줄마다 `trim()`한다(`src/lib/job-form.ts:288` `parseExcludesText`). 공용 라이브러리는 앞뒤 공백을 거부한다(`libraryPatternIssue`). 그래서 **화면으로는 앞뒤 공백 패턴을 저장할 수 없다.**
- 저장 스키마 `zExcludes`(`src/shared/schemas/job.ts:32`)는 공백을 지우지 않는다. 그래서 IPC를 직접 부르거나 이전 데이터에 남아 있으면 저장된다. 버그는 실제로 생길 수 있지만 영향은 작다.
- 예외: U+0085(NEL)는 JS `trim()`이 지우지 않고 저장 검사(`\u0000-\u001f`)도 통과한다. 그런데 rclone은 지운다(§6.3). 그래서 화면에 붙여넣으면 끝 U+0085 패턴이 저장되고, 지금은 그 문자가 빠진 규칙이 적용된다. 드문 경우다.
- 그래서 T-02 우선순위는 P2로 내렸다(§10 Q-3).

## 2. 범위 (In-scope / Out-of-scope)

**In-scope**
- 필터 파일 내용 생성(순수 함수)과 그 단위 테스트
- `resolveEffectiveExcludes` 결과 형식 변경, `snapshotHash` 버전 2
- `command-builder`의 `--exclude`·`--exclude-from` → `--filter-from`
- 비교(`compare-service`)와 미리보기·사전 확인·실제 전송(`run-service`)의 호출부 변경. 자동·OS 예약 실행은 `runs.start*`를 거치므로 코드 변경 없이 따라온다
- 인자 전용 예산과 전달 방식 기준 상수 제거, 저장 오류 문구 정리
- probe 보강(공백이 아닌 유니코드 공백, `\ ` 이스케이프), 통합 테스트, 문서(MVP_SPEC·rclone-notes·CHANGELOG)

**Out-of-scope**
- rc(`rcd` + `sync/sync`) 전환(INBOX 2026-11-03-02)
- 편집기 입력란이 공백을 지우는 동작 변경(앞뒤 공백 패턴을 화면에서 입력할 수 있게 하는 것)
- 공용 라이브러리의 `#`·`;` 시작 금지 해제(DB CHECK 변경이 필요하다, §10 Q-2)
- `+`(포함) 규칙·`--include`·`--filter` 지원
- 폴더 탐색·경로 확인(`buildListDirsArgs`·`buildProbeListArgs`). 제외 패턴을 쓰지 않으므로 바뀌지 않는다

## 3. 영향 시스템 · 모듈 · 데이터

| 파일 | 지금 | 변경 |
| :--- | :--- | :--- |
| `src/shared/exclude-patterns.ts` | `isFileSafePattern`(51), `planExcludeTransport`(95), `itfExcludeTransport`(26), `f_ArgChars`·`ARG_OVERHEAD`(21·87), `excludesSaveIssue`(110, 예산 검사 포함), `libraryPatternIssue`(39, `#`·`;` 문구가 "제외 파일에서 주석으로 읽힘") | 필터 줄 함수 추가(§6.1). 전달 방식 함수·예산 검사 삭제. 공용 패턴 `#`·`;` 문구 수정 |
| `src/shared/option-limits.ts` | `EXCLUDE_FILE_MIN_COUNT`·`EXCLUDE_FILE_MIN_CHARS`·`EXCLUDE_ARG_ONLY_BUDGET` | 셋 삭제. `WIN_CMDLINE_MAX`·`CMDLINE_SAFETY_MARGIN`은 유지 |
| `src/main/services/effective-excludes.ts` | `itfEffectiveExcludes { patterns, argPatterns, filePatterns, fileContent, snapshotHash }`, `HASH_VERSION = 1` | `{ patterns, fileContent, snapshotHash }`, `HASH_VERSION = 2` |
| `src/main/services/exclude-file.ts` | `writeExcludeFile`·`cleanupExcludeFiles`, 파일 이름 `excl-<cmp\|run>-<UUID>.txt` | 동작 유지. 머리 주석만 `--filter-from`으로. 파일 이름 접두사는 유지(시작 정리 호환) |
| `src/main/rclone/command-builder.ts` | `itfExcludeArgs { patterns, fromFile }`(256), `f_PushCommon`(359)이 `--exclude P`… `--exclude-from F`. 머리 주석 7행 "`--filter-from`은 만들지 않음" | `itfExcludeArgs { filterFile: string \| null }`, `--filter-from F` 하나. 주석·`buildLsjsonArgs` JSDoc 갱신 |
| `src/main/services/compare-service.ts` | 348~358: `fileContent`가 있으면 `writeExcludeFile(…, "cmp")`, `{ patterns: argPatterns, fromFile }` | `{ filterFile: file?.path ?? null }` |
| `src/main/services/run-service.ts` | 839~846: 파일 생성·`active.excludeFile`, 974: `{ patterns: argPatterns, fromFile: active.excludeFile }` | 974만 `{ filterFile: active.excludeFile }` |
| `src/main/services/plan-token.ts` | 첫 필드 버전 `4`, `excludeSnapshotHash` 포함 | 변경 없음(해시 버전이 바뀌면 토큰도 달라진다, §10 Q-4) |
| `src/main/index.ts` | 628: "남은 --exclude-from 임시 파일 정리" | 주석만 |
| `src/shared/schemas/job.ts` | 141~146 `f_ExcludesTotal` → `excludesSaveIssue` | 호출은 그대로, 함수 안에서 예산 검사만 빠진다 |
| `scripts/probes/rclone-probes.mjs` | `filter` 묶음(F1~F6) | F7·F8 추가(§6.3) |
| 테스트 | `tests/unit/exclude-patterns.test.ts`(69~100), `effective-excludes.test.ts`, `command-builder.test.ts`(35·84·143·240·494~510), `tests/integration/excludes-file.test.ts`(44~) | §8 기준으로 갱신·추가 |
| 문서 | `docs/specs/MVP_SPEC.md` 99·291·941~948·1077·1088행, `rclone-notes.md` #18·#20 영향, `docs/CHANGELOG.md` | 갱신 |

데이터: DB 스키마 변경 없음. 비교 결과(`excludeHash`)는 메모리 캐시라 앱을 업데이트하고 다시 시작하면 사라진다. 마이그레이션은 필요 없다.

## 4. 기능 요구사항 (FR-n)

- **FR-1** 적용 패턴(`mergeExcludePatterns` 결과)이 1개 이상이면 필터 파일 내용은 패턴마다 한 줄 `- <변환된 패턴>`이고, 순서는 적용 순서와 같다. 줄 끝은 LF, 마지막 줄도 LF로 끝나며, BOM과 빈 줄은 없다.
- **FR-2** 적용 패턴이 0개면 필터 파일을 만들지 않고 `--filter-from`도 넘기지 않는다.
- **FR-3** 패턴 끝에 이어진 공백 문자는 각각 `[<문자>]`로 바꾼다. 공백 문자 집합은 rclone(Go `unicode.IsSpace`)이 지우는 문자와 같게 명시한다: `[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`(§6.3 실측). JS `\s`는 쓰지 않는다(U+0085가 빠지고, rclone이 지우지 않는 U+FEFF가 들어간다). 바로 앞에 이스케이프 역슬래시가 있으면(끝 공백 직전의 연속 `\` 개수가 홀수) 그 역슬래시 하나를 지우고 바꾼다. 다른 위치의 문자는 바꾸지 않는다.
- **FR-4** 필터 파일의 모든 줄은 `- `로 시작한다. `+ `·`!` 줄을 만드는 코드 경로가 없다.
- **FR-5** rclone 명령에는 `--exclude`·`--exclude-from`·`--include*`·`--filter`(단독)를 넣지 않는다. 필터 파일이 있으면 `--filter-from <파일>`을 `--config` 뒤, `--` 앞에 한 번 넣는다.
- **FR-6** 비교의 두 `lsjson`, 미리보기 dry-run, 사전 확인 dry-run, 실제 sync/copy는 같은 실행 문맥에서 만든 필터 파일 하나(비교 1개, 실행 1개)를 쓴다. 지금의 파일 수명주기(생성 `wx`·다시 읽어 확인·종료 시 삭제·시작 시 `excl-*.txt` 정리)를 그대로 쓴다.
- **FR-7** `snapshotHash`는 `[2, patterns, fileContent]`의 sha256 앞 32자다. 비교와 실행의 해시가 다르면 지금처럼 `PLAN_STALE`로 막는다.
- **FR-8** 작업 저장 검사(`excludesSaveIssue`)는 공용+작업 전용 합계 500개 초과만 막는다.
- **FR-9** 공용 라이브러리의 `#`·`;` 시작 금지는 유지한다. 오류 문구에서 "rclone 제외 파일에서 주석으로 읽힘"을 빼고 "공용 패턴은 #·;로 시작할 수 없습니다. 이 작업 전용 패턴으로 쓰세요."로 바꾼다.
- **FR-10** 실행 로그·이력·오류 메시지에 필터 파일 내용(패턴)을 쓰지 않는다. 명령 머리말의 파일 경로는 지금 `--exclude-from` 경로처럼 기록해도 된다.

## 5. 비기능 요구사항 (NFR-n)

- **NFR-1** 안전 규칙 1~3 불변. 실제 전송 시작은 `spawnTransfer` 한 곳, 게이트(계획 토큰·삭제 수·사전 확인·`--max-delete`·`--backup-dir`·자동 조건) 순서와 조건이 같다.
- **NFR-2** 같은 패턴 집합에 대해 비교 결과(남은 항목·건너뛴 동작)가 지금 인자 방식과 같다(#20의 200개 패턴 기준).
- **NFR-3** rclone 1.65.0과 1.75.1에서 같은 결과(T-05).
- **NFR-4** 성능: 비교·실행마다 작은 파일 1개(최대 500줄 × 약 520바이트)를 쓰고 지운다. 체감 지연이 없어야 한다.

## 6. 인터페이스 · 데이터 스키마

### 6.1 shared — `src/shared/exclude-patterns.ts` (제안)
```ts
/** 패턴 하나를 --filter-from 제외 줄로 바꾼다: "- " + 끝 공백 문자 → "[c]" (FR-3) */
export function toFilterExcludeLine(pattern: string): string;

/** 적용 순서 패턴 → 필터 파일 내용(LF, 마지막 LF). 패턴이 없으면 null (FR-1·2) */
export function buildFilterFileContent(patterns: readonly string[]): string | null;
```
- 삭제: `itfExcludeTransport`, `isFileSafePattern`, `planExcludeTransport`, `f_ArgChars`, `ARG_OVERHEAD`.
- 유지: `normalizeExcludePattern`, `libraryPatternIssue`(문구만 수정), `mergeExcludePatterns`, `excludesSaveIssue`(합계 검사만).

### 6.2 main (제안)
```ts
// effective-excludes.ts
export interface itfEffectiveExcludes {
    patterns: readonly string[];
    /** 필터 파일 내용. 패턴이 없으면 null */
    fileContent: string | null;
    snapshotHash: string;
}

// command-builder.ts
export interface itfExcludeArgs {
    /** --filter-from 파일 경로. 없으면 null */
    filterFile: string | null;
}
```
- `writeExcludeFile(dir, content, kind)`·`itfExcludeFileHandle`·`cleanupExcludeFiles` 시그니처는 그대로(확정).
- `run-service`의 `active.excludeFile` 필드 이름은 그대로 둔다(최소 수정).

### 6.3 probe 보강 (T-02 선행)

2026-11-03 사전 실측(rclone v1.75.1, Windows, 임시 폴더, 일회성 스크립트 `lsf --dump filters`). 아직 저장소 probe·fixture에 없으므로 Phase 1에서 F7·F8로 옮겨 fixture와 rclone-notes #55~에 남긴다(#51~#54는 INT-006이 사용).

**F7 끝 공백 문자** — 파일 줄 `- a<c>`·`- b[<c>]`, 인자 `--exclude a<c>`

| 문자 `<c>` | `- a<c>` 줄·인자 | `- b[<c>]` 줄 |
| :--- | :--- | :--- |
| 공백, U+0009, U+000B, U+00A0, U+2003, U+202F, U+2028, U+3000 | 지워짐 → `(^|/)a$` | 남음 → `(^|/)b[<c>]$` |
| U+0085 (NEL) | 지워짐 | 남음 |
| U+FEFF | 남음 → `(^|/)a\ufeff$` | 남음 |

- 지우는 집합은 Go `unicode.IsSpace`와 맞는다(FR-3). 파일이 기준이며, 인자는 같은 값을 여러 번 주면 첫 값만 뒤 공백이 남는 등 일관성이 없어 쓰지 않는다(2026-11-03 F7 재측정).
- U+2028은 줄을 나누지 않는다(`b[\u2028]`가 규칙 하나로 남음).

**F8 역슬래시·특수 경우**

| 입력 | 결과 |
| :--- | :--- |
| 줄 `- a\ ` | `(^|/)a\$` — 공백이 지워지고 남은 `\`가 `$`를 이스케이프한다. 저장한 뜻과 다른 규칙이 되므로 FR-3 변환이 꼭 필요하다 |
| 줄 `- b\\ ` | `(^|/)b\\$` (공백 지워짐) |
| 줄 `- c\\[ ]` | `(^|/)c\\[ ]$` — 짝수 역슬래시 뒤 `[ ]`는 그대로(AC-3 근거) |
| 줄 `- [ ][ ]` | `(^|/)[ ][ ]$` |
| 인자 `--exclude "  "` (공백만) | `(^|/)  $` — 지워지지 않는다. 위 줄과 같은 뜻(Q-5 근거) |
| 인자 `--exclude ""` | 규칙 없음, exit 0 |
| 빈 필터 파일 | 규칙 없음, exit 0 — 넘기지 않은 것과 같다(Q-1 근거) |
| 줄 `- ` 하나 | exit 1, `malformed rule "-"` (빈 패턴은 `min(1)`로 생기지 않음) |

## 7. 예외 · 엣지 케이스

| 경우 | 처리 |
| :--- | :--- |
| `#`·`;`·`!`·앞 공백으로 시작 | `- ` 접두사로 그대로 규칙이 된다(#47). 바꾸지 않는다 |
| 끝 공백 1개 이상(`a  `) | `a[ ][ ]`(#48) |
| 끝 `\ `(이스케이프 공백) | `a[ ]`(역슬래시 하나 제거). 끝 `\\ `(짝수)는 `a\\[ ]` |
| 패턴 안에 `[`·`]`·`{`·`\` | 바꾸지 않는다(사용자가 쓴 glob 그대로) |
| 줄바꿈·탭 등 제어문자 | 저장 단계에서 이미 거부한다(`zNoControlChars`, `CONTROL_RE`). 줄 주입 불가. 방어로 `resolveEffectiveExcludes`(main)가 제어문자 패턴을 만나면 `clsAppError("VALIDATION")`을 던진다(shared 순수 함수는 `clsAppError`를 쓸 수 없다). 방어 기준은 shared `CONTROL_RE`(`\u0000-\u001f`·`\u007f`)로 한다. 작업 패턴 zod(`zNoControlChars`)는 U+007F를 통과시키므로 이 방어가 차이를 메운다 |
| 끝 U+0085(NEL)·U+00A0·U+3000 등 | FR-3 집합에 있으므로 `[<문자>]`로 바뀌어 저장한 그대로 적용된다. U+0085는 C1 제어문자지만 줄을 나누지 않아 방어 대상이 아니다 |
| 공백만으로 된 패턴(`"  "`) | 저장 스키마 `min(1)`은 통과할 수 있다. `- [ ][ ]`로 변환되어 그 이름만 뺀다. 지금 인자 방식(`(^|/)  $`)과 같은 뜻이다(§6.3 F8, §10 Q-5) |
| 파일 쓰기 실패·BOM | 지금처럼 `STORE_ERROR`, rclone을 실행하지 않는다 |
| 실행 중 파일이 지워짐 | rclone이 시작할 때만 읽는다. 시작 전에 없으면 exit 1(#21과 같은 성격) |
| 패턴 0개 | 파일·플래그 없음(FR-2) |
| 앱 업데이트 직전의 비교 결과 | 메모리 캐시라 재시작 뒤 없다. 같은 세션 안에서 해시가 바뀔 일은 없다 |

## 8. 수용 기준 (AC-n)

- **AC-1** Given 패턴 `["#a", ";a", " lead", "!a", "a  ", "x/**"]`, When `buildFilterFileContent`, Then `"- #a\n- ;a\n-  lead\n- !a\n- a[ ][ ]\n- x/**\n"`.
- **AC-2** Given `[]`, When `buildFilterFileContent`, Then `null`. And 그 작업의 `lsjson`·`sync` 인자에 `--filter-from`·`--exclude`가 없다.
- **AC-3** Given 끝이 `a\ `인 패턴, Then 줄은 `- a[ ]`. Given `a\\ `, Then `- a\\[ ]`.
- **AC-3b** Given 끝이 U+0085·U+00A0·U+3000·U+2028인 패턴, Then 그 문자가 `[<문자>]`로 바뀐다. Given 끝이 U+FEFF인 패턴, Then 바뀌지 않는다.
- **AC-4** Given 제어문자가 든 패턴(IPC 우회 가정), When `resolveEffectiveExcludes`, Then `VALIDATION` 예외, 필터 파일을 만들지 않고 rclone을 실행하지 않는다.
- **AC-5** Given 필터 파일 경로 F, When `buildLsjsonArgs`·`buildTransferArgs`, Then `--filter-from F`가 정확히 한 번, `--config` 뒤 `--` 앞에 있고 `--exclude`·`--exclude-from`이 없다. 차단 목록 단위 테스트는 그대로 통과한다.
- **AC-6** Given 임의 패턴 목록(속성 테스트 또는 표), Then 생성된 모든 줄이 `/^- /`에 맞고 `+ `·`!`로 시작하는 줄이 없다.
- **AC-7** Given 패턴은 같고 버전만 다른 해시, Then v2 해시는 v1과 다르다. 같은 패턴이면 v2 해시가 항상 같다.
- **AC-8** (통합, 실제 rclone) Given 임시 폴더 `#a`·`;a`·` lead`·`!a`·`a`·`c`와 패턴 `#a`·`;a`·` lead`·`!a`, When 앱 비교, Then 남은 원본 파일은 `a`·`c`.
- **AC-9** (통합) Given #20의 301개 파일 폴더와 200개 패턴, When 앱 비교와 sync dry-run, Then 남은 항목 96개·건너뛴 동작 103건(지금 fixture `excl-many-*`와 같다). 실행 뒤 `exclude-files/`가 비어 있다.
- **AC-10** (통합) Given 끝 공백 패턴 `trail `, When 앱이 만든 필터 파일을 테스트가 `rclone lsf --filter-from F --dump filters`로 읽으면, Then 규칙은 `(^|/)trail[ ]$`. (Windows 로컬은 끝 공백 이름을 만들 수 없어 해석 결과로 확인한다. `--dump`는 테스트 코드에서만 쓴다)
- **AC-11** Given 작업 전용 `#`·`;` 패턴 합계가 16,000자를 넘는 작업(500개 이하), When 저장, Then 오류 없이 저장된다.
- **AC-12** Given 비교 뒤 공용 패턴 변경, When 실행, Then `PLAN_STALE`(지금과 같음).
- **AC-13** E2E 기존 시나리오가 콘솔 오류 0으로 통과하고 `pnpm run build:win`이 성공한다.

## 9. 가정과 리스크

| 항목 | 내용 | 대응 |
| :--- | :--- | :--- |
| 가정 | `--filter-from`의 `- ` 줄과 `--exclude` 인자는 같은 glob 해석을 쓴다(#47·#50, `--dump filters`의 정규식이 같음) | AC-9로 결과 동일성 확인 |
| 리스크 | 제외가 덜 적용되면 sync가 원래 빼야 할 파일을 복사하거나 대상 전용 파일을 지운다 | AC-8·AC-9·AC-10 통합 테스트, 사전 확인 dry-run·삭제 게이트는 그대로. 잘못된 줄은 rclone이 실행 전에 실패시킨다(#49) |
| 리스크 | 1.65.0에서 `- ` 줄 해석·끝 공백 처리가 다를 수 있다 | T-05. 다르면 최소 버전을 올리거나 대응을 notes에 기록 |
| 리스크 | 유니코드 공백 처리 | 사전 실측으로 확인(§6.3, v1.75.1). Phase 1에서 probe F7·F8 fixture로 남기고, 1.65.0은 T-05에서 같은 묶음으로 확인 |
| 가정 | 작업 트리의 INT-006 변경(`command-builder.ts`·`process.ts`·`index.ts`)과 같은 파일을 고친다 | 겹치는 줄은 없다. 커밋 때 파일 단위가 아니라 hunk 단위로 나눈다 |

## 10. 미해결 질문 (Open questions)

2026-11-03 결정. 근거는 §6.3 사전 실측과 코드 확인.

- [x] **Q-1** (intent) 패턴이 없을 때 빈 필터 파일을 넘길지 — **넘기지 않는다(FR-2) 확정.** 빈 필터 파일은 규칙 0개·exit 0이라 넘기지 않은 것과 같고, 차이는 파일 I/O뿐이다.
- [x] **Q-2** 공용 라이브러리의 `#`·`;` 시작 금지를 풀지 — **이 범위에서는 문구만 고친다(FR-9).** 해제하려면 DB v2 CHECK(`#`·`;` 금지와 `pattern = trim(pattern)`)를 바꾸는 v3 마이그레이션(테이블 재생성)과 zod·`libraryPatternIssue` 변경이 필요하다. INBOX `2026-11-03-03`으로 남겼다.
- [x] **Q-3** intent T-02 우선순위 — **P2로 낮춘다.** 화면으로는 끝 공백 패턴을 저장할 수 없다(§1.1). 화면으로 들어오는 예외는 끝 U+0085뿐이고 드물다.
- [x] **Q-4** 계획 토큰 버전 — **`4` 그대로.** `excludeSnapshotHash`가 토큰 입력이라 해시 버전 2만으로 토큰이 달라진다. 비교 결과는 메모리 캐시라 업데이트 뒤 재시작하면 남지 않는다. intent 제약 문구를 "snapshotHash 버전을 올린다"로 고쳤다.
- [x] **Q-5** 공백만으로 된 작업 전용 패턴을 저장 단계에서 막을지 — **바꾸지 않는다.** 화면은 막고 IPC는 통과한다. 변환 결과 `- [ ][ ]`가 지금 인자 방식 `(^|/)  $`와 같은 뜻이라 동작이 그대로다(§6.3 F8).
- [ ] **Q-6** (intent) 1.65.0에서 #47~#49와 §6.3 F7·F8이 같은지 — T-05. 공식 `rclone-v1.65.0-windows-amd64.zip`의 SHA256(`e65c9a1f…5ecdee`)이 `SHA256SUMS`와 같은 것까지 확인했다. 실행은 아직 하지 않았다. probe가 `tests/fixtures/rclone/`를 덮어쓰지 않도록 출력 위치를 나눈 뒤 실행한다.
