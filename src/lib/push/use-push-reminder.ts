"use client";

import { useCallback, useEffect, useState } from "react";
import { usePushSubscription } from "./use-push-subscription";

const SNOOZE_KEY = "claw-chat:push-reminder-dismissed-at";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export interface UsePushReminderResult {
  shouldShow: boolean;
  enable: () => void;
  dismiss: () => void;
}

function readSnoozeAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function isSnoozed(now: number): boolean {
  const at = readSnoozeAt();
  if (!at) return false;
  return now - at < SNOOZE_MS;
}

/**
 * Decides when to nudge the user to enable push notifications.
 *
 * Shows the prompt only when:
 *   - the browser actually supports Web Push,
 *   - the user hasn't permanently denied permission (no point asking),
 *   - this device isn't already subscribed for the current user, and
 *   - the user hasn't dismissed the banner in the last 7 days.
 *
 * Re-evaluates on mount, every 6 hours, and when the tab regains
 * visibility — so enabling notifications elsewhere (Settings page,
 * another device) hides the banner on the next tick.
 */
export function usePushReminder(): UsePushReminderResult {
  const sub = usePushSubscription();
  const [now, setNow] = useState<number>(() => (typeof Date !== "undefined" ? Date.now() : 0));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, RECHECK_INTERVAL_MS);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      /* localStorage unavailable — nothing to do */
    }
    setNow(Date.now());
  }, []);

  const enable = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("settings", "notifications");
      window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      // Last-ditch fallback: hard nav to the settings deep-link.
      window.location.href = `${BASE}/?settings=notifications`;
    }
  }, []);

  if (sub.support.kind !== "supported") return { shouldShow: false, enable, dismiss };
  if (sub.loading) return { shouldShow: false, enable, dismiss };
  if (sub.permission === "denied") return { shouldShow: false, enable, dismiss };
  if (sub.thisDevice) return { shouldShow: false, enable, dismiss };
  if (isSnoozed(now)) return { shouldShow: false, enable, dismiss };

  return { shouldShow: true, enable, dismiss };
}
