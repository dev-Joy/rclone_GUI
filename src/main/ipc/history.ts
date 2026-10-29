/**
 * 이력 IPC (history:list / get / readLog / clear, MVP_SPEC §11, intent T-13).
 * 로그는 이력 레코드의 파일 이름으로만 찾고 logs 폴더 안의 실행 로그만 읽는다(경로 탈출 방지).
 *
 * @author dev-Joy 2026-10-29
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import { clsAppError } from "@/main/lib/app-error";
import { deleteRunLogs, readRunLogTail } from "@/main/services/log-retention";
import type { clsRunService } from "@/main/services/run-service";
import type { clsHistoryStore } from "@/main/store/history-store";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import {
    zHistoryClearInput,
    zHistoryGetInput,
    zHistoryListInput,
    zHistoryReadLogInput,
} from "@/shared/schemas/history";
import { LOG_TAIL_DEFAULT_BYTES, type itfRunLogView } from "@/shared/types/history";

export interface itfHistoryIpcDeps extends itfIpcContext {
    history: clsHistoryStore;
    runs: clsRunService;
    paths: { logs: string };
}

export function registerHistoryIpc(d: itfHistoryIpcDeps): void {
    handle(d, IPC_CHANNELS.historyList, (query) => d.history.list(query), zHistoryListInput);
    handle(d, IPC_CHANNELS.historyGet, ({ runId }) => d.history.get(runId), zHistoryGetInput);
    handle(
        d,
        IPC_CHANNELS.historyReadLog,
        async ({ runId, tailBytes }): Promise<itfRunLogView> => {
            const rec = d.history.get(runId);
            if (!rec) throw new clsAppError("NOT_FOUND", "실행 기록을 찾을 수 없습니다.");
            if (!rec.logFile) {
                return { fileName: null, exists: false, sizeBytes: 0, truncated: false, lines: [] };
            }
            return readRunLogTail(d.paths.logs, rec.logFile, tailBytes ?? LOG_TAIL_DEFAULT_BYTES);
        },
        zHistoryReadLogInput,
    );
    handle(
        d,
        IPC_CHANNELS.historyClear,
        async ({ deleteLogs }) => {
            if (d.runs.getActive()) {
                throw new clsAppError(
                    "BUSY",
                    "실행 중에는 이력을 지울 수 없습니다. 끝나거나 취소한 뒤 다시 시도하세요.",
                );
            }
            const { removed, logFiles } = await d.history.clear();
            const deletedLogs = deleteLogs ? await deleteRunLogs(d.paths.logs, logFiles) : 0;
            d.logger.info(`이력 비우기: removed=${removed} deletedLogs=${deletedLogs}`);
            return { removed, deletedLogs };
        },
        zHistoryClearInput,
    );
}
