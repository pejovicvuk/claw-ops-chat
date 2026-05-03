import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadRateLimits } from "@/lib/account-rate-limits";
import { probeRateLimits } from "@/lib/rate-limit-probe";

/**
 * GET /chat/api/rate-limits
 *
 * Returns the current account-level subscriber rate-limit cache — the same
 * shape the Claude Agent SDK's `rate_limit_event` emits. The cache is
 * populated by the 15-min probe + SDK events from chat turns, and read
 * here without blocking. Always returns `{ windows: {}, updatedAt: null }`
 * when empty — never 404 — so the UI can render "no data yet" cleanly.
 *
 * On stale cache (older than STALE_MS), kick a probe in the background.
 * The probe is non-blocking: this request returns the current cache
 * immediately, and the next poll (the client polls every 30s in
 * `useRateLimits`) picks up the freshly probed values. This shrinks the
 * worst-case lag between Anthropic's actual usage and what the HUD shows
 * from 15 min (the probe interval) to about 30s.
 *
 * The `lastProbeStartedAt` guard prevents a burst of GETs from firing
 * concurrent probes — at most one in-flight at a time, debounced by
 * STALE_MS.
 */

const STALE_MS = 30_000;
let lastProbeStartedAt = 0;

/**
 * Fire-and-forget a probe iff the cache is stale AND no probe has been
 * kicked off recently. Exposed for tests via `__resetProbeKickerForTests`.
 */
function maybeKickProbe(updatedAt: number | null): boolean {
  const now = Date.now();
  // Suppress concurrent probes — the in-flight one will write soon.
  if (now - lastProbeStartedAt < STALE_MS) return false;
  // Cache is fresh enough; nothing to do.
  if (updatedAt !== null && now - updatedAt < STALE_MS) return false;
  lastProbeStartedAt = now;
  void probeRateLimits().catch(() => {
    /* probeRateLimits already swallows internally — defensive */
  });
  return true;
}

/** Test-only: reset the in-module debounce timestamp. */
export function __resetProbeKickerForTests(): void {
  lastProbeStartedAt = 0;
}

export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const cache = await loadRateLimits();
  maybeKickProbe(cache.updatedAt);
  return Response.json(cache);
}
