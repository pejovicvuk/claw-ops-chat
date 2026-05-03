import { extractSession, unauthorized } from "@/lib/auth-server";
import { snapshot as webrtcSnapshot } from "@/lib/preview-stream/webrtc-metrics";

/**
 * Phase 4 (#130) hardening: process-wide preview-pipeline metrics.
 * Auth-gated; reveals operational counts only — no PII, no per-actor
 * breakdown.
 *
 * Useful for "is RTC actually working" — pair `paired` against
 * `pair_timeout` + `capture_failed` to see the effective WebRTC
 * connect rate. `fallback_to_mse` is bumped client-side, not here,
 * so this is a server-side picture only.
 */
export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  return Response.json({ webrtc: webrtcSnapshot() });
}
