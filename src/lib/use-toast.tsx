"use client";

import { useSyncExternalStore, useCallback } from "react";
import { FiCheck, FiAlertTriangle, FiInfo, FiX } from "react-icons/fi";
import { Z_INDEX } from "@/lib/z-index";

/**
 * Tiny toast system — module-level store, no provider required.
 *
 * Matches the `useUrlState` pattern already used in the codebase: external
 * store + `useSyncExternalStore` for reads. The `<ToastStack />` component
 * mounts once at the app root and renders the fixed-top stack; anywhere
 * else, `useToast()` gives you `toast.error/success/info` to push.
 *
 * Design choices:
 * - Max 4 visible; older toasts are dropped from the head of the queue so
 *   the newest event is always visible.
 * - Auto-dismiss after 3 s. Click to dismiss earlier.
 * - No aria-live spam: the stack itself is `aria-live="polite"` so a
 *   screen reader reads new messages without repeating the whole stack.
 */

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

const MAX_VISIBLE = 4;
const AUTO_DISMISS_MS = 3000;

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 0;

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): ToastItem[] {
  return items;
}

function getServerSnapshot(): ToastItem[] {
  return [];
}

function push(kind: ToastKind, message: string): string {
  const id = `t${nextId++}`;
  const item: ToastItem = { id, kind, message };
  const next = [...items, item];
  if (next.length > MAX_VISIBLE) {
    next.splice(0, next.length - MAX_VISIBLE);
  }
  items = next;
  emit();
  if (typeof window !== "undefined") {
    window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }
  return id;
}

function dismiss(id: string): void {
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

/** Public push API. Stable references so callers can drop into effect deps. */
export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
  info: (message: string) => push("info", message),
  dismiss,
};

export function useToast(): { toast: typeof toast } {
  return { toast };
}

/** Read-only hook — used by the stack component. */
export function useToastItems(): ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function ToastRow({ item }: { item: ToastItem }) {
  const onDismiss = useCallback(() => dismiss(item.id), [item.id]);

  const color =
    item.kind === "error"
      ? "bg-red-600"
      : item.kind === "success"
        ? "bg-green-600"
        : "bg-canvas-surface border border-canvas-border";
  const Icon = item.kind === "error" ? FiAlertTriangle : item.kind === "success" ? FiCheck : FiInfo;

  return (
    <button
      type="button"
      onClick={onDismiss}
      className={`animate-menu-in flex min-w-0 max-w-[360px] items-center gap-2 rounded-full px-3 py-1.5 text-left shadow-lg ${color}`}
      aria-label="Dismiss notification"
    >
      <Icon size={13} className="shrink-0 text-white" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white">
        {item.message}
      </span>
      <FiX size={11} className="shrink-0 text-white/70" />
    </button>
  );
}

/**
 * Mount once at the app root. Renders the fixed-top stack.
 */
export function ToastStack(): React.ReactElement | null {
  const list = useToastItems();
  if (list.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed left-1/2 top-20 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ zIndex: Z_INDEX.TOAST }}
      aria-live="polite"
      aria-atomic="false"
    >
      {list.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <ToastRow item={item} />
        </div>
      ))}
    </div>
  );
}
