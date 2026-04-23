import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAllSessionStatuses } from "@/lib/session-status-store";

// Status is strictly in-memory per-request — must never be snapshotted
// at build time or served from the router cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /chat/api/sessions/status
 *
 * Returns a snapshot of every in-memory session's current status so the
 * sidebar can render a live dot next to each session row. Polled every
 * 2 s by the `useSessionStatuses` hook when the tab is visible; paused
 * when hidden to avoid background traffic.
 *
 * Response shape:
 *   { [sessionId]: { status, lastActivityAt } }
 *
 * Status values match the WebSocket `status` message format:
 *   "idle" | "thinking" | "tool_running"
 *   | "awaiting_permission" | "awaiting_input"
 */
export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  return Response.json(getAllSessionStatuses(), {
    // Discourage any intermediate cache from holding stale data — this
    // endpoint is live and the polling cadence is already 2 s.
    headers: { "Cache-Control": "no-store" },
  });
}
