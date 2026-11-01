/**
 * 순수 diff 엔진 (MVP_SPEC §7.3). 원본·대상 파일 목록을 받아 상태 5종으로 분류하고 요약한다.
 * rclone copy/sync의 판단(크기 → 해시 또는 수정시간 허용오차)과 같은 규칙을 따른다.
 * 전체 범위(INT-002 T-05)에서는 폴더 목록을 받아 만들 빈 폴더·지울 폴더를 따로 센다(파일 5상태와 섞지 않음).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import type {
    itfCompareSummary,
    itfDiffEntry,
    itfDirChange,
    itfFileMeta,
    typCompareStatus,
    typModifiedReason,
} from "@/shared/types/compare";

export interface itfDiffOptions {
    caseInsensitive: boolean;
    checkHashes: boolean;
    modtimeToleranceMs: number;
}

/** 전체 범위의 폴더 목록(lsjson IsDir 항목의 Path) */
export interface itfDirLists {
    source: readonly string[];
    dest: readonly string[];
}

export type typDiffResult =
    | {
          ok: true;
          entries: itfDiffEntry[];
          summary: itfCompareSummary;
          dirChanges: itfDirChange[];
          warnings: string[];
      }
    | { ok: false; code: "CASE_COLLISION"; side: "source" | "dest"; paths: [string, string] };

/** 양쪽에 모두 있는 첫 알고리즘을 쓴다 */
export const HASH_PRIORITY: readonly string[] = [
    "sha1",
    "md5",
    "sha256",
    "xxh3",
    "xxh128",
    "crc32",
    "blake3",
    "dropbox",
    "quickxor",
    "whirlpool",
];

interface itfIndexed {
    map: Map<string, itfFileMeta>;
    collision: [string, string] | null;
}

function f_Key(path: string, caseInsensitive: boolean): string {
    const nfc = path.normalize("NFC");
    return caseInsensitive ? nfc.toLowerCase() : nfc;
}

function f_Index(list: readonly itfFileMeta[], caseInsensitive: boolean): itfIndexed {
    const map = new Map<string, itfFileMeta>();
    for (const file of list) {
        const key = f_Key(file.path, caseInsensitive);
        const prev = map.get(key);
        if (prev) return { map, collision: [prev.path, file.path] };
        map.set(key, file);
    }
    return { map, collision: null };
}

interface itfDirIndexed {
    map: Map<string, string>;
    collision: [string, string] | null;
}

/** 폴더 경로 색인. 같은 쪽 폴더끼리 또는 같은 쪽 파일과 키가 겹치면 collision */
function f_IndexDirs(
    list: readonly string[],
    files: ReadonlyMap<string, itfFileMeta>,
    caseInsensitive: boolean,
): itfDirIndexed {
    const map = new Map<string, string>();
    for (const path of list) {
        const key = f_Key(path, caseInsensitive);
        const prev = map.get(key) ?? files.get(key)?.path;
        if (prev !== undefined) return { map, collision: [prev, path] };
        map.set(key, path);
    }
    return { map, collision: null };
}

/** "a/b/c" → ["a", "a/b"] */
function f_Ancestors(key: string): string[] {
    const out: string[] = [];
    let idx = key.indexOf("/");
    while (idx !== -1) {
        out.push(key.slice(0, idx));
        idx = key.indexOf("/", idx + 1);
    }
    return out;
}

function f_ConflictRoot(key: string, roots: ReadonlySet<string>): string | null {
    if (roots.has(key)) return key;
    for (const a of f_Ancestors(key)) if (roots.has(a)) return a;
    return null;
}

function f_PickHash(s: itfFileMeta, d: itfFileMeta): string | null {
    if (!s.hashes || !d.hashes) return null;
    for (const algo of HASH_PRIORITY) {
        if (s.hashes[algo] && d.hashes[algo]) return algo;
    }
    return null;
}

interface itfPairResult {
    status: typCompareStatus;
    reasons: typModifiedReason[];
    hashAlgo: string | null;
    hashUnavailable: boolean;
}

function f_ComparePair(s: itfFileMeta, d: itfFileMeta, opts: itfDiffOptions): itfPairResult {
    const base = { hashAlgo: null, hashUnavailable: false };
    if (s.size !== d.size) return { ...base, status: "modified", reasons: ["size"] };

    if (opts.checkHashes) {
        const algo = f_PickHash(s, d);
        if (!algo) return { ...base, status: "equal", reasons: [], hashUnavailable: true };
        const same = s.hashes![algo]!.toLowerCase() === d.hashes![algo]!.toLowerCase();
        return {
            status: same ? "equal" : "modified",
            reasons: same ? [] : ["hash"],
            hashAlgo: algo,
            hashUnavailable: false,
        };
    }

    if (s.modTimeMs === null || d.modTimeMs === null) {
        return { ...base, status: "modified", reasons: ["mtimeUnknown"] };
    }
    if (Math.abs(s.modTimeMs - d.modTimeMs) > opts.modtimeToleranceMs) {
        return { ...base, status: "modified", reasons: ["mtime"] };
    }
    return { ...base, status: "equal", reasons: [] };
}

function f_Side(f: itfFileMeta) {
    return { path: f.path, size: Math.max(0, f.size), modTimeMs: f.modTimeMs };
}

export function emptySummary(): itfCompareSummary {
    return {
        sourceFiles: 0,
        destFiles: 0,
        createFiles: 0,
        updateFiles: 0,
        deleteFiles: 0,
        sameFiles: 0,
        conflictFiles: 0,
        conflictGroups: 0,
        createBytes: 0,
        updateBytes: 0,
        deleteBytes: 0,
        transferBytes: 0,
        caseOnlyFiles: 0,
        hashComparedFiles: 0,
        hashUnavailableFiles: 0,
        createDirs: 0,
        deleteDirs: 0,
    };
}

/**
 * dirs가 null이면 파일만 범위(폴더 수 0, dirChanges []).
 * dirs가 있으면 원본 폴더가 대상 파일(또는 그 반대)과 겹치는 곳을 충돌로 더하고,
 * 파일이 없는 원본 전용 폴더를 createDirs, 대상 전용 폴더를 deleteDirs로 센다.
 */
export function diffFileLists(
    sourceList: readonly itfFileMeta[],
    destList: readonly itfFileMeta[],
    opts: itfDiffOptions,
    dirs: itfDirLists | null = null,
): typDiffResult {
    const src = f_Index(sourceList, opts.caseInsensitive);
    if (src.collision)
        return { ok: false, code: "CASE_COLLISION", side: "source", paths: src.collision };
    const dst = f_Index(destList, opts.caseInsensitive);
    if (dst.collision)
        return { ok: false, code: "CASE_COLLISION", side: "dest", paths: dst.collision };

    const warnings: string[] = [];
    const negative = [...sourceList, ...destList].filter((f) => f.size < 0).length;
    if (negative > 0) {
        warnings.push(`크기를 알 수 없는 파일 ${negative}개를 0 B로 계산했습니다(Google 문서 등).`);
    }

    // 1) 파일 ↔ 폴더 충돌: 한쪽의 파일 경로가 다른 쪽에서는 폴더(상위 경로)인 경우
    const conflictRoots = new Set<string>();
    for (const key of src.map.keys())
        for (const a of f_Ancestors(key)) if (dst.map.has(a)) conflictRoots.add(a);
    for (const key of dst.map.keys())
        for (const a of f_Ancestors(key)) if (src.map.has(a)) conflictRoots.add(a);

    // 폴더 목록(전체 범위): 같은 쪽 충돌 검사, 폴더 ↔ 다른 쪽 파일 충돌을 더한다
    let srcDirs: itfDirIndexed | null = null;
    let dstDirs: itfDirIndexed | null = null;
    if (dirs) {
        srcDirs = f_IndexDirs(dirs.source, src.map, opts.caseInsensitive);
        if (srcDirs.collision)
            return { ok: false, code: "CASE_COLLISION", side: "source", paths: srcDirs.collision };
        dstDirs = f_IndexDirs(dirs.dest, dst.map, opts.caseInsensitive);
        if (dstDirs.collision)
            return { ok: false, code: "CASE_COLLISION", side: "dest", paths: dstDirs.collision };
        for (const key of srcDirs.map.keys())
            for (const k of [...f_Ancestors(key), key]) if (dst.map.has(k)) conflictRoots.add(k);
        for (const key of dstDirs.map.keys())
            for (const k of [...f_Ancestors(key), key]) if (src.map.has(k)) conflictRoots.add(k);
    }

    const keys = [...new Set([...src.map.keys(), ...dst.map.keys()])].toSorted();
    const summary = emptySummary();
    summary.sourceFiles = src.map.size;
    summary.destFiles = dst.map.size;
    summary.conflictGroups = conflictRoots.size;
    const entries: itfDiffEntry[] = [];

    for (const key of keys) {
        const s = src.map.get(key);
        const d = dst.map.get(key);
        let pair: itfPairResult;
        if (f_ConflictRoot(key, conflictRoots) !== null) {
            pair = {
                status: "typeConflict",
                reasons: ["type"],
                hashAlgo: null,
                hashUnavailable: false,
            };
        } else if (s && !d) {
            pair = { status: "onlySource", reasons: [], hashAlgo: null, hashUnavailable: false };
        } else if (!s && d) {
            pair = { status: "onlyDest", reasons: [], hashAlgo: null, hashUnavailable: false };
        } else {
            pair = f_ComparePair(s!, d!, opts);
        }

        const entry: itfDiffEntry = {
            path: (s ?? d)!.path,
            status: pair.status,
            reasons: pair.reasons,
            source: s ? f_Side(s) : null,
            dest: d ? f_Side(d) : null,
            caseOnly: Boolean(s && d && s.path !== d.path),
            hashAlgo: pair.hashAlgo,
            hashUnavailable: pair.hashUnavailable,
        };
        entries.push(entry);

        if (entry.caseOnly) summary.caseOnlyFiles += 1;
        if (pair.hashAlgo) summary.hashComparedFiles += 1;
        if (pair.hashUnavailable) summary.hashUnavailableFiles += 1;
        switch (pair.status) {
            case "onlySource":
                summary.createFiles += 1;
                summary.createBytes += entry.source!.size;
                break;
            case "modified":
                summary.updateFiles += 1;
                summary.updateBytes += entry.source!.size;
                break;
            case "onlyDest":
                summary.deleteFiles += 1;
                summary.deleteBytes += entry.dest!.size;
                break;
            case "equal":
                summary.sameFiles += 1;
                break;
            case "typeConflict":
                summary.conflictFiles += 1;
                break;
        }
    }
    summary.transferBytes = summary.createBytes + summary.updateBytes;
    const dirChanges =
        srcDirs && dstDirs ? f_DiffDirs(srcDirs.map, dstDirs.map, src.map, conflictRoots) : null;
    if (dirChanges) {
        summary.createDirs = dirChanges.changes.filter((c) => c.action === "create").length;
        summary.deleteDirs = dirChanges.changes.length - summary.createDirs;
        summary.caseOnlyFiles += dirChanges.caseOnly.length;
        for (const [a, b] of dirChanges.caseOnly)
            warnings.push(`대소문자만 다른 폴더: ‘${a}’ ↔ ‘${b}’`);
    }
    if (opts.checkHashes && summary.hashUnavailableFiles > 0) {
        warnings.push(
            `공통 해시가 없는 파일 ${summary.hashUnavailableFiles}개는 크기만 비교했습니다(rclone --checksum과 같음).`,
        );
    }
    return { ok: true, entries, summary, dirChanges: dirChanges?.changes ?? [], warnings };
}

/** 폴더 변화. 충돌 루트 아래 폴더는 세지 않는다(파일 쪽 typeConflict가 실행을 막음) */
function f_DiffDirs(
    srcDirs: ReadonlyMap<string, string>,
    dstDirs: ReadonlyMap<string, string>,
    srcFiles: ReadonlyMap<string, itfFileMeta>,
    conflictRoots: ReadonlySet<string>,
): { changes: itfDirChange[]; caseOnly: [string, string][] } {
    const srcFileAncestors = new Set<string>();
    for (const key of srcFiles.keys()) for (const a of f_Ancestors(key)) srcFileAncestors.add(a);
    const changes: itfDirChange[] = [];
    const caseOnly: [string, string][] = [];
    const keys = [...new Set([...srcDirs.keys(), ...dstDirs.keys()])].toSorted();
    for (const key of keys) {
        if (f_ConflictRoot(key, conflictRoots) !== null) continue;
        const s = srcDirs.get(key);
        const d = dstDirs.get(key);
        if (s !== undefined && d !== undefined) {
            if (s !== d) caseOnly.push([s, d]);
        } else if (s !== undefined) {
            if (!srcFileAncestors.has(key)) changes.push({ path: s, action: "create" });
        } else if (d !== undefined) {
            changes.push({ path: d, action: "delete" });
        }
    }
    return { changes, caseOnly };
}
