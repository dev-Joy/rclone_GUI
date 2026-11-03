# Idea Inbox

> 상태가 결정되지 않은 미처리 아이디어 수집 풀입니다.
> 형식: `- [YYYY-MM-DD-NN] 아이디어 한 줄 — 맥락/출처`
> 승격 시 DONE.md, 보류 시 HOLD.md, 취소 시 CANCEL.md로 이동합니다.
- [2026-11-03-01] 앱에서 remote 이름 변경(새 이름으로 추가 → 작업·북마크·예약 참조 갱신 → 기존 remote 삭제를 한 흐름으로) — INT-006 Q4에서 범위 밖으로 결정. 비밀 값을 앱이 읽지 않아 rclone만으로 옮길 방법(rc config/get 금지)부터 찾아야 함
- [2026-11-03-02] rclone 실행을 rc(`rcd` + `sync/sync`·`sync/copy`의 `_config`·`_filter`·`_async`)로 바꿔 진행률은 `core/stats` JSON으로, 중지는 `job/stop`으로 받기 — INT-007 범위 검토에서 뺌. 통과 조건: `core/stats`가 지금 stats 파서·run-eta와 같은 정보를 주는지, `job/stop` 뒤 자식 프로세스가 남지 않는지, 차단 목록을 `_config` 키에도 적용할 수 있는지, 1.65.0 지원 여부. 안전 규칙 1·2 개정 필요
- [2026-11-03-03] 공용 제외 패턴의 `#`·`;` 시작 금지 해제 — INT-007 spec Q-2에서 범위 밖으로 결정. `--filter-from`의 `- ` 줄로 바뀌면 기술적 이유가 없어진다. DB v3 마이그레이션(CHECK 변경·테이블 재생성, 앞뒤 공백 금지는 유지할지 함께 결정)·zod·`libraryPatternIssue`·저장 오류 문구 변경 필요. INT-007 완료 뒤 검토
