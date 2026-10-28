# Spec: rclone 기반 폴더 비교·동기화 데스크톱 앱 (rcloneGUI) — oxlint·oxfmt 전환

- Intent: [INT-001](intent.md) | Status: planned | 작성일: 2026-10-28

> 이 문서는 INT-001의 전체 기능 명세가 아니라, 기존 설계 문서의 **린트/포맷 도구 체인을
> ESLint/Prettier에서 oxlint/oxfmt로 교체**하는 변경분(delta)을 상세화한 명세다.
> 앱 기능·아키텍처의 기준 문서는 [`MVP_SPEC.md`](../../../specs/MVP_SPEC.md),
> 구현 순서의 기준 문서는 [`IMPLEMENTATION_PLAN.md`](../../../specs/IMPLEMENTATION_PLAN.md)이다.

## 1. 개요

변경 전 INT-001의 설계 문서는 ESLint 10.13.0 + typescript-eslint 8.72.1 +
eslint-plugin-react-hooks 7.1.1 + Prettier 3.9.10 조합을 전제로 했고, TypeScript 5.9.3을
`typescript-eslint`의 peer 범위(`<6.1.0`) 때문에 고정하며 TS 7.x를 금지했다.

이 변경은 린트/포맷 도구를 다음으로 교체한다.

- 린트: **oxlint 1.90.0**
- 포맷: **oxfmt 0.75.0**
- 제거: `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`
- 유지: `tsc -p tsconfig.*.json --noEmit` 기반 타입 검사
- 유지: TypeScript 5.9.3 (Vite 8/electron-vite 6/React 19 타입 조합의 채택값, Phase 0 재확인)

목표는 다음과 같다.

1. 신규 프로젝트에 불필요한 ESLint/Prettier 설정·의존성을 만들지 않는다.
2. Rust 기반 도구로 린트/포맷 실행 시간을 줄인다.
3. Prettier와 유사한 포맷 결과를 유지하되, `--check` 기반 비파괴 검증을 DoD에 넣는다.
4. oxlint의 type-aware/type-check는 TS 7+와 `oxlint-tsgolint`가 필요하므로 MVP에서는 사용하지 않는다.
5. 설계 문서와 실제 Phase 0 구현이 같은 명령·버전·설정 파일을 가리키게 한다.

이번 작업은 **문서와 설정 명세만** 변경한다. 소스 코드, `package.json`, 실제 설정 파일은
Phase 0에서 생성한다. `intent.md`는 수정하지 않는다.

## 2. 범위 (In-scope / Out-of-scope)

### 2.1 In-scope

| 항목 | 내용 |
| :--- | :--- |
| 도구 결정 | oxlint 1.90.0 + oxfmt 0.75.0, 정확한 버전 고정 |
| 설정 명세 | `.oxlintrc.json`, `.oxfmtrc.json`의 전체 초안 |
| 스크립트 명세 | `lint`, `lint:fix`, `format`, `format:check` |
| 문서 동기화 | `MVP_SPEC.md`, `IMPLEMENTATION_PLAN.md`의 도구·버전·파일·명령·DoD·리스크 갱신 |
| 검증 기준 | `oxlint --deny-warnings`, `oxfmt --check`, 문서 잔재 grep, LF/CR 검사 |
| 백업 | 기존 `docs/specs` 문서를 `.bak_YYYYMMDD-HHmmss`로 보존 |
| 매핑 | plan 단계와 intent T-01/T-12/T-15 연결 |

### 2.2 Out-of-scope

| 항목 | 이유 |
| :--- | :--- |
| 실제 패키지 설치/실행 | Phase 0 구현 단계. 이번 작업은 문서/명세만 |
| `package.json` 생성 | 소스 코드가 아직 없음 |
| oxlint type-aware/type-check | TS 7.0+ 및 `oxlint-tsgolint` 필요. MVP는 TS 5.9.3 유지 |
| TypeScript 7 전환 | Vite 8/electron-vite 6/React 19 타입 호환 검증 선행 필요 |
| CI 파이프라인 | 저장소에 CI 설정이 없음. 로컬 Windows 명령만 정의 |
| ESLint/Prettier 설정 마이그레이션 | 기존 설정 파일이 없어 `oxfmt --migrate prettier` 불필요 |
| 앱 기능/아키텍처 변경 | 린트/포맷은 개발 도구이며 런타임 동작과 무관 |
| `intent.md` 수정/status 변경 | 스킬 금지 사항 |

## 3. 영향 시스템 · 모듈 · 데이터

코드베이스는 아직 없다(신규 저장소, 소스 코드 0건). 따라서 실제 코드 심볼이 아니라
설계 문서의 파일·섹션을 변경 대상으로 삼는다. 아래 라인 번호는 **편집 전 기준**이다.

| 파일 | 섹션/라인 | 변경 |
| :--- | :--- | :--- |
| `docs/specs/MVP_SPEC.md` | §0 L17-31 | 핵심 결정에 린트/포맷 행 추가 |
| `docs/specs/MVP_SPEC.md` | §1.2 L51-57 | Tier 3 DoD에 `format:check` 추가 |
| `docs/specs/MVP_SPEC.md` | §2.1 L76 | 스크립트 목록에 `format:check` 추가 |
| `docs/specs/MVP_SPEC.md` | §4.3 L299-302 | `eslint.config.mjs` → `.oxlintrc.json`, `.oxfmtrc.json` |
| `docs/specs/MVP_SPEC.md` | §4.4 L310-350 | 스택 테이블 교체, oxlint/oxfmt 근거·주의 추가 |
| `docs/specs/MVP_SPEC.md` | §17.1 L1603-1623 | scripts를 oxlint/oxfmt로 교체 |
| `docs/specs/MVP_SPEC.md` | §17.3 L1677-1682 | README/AGENTS에 도구·명령 기록 |
| `docs/specs/MVP_SPEC.md` | §19 L1726-1743 | R9 문구 수정, R17/R18 추가, R10 보강 |
| `docs/specs/MVP_SPEC.md` | §20 L1751-1760 | TypeScript 7/type-aware 결정 추가 |
| `docs/specs/MVP_SPEC.md` | 부록 A L1769-1789 | oxlint/oxfmt 실측 근거 추가 |
| `docs/specs/IMPLEMENTATION_PLAN.md` | §1.2 L29-47 | Windows 명령에 `format:check` 추가 |
| `docs/specs/IMPLEMENTATION_PLAN.md` | §1.3 L49-54 | TS 5.9.3 근거 수정, oxlint/oxfmt 고정 |
| `docs/specs/IMPLEMENTATION_PLAN.md` | Phase 0 L96-149 | 설정 파일/의존성/명령/합격 기준 갱신 |
| `docs/specs/IMPLEMENTATION_PLAN.md` | §4.1 L627-633 | Static 계층에 oxlint, Format 계층 추가 |
| `docs/specs/IMPLEMENTATION_PLAN.md` | §4.3 L650-668 | 실행 명령에 `format:check` 추가 |
| `docs/specs/IMPLEMENTATION_PLAN.md` | §4.4 L670-676 | 공통 합격 기준에 `format:check` 추가 |
| `docs/specs/IMPLEMENTATION_PLAN.md` | §6 L702-714 | Phase 0 체크포인트에 oxlint/oxfmt 추가 |
| `docs/specs/IMPLEMENTATION_PLAN.md` | §8 L774-788 | 릴리스 체크리스트 갱신 |
| `docs/specs/IMPLEMENTATION_PLAN.md` | §9 L792-803 | Phase 0 요약에 도구 기준선 추가 |

데이터 모델, DB, 파일 포맷, 마이그레이션 변경은 없다. `package.json`과 설정 파일은
Phase 0에서 새로 생성되며, 기존 런타임 데이터에 접근하지 않는다.

## 4. 기능 요구사항 (FR-n)

- **FR-1 (도구 교체)**: INT-001의 린트/포맷 도구는 ESLint/Prettier가 아니라 oxlint/oxfmt여야 한다.
  `eslint.config.mjs`, `.prettierrc`, `.prettierignore`를 생성하지 않는다.
- **FR-2 (버전 고정)**: `oxlint`는 `1.90.0`, `oxfmt`는 `0.75.0`으로 정확히 고정해야 한다.
  `^`/`~` 범위를 사용하지 않는다. oxfmt는 0.x이므로 특히 정확한 버전이 필요하다.
- **FR-3 (린트 설정)**: `.oxlintrc.json`은 다음을 포함해야 한다.
  - plugins: `eslint`, `typescript`, `unicorn`, `oxc`, `import`, `react`, `jsx-a11y`, `promise`, `vitest`
  - categories: `correctness: error`, `suspicious: warn`
  - env: `es2024`
  - React version: `19.3.1`
  - React Hooks: `react/rules-of-hooks: error`, `react/exhaustive-deps: warn`
  - React JSX runtime: `react/react-in-jsx-scope: off`
  - Fast Refresh: `react/only-export-components: warn`
  - TypeScript: `typescript/no-explicit-any: warn`
  - import: `import/no-cycle: warn`
  - unused: `no-unused-vars: error` (`argsIgnorePattern: ^_`)
  - main/preload/tests override, renderer browser env, tests vitest env
  - `ignorePatterns`로 `out`, `release`, `coverage`, `docs`, `tests/fixtures`, `resources`, `build` 제외
- **FR-4 (포맷 설정)**: `.oxfmtrc.json`은 Prettier 기본값과의 호환을 위해 다음을 명시해야 한다.
  - `printWidth: 80` (oxfmt 기본 100과 다름)
  - `tabWidth: 2`, `useTabs: false`, `semi: true`, `singleQuote: false`
  - `trailingComma: "all"`, `bracketSpacing: true`, `arrowParens: "always"`
  - `endOfLine: "lf"`, `insertFinalNewline: true`
  - `proseWrap: "preserve"`
  - `sortImports: false`, `sortPackageJson: false`
  - `ignorePatterns`로 `docs/**`, `tests/fixtures/**`, 빌드 산출물 제외
- **FR-5 (스크립트)**: `package.json` scripts는 다음을 제공해야 한다.
  - `lint`: `oxlint --deny-warnings`
  - `lint:fix`: `oxlint --fix`
  - `format`: `oxfmt`
  - `format:check`: `oxfmt --check`
- **FR-6 (DoD 통합)**: Tier 3 완료 조건, Phase 0 합격 기준, 각 Phase 종료 검증, 릴리스 체크리스트에
  `format:check`를 포함해야 한다.
- **FR-7 (문서 동기화)**: `MVP_SPEC.md`와 `IMPLEMENTATION_PLAN.md`에서 ESLint/Prettier를
  현재 도구로 서술한 부분을 oxlint/oxfmt로 교체해야 한다. 역사적 언급·롤백·마이그레이션 설명은
  문맥이 드러나면 남길 수 있다.
- **FR-8 (타입 검사 유지)**: 타입 검사는 계속 `tsc -p tsconfig.node.json --noEmit` 및
  `tsc -p tsconfig.web.json --noEmit`이 담당한다. oxlint의 `--type-aware`/`--type-check`는
  사용하지 않는다.
- **FR-9 (문서/픽스처 보존)**: `docs/**`와 `tests/fixtures/**`는 oxfmt/oxlint 대상에서 제외해
  설계 문서와 관측 rclone 로그를 재포맷하지 않는다.
- **FR-10 (백업)**: 기존 `docs/specs` 문서를 수정하기 전에 `.bak_YYYYMMDD-HHmmss`로 백업해야 한다.
- **FR-11 (의도 보존)**: `docs/intent/planned/INT-001-rclone-sync-gui/intent.md`의 본문, status,
  priority, tasks를 변경하지 않는다.
- **FR-12 (Windows 명령)**: 모든 npm 명령은 Windows PowerShell에서 `npm.cmd`로 실행하고,
  WSL에서는 `cmd.exe /c`를 경유한다. oxlint/oxfmt의 Windows native binding을 사용한다.
- **FR-13 (문서 보고)**: 이번 산출물은 `spec.md`와 `plan.md`이며, 기존 문서 변경 내역·백업·
  미해결 질문·검증 결과를 최종 보고에 포함한다.

## 5. 비기능 요구사항 (NFR-n)

- **NFR-1 (결정성)**: 정확한 도구 버전과 lockfile로 Windows x64에서 동일한 결과를 재현해야 한다.
- **NFR-2 (성능)**: 린트/포맷은 ESLint/Prettier 대비 빠른 실행을 목표로 하며, Phase 0에서
  `time` 측정은 선택이다. 성능 수치는 DoD가 아니다.
- **NFR-3 (비파괴성)**: `format:check`는 파일을 수정하지 않아야 한다. `format`만 파일을 쓴다.
- **NFR-4 (호환성)**: Node 24.20.0, npm 9.2.0, Windows 11 x64에서 동작해야 한다.
  oxlint/oxfmt의 Node engines(`^20.19.0 || >=22.12.0`)를 충족한다.
- **NFR-5 (유지보수성)**: 린트 규칙의 단일 기준은 `.oxlintrc.json`, 포맷 규칙의 단일 기준은
  `.oxfmtrc.json`이다. ESLint/Prettier 설정과 중복하지 않는다.
- **NFR-6 (복구 가능성)**: Phase 0에서 도구 결함이 확인되면 백업과 lockfile로 ESLint/Prettier
  체제로 되돌릴 수 있어야 한다. 단, 사용자 승인 없이 자동 회귀하지 않는다.
- **NFR-7 (문서 일관성)**: `docs/specs`에서 현재 도구를 ESLint/Prettier로 서술하는 활성 참조가
  남지 않아야 한다. 역사적/롤백/마이그레이션 문맥은 허용한다.
- **NFR-8 (보안)**: oxlint/oxfmt는 `devDependencies`에만 추가하고 런타임 번들/패키지에 포함하지 않는다.
- **NFR-9 (가독성)**: 설정 파일은 JSON으로 유지하고, 각 규칙의 의도는 이 spec과 주석이 아닌
  문서(README/AGENTS)에 기록한다. JSON에는 주석을 넣지 않는다.

## 6. 인터페이스 · 데이터 스키마

### 6.1 확정/초안 상태

| 항목 | 상태 | 비고 |
| :--- | :--- | :--- |
| 도구/버전 | **확정** | oxlint 1.90.0, oxfmt 0.75.0 |
| 설정 파일명 | **확정** | `.oxlintrc.json`, `.oxfmtrc.json` |
| 스크립트 이름 | **확정** | lint, lint:fix, format, format:check |
| 규칙 severity | **초안** | Phase 0에서 baseline에 맞춰 조정 가능 |
| `printWidth` | **초안** | 80 (Prettier 기본), 필요 시 100 |
| ignorePatterns | **초안** | docs/fixtures/빌드 산출물 제외 |
| TypeScript 5.9.3 | **확정** | type-aware 미사용 |

### 6.2 `package.json` scripts (확정)

```json
{
  "scripts": {
    "lint": "oxlint --deny-warnings",
    "lint:fix": "oxlint --fix",
    "format": "oxfmt",
    "format:check": "oxfmt --check"
  }
}
```

### 6.3 `package.json` devDependencies (확정)

```json
{
  "devDependencies": {
    "oxlint": "1.90.0",
    "oxfmt": "0.75.0"
  }
}
```

제거 대상: `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`.
`@typescript-eslint/*` 계열도 추가하지 않는다.

### 6.4 `.oxlintrc.json` (초안)

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": [
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "react",
    "jsx-a11y",
    "promise",
    "vitest"
  ],
  "categories": {
    "correctness": "error",
    "suspicious": "warn"
  },
  "env": {
    "es2024": true
  },
  "settings": {
    "react": {
      "version": "19.3.1"
    }
  },
  "rules": {
    "no-console": "warn",
    "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "typescript/no-explicit-any": "warn",
    "react/react-in-jsx-scope": "off",
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "warn",
    "react/only-export-components": "warn",
    "import/no-cycle": "warn"
  },
  "overrides": [
    {
      "files": [
        "src/main/**/*.ts",
        "src/main/**/*.tsx",
        "src/preload/**/*.ts",
        "src/preload/**/*.tsx",
        "electron.vite.config.mts",
        "vitest.config.ts",
        "vitest.integration.config.ts",
        "playwright.config.ts"
      ],
      "env": {
        "es2024": true,
        "node": true
      },
      "rules": {
        "no-console": "off"
      }
    },
    {
      "files": ["src/renderer/**/*.ts", "src/renderer/**/*.tsx"],
      "env": {
        "es2024": true,
        "browser": true
      }
    },
    {
      "files": [
        "tests/**/*.test.ts",
        "tests/**/*.test.tsx",
        "tests/**/*.spec.ts",
        "tests/**/*.spec.tsx"
      ],
      "env": {
        "es2024": true,
        "node": true,
        "vitest": true
      },
      "rules": {
        "no-console": "off",
        "typescript/no-explicit-any": "off"
      }
    }
  ],
  "ignorePatterns": [
    "out/**",
    "release/**",
    "coverage/**",
    "docs/**",
    "tests/fixtures/**",
    "resources/**",
    "build/**"
  ]
}
```

> Oxlint core 규칙은 `no-console`, `no-unused-vars`처럼 접두사 없이 쓴다.
> `typescript/`, `react/`, `import/` 접두사는 플러그인 규칙에만 사용한다.

### 6.5 `.oxfmtrc.json` (초안)

```json
{
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "quoteProps": "as-needed",
  "jsxSingleQuote": false,
  "trailingComma": "all",
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "always",
  "endOfLine": "lf",
  "insertFinalNewline": true,
  "proseWrap": "preserve",
  "htmlWhitespaceSensitivity": "css",
  "embeddedLanguageFormatting": "auto",
  "sortImports": false,
  "sortPackageJson": false,
  "ignorePatterns": [
    "out/**",
    "release/**",
    "coverage/**",
    "docs/**",
    "tests/fixtures/**",
    "resources/**",
    "build/**"
  ]
}
```

### 6.6 파일 배치

```text
rcloneGUI/
├─ .oxlintrc.json          # 신규 (Phase 0)
├─ .oxfmtrc.json           # 신규 (Phase 0)
├─ .editorconfig           # 유지
├─ .gitignore              # 유지
├─ package.json            # Phase 0에서 생성(scripts/devDeps)
├─ src/
│  ├─ main/
│  ├─ preload/
│  ├─ renderer/
│  └─ shared/
├─ tests/
│  └─ fixtures/            # lint/format 제외
└─ docs/                   # lint/format 제외
```

생성하지 않는 파일: `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.eslintignore`.

### 6.7 CLI 매핑

| 이전 | 이후 | 비고 |
| :--- | :--- | :--- |
| `eslint . --max-warnings=0` | `oxlint --deny-warnings` | 경고도 실패 |
| `eslint . --fix` | `oxlint --fix` | 안전한 수정만 |
| `prettier --write .` | `oxfmt` | 현재 디렉터리 포맷 |
| `prettier --check .` | `oxfmt --check` | 비파괴 검사 |

기존 Prettier 설정이 없으므로 `oxfmt --migrate prettier`는 사용하지 않는다.

## 7. 예외 · 엣지 케이스

- **Windows native binding 누락**: `npm.cmd install` 후 `oxlint --version`/`oxfmt --version`이
  실패하면 `node_modules`를 삭제하고 lockfile로 재설치한다. WSL에서 설치한 Linux binding을
  Windows 실행에 재사용하지 않는다.
- **npm 9 + optional deps**: 설치 로그에 optional dependency 경고가 나와도 실제 바이너리가
  실행되는지 확인한다. 실패가 반복되면 사용자 승인 후 npm 11 업그레이드를 검토한다.
- **`--deny-warnings` baseline**: Phase 0에서 기존 경고가 다수 나오면 규칙을 한 번에 끄지 말고,
  오탐/의도된 패턴을 구분해 severity 또는 override를 조정한다. 조정 내역은 plan/README에 남긴다.
- **React Hooks 오탐**: `react/exhaustive-deps`는 의도된 예외에 `// oxlint-disable-next-line`을
  사용하고 사유를 적는다. 규칙 자체를 끄지 않는다.
- **`react/only-export-components`**: Vite Fast Refresh와 충돌하는 파일이 있으면 warn을 유지하되,
  필요한 파일에만 disable 주석을 둔다. Phase 0에서 error로 올릴지 재검토한다.
- **`sortPackageJson` 기본값**: oxfmt 기본은 `true`이므로 `false`를 명시하지 않으면
  `package.json` 키가 재정렬된다. 이번 설계는 `false`로 고정한다.
- **`printWidth` 차이**: oxfmt 기본 100, Prettier 기본 80. 80을 명시하지 않으면 기존 문서의
  포맷 가정과 달라진다. 최종 값은 §10에서 확인한다.
- **문서/픽스처 재포맷**: `docs/**`와 `tests/fixtures/**`를 제외하지 않으면 설계 문서와
  rclone 로그 fixture가 변경될 수 있다. 반드시 ignorePatterns에 포함한다.
- **생성물**: `out/**`, `release/**`, `coverage/**`, `build/**`는 lint/format 대상이 아니다.
- **oxfmt 0.x 변경**: 0.x 버전은 포맷/옵션이 바뀔 수 있다. 정확한 버전 고정과 업그레이드 시
  `format:check` diff 리뷰를 필수로 한다.
- **oxlint 규칙명/접두사**: 규칙 이름은 버전에 종속된다. core 규칙은 `no-console`처럼 접두사 없이,
  플러그인 규칙은 `typescript/no-explicit-any`처럼 접두사를 붙인다. core 규칙에 `eslint/` 접두사를 붙이면
  잘못된 이름이다. Phase 0에서 `oxlint --rules` 또는 실행 결과로 유효성을 확인하고, 잘못된 규칙명이 있으면 즉시 수정한다.
- **TypeScript 7**: type-aware를 켜려면 TS 7.0+와 `oxlint-tsgolint`가 필요하다. MVP에서는
  켜지 않으며, TS 7 전환은 별도 intent/승인으로 분리한다.
- **레거시 설정**: ESLint/Prettier 설정이 없으므로 `--migrate prettier`를 실행하지 않는다.
  만약 나중에 레거시 설정이 생기면 마이그레이션 후 diff를 리뷰한다.

## 8. 수용 기준 (AC-n)

- **AC-1**: Given `docs/specs`가 갱신되었을 때, When `eslint.config.mjs`, `.prettierrc`,
  `prettier --write`, `eslint . --max-warnings=0`을 grep하면, Then 현재 도구로 서술하는 활성 참조가
  0건이다(역사적/롤백/마이그레이션 문맥과 `*.bak_*` 제외).
- **AC-2**: Given `.oxlintrc.json`과 `.oxfmtrc.json`이 있을 때, When `oxlint --deny-warnings`와
  `oxfmt --check`를 Phase 0 스캐폴드에서 실행하면, Then 둘 다 exit 0이다.
- **AC-3**: Given `package.json`을 검사할 때, When scripts와 devDependencies를 확인하면,
  Then §6.2/§6.3의 값과 일치하고 ESLint/Prettier 의존성이 0건이다.
- **AC-4**: Given `docs/**`와 `tests/fixtures/**`가 있을 때, When `oxfmt --check`를 실행하면,
  Then 해당 경로의 파일이 변경/diff 대상으로 보고되지 않는다.
- **AC-5**: Given Tier 3 DoD와 릴리스 체크리스트를 검토할 때, When `format:check`와 정확한
  도구 버전이 포함되었는지 확인하면, Then 모두 포함되어 있다.
- **AC-6**: Given `intent.md`를 diff할 때, When 변경 내역을 확인하면, Then 본문/status/priority/
  tasks가 변경되지 않았다.
- **AC-7**: Given 기존 `docs/specs` 문서를 수정했을 때, When `.bak_20261028-140418` 파일을
  확인하면, Then 두 백업이 존재하고 수정 전 크기/줄 수(90,436 B/1,806줄, 36,571 B/805줄)와 일치한다.
- **AC-8**: Given Windows x64 Phase 0 환경에서, When `oxlint --version`과 `oxfmt --version`을
  실행하면, Then 각각 `1.90.0`, `0.75.0`이 출력되고 native binding 오류가 없다.
- **AC-9**: Given `MVP_SPEC.md`와 `IMPLEMENTATION_PLAN.md`를 검토할 때, When `typescript-eslint`
  peer 때문에 TS 7을 금지한다는 서술을 찾으면, Then 해당 서술은 제거되고 TS 5.9.3의 채택 근거
  (Vite/electron-vite/React 타입 조합, Phase 0 재확인)로 대체되어 있다.
- **AC-10**: Given `plan.md`의 매핑 표를 볼 때, When 각 Step과 intent T-NN을 대조하면,
  Then 모든 Step이 T-01/T-12/T-15 중 하나 이상에 매핑되고 누락 단계가 없다.
- **AC-11**: Given 최종 문서를 검사할 때, When CRLF/BOM을 확인하면, Then 신규/수정 파일의
  CR은 0건이고 BOM이 없다.
- **AC-12**: Given `git status --short --untracked-files=all`을 확인할 때, When 변경 목록을 보면,
  Then `docs/intent/.../spec.md`, `plan.md`, `docs/specs/*.md`, `docs/specs/*.bak_*`가 있고,
  소스/config 변경은 0건이다. (저장소에 커밋이 없어 기존 `.gitignore`, `docs/` 파일은 모두 untracked로 보인다.)

## 9. 가정과 리스크

### 9.1 가정

- 사용자는 oxfmt 0.x의 pre-1.0 상태를 수용하고 정확한 버전 고정을 유지한다.
- 기존 ESLint/Prettier 설정이 없으므로 마이그레이션 비용은 0이다.
- `printWidth` 80은 Prettier 기본과의 호환을 위한 초안이며, Phase 0에서 100으로 바꿀 수 있다.
- `docs/**`와 `tests/fixtures/**`는 코드가 아니므로 lint/format 대상에서 제외하는 것이 안전하다.
- TypeScript 5.9.3은 린트 도구와 무관하게 Vite 8/electron-vite 6/React 19 조합의 채택값으로 유지하며 Phase 0에서 재확인한다.

### 9.2 리스크

| # | 리스크 | 영향 | 대응 |
| :--- | :--- | :--- | :--- |
| S-R1 | oxlint 규칙 커버리지가 ESLint/TS-ESLint보다 좁음 | 린트 공백 | `tsc` 유지, correctness+핵심 플러그인 활성, 필요한 규칙만 명시 |
| S-R2 | `--deny-warnings`로 초기 경고가 빌드를 막음 | Phase 0 지연 | baseline 후 severity/override 조정, 오탐은 disable+사유 |
| S-R3 | oxfmt 0.x 포맷/옵션 변경 | 대규모 diff | 정확한 버전 고정, 업그레이드 시 `format:check` diff 리뷰 |
| S-R4 | Windows native binding 설치 실패 | lint/format 불가 | `npm.cmd install` 재시도, lockfile 재설치, 2회 실패 시 사용자 승인 후 회귀 |
| S-R5 | React Hooks/Fast Refresh 규칙 오탐 | 개발 불편 | warn 유지, 파일별 disable+사유, Phase 0에서 severity 재검토 |
| S-R6 | docs/fixtures 재포맷 | 문서/로그 손실 | ignorePatterns로 제외, `format:check`로 확인 |
| S-R7 | `sortPackageJson` 기본 true | package.json 재정렬 | `false` 명시 |
| S-R8 | TS 7/type-aware 조기 도입 | 빌드 호환성 파손 | MVP 미사용, 별도 승인/검증 후 Post-MVP |
| S-R9 | 문서와 실제 구현 불일치 | 혼란 | 이 spec/plan + Phase 0 수용 기준 + grep 검증 |

브레이킹 체인지 여부: 런타임/앱 동작에 대한 브레이킹 체인지는 **없음**. 개발 도구 체인 변경만 있다.
데이터 마이그레이션: **없음**. 롤백 기준: Phase 0에서 도구 결함이 2회 반복되면 사용자 승인 후
ESLint/Prettier로 복귀한다.

## 10. 미해결 질문 (Open questions)

1. `.oxfmtrc.json`의 `printWidth`를 80(Prettier 기본)으로 할지, 100(oxfmt 기본)으로 할지.
   현재 초안은 80이다.
2. `react/only-export-components`를 `warn`으로 둘지, `error`로 올릴지.
3. `import/no-cycle`를 `warn`으로 둘지, `error`로 올릴지.
4. `no-console`을 renderer에서 `warn`으로 유지할지, 프로젝트 로거 사용을 강제할지.
5. `docs/**`와 `tests/fixtures/**`를 포맷 제외하는 정책을 확정할지(현재 제외).
6. Vitest 플러그인을 top-level로 둘지, 테스트 override에서만 활성할지.
7. 향후 TS 7 전환 시 oxlint type-aware/type-check를 도입할지, 별도 intent로 분리할지.
8. CI 도입 시 `lint`/`format:check`를 어느 워크플로에 넣을지(현재 CI 없음).
9. `.gitattributes`로 LF를 강제할지(현재 파일은 모두 LF, CR 0).
