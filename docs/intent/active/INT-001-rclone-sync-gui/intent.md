---
id: INT-001
title: rclone 기반 폴더 비교·동기화 데스크톱 앱 (rcloneGUI)
status: active
priority: P2
created: 2026-10-27
updated: 2026-10-28
---

# Intent: rclone 기반 폴더 비교·동기화 데스크톱 앱 (rcloneGUI)

> 관련 문서: [`docs/specs/MVP_SPEC.md`](../../../specs/MVP_SPEC.md) (설계 명세), [`docs/specs/IMPLEMENTATION_PLAN.md`](../../../specs/IMPLEMENTATION_PLAN.md) (구현 계획)

## 문제 (Problem)
- 현재 Windows에서 rclone CLI를 수동/반자동으로 실행해 폴더를 동기화하고 있어, 어떤 파일이 추가·변경·삭제되었는지 사전에 확인하기 어렵고 명령 오타·옵션 실수로 원치 않는 결과가 발생할 위험이 있다.
- 기존에 사용하던 GoodSync는 평생 라이선스가 사라져 지속 사용이 어렵고, rclone 기반으로 동일한 "좌측 원본 / 우측 대상 비교 후 복사·동기화" 경험을 제공하는 자체 GUI가 필요하다.
- 실제 사용 환경은 WSL 내부 작업 폴더 → `E:\My Projects` 하위 폴더, 이어서 `E:\My Projects` 전체 → Google Drive remote(`GDRIVE-storiez11:My Projects`)로 이어지는 2단계 동기화이며, WSL 경로는 `\\wsl.localhost\...` UNC 형태로만 접근 가능해 일반 GUI 도구로는 다루기 번거롭다.
- Google Drive 가상드라이브는 IDE에서 직접 사용이 어려워 E 드라이브를 경유해야 하므로, 로컬 경로·UNC 경로·rclone remote를 한 화면에서 다루는 도구가 필요하다.

## 제안 결과 (Proposed outcome)
- 로컬 데스크톱 앱을 실행하면 좌측(원본)과 우측(대상) 폴더/remote를 선택하고, Compare Folders/Files 스타일의 2-pane 화면에서 차이(원본만 존재 / 대상만 존재 / 크기·시간·해시 상이 / 동일)를 한눈에 확인할 수 있다.
- 비교 결과를 확인한 뒤 작업(job) 단위로 원본 → 대상 copy 또는 대상에만 존재하는 파일까지 정리하는 sync를 실행할 수 있고, 실행 전 dry-run 미리보기와 삭제 대상 확인 절차를 거친다. (선택 항목만 복사는 Post-MVP)
- 실제 동기화는 실행 직전 dry-run 사전점검으로 계획과의 차이가 없음을 확인한 뒤 수행되며, 진행률·처리 파일 수·오류 로그를 화면에서 확인할 수 있다.
- rclone은 `--config`로 `rclone.conf`를 명시해 실행하고, 옵션은 구조화된 항목으로만 입력한다(임의 플래그 입력 불가). 로컬 경로·UNC 경로·클라우드(FTP/SFTP/Google Drive 등) remote를 동일한 워크플로로 다룰 수 있다.
- 자주 쓰는 동기화 작업(job)을 저장해 재실행할 수 있고, MVP 수준의 주기 실행 스케줄러로 반복 동기화를 자동화할 수 있다.
- 서버·계정 로그인 없이 로컬에서만 동작하며, Windows에서 실제로 매일 사용 가능한 안정성을 확보한다.

## 영향 사용자 및 시스템 (Affected users and systems)
- 사용자: 개발자 본인 1인(단일 사용자, 로컬 전용). 향후 필요 시 소수 사용자로 확장 가능.
- 클라이언트: Windows 데스크톱 앱(Electron + Vite + React + TypeScript). 메인 프로세스에서 rclone CLI를 child process로 실행하고 렌더러는 UI만 담당.
- 외부 의존: rclone CLI(최소 1.65.0, 1.75.1에서 검증, 로컬 설치), rclone 설정 파일(`rclone.conf`), Google Drive remote(`GDRIVE-storiez11:My Projects`), FTP/SFTP 등 rclone이 지원하는 remote.
- 파일 시스템: WSL 내부 작업 폴더(`\\wsl.localhost\...` UNC), `E:\My Projects` 및 하위 폴더, Google Drive(remote 경유).
- 산출물: 설치/실행 가능한 Electron 앱, job 설정 영속화 파일, 실행 로그.

## 제약 (Constraints)
- MVP 우선: 실제 사용 가능한 안정성을 최우선으로 하고, 완벽한 UI/고급 기능은 이후 점진적으로 업그레이드한다.
- Post-MVP 업그레이드 순서: 선택 항목만 복사 → 파일 감시(watcher) 자동 동기화 → `rclone bisync`.
- 로컬 전용: 서버, 계정 로그인, 클라우드 백엔드 없음. 설정·job·로그는 로컬에 저장한다.
- 기술 스택 고정: Electron + Vite + React (+ TypeScript). Windows 우선 지원.
- rclone CLI 의존: 비교는 `rclone lsjson` 등 메타데이터 조회를 활용하고, 실제 동기화는 실행 직전 dry-run 사전점검 후 수행한다. rclone 미설치/버전 불일치 시 명확한 안내가 필요하다.
- 경로 제약: WSL 경로는 UNC(`\\wsl.localhost\...`) 형태로 접근하며, Google Drive 가상드라이브는 직접 사용하지 않고 E 드라이브 경유 워크플로를 전제로 한다.
- 안전성: sync는 대상에만 있는 파일을 삭제하는 파괴적 동작이므로, 실행 전 삭제 대상 목록 확인·dry-run 미리보기·확인 절차 등 안전장치가 필수다.
- 테스트 안전: 자동 테스트와 수용 테스트는 임시 폴더와 테스트 remote만 사용하며, 실제 `E:\My Projects`·실제 Google Drive에는 접근하지 않는다.
- 환경: Windows Node 24 / npm 9, rclone 1.75.1, 프로젝트 경로 `D:\dev-Joy\rcloneGUI`(WSL에서는 `/mnt/d/dev-Joy/rcloneGUI`).

## 미해결 질문 (Open questions)
- [x] 최종 앱 이름/브랜딩을 "SyncDeck"으로 확정할지, 다른 이름으로 변경할지. → **rcloneGUI**로 확정.
- [x] 자동 동기화 방식: MVP는 주기 실행 스케줄러로 시작하되, 이후 파일 감시(watcher) 또는 `rclone bisync` 중 무엇을 1차 업그레이드로 채택할지. → 파일 감시 먼저, 그다음 `rclone bisync`. (선택 항목만 복사는 Post-MVP 업그레이드 1순위)
- [x] Google Drive remote 인증 방식(OAuth 토큰 갱신 처리)과 해시 검증 정책(크기/수정시간 vs 체크섬)을 어느 수준까지 보장할지. → OAuth 토큰 갱신은 rclone에 위임, 해시 검증은 기본 OFF·작업별 ON, 수정시간 허용오차 2초.
- [x] 대용량 폴더(수만~수십만 파일) 비교 시 허용 가능한 성능 목표(최초 스캔 시간, 메모리 사용량)를 어디까지 둘지. → 2만 파일 비교 60초 이내, 5만 행 메모리 600MB 이하, 20만 파일 초과는 Post-MVP.
- [x] Windows 외 플랫폼(macOS/Linux) 지원 여부와 시점. → Windows x64만 지원, macOS/Linux는 Post-MVP 4순위.

## 작업 (Tasks)
- [x] T-01 [P1] Electron + Vite + React + TypeScript 프로젝트 스캐폴딩 및 Phase 0 호환성 확인(CJS preload 등), IPC 채널 경계 및 공통 타입(Job, DiffEntry, RcloneResult 등) 정의
- [x] T-02 [P1] rclone 실행 래퍼 및 환경 감지 (바이너리 경로 탐색, `--version` 확인, `--config` 명시 실행, stdout/stderr/exit code 표준화) (depends: T-01)
- [ ] T-03 [P1] 경로/remote 선택 UI·검증 (로컬 경로, `\\wsl.localhost\...` UNC, WSL distro 목록 조회 및 `/home/...` → UNC 변환 도우미, rclone remote `name:path`, 접근 가능 여부 사전 확인) (depends: T-01, T-02)
- [ ] T-04 [P1] 작업(job) CRUD 및 영속화 (원본/대상, 옵션, 사용할 `.conf`, 마지막 실행 결과 저장) (depends: T-01)
- [ ] T-05 [P1] 메타데이터 기반 폴더 비교 엔진 (`rclone lsjson`/`check`/`--dry-run` 결과 파싱, 원본만·대상만·변경·동일 분류) (depends: T-02, T-03)
- [ ] T-06 [P1] 차이(diff) 2-pane UI (Compare Folders 스타일 목록, 크기·수정시간·해시 표시, 정렬/필터) (depends: T-04, T-05)
- [ ] T-07 [P1] copy/sync 실행과 진행률·로그 표시 (실행 직전 dry-run 사전점검, `--stats`/`--progress` 파싱, 취소 처리, 전역 단일 활동 락으로 비교·실행·자동 실행 중복 방지) (depends: T-05, T-06)
- [ ] T-08 [P1] dry-run 미리보기 및 삭제 안전확인 (삭제 예정 목록 명시, 확인 후 실행, 위험 옵션 차단) (depends: T-07)
- [ ] T-09 [P2] `.conf` 관리 (설정 파일 선택·검증, remote 목록 조회) (depends: T-02)
- [ ] T-10 [P2] 자동 동기화 스케줄러 (job별 주기 실행, 중복 실행 방지, 실패 시 로그·알림) (depends: T-04, T-07, T-08)
- [ ] T-11 [P3] 설정 화면 (rclone 경로, 기본 옵션, 로그 보관/정리, 앱 테마) (depends: T-02)
- [ ] T-12 [P3] 테스트 및 패키징 (핵심 로직 단위 테스트, Windows 인스톨러 빌드, 실행 스모크 테스트) (depends: T-08, T-09, T-10, T-11, T-13, T-14)
- [ ] T-13 [P1] 실행 이력/로그 UI (이력 목록, 로그 tail 보기, 로그 폴더 열기·정리) (depends: T-07)
- [ ] T-14 [P2] 트레이·로그인 시 자동 시작·단일 인스턴스 (depends: T-10)
- [ ] T-15 [P2] 문서(README/AGENTS.md) 및 실제 환경 수용 테스트(임시 경로·테스트 remote) (depends: T-12)
