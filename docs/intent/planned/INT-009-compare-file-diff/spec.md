# Spec: 비교 결과의 변경 파일 내용 차이(diff)를 동기화 전에 앱에서 보기
- Intent: [INT-009](intent.md) | Status: planned | 작성일: 2026-11-17
- Intent updated_at: 2026-11-17T16:42:44+09:00

> 기준: rcloneGUI HEAD `a830acb`(2026-11-17). intent 작성 뒤 INT-008 Phase 2(`8d2ed8c`)가 들어와 "행에 동작 없음·ItemMenu 미사용" 전제가 바뀌었다. 이 문서는 바뀐 현재 코드를 기준으로 쓴다(§3 드리프트 교정).

## 1. 개요
- 원 요구: "변경된 파일을 diff해 볼 수 있는 기능이 필요해. 변경이라고 나오기는 하는데 각각 열어보지 않으면 뭐가 변경됐는지 알 수가 없어서 동기화 전에 비교해보려는데 비교가 어려워." (2026-11-17 대화 요청)
- 문제: 비교 결과는 '변경(modified)' 사실과 사유(size·hash·mtime)만 보여 준다. 동기화(덮어쓰기) 전에 바뀐 내용을 앱 안에서 확인할 수 없어, 대상 쪽 수정을 잃을 위험을 판단하기 어렵다.
- 목표: 비교 결과 파일 행에서 원본·대상 내용을 main이 `rclone cat`으로 읽어 오고, 화면에서 좌우 나란히 줄 단위 diff를 보여 준다. 추가(원본에만)·삭제(대상에만) 파일은 있는 쪽만 미리 본다. 읽기 전용이며 전송·계획 토큰·삭제 확인 흐름은 바꾸지 않는다.
- 진입: 파일 행 더블클릭 + 파일 줄 메뉴(`FileRowMenu`, INT-008 FR-13로 이미 구현됨)에 항목 추가. 키보드는 기존 Shift+F10·메뉴 키로 메뉴를 연다.
- 다음 세션 첫 행동: §10 미해결 질문을 확정한 뒤 plan.md Step 1부터 진행한다. 착수 전 `src/pages/CompareRow.tsx`의 다른 작업 미커밋 변경이 정리됐는지 확인한다(§9 R-5).

## 2. 범위 (In-scope / Out-of-scope)
- In-scope
  - `rclone cat` 인자 빌더와 허용 명령 등록(`command-builder.ts`), cat 시간 제한(`RCLONE_TIMEOUTS`).
  - main 서비스: 캐시된 비교 결과에서 항목을 찾아 원본·대상 파일 내용을 읽고, 크기 상한·바이너리·문자 인코딩을 판정한다.
  - 루트 경로 + 상대 경로 결합 순수 함수(local·UNC·remote).
  - 줄 단위 diff 순수 함수(Myers, `src/shared/`, 의존성 0)와 좌우 정렬 행 변환.
  - 새 IPC 채널 `compare:fileDiff`(contract·schema·handler·preload).
  - 화면: diff 보기 모달, 파일 행 더블클릭, 파일 줄 메뉴 항목 `원본·대상 내용 비교`.
  - 테스트(단위·통합·E2E), `docs/CHANGELOG.md` 한 줄, `docs/knowhow/rclone-notes.md`에 cat 동작 기록.
- Out-of-scope (intent `범위 밖·전제`)
  - 파일 편집·병합(3-way merge)·선택 반영, 이미지·바이너리 내용 비교.
  - 같음(equal)·종류 충돌(typeConflict) 항목 보기, 폴더 행 보기.
  - rclone 비교 방식(lsjson 나열) 변경, 비교 결과 타입에 해시 값·루트 경로 추가.
  - 진행 중인 cat 취소 IPC(시간 제한으로 막는다, D-07).
  - 단어(문자) 단위 강조. 줄 단위만 한다.

## 3. 영향 시스템 · 모듈 · 데이터
| 영역 | 경로:라인 | 현재 사실 | 이번 변경 |
| :--- | :--- | :--- | :--- |
| modified 판정 | `src/shared/diff-engine.ts:129` | `f_ComparePair`가 크기→해시→mtime 순으로 판정(:129-151) | 변경 없음(읽기만) |
| 비교 항목 타입 | `src/shared/types/compare.ts:30` | `itfDiffEntry {path, status, reasons, source, dest, caseOnly, hashAlgo}`(:30-42), `:39` "값은 보관하지 않음" | 변경 없음 |
| 한쪽 정보 | `src/shared/types/compare.ts:24` | `itfDiffSide {path, size, modTimeMs}`(:24-28) | 변경 없음. `size`로 사전 크기 판정 |
| 상태 이름 | `src/shared/types/compare.ts:11` | `"onlySource" \| "onlyDest" \| "modified" \| "equal" \| "typeConflict"` | 변경 없음 |
| 비교 결과 | `src/shared/types/compare.ts:79` | `itfCompareResult`(:79-106)에 루트 경로 없음, `planToken`(:103)·`excludeHash`(:105) | 변경 없음 |
| 나열 비교 | `src/main/services/compare-service.ts:571` | `buildLsjsonArgs({path: side.path.normalized, ...})`(:571-583) | 변경 없음 |
| 결과 캐시 | `src/main/services/compare-service.ts:170` | 메모리 `cache` Map(jobId 키), `get(jobId)`가 rev·설정·excludeHash 변경 시 버림(:276) | 읽기만(`get` 재사용) |
| job 실행 맥락 | `src/main/services/job-context.ts:74` | `resolveJobContext(job, deps)` → `{src, dst, binaryPath, configPath, ...}` | 재사용 |
| 빌더 차단 목록 | `src/main/rclone/command-builder.ts:51` | `BLOCKED_FLAGS` 5개 | 변경 없음 |
| 허용 명령 | `src/main/rclone/command-builder.ts:101` | `ALLOWED_COMMANDS`(:101-114)에 `cat` 없음 | `cat` 추가 |
| lsjson 빌더(관례) | `src/main/rclone/command-builder.ts:285` | `--ask-password=false`, `--config C`, 경로는 `--` 뒤 | 같은 관례로 `buildCatArgs` 추가 |
| 시간 제한 | `src/main/rclone/config.ts:31` | `RCLONE_TIMEOUTS`에 cat 없음 | `cat: 60_000` 추가 |
| 실행 | `src/main/rclone/process.ts:86` | `DEFAULT_MAX_STDOUT_BYTES = 16 * 1024 * 1024`, 결과에 `stdoutBytes: Buffer`(:49) | 재사용. `maxStdoutBytes`를 상한+1로 준다 |
| 경로 종류 | `src/shared/path-utils.ts:15` | `typPathKind = "local" \| "unc" \| "remote"` | 변경 없음 |
| 경로 결합 | `src/shared/path-utils.ts:396` | `joinBackupPath(base, subdir)`만 있음. 일반 루트+상대 결합 함수 없음 | `joinRootRelative` 신규 |
| IPC 채널 | `src/shared/ipc-contract.ts:95` | `compareRun: "compare:run"` 등 compare 채널 | `compareFileDiff: "compare:fileDiff"` 추가 |
| IPC API 타입 | `src/shared/ipc-contract.ts:290` | `compare: { run, cancel, get, getActive }` | `fileDiff` 추가 |
| 입력 스키마 | `src/shared/schemas/compare.ts:10` | `zCompareJobInput = z.object({ jobId: z.uuid() }).strict()` | `zCompareFileDiffInput` 추가 |
| IPC 핸들러 | `src/main/ipc/compare.ts:18` | `registerCompareIpc`가 `handle(d, 채널, fn, zSchema)`로 등록 | 채널 1개 등록 |
| preload | `src/preload/index.ts:71` | `compare: { ... }` 노출 | `fileDiff` 노출 |
| 오류 코드 | `src/shared/errors.ts:7` | `NOT_FOUND`·`PLAN_STALE`·`RCLONE_FAILED`·`VALIDATION` 등 | 새 코드 없음(D-06) |
| 파일 행 | `src/pages/CompareRow.tsx:79` | `<tr>`에 `onContextMenu`·`onKeyDown`(:79-87) 있음, `onDoubleClick` 없음 | 더블클릭 추가 |
| 파일 줄 메뉴 | `src/pages/FileRowMenu.tsx:55` | 항목은 `경로 복사` 하나, target은 `{path, x, y}`(:16-20) | 항목·target 필드 추가 |
| 메뉴 연결 | `src/pages/CompareView.tsx:207` | `<FileRowMenu target={menu} onClose={h_CloseMenu} />` | diff 모달 상태 소유 |
| 메뉴 공용 | `src/pages/ItemMenu.tsx:27` | `itfItemMenuProps`, 항목에 `disabled?` 있음(:16-25) | 재사용 |
| 모달 | `src/components/ZBCModal.tsx:21` | `itfZBCModalProps {open, title, children, onClose, footer?, closeOnBackdrop?, size?}` | 재사용(`size="wide"`) |
| 가상 스크롤 | `src/lib/use-virtual-rows.ts:19` | `useVirtualRows` | diff 행 그리기에 재사용 |
| 의존성 | `package.json:28` | `"dependencies": { "zod": ... }` 하나 | 변경 없음 |
- 드리프트 교정(intent 인용 → 현재): `diff-engine.ts:128-151`→`:129-151` / `CompareTable.tsx:75` 행 동작 없음 → `CompareRow.tsx:79-87`(우클릭·메뉴 키 있음, 더블클릭 없음) / `CompareTable.tsx:144` → `CompareHead.tsx:48` / `ItemMenu.tsx:1-35` 미사용 → 커밋됨, 사용처 `FileRowMenu.tsx`·`JobWorkspace.tsx`.

## 4. 기능 요구사항 (FR-n)
- **FR-1 진입(더블클릭)**: 비교 결과 평면·트리의 파일 행 중 status가 `modified`·`onlySource`·`onlyDest`인 행을 더블클릭하면 diff 모달이 열린다. `equal`·`typeConflict` 행은 더블클릭해도 아무 일도 없다.
- **FR-2 진입(메뉴)**: 파일 줄 메뉴에 `원본·대상 내용 비교` 항목을 `경로 복사` 위에 둔다. `equal`·`typeConflict` 행에서는 `disabled`이고 `title`로 이유("같은 파일이라 비교할 내용이 없음" / "파일과 폴더가 섞여 내용을 비교할 수 없음")를 보인다. 키보드는 기존 Shift+F10·메뉴 키로 메뉴를 연다.
- **FR-3 내용 가져오기**: renderer는 `{ jobId, path }`만 보낸다. main은 `compareService.get(jobId)`로 유효한 캐시 결과를 얻고 `entries`에서 `path`가 같은 항목을 찾는다. 원본은 `entry.source.path`, 대상은 `entry.dest.path`를 각 루트에 결합해 `rclone cat`으로 읽는다. renderer가 보낸 경로를 그대로 파일 경로로 쓰지 않는다.
- **FR-4 크기 상한**: 파일당 2MB(`2 * 1024 * 1024` 바이트) 상한. `itfDiffSide.size`가 상한을 넘으면 cat을 실행하지 않고 `tooLarge`로 응답한다. 실행할 때도 `maxStdoutBytes = 상한 + 1`로 주어, 잘림(`stdoutTruncated`)이면 `tooLarge`로 본다(비교 뒤 파일이 커진 경우).
- **FR-5 바이너리 판정**: 읽은 바이트의 앞 8000바이트에 NUL(0x00)이 있으면 `binary`로 응답하고 내용은 보내지 않는다.
- **FR-6 문자 인코딩**: UTF-8 BOM은 떼고 UTF-8로 디코딩한다. 그 밖의 처리는 §10 Q-1 답에 따른다.
- **FR-7 줄 diff**: `src/shared/text-diff.ts`(신규)의 순수 함수가 두 텍스트를 줄로 나눠(`\r\n`·`\n`·`\r`) Myers 알고리즘으로 같음·삭제·추가 연산 목록을 만든다. 이어진 삭제+추가 묶음은 좌우 같은 줄에 짝지어 `changed`로 표시하고, 남는 줄은 반대편 빈칸으로 둔다.
- **FR-8 좌우 표시**: 모달은 왼쪽 원본·오른쪽 대상 2열, 각 줄에 줄 번호를 붙인다. 색은 추가(초록)·삭제(빨강)·변경(노랑)이며 테마 토큰을 쓴다. 상단 요약 줄에 `n줄 추가, m줄 삭제, k줄 변경`을 보인다. 행은 `useVirtualRows`로 그린다.
- **FR-9 한쪽 미리보기**: `onlySource`는 왼쪽 원본만, `onlyDest`는 오른쪽 대상만 보이고, 반대편 열에는 "대상에 없음 — 동기화하면 새로 복사됨" / "원본에 없음 — 동기화(sync)하면 대상에서 삭제됨"(copy 작업이면 "원본에 없음 — copy는 대상에서 지우지 않음")을 보인다.
- **FR-10 볼 수 없는 이유 표시**: 한쪽이라도 `binary`·`tooLarge`·읽기 실패면 그 쪽 열에 이유 문구를 보인다. 예: "바이너리 파일이라 내용 비교를 보여 줄 수 없음", "크기 3.4 MB가 상한 2 MB를 넘음", "대상 파일을 읽지 못함: <rclone 오류 요약>". 둘 다 텍스트일 때만 diff를 계산한다.
- **FR-11 줄바꿈만 다름**: 두 텍스트의 줄 목록이 같고 바이트만 다르면(CRLF/LF·끝 줄바꿈·BOM 차이) diff 대신 "내용은 같고 줄바꿈 방식(CRLF/LF)·BOM만 다름"을 보인다.
- **FR-12 diff 상한**: Myers 편집 거리 D가 `TEXT_DIFF_MAX_EDITS`(2000)를 넘으면 계산을 멈추고 "차이가 너무 많아 줄 단위 비교를 생략함 — 양쪽 내용을 그대로 보여 줌"과 함께 좌우 원문을 짝 없이 보인다(D-05).
- **FR-13 오래된 결과**: 캐시 결과가 없거나(작업 수정·설정 변경으로 버려짐) 항목이 없으면 `PLAN_STALE`/`NOT_FOUND`로 응답하고, 모달은 "비교 결과가 바뀌었음 — 다시 비교한 뒤 열어 주세요"를 보인다.
- **FR-14 읽기 전용**: 모달에 편집·복사 반영·전송 단추가 없다. 닫기(Escape·닫기 단추·바깥 클릭)만 있다. 모달을 닫은 뒤 도착한 응답은 버린다(요청 번호 비교).
- **FR-15 경로 결합**: `joinRootRelative(root: itfParsedPath, rel: string): string` — local·UNC는 `rel`의 `/`를 `\`로 바꿔 `normalized` 뒤에 `\`로 붙이고, remote는 루트가 `name:`이면 `name:rel`, 아니면 `/`로 붙인다(`name:/rel` 금지). `rel`이 비었거나 `..` 조각·절대 경로·드라이브 문자·NUL을 포함하면 `VALIDATION`.

## 5. 비기능 요구사항 (NFR-n)
- **NFR-1 안전 불변**: AGENTS.md 1.2 — `run-service.ts`(`spawnTransfer`)·`plan-token.ts` diff 0줄. diff 기능은 쓰기·전송 명령을 실행하지 않는다.
- **NFR-2 실행 규칙**: AGENTS.md 1.1·1.3 — cat은 `runRclone`(허용 목록·차단 목록·길이 검사 → `spawn(..., { shell: false })`)으로만 실행한다. `BLOCKED_FLAGS` 스냅샷 테스트 불변, `ALLOWED_COMMANDS` 스냅샷에 `cat`만 추가.
- **NFR-3 비밀·경로 비노출**: AGENTS.md 1.4·1.6 — 파일 내용·실제 경로·rclone.conf 내용을 로그·오류 메시지·테스트 이름·fixture에 남기지 않는다. 오류 요약에서 경로를 뺀다. rclone.conf는 `--config` 경로로만 넘긴다.
- **NFR-4 프로세스 경계**: AGENTS.md 1.5 — 파일 읽기는 main에서만, renderer는 IPC 응답만 받는다. `contextIsolation`·`sandbox` 유지. IPC 입력은 zod `.strict()`로 파싱한다.
- **NFR-5 임의 파일 읽기 금지**: 읽을 수 있는 파일은 현재 유효한 비교 결과의 항목뿐이다(FR-3). renderer 입력 경로로 다른 파일을 읽을 수 없어야 한다.
- **NFR-6 의존성 0**: `package.json` 운영 의존성 변경 없음, `THIRD_PARTY_NOTICES.md` 변경 없음.
- **NFR-7 응답성**: 2MB·약 5만 줄 텍스트 두 개(차이 D ≤ 2000)의 diff 계산이 단위 테스트 기준 1초 안에 끝난다. 계산은 renderer에서 하며 모달은 "불러오는 중"을 먼저 보인다.
- **NFR-8 컨벤션**: 신규 파일은 `docs/guide/File.tsx.guide`·`File.module.css.guide` 형식, `typ`/`itf`/`f_`/`h_` 접두사, 공백 4칸·큰따옴표·LF, UI 문구는 일어날 일을 쓴다(AGENTS.md 4.1).

## 6. 인터페이스 · 데이터 스키마
- **확정**
  - 채널: `IPC_CHANNELS.compareFileDiff = "compare:fileDiff"`, API `compare.fileDiff(jobId: string, path: string): Promise<typApiResult<itfFileDiffData>>`.
  - 입력: `zCompareFileDiffInput = z.object({ jobId: z.uuid(), path: z.string().min(1).max(4096) }).strict()`.
  - 빌더: `buildCatArgs({ path, configPath }): string[]` → `["cat", "--ask-password=false", ...(configPath ? ["--config", configPath] : []), "--", path]`. `ALLOWED_COMMANDS`에 `["cat"]` 추가.
  - 상수: `FILE_DIFF_MAX_BYTES = 2 * 1024 * 1024`, `BINARY_SNIFF_BYTES = 8000`, `TEXT_DIFF_MAX_EDITS = 2000`, `RCLONE_TIMEOUTS.cat = 60_000`.
- **초안(구현 중 이름 조정 가능, 의미 고정)**
```ts
// src/shared/types/compare.ts 또는 src/shared/types/file-diff.ts
export type typFileSideState =
    | { kind: "text"; text: string; encoding: "utf-8" | "euc-kr"; bom: boolean; size: number }
    | { kind: "absent" }                                  // onlySource의 대상, onlyDest의 원본
    | { kind: "binary"; size: number }
    | { kind: "tooLarge"; size: number; limit: number }
    | { kind: "error"; message: string };                 // 경로 없는 요약
export interface itfFileDiffData {
    path: string;
    status: "modified" | "onlySource" | "onlyDest";
    mode: typRunMode;                                     // FR-9 문구(src/shared/schemas/common.ts:18)
    source: typFileSideState;
    dest: typFileSideState;
}
// src/shared/text-diff.ts
export type typDiffOp = { op: "equal" | "delete" | "insert"; aIndex: number | null; bIndex: number | null };
export function diffLines(a: readonly string[], b: readonly string[], maxEdits?: number): typDiffOp[] | null; // null = 상한 초과
export interface itfSideBySideRow { kind: "equal" | "changed" | "delete" | "insert"; left: number | null; right: number | null }
export function toSideBySide(ops: readonly typDiffOp[]): itfSideBySideRow[];
export function splitLines(text: string): string[];
// src/shared/path-utils.ts
export function joinRootRelative(root: itfParsedPath, rel: string): string;
```
  - 한쪽 읽기 실패는 전체 실패가 아니라 그 쪽 `error`로 담는다. 전체 실패(`ok:false`)는 입력 오류·결과 없음·rclone 미설치·`CONFIG_REQUIRED` 같은 공통 원인만이다.
  - 화면: `src/pages/FileDiffModal.tsx`(+`.module.css`) 신규. `itfFileMenuTarget`에 `status` 추가.

## 7. 예외 · 엣지 케이스
| 경우 | 동작 |
| :--- | :--- |
| 캐시 결과 없음/작업 수정됨 | `PLAN_STALE` → "비교 결과가 바뀌었음 — 다시 비교" (FR-13) |
| `path`가 항목에 없음 | `NOT_FOUND` |
| `equal`·`typeConflict` 항목 요청 | `VALIDATION`(화면에서는 진입 차단) |
| `caseOnly` 항목(대소문자만 다름) | 원본은 `source.path`, 대상은 `dest.path`로 각각 읽는다 |
| 비교 뒤 파일이 지워짐 | 그 쪽 `error`("파일을 찾지 못함 — 다시 비교") |
| 비교 뒤 파일이 상한 넘게 커짐 | 잘림 감지 → `tooLarge`(FR-4) |
| 0바이트 파일 | 빈 텍스트(줄 0개)로 diff |
| 한쪽 바이너리·한쪽 텍스트 | 각 쪽 상태를 따로 표시, diff 없음(FR-10) |
| CRLF/LF·BOM·끝 줄바꿈만 다름 | FR-11 문구 |
| 차이가 매우 많음(D>2000) | FR-12 |
| 매우 긴 한 줄(미니파이 JS 등) | 줄 바꿈 없이 가로 스크롤, 줄 수는 1 |
| remote 루트가 `name:` | `name:rel` (FR-15) |
| WSL UNC 루트 | UNC 결합(`\\wsl.localhost\...\rel`) |
| rel에 `..`·절대 경로 | `VALIDATION`(FR-15) |
| cat 60초 초과 | 그 쪽 `error`("시간 제한 60초를 넘음") |
| rclone 없음·conf 필요 | `resolveJobContext` 오류 그대로(`RCLONE_NOT_FOUND`·`CONFIG_REQUIRED`) |
| 모달을 닫은 뒤 응답 도착 | 버림(FR-14) |
| 같은 파일 빠르게 두 번 더블클릭 | 마지막 요청만 반영 |
| 비 UTF-8 텍스트(CP949 등) | §10 Q-1 |

## 8. 수용 기준 (AC-n)
- **AC-1** (FR-1·FR-8): E2E — 임시 폴더 두 개에 내용이 다른 `a.txt`를 두고 비교 → `a.txt` 행 더블클릭 → `getByRole("dialog")` 안에 좌우 2열·추가/삭제/변경 표시·요약 줄이 보인다. 콘솔 오류 0.
- **AC-2** (FR-2): E2E — `a.txt` 행 우클릭 → `원본·대상 내용 비교` 선택 → 같은 모달. `equal` 행 메뉴에서는 항목이 `disabled`이다.
- **AC-3** (FR-9): E2E — 원본에만 있는 파일 더블클릭 → 왼쪽만 내용, 오른쪽에 "대상에 없음" 문구.
- **AC-4** (FR-4·FR-5·FR-10): 단위 — 서비스에 가짜 runner를 주고: size > 2MB면 runner 호출 0회·`tooLarge`; NUL 포함 바이트 → `binary`; 잘림 → `tooLarge`.
- **AC-5** (FR-7·FR-12·NFR-7): 단위 — `diffLines` 정답 표(빈·같음·앞/뒤/가운데 삽입·삭제·교체), `toSideBySide` 짝짓기, D 상한 초과 시 `null`, 5만 줄·D=2000 입력 1초 이내.
- **AC-6** (FR-15): 단위 — `joinRootRelative` local·UNC(WSL 포함)·remote(`name:`·`name:dir`·`name:/abs`)와 `..`·절대 경로·NUL 거부.
- **AC-7** (FR-3·NFR-2): 단위 — `buildCatArgs` 결과가 `cat --ask-password=false [--config C] -- <path>`이고 `assertNoBlockedFlags` 통과, `ALLOWED_COMMANDS` 스냅샷에 `cat`만 추가, `BLOCKED_FLAGS` 스냅샷 불변.
- **AC-8** (FR-3·NFR-5): 단위 — 캐시에 없는 `path`·`equal` 항목 요청은 runner 호출 0회로 `NOT_FOUND`/`VALIDATION`. 캐시 없음은 `PLAN_STALE`.
- **AC-9** (FR-3): 통합 — 실제 rclone으로 임시 local 폴더의 텍스트·바이너리·0바이트 파일을 읽어 기대 상태가 나온다(rclone 없으면 이유 출력 후 skip).
- **AC-10** (FR-11·FR-6): 단위 — CRLF/LF만 다른 두 바이트열, BOM 유무만 다른 두 바이트열이 "줄바꿈·BOM만 다름"으로 판정된다.
- **AC-11** (NFR-1·NFR-6): `git diff`에서 `src/main/services/run-service.ts`·`src/main/services/plan-token.ts`·`package.json` dependencies·`THIRD_PARTY_NOTICES.md` 변경 0줄.
- **AC-12** (FR-13): 단위 — 비교 뒤 작업 rev가 바뀌어 `get(jobId)`가 null이면 `PLAN_STALE`.
- **AC-13** (완료 기준): `pnpm run check`·`format:check`·`test:int`·`test:e2e`(콘솔 오류 0)·`build:win` 통과, `docs/CHANGELOG.md` 한 줄.

## 9. 가정과 리스크
- 가정
  - `itfDiffSide.path`는 각 루트 기준 상대 경로(`/` 구분)다. Step 2 단위 테스트에서 compare-service fixture로 확인하고, 다르면 FR-15 입력 변환만 고친다.
  - `rclone cat`은 rclone v1.75.1(`tests/fixtures/rclone/version.stdout.txt:1`)과 지원 하한 1.65.0에서 파일 하나를 stdout으로 그대로 낸다. cat `--count`·`--head`는 저장소 근거가 없어 쓰지 않는다(D-04). Step 3에서 probe로 실측해 `rclone-notes.md`에 기록한다.
  - diff 계산은 renderer에서 한다(D-03). 2MB·D≤2000이면 UI가 멈추지 않는다(NFR-7로 검증).
- 리스크
  - R-1: renderer가 보낸 경로로 임의 파일을 읽는 경로 우회 → FR-3(캐시 항목만)·FR-15(`..` 거부)·AC-8로 막는다.
  - R-2: 큰 파일이 비교 뒤 커지면 rclone이 끝까지 읽어 시간이 걸린다 → 사전 size 판정 + 60초 시간 제한 + 잘림 감지.
  - R-3: remote 루트 `name:` + `/` 결합 시 `name:/x`(절대 경로)가 되는 함정(`src/shared/path-utils.ts:125-126` 맨 앞 `/` 보존 주석, `isRemoteAbsolute` `:140`) → FR-15·AC-6.
  - R-4: CP949 파일이 깨져 보임 → §10 Q-1.
  - R-5: `src/pages/CompareRow.tsx`·`JobWorkspace.tsx`에 다른 작업의 미커밋 변경이 있다(2026-11-17 확인). 착수 전 정리 여부를 확인하고 충돌을 피한다.
  - R-6: `ALLOWED_COMMANDS`에 `cat`이 들어가면 다른 코드도 cat을 쓸 수 있다 → `buildCatArgs` 한 곳만 쓰고 쓰기 명령이 아님을 리뷰에서 확인.
- 결정
  - D-03: diff 계산 위치는 renderer(shared 순수 함수). 근거: main 이벤트 루프를 막지 않고, IPC는 원문 2개(최대 4MB)만 보낸다. 폐기 대안: main에서 계산해 행 목록 전송(main 정지·응답 커짐).
  - D-04: 크기 상한은 lsjson `size`로 사전 판정하고 `maxStdoutBytes`로 백스톱한다. 근거: 근거 없는 `cat --count` 의존을 피한다. 폐기 대안: `cat --count`(실측 근거 없음).
  - D-05: Myers D 상한 2000. 근거: 2MB 입력에서 계산량을 묶는다. 폐기 대안: 상한 없음(UI 정지), Web Worker(구조 추가).
  - D-06: 새 오류 코드를 만들지 않고 `PLAN_STALE`·`NOT_FOUND`·`VALIDATION`을 쓴다. 한쪽 실패는 응답 데이터 안의 `error` 상태로 둔다. 근거: `ERROR_CODES` 계약 변경 회피.
  - D-07: 진행 중 cat 취소 IPC는 두지 않는다. 근거: 2MB 상한·60초 제한으로 충분, 닫은 뒤 응답은 버린다. 폐기 대안: `compare:fileDiffCancel`.
  - D-08: 메뉴 항목 문구는 `원본·대상 내용 비교`. 근거: 일어날 일을 쓴다(AGENTS.md 4.1), "diff"라는 개발 용어를 피한다.

### 인계 대조표 (11범주)
| 범주 | intent 기록 위치 | spec 반영 | plan 반영 | 판정 |
| :--- | :--- | :--- | :--- | :--- |
| ① 원 요구·출처 | 배경 `- 원 요구:` | §1 | §2 서두 | 기록 |
| ② 문제·영향 | `## 문제` | §1·§2 | §5 | 기록 |
| ③ 제안 결과 | `## 제안 결과` | §4 FR-1~15·§8 | §3 | 기록 |
| ④ 영향 시스템·경로:라인 | `## 영향`·`- 참조:` | §3(드리프트 교정 포함) | §2 | 기록 |
| ⑤ 제약 | `## 제약` | §5 NFR-1~8·§7 | §4·§5 | 기록 |
| ⑥ 결정 D-n | D-01·D-02 | §9 D-03~D-08 | §5 | 기록 |
| ⑦ 범위 밖·전제 | `- 범위 밖·전제:` | §2 Out-of-scope | §5 | 기록 |
| ⑧ 용어·기각 접근 | D-02 폐기 대안(INT-008 범위 확장) | §9 폐기 대안 | §5 | 기록 |
| ⑨ 환경·재현 | `- 환경·재현:` | §1·§7(local·UNC·remote) | §2 Step 0·§4 | 기록 |
| ⑩ 미확정·가정 | `## 미해결 질문`(4건 확정) | §1 진입·§4 FR-4·5·9·§9 가정·§10 | §5 | 기록 |
| ⑪ 인계 지시 | `- 인계 지시:` | §1 진입·다음 세션 첫 행동 | §1·§3·§6 | 기록 |
- 인계 지시 이행: "진입 방식이 INT-008 FR-13 메뉴와 어떻게 이어지는지(선후·공유)" → INT-008 FR-13은 `8d2ed8c`로 이미 구현됨(선행 완료). 이번에는 `FileRowMenu` 항목 추가로 공유한다(§1·FR-2). Tier는 plan §1에서 3으로 산정.
- `경로:라인` 재실존: §3 인용 라인을 2026-11-17 HEAD `a830acb`에서 ±0행으로 확인했다(intent 인용 드리프트 4건은 §3 말미에 교정).
- 원문 보존: 2MB·NUL 바이트·좌우 나란히(왼쪽 원본·오른쪽 대상)·`rclone cat`·`compare:fileDiff`·16MB·zod 하나·Shift+F10·완료 기준 명령을 원문 그대로 옮겼다.
- 모의 독해: 새 세션이 spec·plan만으로 §10 Q-1 확정 후 plan Step 1부터 시작할 수 있다 — 통과.

## 10. 미해결 질문 (Open questions)
- [ ] Q-1 비 UTF-8 텍스트 — CP949(EUC-KR)로 저장된 한글 텍스트를 어떻게 보일까? 선택지: (A, 권장) UTF-8 엄격 디코딩이 실패하면 `TextDecoder("euc-kr")`로 다시 디코딩하고 상단에 "인코딩: EUC-KR로 읽음" 표시 / (B) UTF-8만, 깨진 글자는 대체 문자(�)로 보이고 "UTF-8이 아님" 표시 / (C) 바이너리처럼 "UTF-8 텍스트가 아니라 비교를 보여 줄 수 없음". 영향: A는 디코딩 판정 함수와 단위 테스트가 늘고, B·C는 한글 Windows 메모장 옛 파일을 못 읽는다.
