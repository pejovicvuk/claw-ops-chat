/**
 * Pure helpers for the rate-limit cache.
 *
 * The Claude Agent SDK can populate up to three "weekly" windows in
 * `RateLimitsCache.windows` — `seven_day`, `seven_day_opus`, and
 * `seven_day_sonnet`. The header HUD shows one Weekly ring, so we
 * surface the **most restrictive** of the three: whichever is closest
 * to (or past) its limit. That answers the user-facing question
 * "what's blocking me right now?" rather than "what's the average?"
 *
 * Five-hour is simpler — the SDK only emits a single `five_hour` key.
 *
 * Restrictiveness ranking:
 *   1. status === "rejected" beats everything (limit hit)
 *   2. status === "allowed_warning" beats "allowed"
 *   3. within the same status, higher `utilization` (0..1) wins
 *   4. ties broken by closer `resetsAt`
 *
 * No data → null. Callers render a grey ring in the "—" state.
 */

import type { RateLimitWindow, RateLimitsCache } from "./account-rate-limits";

/** Status priority — higher number = more restrictive. */
function statusPriority(status: RateLimitWindow["status"]): number {
  if (status === "rejected") return 2;
  if (status === "allowed_warning") return 1;
  return 0;
}

/**
 * Compare two rate-limit windows. Returns the more-restrictive one.
 * Null arguments are treated as "no data, less restrictive".
 */
export function moreRestrictive(
  a: RateLimitWindow | undefined | null,
  b: RateLimitWindow | undefined | null,
): RateLimitWindow | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const sa = statusPriority(a.status);
  const sb = statusPriority(b.status);
  if (sa !== sb) return sa > sb ? a : b;
  const ua = typeof a.utilization === "number" ? a.utilization : -1;
  const ub = typeof b.utilization === "number" ? b.utilization : -1;
  if (ua !== ub) return ua > ub ? a : b;
  // Tie-break by closer reset (sooner = more pressing).
  const ra = typeof a.resetsAt === "number" ? a.resetsAt : Number.POSITIVE_INFINITY;
  const rb = typeof b.resetsAt === "number" ? b.resetsAt : Number.POSITIVE_INFINITY;
  return ra <= rb ? a : b;
}

export interface PickedWindow {
  /** The window data itself (or null when no relevant entry exists). */
  window: RateLimitWindow | null;
  /**
   * Which key it came from — `"seven_day"`, `"seven_day_opus"`, or
   * `"seven_day_sonnet"`. Useful for the popup so the user can see
   * *which* model's bucket is filling. Null when `window` is null.
   */
  key: string | null;
}

/**
 * Pick the most-restrictive Weekly window across the combined and
 * per-model variants. Returns `{ window: null, key: null }` when none
 * are present in the cache.
 */
export function pickWeeklyWindow(cache: RateLimitsCache | null | undefined): PickedWindow {
  if (!cache?.windows) return { window: null, key: null };
  const candidates: Array<[string, RateLimitWindow | undefined]> = [
    ["seven_day", cache.windows.seven_day],
    ["seven_day_opus", cache.windows.seven_day_opus],
    ["seven_day_sonnet", cache.windows.seven_day_sonnet],
  ];
  let bestKey: string | null = null;
  let best: RateLimitWindow | null = null;
  for (const [key, win] of candidates) {
    if (!win) continue;
    const merged = moreRestrictive(best, win);
    if (merged === win) {
      best = win;
      bestKey = key;
    } else if (merged && merged !== best) {
      best = merged;
      // The other one won — keep the existing key only if it points to it.
      // (Defensive — moreRestrictive should never return a third object.)
    }
  }
  return { window: best, key: bestKey };
}

/**
 * Return the `five_hour` window from the cache, or null when absent.
 * Pure pass-through — exposed as a function so the call sites stay
 * symmetric with `pickWeeklyWindow()`.
 */
export function pickFiveHourWindow(cache: RateLimitsCache | null | undefined): PickedWindow {
  const win = cache?.windows?.five_hour;
  return { window: win ?? null, key: win ? "five_hour" : null };
}

/** Convert a 0..1 utilization into a 0..100 integer percentage. */
export function utilizationToPercent(util: number | undefined | null): number | null {
  if (typeof util !== "number" || !Number.isFinite(util)) return null;
  return Math.max(0, Math.min(100, Math.round(util * 100)));
}
