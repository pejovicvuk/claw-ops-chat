"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";
import type { RateLimitsCache } from "@/lib/account-rate-limits";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const POLL_INTERVAL_MS = 30_000;

/**
 * Fetch + poll the account-level rate-limit cache from `/api/rate-limits`.
 *
 * Used by the header rings (5h + Weekly) and the HUD popup. Mounting this
 * once at the parent (HeaderIndicators) and passing the result down to
 * all consumers means a single network poll regardless of how many
 * indicators or popups are visible.
 *
 * The hook never throws: a fetch failure leaves `cache` null and the
 * indicators render their "no data yet" state.
 */
export function useRateLimits(): RateLimitsCache | null {
  const [cache, setCache] = useState<RateLimitsCache | null>(null);

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await authFetch(`${BASE}/api/rate-limits`);
        if (!res.ok) throw new Error(`rate-limits HTTP ${res.status}`);
        const data = (await res.json()) as RateLimitsCache;
        if (!cancelled) setCache(data);
      } catch {
        // Silent failure — leave the previous cache in place (so a
        // brief blip doesn't flash "—" and back). On first failure
        // `cache` is still null and the UI shows the empty state.
      }
    };

    void pull();
    const id = setInterval(pull, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return cache;
}
