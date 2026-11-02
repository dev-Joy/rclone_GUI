/**
 * remote 북마크와 폴더 탐색 결과 타입 (INT-002 T-02).
 * DB에는 별칭·remote 이름·기준 경로만 두고, 화면에 보여 줄 전체 경로(path)는 파생한다.
 *
 * @author dev-Joy 2026-10-30
 */

export interface itfRemoteBookmark {
    id: string;
    /** 사용자가 붙인 이름 */
    alias: string;
    /** rclone.conf의 remote 이름(":" 제외) */
    remoteName: string;
    /** remote 안의 기준 경로. 선두 "/"는 보존, 빈 값은 루트 */
    basePath: string;
    /** "remoteName:basePath" */
    path: string;
    createdAt: string;
    updatedAt: string;
}

export interface itfDirEntry {
    name: string;
    /** "remoteName:basePath/name" */
    path: string;
}

export interface itfDirListing {
    /** 나열한 경로(정규화) */
    path: string;
    /** 이름 순, 최대 LIST_DIR_MAX개 */
    entries: itfDirEntry[];
    /** 상한 전 전체 항목 수 */
    total: number;
    /** LIST_DIR_MAX를 넘었거나 rclone 출력이 잘렸다 */
    truncated: boolean;
}

/** remotes:features 결과(INT-003 FR-32, 편집기 경고용) */
export interface itfRemoteFeatures {
    /** 빈 폴더를 만들 수 있는지. 로컬·UNC는 true, 알 수 없으면 null */
    canHaveEmptyDirs: boolean | null;
}
