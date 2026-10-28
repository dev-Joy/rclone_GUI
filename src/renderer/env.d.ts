/// <reference types="vite/client" />

import type { itfRcloneGuiApi } from "@/shared/ipc-contract";

declare global {
    interface Window {
        readonly rclonegui: itfRcloneGuiApi;
    }
}
