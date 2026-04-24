import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadRateLimits } from "@/lib/account-rate-limits";

/**
 * GET /chat/api/rate-limits
 *
 * Returns the current account-level subscriber rate-limit cache — the same
 * shape the Claude Agent SDK's `rate_limit_event` emits. The cache is
 * populated whenever any chat session turns execute. The HUD popup fetches
 * this on open (and polls every 30s) to show the 5-hour and 7-day windows.
 *
 * Always returns `{ windows: {}, updatedAt: null }` when the cache is
 * empty — never 404 — so the UI can render "no data yet" consistently.
 */
export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const cache = await loadRateLimits();
  return Response.json(cache);
}
