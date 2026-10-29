// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    excludeChangeConfirmText,
    jobOnlyCommentLike,
    missingPatternIds,
    togglePatternId,
} from "@/lib/exclude-view";

describe("exclude-view", () => {
    it("확인 버튼 문구는 일어날 일", () => {
        expect(excludeChangeConfirmText("delete", 3)).toBe(
            "패턴 지우고 작업 3개의 비교 결과 버리기",
        );
        expect(excludeChangeConfirmText("update", 1)).toBe(
            "패턴 바꾸고 작업 1개의 비교 결과 버리기",
        );
        expect(excludeChangeConfirmText("delete", 0)).toBe("패턴 지우기");
    });

    it("지워진 id 찾기·토글(정렬)·#;; 줄", () => {
        const at = "2026-10-29T00:00:00.000Z";
        const items = [{ id: "b", pattern: "x", createdAt: at, updatedAt: at, usedBy: [] }];
        expect(missingPatternIds(["a", "b"], items)).toEqual(["a"]);
        expect(togglePatternId(["c", "a"], "b", true)).toEqual(["a", "b", "c"]);
        expect(togglePatternId(["a", "b"], "a", false)).toEqual(["b"]);
        expect(jobOnlyCommentLike(["#a", "b", ";c", " #d"])).toEqual(["#a", ";c"]);
    });
});
