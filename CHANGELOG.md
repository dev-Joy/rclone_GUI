# Changelog

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르며, `z_skill_git_commit`·`z_skill_git_to_merge`가 `main`/`master` 반영 시 실제 변경 내역을 기록합니다.

## [0.1.73] - 2026-11-17

### Changed

- E2E에서 `지금 실행` 직후 비교 종료 경합을 조건 대기·1회 재시도로 안정화

### Fixed

- `복제`가 작업을 바로 만들지 않고 편집 모달을 열어 값을 확인한 뒤 저장하도록 맞춤(spec FR-15)

## [0.1.72] - 2026-11-17

### Changed

- docs: INT-008 Phase 2·3 구현 내용을 문서에 반영한다

## [0.1.71] - 2026-11-17

### Added

- 작업 그룹: 만들기·이름 바꾸기·지우기·접기/펼치기, 목록 그룹 머리글과 `+ 새 그룹`
- 작업 편집 모달의 그룹 선택

### Changed

- 데이터 구조 v3: groups 표와 작업 group_id, 그룹 지정은 비교 계획을 무효화하지 않음
