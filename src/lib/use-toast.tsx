"use client";

import { useSyncExternalStore } from "react";
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
  /** Optional click action — wires the whole toast as a button when set. */
  onClick?: () => void;
}

export interface ToastOptions {
  /** Click action; the toast still auto-dismisses on its own timer. */
  onClick?: () => void;
  /** Override the default auto-dismiss in ms. Pass 0 to disable. */
  durationMs?: number;
}

const MAX_VISIBLE = 4;
const AUTO_DISMISS_MS = 3000;
const NOTIFICATION_DISMISS_MS = 8000;

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

function push(kind: ToastKind, message: string, options?: ToastOptions): string {
  const id = `t${nextId++}`;
  const item: ToastItem = { id, kind, message, onClick: options?.onClick };
  const next = [...items, item];
  if (next.length > MAX_VISIBLE) {
    next.splice(0, next.length - MAX_VISIBLE);
  }
  items = next;
  emit();
  if (typeof window !== "undefined") {
    const ms =
      options?.durationMs ?? (options?.onClick ? NOTIFICATION_DISMISS_MS : AUTO_DISMISS_MS);
    if (ms > 0) {
      window.setTimeout(() => dismiss(id), ms);
    }
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
  success: (message: string, options?: ToastOptions) => push("success", message, options),
  error: (message: string, options?: ToastOptions) => push("error", message, options),
  info: (message: string, options?: ToastOptions) => push("info", message, options),
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
  const onPrimary = () => {
    if (item.onClick) item.onClick();
    dismiss(item.id);
  };
  const onDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    dismiss(item.id);
  };

  // Solid background + white foreground for every kind. The previous
  // info variant used `bg-canvas-surface` (theme-aware) with hardcoded
  // `text-white`, which made notification toasts read as white-on-white
  // in light mode. Using a solid Tailwind color keeps the contrast high
  // and identical across light/dark themes — same approach as error /
  // success — and makes the in-app notification surface visible at a
  // glance whichever theme the user is on.
  const color =
    item.kind === "error" ? "bg-red-600" : item.kind === "success" ? "bg-green-600" : "bg-blue-600";
  const Icon = item.kind === "error" ? FiAlertTriangle : item.kind === "success" ? FiCheck : FiInfo;

  return (
    <div
      className={`animate-menu-in flex min-w-0 max-w-[380px] items-center rounded-full shadow-xl ring-1 ring-black/10 ${color}`}
    >
      <button
        type="button"
        onClick={onPrimary}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-l-full px-3.5 py-2 text-left"
        aria-label={item.onClick ? "Open" : "Dismiss notification"}
      >
        <Icon size={14} className="shrink-0 text-white" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">
          {item.message}
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-r-full px-2.5 py-2 text-white/80 hover:text-white"
        aria-label="Dismiss notification"
      >
        <FiX size={12} className="shrink-0" />
      </button>
    </div>
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
      className="pointer-events-none fixed left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ zIndex: Z_INDEX.TOAST, top: "max(env(safe-area-inset-top, 0px), 80px)" }}
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
