"use client";

import { useEffect } from "react";
import { FiBell, FiX } from "react-icons/fi";
import { usePushReminder } from "@/lib/push/use-push-reminder";

/**
 * Compact banner that nudges the user to enable push notifications.
 * Self-hides when notifications are already on, when the browser has
 * denied them, or when the user dismissed the banner in the last 7
 * days. Mount once near the top of the chat surface.
 */
export function PushReminderBanner() {
  const reminder = usePushReminder();

  useEffect(() => {
    if (!reminder.shouldShow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") reminder.dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reminder]);

  if (!reminder.shouldShow) return null;

  return (
    <div
      role="region"
      aria-label="Notification reminder"
      aria-live="polite"
      className="animate-panel-in mx-3 mt-2 flex items-center gap-3 rounded-xl border border-canvas-border bg-canvas-surface px-3 py-2 shadow-sm sm:mx-4"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <FiBell size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-canvas-fg">
          Get notified when Claude finishes
        </p>
        <p className="hidden truncate text-[10px] text-canvas-muted sm:block">
          Even when this tab is in the background.
        </p>
      </div>
      <button
        type="button"
        onClick={reminder.enable}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
      >
        Enable
      </button>
      <button
        type="button"
        onClick={reminder.dismiss}
        aria-label="Dismiss notification reminder for 7 days"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
      >
        <FiX size={13} />
      </button>
    </div>
  );
}
