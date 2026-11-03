/**
 * 앱에서 rclone remote 설정을 추가·수정·삭제·재인증할 때 쓰는 타입 (INT-006 T-02~T-05).
 * providers 정의에서 만든 동적 폼, 수정 화면의 비밀 아닌 값, 참조 수, OAuth 진행 상태를 정의한다.
 * 비밀 값은 이 타입에 담지 않는다(secretsSet은 "값이 있다"만 알린다).
 *
 * @author dev-Joy 2026-11-03
 */

/** 폼 입력 종류. providers의 Type을 화면이 다루기 쉬운 값으로 줄인 것 */
export type typRemoteOptionKind = "string" | "bool" | "int" | "duration" | "size" | "enum";

export interface itfRemoteOptionChoice {
    value: string;
    help: string;
}

/** providers 옵션 하나(숨김 옵션은 파서가 뺀다) */
export interface itfRemoteOption {
    name: string;
    help: string;
    defaultText: string;
    required: boolean;
    advanced: boolean;
    /** IsPassword || Sensitive — 화면에서 가림 입력, 수정 화면에서 "설정됨"으로 표시 */
    secret: boolean;
    kind: typRemoteOptionKind;
    /** Exclusive 옵션의 선택지(그 밖의 값은 거부) */
    choices: itfRemoteOptionChoice[];
    exclusive: boolean;
}

export interface itfRemoteProvider {
    /** providers의 Prefix(예: drive, sftp, local) */
    type: string;
    description: string;
    /** options에 token이 있으면 OAuth 종류(probe 기준) */
    oauth: boolean;
    options: itfRemoteOption[];
}

/** remoteConfig:get 결과. 비밀 값은 빠지고 값이 있는 비밀 옵션 이름만 온다 */
export interface itfRemoteConfigView {
    name: string;
    type: string;
    /** 비밀 아닌 값만 */
    values: Record<string, string>;
    /** 값이 있는 비밀 옵션 이름(화면은 "설정됨 — 바꿀 때만 입력") */
    secretsSet: string[];
    /** config redacted를 쓸 수 없어 값을 채우지 못했는지 */
    redactedUnavailable: boolean;
}

/** remoteConfig:usage 결과(FR-19). 대소문자를 무시하고 센다 */
export type typRemoteUsageAutoSync = "off" | "app" | "os";

export interface itfRemoteUsageJob {
    id: string;
    name: string;
    autoSync: typRemoteUsageAutoSync;
}

export interface itfRemoteUsageBookmark {
    id: string;
    alias: string;
}

export interface itfRemoteUsage {
    jobs: itfRemoteUsageJob[];
    bookmarks: itfRemoteUsageBookmark[];
    /** 작업별 rclone.conf를 써서 세지 않은 작업 수(안내용, FR-19) */
    otherConfigJobs: number;
}

export interface itfRemoteDeleteResult {
    name: string;
    /** 자동 실행을 끈 작업 id */
    disabledJobIds: string[];
}

/** rclone이 비대화형 흐름에서 돌려준 질문 하나(FR-15a) */
export interface itfRemoteQuestion {
    state: string;
    option: itfRemoteOption | null;
}

export type typRemoteAuthPhase =
    | "starting"
    | "waiting"
    | "question"
    | "done"
    | "failed"
    | "canceled"
    | "timeout";

/** remoteConfig:authProgress 이벤트. 비밀 값·토큰은 담지 않는다 */
export interface itfRemoteAuthProgress {
    phase: typRemoteAuthPhase;
    name: string;
    /** rclone이 출력한 인증 주소(127.0.0.1만 통과) */
    authUrl?: string;
    /** 대기 만료 시각(ISO) */
    expiresAt?: string;
    message?: string;
    question?: itfRemoteQuestion;
}

export interface itfRemoteAuthAnswerResult {
    phase: typRemoteAuthPhase;
    question?: itfRemoteQuestion;
    message?: string;
}
