import { extractSession, unauthorized } from "@/lib/auth-server";
import { bump, type WebRtcCounters } from "@/lib/preview-stream/webrtc-metrics";

const ALLOWED_EVENTS: ReadonlySet<keyof WebRtcCounters> = new Set([
  "fallback_to_mse",
  "ice_restart",
]);

/**
 * Phase 4 (#130) hardening: client-reported metrics. The browser-side
 * `use-preview-stream` hook posts here when it does an ICE restart or
 * sticky-fails to MSE — events the server-side handler can't observe.
 *
 * Tightly scoped: only `fallback_to_mse` and `ice_restart` are
 * accepted, nothing else. No labels, no PII. The endpoint is
 * auth-gated so unauthenticated traffic can't pump the counters.
 */
export async function POST(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  let body: { event?: string };
  try {
    body = (await request.json()) as { event?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = body.event;
  if (typeof event !== "string" || !ALLOWED_EVENTS.has(event as keyof WebRtcCounters)) {
    return Response.json({ error: "Unknown event" }, { status: 400 });
  }
  bump(event as keyof WebRtcCounters);
  return Response.json({ ok: true });
}
