"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";
import type { SessionStatus } from "@/lib/session-status-store";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const POLL_INTERVAL_MS = 2000;

export interface SessionStatusMap {
  [sessionId: string]: {
    status: SessionStatus;
    lastActivityAt: number;
  };
}

/**
 * Poll /chat/api/sessions/status every 2 s so the sidebar can show a live
 * dot next to each chat. Pauses when the tab is hidden (no point burning
 * battery + server CPU polling while the user is elsewhere) and resumes
 * instantly on visibility change. One shared state object per mount —
 * each component that wants statuses instantiates its own interval, which
 * is fine for the 2 s cadence.
 */
export function useSessionStatuses(): SessionStatusMap {
  const [statuses, setStatuses] = useState<SessionStatusMap>({});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      if (cancelled) return;
      try {
        const res = await authFetch(`${BASE}/api/sessions/status`);
        if (res.ok) {
          const data = (await res.json()) as SessionStatusMap;
          if (!cancelled) setStatuses(data);
        }
      } catch {
        // Transient network errors are expected on suspend / server restart —
        // just try again next tick rather than flash a stale "disconnected"
        // state to the user.
      }
      if (!cancelled && !document.hidden) {
        timer = setTimeout(fetchOnce, POLL_INTERVAL_MS);
      }
    }

    function onVisibility() {
      if (document.hidden) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      } else {
        // Fetch immediately on return so the user sees fresh dots without
        // waiting a full interval.
        void fetchOnce();
      }
    }

    void fetchOnce();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return statuses;
}
