// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { emptyDirQueryRoot } from "@/lib/use-empty-dir-support";

describe("emptyDirQueryRoot (INT-003 FR-32)", () => {
    it("로컬·UNC는 조회하지 않는다(null)", () => {
        expect(emptyDirQueryRoot("D:\\x")).toBeNull();
        expect(emptyDirQueryRoot("\\\\server\\share\\x")).toBeNull();
    });

    it("remote 경로는 remote 루트", () => {
        expect(emptyDirQueryRoot("remote:a/b")).toBe("remote:");
        expect(emptyDirQueryRoot("remote:")).toBe("remote:");
    });

    it("빈 값·해석할 수 없는 경로는 null", () => {
        expect(emptyDirQueryRoot("")).toBeNull();
        expect(emptyDirQueryRoot("rel/path")).toBeNull();
        expect(emptyDirQueryRoot(":memory:")).toBeNull();
    });
});
