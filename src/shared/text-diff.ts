/**
 * 줄 단위 텍스트 diff (INT-009 FR-7·FR-12). 외부 의존성 없이 Myers(LCS)로 같음·삭제·추가 연산을 만든다.
 * - 계산은 화면(renderer)에서 한다. 2MB·D ≤ 2000 입력이 1초 안에 끝나도록 공통 앞뒤 줄을 잘라내고,
 *   줄 문자열은 정수로 바꿔(인터닝) 비교한다.
 * - Myers 편집 거리 D가 상한(TEXT_DIFF_MAX_EDITS)을 넘으면 null을 돌려주고 화면은 원문만 보인다.
 * - 좌우 2열 표시용 행은 toSideBySide가 만든다. delete/insert 묶음은 순서대로 짝지어 changed로 접는다.
 * Node·DOM 의존 없음.
 *
 * @author dev-Joy 2026-11-17
 */

/** 줄 단위 diff 상한(Myers 편집 거리). 넘으면 계산을 멈춘다(FR-12, D-05) */
export const TEXT_DIFF_MAX_EDITS = 2000;

export type typDiffOp = {
    op: "equal" | "delete" | "insert";
    /** a(원본) 줄 인덱스. insert면 null */
    aIndex: number | null;
    /** b(대상) 줄 인덱스. delete면 null */
    bIndex: number | null;
};

export interface itfSideBySideRow {
    kind: "equal" | "changed" | "delete" | "insert";
    /** 왼쪽(원본) 줄 인덱스. 없으면 null */
    left: number | null;
    /** 오른쪽(대상) 줄 인덱스. 없으면 null */
    right: number | null;
}

/**
 * 텍스트를 줄로 나눈다. `\r\n`·`\n`·`\r` 을 모두 줄바꿈으로 보고,
 * 끝에 붙은 빈 줄 하나는 버린다("a\n" → ["a"]). 빈 문자열은 줄 0개다.
 */
export function splitLines(text: string): string[] {
    if (text === "") return [];
    const lines = text.split(/\r\n|\n|\r/);
    if (lines.at(-1) === "") lines.pop();
    return lines;
}

/** Myers 역추적. snapshots[d]는 d번째 라운드 시작 시점(d-1 거리까지의 상태), 인덱스 기준 offset은 d */
function f_Backtrack(snapshots: Int32Array[], n: number, m: number): typDiffOp[] {
    const ops: typDiffOp[] = [];
    let x = n;
    let y = m;
    for (let d = snapshots.length - 1; d > 0; d--) {
        const v = snapshots[d]!;
        const k = x - y;
        let prevK: number;
        if (k === -d || (k !== d && v[d + k - 1]! < v[d + k + 1]!)) {
            prevK = k + 1;
        } else {
            prevK = k - 1;
        }
        const prevX = v[d + prevK]!;
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) {
            x--;
            y--;
            ops.push({ op: "equal", aIndex: x, bIndex: y });
        }
        if (x === prevX) {
            y--;
            ops.push({ op: "insert", aIndex: null, bIndex: y });
        } else {
            x--;
            ops.push({ op: "delete", aIndex: x, bIndex: null });
        }
        x = prevX;
        y = prevY;
    }
    // 남은 앞부분은 두 쪽이 같은 줄이다(d = 0 구간)
    while (x > 0 && y > 0) {
        x--;
        y--;
        ops.push({ op: "equal", aIndex: x, bIndex: y });
    }
    ops.reverse();
    return ops;
}

/**
 * 정수로 바꾼 두 줄 목록의 최단 편집 스크립트. D가 maxEdits를 넘으면 null.
 * O((N+M)·D) 시간, 추적 기록은 O(D²) 정수다(D ≤ 2000에서 16MB 이내).
 */
function f_Myers(a: Int32Array, b: Int32Array, maxEdits: number): typDiffOp[] | null {
    const n = a.length;
    const m = b.length;
    const limit = Math.min(maxEdits, n + m);
    const snapshots: Int32Array[] = [];
    let prev = new Int32Array(3);
    let offset = 1;
    for (let d = 0; d <= limit; d++) {
        snapshots.push(prev);
        const row = new Int32Array(2 * d + 3);
        const base = d + 1;
        for (let k = -d; k <= d; k += 2) {
            const right = prev[offset + k + 1]!;
            let x: number;
            if (k === -d || (k !== d && prev[offset + k - 1]! < right)) {
                x = right;
            } else {
                x = prev[offset + k - 1]! + 1;
            }
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
                x++;
                y++;
            }
            row[base + k] = x;
            if (x >= n && y >= m) return f_Backtrack(snapshots, n, m);
        }
        prev = row;
        offset = base;
    }
    return null;
}

/**
 * 두 줄 목록의 줄 단위 diff. 같음·삭제·추가 연산을 앞에서부터 순서대로 돌려준다.
 * 공통 앞뒤 줄은 먼저 잘라내고 가운데만 계산하며, 편집 거리 D가 maxEdits를 넘으면 null(FR-12).
 * 한쪽만 남는 경우(추가만·삭제만)도 D가 상한을 넘으면 null이다.
 */
export function diffLines(
    a: readonly string[],
    b: readonly string[],
    maxEdits: number = TEXT_DIFF_MAX_EDITS,
): typDiffOp[] | null {
    const n = a.length;
    const m = b.length;
    const ops: typDiffOp[] = [];

    let prefix = 0;
    while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) {
        suffix++;
    }
    for (let i = 0; i < prefix; i++) ops.push({ op: "equal", aIndex: i, bIndex: i });

    const an = n - prefix - suffix;
    const bn = m - prefix - suffix;
    if (an === 0) {
        if (bn > maxEdits) return null;
        for (let j = 0; j < bn; j++) ops.push({ op: "insert", aIndex: null, bIndex: prefix + j });
    } else if (bn === 0) {
        if (an > maxEdits) return null;
        for (let i = 0; i < an; i++) ops.push({ op: "delete", aIndex: prefix + i, bIndex: null });
    } else {
        // 같은 줄을 같은 정수로 바꿔 문자열 비교 비용을 없앤다(인터닝)
        const ids = new Map<string, number>();
        const ai = new Int32Array(an);
        for (let i = 0; i < an; i++) {
            const line = a[prefix + i]!;
            let id = ids.get(line);
            if (id === undefined) {
                id = ids.size;
                ids.set(line, id);
            }
            ai[i] = id;
        }
        const bi = new Int32Array(bn);
        for (let j = 0; j < bn; j++) {
            const line = b[prefix + j]!;
            let id = ids.get(line);
            if (id === undefined) {
                id = ids.size;
                ids.set(line, id);
            }
            bi[j] = id;
        }
        const middle = f_Myers(ai, bi, maxEdits);
        if (middle === null) return null;
        for (const op of middle) {
            ops.push({
                op: op.op,
                aIndex: op.aIndex === null ? null : prefix + op.aIndex,
                bIndex: op.bIndex === null ? null : prefix + op.bIndex,
            });
        }
    }

    for (let i = 0; i < suffix; i++) {
        ops.push({ op: "equal", aIndex: n - suffix + i, bIndex: m - suffix + i });
    }
    return ops;
}

/**
 * 연산 목록을 좌우 2열 행으로 접는다(FR-7).
 * 이어진 삭제·추가 묶음은 앞에서부터 하나씩 짝지어 changed로 만들고, 남는 줄은 delete(왼쪽만)·
 * insert(오른쪽만)로 둔다. equal은 그대로 둔다.
 */
export function toSideBySide(ops: readonly typDiffOp[]): itfSideBySideRow[] {
    const rows: itfSideBySideRow[] = [];
    let deleted: number[] = [];
    let inserted: number[] = [];

    function f_Flush(): void {
        const pairs = Math.min(deleted.length, inserted.length);
        for (let i = 0; i < pairs; i++) {
            rows.push({ kind: "changed", left: deleted[i]!, right: inserted[i]! });
        }
        for (let i = pairs; i < deleted.length; i++) {
            rows.push({ kind: "delete", left: deleted[i]!, right: null });
        }
        for (let i = pairs; i < inserted.length; i++) {
            rows.push({ kind: "insert", left: null, right: inserted[i]! });
        }
        deleted = [];
        inserted = [];
    }

    for (const op of ops) {
        if (op.op === "equal") {
            if (deleted.length > 0 || inserted.length > 0) f_Flush();
            rows.push({ kind: "equal", left: op.aIndex, right: op.bIndex });
            continue;
        }
        if (op.op === "delete") {
            if (op.aIndex !== null) deleted.push(op.aIndex);
            continue;
        }
        if (op.bIndex !== null) inserted.push(op.bIndex);
    }
    if (deleted.length > 0 || inserted.length > 0) f_Flush();
    return rows;
}
