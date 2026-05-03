import { extractSession, unauthorized } from "@/lib/auth-server";
import { getRtcConfig } from "@/lib/preview-stream/webrtc-config";

/**
 * Phase 4 (#130) hardening: WebRTC ICE configuration for the
 * preview-stream client + the controller page. Both fetch from this
 * endpoint instead of hardcoding STUN, so an operator can swap to a
 * self-hosted coturn (or a paid TURN provider) by setting env vars
 * without redeploying client code.
 *
 * Auth: standard session-cookie check. The endpoint reveals only the
 * STUN/TURN URLs already configured on the server — no secrets — but
 * we gate it anyway so unauthenticated probes can't enumerate the
 * deployment's TURN provider.
 */
export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const cfg = getRtcConfig();
  return Response.json(cfg);
}
