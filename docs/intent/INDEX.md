# Intent Index

> 이 파일은 `docs/intent/` 폴더 스캔 결과로 재작성되는 대장입니다. 직접 편집하지 않습니다.
> Last updated: 2026-11-03

## 요약
| 상태 | 건수 |
| :--- | :--- |
| planned | 0 |
| active | 1 |
| hold | 0 |
| done | 6 |
| **합계** | **7** |

## Planned (미착수)
| ID | 제목 | 우선순위 | 태스크 | 갱신 |
| :--- | :--- | :--- | :--- | :--- |

## Active (작업 중)
| ID | 제목 | 우선순위 | 태스크 | 갱신 |
| :--- | :--- | :--- | :--- | :--- |
| INT-004 | 작은 파일이 많은 실행에서도 믿을 수 있는 남은 시간 표시 | P2 | 3/3 | 2026-11-03 |

## Hold (보류)
| ID | 제목 | 보류 사유 | 재개 조건 | 갱신 |
| :--- | :--- | :--- | :--- | :--- |

## Done (완료)
| ID | 제목 | 완료일 | 결과 요약 |
| :--- | :--- | :--- | :--- |
| INT-001 | rclone 기반 폴더 비교·동기화 데스크톱 앱 (rcloneGUI) | 2026-10-29 | Windows x64 NSIS 설치본 0.1.0 완성 — 단위 707·통합 36(+1 skip)·E2E 3, 설치 스모크 15/15, drive-app 89/89 통과 |
| INT-002 | rcloneGUI 스케줄·SQLite·리모트/제외 패턴 UX 개선 | 2026-11-02 | 태스크 11/11(취소 2) — SQLite·제외 패턴·리모트 북마크·동기화 범위·매일/요일 예약·단계별 실행 화면, unit 977·통합 51(+7 skip)·E2E 10·설치 스모크 통과. 후속은 INT-003 |
| INT-005 | rclone이 외부에서 강제 종료됐을 때 이해할 수 있는 실패 안내 | 2026-11-03 | T-01~T-03 — 방식별 종료 코드 실측(Stop-Process/.NET=-1, taskkill=1, CIM Terminate=0, Ctrl+C=1+Signal), int32 표기·RCLONE_KILLED/CRASHED 분류·화면/이력/알림 문구. unit 1,312·통합 77(+19 skip)·E2E 15·build:win·drive-app 112 통과 |
| INT-006 | 앱에서 rclone remote 추가·수정·삭제·재인증 | 2026-11-03 | T-01~T-06 완료 — providers 동적 폼·rcd 본문 비밀 값·OAuth 질문/취소/재인증·redacted 수정·참조 확인 삭제·REMOTE_NOT_FOUND, unit 76파일 1,274·통합 75(+19 skip)·E2E 15·build:win 통과(OAuth 실제 로그인 수동 확인 남음) |
| INT-007 | 제외 패턴을 --filter-from 파일로 전달해 명령줄 전용 패턴 제한과 뒤 공백 버그 해소 | 2026-11-03 | T-01~T-05 완료 — 모든 패턴을 `- <패턴>` 필터 파일 하나로 전달(끝 공백 `[c]`·`snapshotHash` v2), 인자 전용 예산·`isFileSafePattern` 제거, 1.65.0/1.75.1 동작 확인. unit 1,289·통합 77(+19 skip)·E2E 15·build:win 통과 |
| INT-003 | OS 예약·헤드리스 실행·sync 오류 무시/백업 폴더·GCS 실측 후속 | 2026-11-02 | 태스크 4/4(취소 4) — Windows 작업 스케줄러 예약·헤드리스 실행, 백업 폴더 sync, 빈 폴더 불가 대상 안내, Google Drive 수용 테스트(T-04 대체). unit 1198·통합 71(+19 skip)·E2E 14·Drive 수용 14/14 통과 |
