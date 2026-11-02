// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import {
    browserChild,
    browserParent,
    isBrowserRoot,
    visibleDirEntries,
} from "@/lib/remote-browser";
import type { itfRemoteBookmark } from "@/shared/types/remotes";

const AT = "2026-10-30T00:00:00.000Z";

function f_Bookmark(over: Partial<itfRemoteBookmark> = {}): itfRemoteBookmark {
    return {
        id: "00000000-0000-4000-8000-000000000001",
        alias: "테스트",
        remoteName: "rr",
        basePath: "base",
        path: "rr:base",
        createdAt: AT,
        updatedAt: AT,
        ...over,
    };
}

describe("browserParent", () => {
    const b = f_Bookmark();

    it("기준 경로 아래에서는 한 단계씩 올라간다", () => {
        expect(browserParent(b, "rr:base/a/b")).toBe("rr:base/a");
        expect(browserParent(b, "rr:base/a")).toBe("rr:base");
    });

    it("기준 경로에 닿거나 밖이면 null", () => {
        expect(browserParent(b, "rr:base")).toBeNull();
        expect(browserParent(b, "rr:other/a")).toBeNull();
        expect(browserParent(b, "rr:")).toBeNull();
    });

    it("다른 remote·로컬 경로는 null", () => {
        expect(browserParent(b, "x:base/a")).toBeNull();
        expect(browserParent(b, "C:\\tmp\\a")).toBeNull();
        expect(browserParent(b, "not a path")).toBeNull();
    });

    it("선두 / 기준 경로도 보존한다", () => {
        const abs = f_Bookmark({ basePath: "/base", path: "rr:/base" });
        expect(browserParent(abs, "rr:/base/a/b")).toBe("rr:/base/a");
        expect(browserParent(abs, "rr:/base/a")).toBe("rr:/base");
        expect(browserParent(abs, "rr:base/a")).toBeNull();
    });
});

describe("browserChild", () => {
    const b = f_Bookmark();

    it("현재 경로 아래 이름 하나를 덧붙인다", () => {
        expect(browserChild(b, "rr:base", "a")).toBe("rr:base/a");
        expect(browserChild(b, "rr:base/a", "b")).toBe("rr:base/a/b");
    });

    it("안전하지 않은 이름은 null", () => {
        expect(browserChild(b, "rr:base", "")).toBeNull();
        expect(browserChild(b, "rr:base", ".")).toBeNull();
        expect(browserChild(b, "rr:base", "..")).toBeNull();
        expect(browserChild(b, "rr:base", "a/b")).toBeNull();
        expect(browserChild(b, "rr:base", "a\\b")).toBeNull();
        expect(browserChild(b, "rr:base", " a")).toBeNull();
        expect(browserChild(b, "rr:base", "a\n")).toBeNull();
    });

    it("기준 경로 밖이거나 다른 리모트면 null", () => {
        expect(browserChild(b, "rr:other", "a")).toBeNull();
        expect(browserChild(b, "x:base", "a")).toBeNull();
        expect(browserChild(b, "C:\\tmp", "a")).toBeNull();
    });

    it("선두 / 기준 경로를 유지한다", () => {
        const abs = f_Bookmark({ basePath: "/base", path: "rr:/base" });
        expect(browserChild(abs, "rr:/base", "a")).toBe("rr:/base/a");
        expect(browserChild(abs, "rr:/base/a", "b")).toBe("rr:/base/a/b");
    });
});

describe("isBrowserRoot", () => {
    it("리모트 루트만 true", () => {
        expect(isBrowserRoot("rr:")).toBe(true);
        expect(isBrowserRoot("rr:base")).toBe(false);
        expect(isBrowserRoot("C:\\tmp")).toBe(false);
        expect(isBrowserRoot("not a path")).toBe(false);
    });
});

describe("visibleDirEntries", () => {
    const entries = [
        { name: "a", path: "rr:base/a" },
        { name: "b", path: "rr:base/b" },
        { name: "c", path: "rr:base/c" },
    ];

    it("앞에서 shown개만 돌려준다", () => {
        expect(visibleDirEntries(entries, 2)).toEqual(entries.slice(0, 2));
        expect(visibleDirEntries(entries, 0)).toEqual([]);
        expect(visibleDirEntries(entries, -1)).toEqual([]);
        expect(visibleDirEntries(entries, 10)).toEqual(entries);
    });
});
