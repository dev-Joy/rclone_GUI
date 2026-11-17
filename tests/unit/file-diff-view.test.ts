// ========== External imports ==========
import { describe, expect, it } from "vitest";

// ========== Internal imports ==========
import { resolveDiffView } from "@/lib/file-diff-view";
import type { typRunMode } from "@/shared/schemas/common";
import type { itfFileDiffData, typFileSideState } from "@/shared/types/file-diff";

const SAME_TEXT = "내용은 같습니다. 수정 시각만 다립니다.";
const LINE_ENDING_TEXT = "내용은 같고 줄바꿈 방식(CRLF/LF)만 다릅니다.";
const LINE_ENDING_BOM_TEXT = "내용은 같고 줄바꿈 방식(CRLF/LF)·BOM만 다릅니다.";
const LINE_ENDING_ENCODING_TEXT = "내용은 같고 줄바꿈 방식(CRLF/LF)·인코딩만 다릅니다.";
const LINE_ENDING_BOM_ENCODING_TEXT = "내용은 같고 줄바꿈 방식(CRLF/LF)·BOM·인코딩만 다릅니다.";
const BOM_TEXT = "내용은 같고 BOM만 다릅니다.";
const ENCODING_TEXT = "내용은 같고 인코딩만 다릅니다.";
const BOM_ENCODING_TEXT = "내용은 같고 BOM·인코딩만 다릅니다.";
const ABSENT_DEST_TEXT = "대상에 없음 — 동기화하면 새로 복사됨";

/** 텍스트 상태 기본값. 테스트마다 필요한 값만 바꾼다 */
function f_Text(over: Partial<Extract<typFileSideState, { kind: "text" }>> = {}): typFileSideState {
    return { kind: "text", text: "a\nb", encoding: "utf-8", bom: false, size: 3, ...over };
}

function f_Data(
    source: typFileSideState,
    dest: typFileSideState,
    mode: typRunMode = "sync",
): itfFileDiffData {
    return { path: "a.txt", status: "modified", mode, source, dest };
}

describe("resolveDiffView — 같은 내용 판정 (FR-11)", () => {
    it("텍스트가 같고 BOM만 다르면 BOM 안내를 보여 준다 (AC-10)", () => {
        const view = resolveDiffView(f_Data(f_Text({ bom: true }), f_Text({ bom: false })));

        expect(view.headline).toBe(BOM_TEXT);
        expect(view.headline).not.toBe(LINE_ENDING_TEXT);
        expect(view.counts).toBe("");
        expect(view.rows).toEqual([]);
        expect(view.encodingNote).toBe("");
    });

    it("텍스트가 같고 인코딩만 다르면 인코딩 안내다", () => {
        const view = resolveDiffView(
            f_Data(f_Text({ encoding: "utf-8" }), f_Text({ encoding: "euc-kr" })),
        );

        expect(view.headline).toBe(ENCODING_TEXT);
        expect(view.headline).not.toBe(SAME_TEXT);
        // EUC-KR 안내는 그대로 붙는다(문구와 따로 표시된다)
        expect(view.encodingNote).toBe("인코딩: EUC-KR로 읽음");
    });

    it("텍스트가 같고 BOM·인코딩이 모두 다르면 둘 다 안내한다", () => {
        const view = resolveDiffView(
            f_Data(
                f_Text({ bom: true, encoding: "utf-8" }),
                f_Text({ bom: false, encoding: "euc-kr" }),
            ),
        );

        expect(view.headline).toBe(BOM_ENCODING_TEXT);
        expect(view.headline).not.toBe(BOM_TEXT);
        expect(view.headline).not.toBe(ENCODING_TEXT);
        expect(view.encodingNote).toBe("인코딩: EUC-KR로 읽음");
    });

    it("텍스트가 같고 BOM·인코딩도 같으면 수정 시각만 다르다고 보여 준다", () => {
        const view = resolveDiffView(f_Data(f_Text(), f_Text()));

        expect(view.headline).toBe(SAME_TEXT);
        expect(view.encodingNote).toBe("");
    });

    it("줄바꿈 방식만 다르면 줄바꿈 안내를 보여 준다 (AC-10)", () => {
        const view = resolveDiffView(f_Data(f_Text({ text: "a\nb" }), f_Text({ text: "a\r\nb" })));

        expect(view.headline).toBe(LINE_ENDING_TEXT);
        expect(view.headline).not.toContain("BOM");
        expect(view.headline).not.toContain("인코딩");
        expect(view.counts).toBe("");
    });

    it("줄바꿈과 BOM이 함께 다르면 둘 다 안내한다", () => {
        const view = resolveDiffView(
            f_Data(f_Text({ text: "a\r\nb", bom: true }), f_Text({ text: "a\nb", bom: false })),
        );

        expect(view.headline).toBe(LINE_ENDING_BOM_TEXT);
        expect(view.headline).not.toBe(LINE_ENDING_TEXT);
        expect(view.headline).not.toContain("인코딩");
        expect(view.counts).toBe("");
        expect(view.rows).toEqual([]);
    });

    it("줄바꿈과 인코딩이 함께 다르면 둘 다 안내한다", () => {
        const view = resolveDiffView(
            f_Data(
                f_Text({ text: "a\r\nb", encoding: "utf-8" }),
                f_Text({ text: "a\nb", encoding: "euc-kr" }),
            ),
        );

        expect(view.headline).toBe(LINE_ENDING_ENCODING_TEXT);
        expect(view.headline).not.toBe(LINE_ENDING_TEXT);
        expect(view.headline).not.toContain("BOM");
        expect(view.counts).toBe("");
    });

    it("줄바꿈·BOM·인코딩이 모두 다르면 셋 다 안내한다", () => {
        const view = resolveDiffView(
            f_Data(
                f_Text({ text: "a\r\nb", bom: true, encoding: "utf-8" }),
                f_Text({ text: "a\nb", bom: false, encoding: "euc-kr" }),
            ),
        );

        expect(view.headline).toBe(LINE_ENDING_BOM_ENCODING_TEXT);
        expect(view.headline).not.toBe(LINE_ENDING_BOM_TEXT);
        expect(view.headline).not.toBe(LINE_ENDING_ENCODING_TEXT);
        expect(view.counts).toBe("");
    });

    it("BOM이 달라도 텍스트가 다르면 실제 줄 차이를 보여 준다", () => {
        const view = resolveDiffView(
            f_Data(f_Text({ text: "a\nb", bom: true }), f_Text({ text: "a\nc" })),
        );

        expect(view.headline).toBe("");
        expect(view.counts).toBe("0줄 추가, 0줄 삭제, 1줄 변경");
        expect(view.rows).toHaveLength(2);
    });
});

describe("resolveDiffView — 한쪽 이유 문구 (FR-10·FR-9)", () => {
    it("읽기 실패는 서비스 문구를 접두 없이 그대로 보여 준다", () => {
        const view = resolveDiffView(
            f_Data({ kind: "error", message: "대상 파일을 읽지 못함: 권한이 없습니다." }, f_Text()),
        );

        expect(view.leftNotice).toBe("대상 파일을 읽지 못함: 권한이 없습니다.");
        expect(view.leftNotice).not.toContain("파일을 읽지 못함: 대상 파일");
        expect(view.rightNotice).toBe("");
    });

    it("대상이 없으면 대상 absent 안내를 유지한다", () => {
        const view = resolveDiffView(f_Data(f_Text(), { kind: "absent" }));

        expect(view.rightNotice).toBe(ABSENT_DEST_TEXT);
        expect(view.leftNotice).toBe("");
    });

    it("원본이 없으면 모드에 맞는 absent 안내를 유지한다", () => {
        const sync = resolveDiffView(f_Data({ kind: "absent" }, f_Text(), "sync"));
        const copy = resolveDiffView(f_Data({ kind: "absent" }, f_Text(), "copy"));

        expect(sync.leftNotice).toBe("원본에 없음 — 동기화(sync)하면 대상에서 삭제됨");
        expect(copy.leftNotice).toBe("원본에 없음 — copy는 대상에서 지우지 않음");
    });
});
