/**
 * 실행 IPC (run:start / run:cancel / run:getActive / run:command).
 * 진행 이벤트(run:event)는 index.ts가 실행 서비스의 emit으로 창에 보낸다.
 * run:command는 터미널에서 쓸 명령 문자열만 만들며 rclone을 실행하지 않는다(새 전송 경로 없음).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import { commandPreview } from "@/main/services/command-preview";
import type { clsRunService } from "@/main/services/run-service";
import type { clsJobStore } from "@/main/store/job-store";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import { zRunCommandInput, zRunIdInput, zStartRunInput } from "@/shared/schemas/run";
import type { typSettings } from "@/shared/schemas/settings";

export interface itfRunIpcDeps extends itfIpcContext {
    runs: clsRunService;
    jobs: Pick<clsJobStore, "get">;
    settings: { get(): typSettings };
}

export function registerRunIpc(d: itfRunIpcDeps): void {
    handle(d, IPC_CHANNELS.runStart, (input) => d.runs.start(input), zStartRunInput);
    handle(d, IPC_CHANNELS.runCancel, ({ runId }) => d.runs.cancel(runId), zRunIdInput);
    handle(d, IPC_CHANNELS.runGetActive, () => d.runs.getActive());
    handle(
        d,
        IPC_CHANNELS.runCommand,
        ({ jobId }) => commandPreview(d.jobs.get(jobId), d.settings.get()),
        zRunCommandInput,
    );
}
