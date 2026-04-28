"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";
import type { SessionBranchSnapshot, SessionBranchesResponse } from "@/lib/session-branches";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const POLL_INTERVAL_MS = 5000;

/**
 * Polls /api/sessions/branches every 5 s so the branch-list UI can mark
 * branches that have active chats. Pauses while the tab is hidden;
 * resumes immediately on visibilitychange. Errors are swallowed — a
 * transient network blip shouldn't blank the chips.
 */
export function useSessionBranches(): SessionBranchSnapshot[] {
  const [sessions, setSessions] = useState<SessionBranchSnapshot[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      if (cancelled) return;
      try {
        const res = await authFetch(`${BASE}/api/sessions/branches`);
        if (res.ok) {
          const data = (await res.json()) as SessionBranchesResponse;
          if (!cancelled) setSessions(data.sessions);
        }
      } catch {
        /* transient network — try again next tick */
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

  return sessions;
}
