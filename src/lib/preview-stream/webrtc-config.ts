/**
 * Phase 4 (#130) hardening: enterprise WebRTC configuration parsed
 * from environment variables. Exposed to clients via the auth-gated
 * `/api/preview/rtc-config` route — both the user's hook and the
 * controller page fetch from there instead of hardcoding STUN.
 *
 * Defaults preserve the original Google public STUN behavior so a
 * deployment that doesn't set anything keeps working.
 *
 * Env vars (all optional):
 *   WEBRTC_STUN_URLS          comma-separated list of stun: URLs
 *                             (default: stun.l.google.com:19302 + 1)
 *   WEBRTC_TURN_URL           single turn:/turns: URL (no default)
 *   WEBRTC_TURN_USERNAME      shared with WEBRTC_TURN_URL
 *   WEBRTC_TURN_PASSWORD      shared with WEBRTC_TURN_URL
 *   WEBRTC_CONNECT_TIMEOUT_MS time before sticky-failing RTC
 *                             (default 5000)
 */

export const DEFAULT_STUN_URLS: readonly string[] = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];

export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export interface RtcConfig {
  iceServers: RTCIceServer[];
  connectTimeoutMs: number;
}

function parseStunUrls(raw: string | undefined): string[] {
  if (!raw) return [...DEFAULT_STUN_URLS];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => s.startsWith("stun:") || s.startsWith("stuns:"));
  return parts.length > 0 ? parts : [...DEFAULT_STUN_URLS];
}

function parseConnectTimeoutMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_CONNECT_TIMEOUT_MS;
  const n = Number(raw);
  // Clamp: ICE cannot succeed in <500 ms over the public internet,
  // and waiting >60 s is user-hostile (they'd close the tab first).
  if (!Number.isFinite(n) || n < 500 || n > 60_000) {
    return DEFAULT_CONNECT_TIMEOUT_MS;
  }
  return n;
}

function buildTurnEntry(
  url: string | undefined,
  username: string | undefined,
  password: string | undefined,
): RTCIceServer | null {
  if (!url) return null;
  if (!url.startsWith("turn:") && !url.startsWith("turns:")) return null;
  if (!username || !password) return null;
  return { urls: url, username, credential: password };
}

/**
 * Build the iceServers array from env. Order matters for ICE — TURN
 * is listed alongside STUN so the agent uses host candidates first,
 * then srflx (STUN), then relay (TURN) as a last resort. This is
 * the standard ordering that minimizes TURN bandwidth costs.
 */
export function getIceServers(
  env: Record<string, string | undefined> = process.env,
): RTCIceServer[] {
  const stunUrls = parseStunUrls(env.WEBRTC_STUN_URLS);
  const turn = buildTurnEntry(
    env.WEBRTC_TURN_URL,
    env.WEBRTC_TURN_USERNAME,
    env.WEBRTC_TURN_PASSWORD,
  );
  const servers: RTCIceServer[] = [{ urls: stunUrls }];
  if (turn) servers.push(turn);
  return servers;
}

export function getRtcConnectTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  return parseConnectTimeoutMs(env.WEBRTC_CONNECT_TIMEOUT_MS);
}

export function getRtcConfig(env: Record<string, string | undefined> = process.env): RtcConfig {
  return {
    iceServers: getIceServers(env),
    connectTimeoutMs: getRtcConnectTimeoutMs(env),
  };
}
