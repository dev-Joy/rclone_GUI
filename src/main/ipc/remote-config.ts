/**
 * remote 설정 IPC (remoteConfig:providers / get / usage / create / update / delete / reconnect / answer / authCancel).
 * GUI에서만 등록한다(헤드리스 `--run-job`에서는 OAuth·설정 변경을 시작하지 않는다, E-8).
 * 입력은 zod로 검증하고 응답은 envelope로 돌려준다. 비밀 값은 응답에 담지 않는다.
 *
 * @author dev-Joy 2026-11-03
 */

// ========== Internal imports ==========
import { handle, type itfIpcContext } from "@/main/ipc/handle";
import type { clsRemoteConfigService } from "@/main/services/remote-config-service";
import { IPC_CHANNELS } from "@/shared/ipc-contract";
import {
    zRemoteConfigAnswerInput,
    zRemoteConfigCreateInput,
    zRemoteConfigDeleteInput,
    zRemoteConfigNameInput,
    zRemoteConfigUpdateInput,
} from "@/shared/schemas/remote-config";

export interface itfRemoteConfigIpcDeps extends itfIpcContext {
    remoteConfig: clsRemoteConfigService;
}

export function registerRemoteConfigIpc(d: itfRemoteConfigIpcDeps): void {
    handle(d, IPC_CHANNELS.remoteConfigProviders, () => d.remoteConfig.providers());
    handle(
        d,
        IPC_CHANNELS.remoteConfigGet,
        (input) => d.remoteConfig.get(input.name),
        zRemoteConfigNameInput,
    );
    handle(
        d,
        IPC_CHANNELS.remoteConfigUsage,
        (input) => d.remoteConfig.usage(input.name),
        zRemoteConfigNameInput,
    );
    handle(
        d,
        IPC_CHANNELS.remoteConfigCreate,
        (input) => d.remoteConfig.create(input),
        zRemoteConfigCreateInput,
    );
    handle(
        d,
        IPC_CHANNELS.remoteConfigUpdate,
        (input) => d.remoteConfig.update(input),
        zRemoteConfigUpdateInput,
    );
    handle(
        d,
        IPC_CHANNELS.remoteConfigDelete,
        (input) => d.remoteConfig.remove(input),
        zRemoteConfigDeleteInput,
    );
    handle(
        d,
        IPC_CHANNELS.remoteConfigReconnect,
        (input) => d.remoteConfig.reconnect(input.name),
        zRemoteConfigNameInput,
    );
    handle(
        d,
        IPC_CHANNELS.remoteConfigAnswer,
        (input) => d.remoteConfig.answer(input.state, input.result),
        zRemoteConfigAnswerInput,
    );
    handle(d, IPC_CHANNELS.remoteConfigAuthCancel, () => d.remoteConfig.cancelAuth());
}
