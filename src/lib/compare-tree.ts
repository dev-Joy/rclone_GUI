/**
 * 비교 결과를 폴더 트리로 접고 펼친 1차원 행 목록을 만드는 순수 함수.
 * 경로 구분자는 "/"만 쓰고, 형제 순서는 입력 rows(필터·정렬 결과) 순서를 그대로 따른다.
 * 폴더 노드 순서는 그 폴더에 속한 첫 파일이 나온 순서다. 대소문자가 다른 경로는 별도 노드로 둔다.
 * 접힌 폴더의 하위는 결과에 넣지 않는다. DOM·window 의존 없음 (단위 테스트는 node 환경).
 *
 * @author dev-Joy 2026-11-17
 */

// ========== Internal imports ==========
import type { itfDiffEntry } from "@/shared/types/compare";

// ========== Props & Types ==========
export interface itfTreeFolderRow {
    kind: "folder";
    /** "/" 구분 폴더 경로 */
    path: string;
    name: string;
    depth: number;
    /** 하위 전체 파일 수(필터·정렬 결과 기준) */
    fileCount: number;
    /** 하위 변경 파일 수(equal 제외) */
    changeCount: number;
}

export interface itfTreeFileRow {
    kind: "file";
    /** entries 배열의 인덱스 */
    entryIndex: number;
    path: string;
    name: string;
    depth: number;
}

export type typTreeRow = itfTreeFolderRow | itfTreeFileRow;

interface itfFileNode {
    kind: "file";
    entryIndex: number;
    path: string;
    name: string;
    depth: number;
}

interface itfFolderNode {
    kind: "folder";
    path: string;
    name: string;
    depth: number;
    fileCount: number;
    changeCount: number;
    children: typNode[];
}

type typNode = itfFolderNode | itfFileNode;

/**
 * rows(필터·정렬된 entries 인덱스)를 폴더 트리로 접고, expanded 폴더의 하위만 펼쳐
 * 1차원 행 목록으로 만든다. 폴더 자체 행은 항상 포함한다(접힘이면 하위만 감춘다).
 */
export function buildTreeRows(
    entries: readonly itfDiffEntry[],
    rows: readonly number[],
    expanded: ReadonlySet<string>,
): typTreeRow[] {
    const root: itfFolderNode = {
        kind: "folder",
        path: "",
        name: "",
        depth: -1,
        fileCount: 0,
        changeCount: 0,
        children: [],
    };
    /** 폴더 경로 → 노드. 경로 문자열을 그대로 키로 쓴다(정규화·대소문자 통합 없음) */
    const folders = new Map<string, itfFolderNode>([["", root]]);

    for (const entryIndex of rows) {
        const entry = entries[entryIndex];
        if (!entry) continue;
        const parts = entry.path.split("/");
        const name = parts[parts.length - 1] ?? entry.path;
        const chain: itfFolderNode[] = [];
        let parent = root;
        let path = "";
        for (let i = 0; i < parts.length - 1; i += 1) {
            path = i === 0 ? (parts[i] ?? "") : `${path}/${parts[i] ?? ""}`;
            let folder = folders.get(path);
            if (!folder) {
                folder = {
                    kind: "folder",
                    path,
                    name: parts[i] ?? "",
                    depth: i,
                    fileCount: 0,
                    changeCount: 0,
                    children: [],
                };
                folders.set(path, folder);
                parent.children.push(folder);
            }
            chain.push(folder);
            parent = folder;
        }
        parent.children.push({
            kind: "file",
            entryIndex,
            path: entry.path,
            name,
            depth: parts.length - 1,
        });
        // 이 파일이 속한 폴더 전부의 집계를 올린다(equal은 전체 수에만 센다)
        for (const folder of chain) {
            folder.fileCount += 1;
            if (entry.status !== "equal") folder.changeCount += 1;
        }
    }

    const out: typTreeRow[] = [];
    const f_Walk = (nodes: typNode[]): void => {
        for (const node of nodes) {
            if (node.kind === "file") {
                out.push({
                    kind: "file",
                    entryIndex: node.entryIndex,
                    path: node.path,
                    name: node.name,
                    depth: node.depth,
                });
                continue;
            }
            out.push({
                kind: "folder",
                path: node.path,
                name: node.name,
                depth: node.depth,
                fileCount: node.fileCount,
                changeCount: node.changeCount,
            });
            if (expanded.has(node.path)) f_Walk(node.children);
        }
    };
    f_Walk(root.children);
    return out;
}

/**
 * rows가 가리키는 모든 폴더 경로(접힘과 무관, 상위 → 하위 순이 아니라 나온 순서).
 * 모두 펼치기와 "폴더가 있는지" 판단에 쓴다.
 */
export function collectFolderPaths(
    entries: readonly itfDiffEntry[],
    rows: readonly number[],
): string[] {
    const paths = new Set<string>();
    for (const entryIndex of rows) {
        const entry = entries[entryIndex];
        if (!entry) continue;
        const parts = entry.path.split("/");
        let path = "";
        for (let i = 0; i < parts.length - 1; i += 1) {
            path = i === 0 ? (parts[i] ?? "") : `${path}/${parts[i] ?? ""}`;
            paths.add(path);
        }
    }
    return [...paths];
}
