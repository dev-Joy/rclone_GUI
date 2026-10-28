/**
 * 토스트 알림 큐 (zustand).
 *
 * @author dev-Joy 2026-10-28
 */

// ========== External imports ==========
import { create } from "zustand";

export type typToastLevel = "info" | "success" | "warning" | "error";

export interface itfToast {
    id: number;
    level: typToastLevel;
    message: string;
}

interface itfToastState {
    toasts: itfToast[];
    push: (level: typToastLevel, message: string) => void;
    dismiss: (id: number) => void;
}

export const MAX_TOASTS = 5;
let nextId = 1;

export const useToastStore = create<itfToastState>((set) => ({
    toasts: [],
    push: (level, message) =>
        set((s) => ({
            toasts: [...s.toasts, { id: nextId++, level, message }].slice(-MAX_TOASTS),
        })),
    dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
