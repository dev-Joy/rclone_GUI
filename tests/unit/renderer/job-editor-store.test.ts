// ========== External imports ==========
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ========== Internal imports ==========
import { createDefaultSettings } from "@/shared/defaults";
import { selectDirty, useJobEditorStore } from "@/stores/job-editor-store";
import { useJobsStore } from "@/stores/jobs-store";
import { createFakeApi, fakeUuid, makeJob, type itfFakeApi } from "./fake-api";

let fake: itfFakeApi;

function f_Editor() {
    return useJobEditorStore.getState();
}

function f_Dirty(): boolean {
    return selectDirty(f_Editor());
}

beforeEach(() => {
    useJobsStore.setState(useJobsStore.getInitialState(), true);
    useJobEditorStore.setState(useJobEditorStore.getInitialState(), true);
    fake = createFakeApi([makeJob({ id: fakeUuid(1), name: "a" })]);
    vi.stubGlobal("window", { rclonegui: fake.api });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("job-editor-store 열기·변경", () => {
    it("openNew: 설정 기본값을 복사한다(배열은 다른 참조)", () => {
        const settings = createDefaultSettings();
        settings.defaults.checkers = 12;
        f_Editor().openNew(settings);
        const s = f_Editor();
        expect(s.open).toBe(true);
        expect(s.jobId).toBeNull();
        expect(s.draft?.options.checkers).toBe(12);
        expect(s.draft?.excludes).toEqual(settings.defaults.excludes);
        expect(s.draft?.excludes).not.toBe(settings.defaults.excludes);
        expect(f_Dirty()).toBe(false);
    });

    it("setField → dirty, revert → not dirty", () => {
        f_Editor().openJob(fake.jobs()[0]!);
        f_Editor().setField("name", "b");
        expect(f_Dirty()).toBe(true);
        f_Editor().setOptions({ checkers: 3 });
        f_Editor().revert();
        expect(f_Dirty()).toBe(false);
        expect(f_Editor().draft?.name).toBe("a");
    });
});

describe("job-editor-store 저장", () => {
    it("화면 검증 실패는 IPC를 부르지 않고 오류를 표시한다", async () => {
        f_Editor().openNew(createDefaultSettings());
        expect(await f_Editor().save(true)).toBe(false);
        expect(f_Editor().showErrors).toBe(true);
        expect(fake.calls.filter((c) => c.startsWith("jobs."))).toEqual([]);
    });

    it("새 작업 저장 성공 → jobId·baseline 갱신, dirty 아님", async () => {
        f_Editor().openNew(createDefaultSettings());
        f_Editor().setField("name", "  새 작업  ");
        f_Editor().setField("source", "C:\\tmp\\x");
        f_Editor().setField("destination", "D:\\tmp\\y");
        expect(await f_Editor().save(true)).toBe(true);
        const s = f_Editor();
        expect(s.jobId).not.toBeNull();
        expect(s.saving).toBe(false);
        expect(f_Dirty()).toBe(false);
        expect(useJobsStore.getState().selectedJobId).toBe(s.jobId);
    });

    it("기존 작업 저장은 update, main 오류는 serverError", async () => {
        f_Editor().openJob(fake.jobs()[0]!);
        f_Editor().setField("name", "b");
        expect(await f_Editor().save(true)).toBe(true);
        expect(fake.calls).toContain("jobs.update");
        expect(f_Editor().baseRev).toBe(1);
        // 화면 검증은 통과하지만 main이 거부하는 경우
        fake.api.jobs.update = () =>
            Promise.resolve({
                ok: false,
                error: { code: "SAFETY_BLOCKED", message: "대상: 막힘" },
            });
        f_Editor().setField("name", "c");
        expect(await f_Editor().save(true)).toBe(false);
        expect(f_Editor().serverError).toMatchObject({ code: "SAFETY_BLOCKED" });
        expect(f_Dirty()).toBe(true);
    });
});

describe("job-editor-store 이동 확인", () => {
    it("dirty가 아니면 즉시 실행, dirty면 보관 → 취소 유지 / 확인 실행", () => {
        const action = vi.fn<() => void>();
        f_Editor().openJob(fake.jobs()[0]!);
        f_Editor().guard(action);
        expect(action).toHaveBeenCalledTimes(1);
        f_Editor().setField("name", "b");
        f_Editor().guard(action);
        expect(action).toHaveBeenCalledTimes(1);
        expect(f_Editor().pendingAction).not.toBeNull();
        f_Editor().cancelDiscard();
        expect(f_Editor().pendingAction).toBeNull();
        expect(f_Editor().draft?.name).toBe("b");
        f_Editor().guard(action);
        f_Editor().confirmDiscard();
        expect(action).toHaveBeenCalledTimes(2);
        expect(f_Dirty()).toBe(false);
    });
});

describe("job-editor-store syncFromJobs", () => {
    it("dirty 아님 → 새 값 반영 / dirty + rev 증가 → externalChange / 삭제 → close", () => {
        const job = fake.jobs()[0]!;
        f_Editor().openJob(job);
        f_Editor().syncFromJobs([{ ...job, name: "외부", rev: 1 }]);
        expect(f_Editor().draft?.name).toBe("외부");
        expect(f_Editor().baseRev).toBe(1);
        f_Editor().setField("name", "내 편집");
        f_Editor().syncFromJobs([{ ...job, name: "외부2", rev: 2 }]);
        expect(f_Editor().externalChange).toBe(true);
        expect(f_Editor().draft?.name).toBe("내 편집");
        f_Editor().syncFromJobs([]);
        expect(f_Editor().open).toBe(false);
    });

    it("같거나 오래된 rev(늦게 온 이벤트)는 무시한다", () => {
        const job = fake.jobs()[0]!;
        f_Editor().openJob({ ...job, rev: 3 });
        f_Editor().syncFromJobs([{ ...job, name: "오래됨", rev: 2 }]);
        f_Editor().syncFromJobs([{ ...job, name: "같음", rev: 3 }]);
        expect(f_Editor().draft?.name).toBe("a");
        expect(f_Editor().baseRev).toBe(3);
        f_Editor().setField("name", "내 편집");
        f_Editor().syncFromJobs([{ ...job, rev: 1 }]);
        expect(f_Editor().externalChange).toBe(false);
    });

    it("새 작업 편집은 목록 변경으로 닫히지 않는다", () => {
        f_Editor().openNew(createDefaultSettings());
        f_Editor().syncFromJobs([]);
        expect(f_Editor().open).toBe(true);
    });
});
