import type { WebSocket } from "ws";

/**
 * Phase 4 (#130): SDP/ICE signaling-relay state for the WebRTC preview
 * pipeline. Pure pairing logic — no I/O, no Chromium integration.
 *
 * Two WebSocket peers connect to the same `/ws/preview-rtc/...` URL:
 *   - The user's browser ("viewer")
 *   - The headless Chromium controller page ("controller")
 *
 * The chat server is signaling-only; once SDP + ICE are exchanged the
 * media stream flows P2P over SRTP between the two peers (via STUN).
 *
 * Pairing rules:
 *   - First peer to attach claims its slot; the room stays "half-open"
 *     until the second peer arrives.
 *   - The PAIR_TIMEOUT_MS clock starts on session creation. If the
 *     second slot is still empty when it fires, both sides receive
 *     `1011 timeout` and the session is dropped.
 *   - Re-attaching to an already-filled slot is rejected with
 *     `slot_taken` so a stuck reconnect doesn't kick the legitimate
 *     peer.
 *
 * Wire frames (text JSON):
 *   - `{type: "role", role: "controller" | "viewer"}` — first message
 *     from each peer; identifies which slot it wants.
 *   - `{type: "sdp", sdp: {...}}` — relayed verbatim to the other slot.
 *   - `{type: "ice", candidate: {...}}` — relayed verbatim.
 *   - `{type: "bye"}` — graceful tear-down; closes the partner.
 *   - `{type: "capture_failed", reason}` — controller-only; tells the
 *     viewer to fall back to the MSE pipeline.
 */

export const PAIR_TIMEOUT_MS = 30_000;

export type RtcRole = "controller" | "viewer";

export interface PeerSlot {
  ws: WebSocket;
  role: RtcRole;
  createdAt: number;
}

export interface RtcSession {
  key: string;
  controller?: PeerSlot;
  viewer?: PeerSlot;
  pairTimer: ReturnType<typeof setTimeout> | null;
  createdAt: number;
}

export type SignalFrame =
  | { type: "role"; role: RtcRole }
  | { type: "sdp"; sdp: unknown }
  | { type: "ice"; candidate: unknown }
  | { type: "bye" }
  | { type: "capture_failed"; reason: string };

export interface AttachResult {
  ok: boolean;
  reason?: "slot_taken";
}

const sessions = new Map<string, RtcSession>();

/**
 * Get an existing session by key, or create a new one. The pairing
 * timer starts on first creation; callers MUST pass a `onTimeout`
 * callback so the relay layer can close both peers when it fires.
 */
export function getOrCreateSession(
  key: string,
  onTimeout: (session: RtcSession) => void,
): RtcSession {
  const existing = sessions.get(key);
  if (existing) return existing;
  const session: RtcSession = {
    key,
    pairTimer: null,
    createdAt: Date.now(),
  };
  session.pairTimer = setTimeout(() => {
    if (session.controller && session.viewer) return; // already paired
    onTimeout(session);
    dropSession(key);
  }, PAIR_TIMEOUT_MS);
  sessions.set(key, session);
  return session;
}

/**
 * Attach a peer to a session. Returns `{ok: false, reason: "slot_taken"}`
 * if the requested slot already has an open peer. Once both slots are
 * filled the pairing timer is cleared.
 */
export function attachPeer(session: RtcSession, ws: WebSocket, role: RtcRole): AttachResult {
  if (role === "controller") {
    if (session.controller) return { ok: false, reason: "slot_taken" };
    session.controller = { ws, role, createdAt: Date.now() };
  } else {
    if (session.viewer) return { ok: false, reason: "slot_taken" };
    session.viewer = { ws, role, createdAt: Date.now() };
  }
  if (session.controller && session.viewer && session.pairTimer) {
    clearTimeout(session.pairTimer);
    session.pairTimer = null;
  }
  return { ok: true };
}

/**
 * Forward a signaling frame from one slot to the other. Drops the
 * frame if the partner slot is empty (still pairing) or the partner
 * WS is no longer open. Frames are JSON-stringified before send.
 */
export function relay(session: RtcSession, from: RtcRole, frame: SignalFrame): void {
  const partner = from === "controller" ? session.viewer : session.controller;
  if (!partner) return;
  const ws = partner.ws;
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    /* socket already closing — partner cleanup will run on its 'close' event */
  }
}

/**
 * Remove a session from the registry and clear its pairing timer.
 * Caller is responsible for closing the actual WebSocket peers — this
 * function only frees state.
 */
export function dropSession(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  if (session.pairTimer) {
    clearTimeout(session.pairTimer);
    session.pairTimer = null;
  }
  sessions.delete(key);
}

/** Test-only: snapshot of internal state. */
export function _stats(): { sessionCount: number; keys: string[] } {
  return { sessionCount: sessions.size, keys: Array.from(sessions.keys()) };
}

/** Test-only: drop ALL sessions. Used by vitest to reset between cases. */
export function _resetAll(): void {
  for (const session of sessions.values()) {
    if (session.pairTimer) clearTimeout(session.pairTimer);
  }
  sessions.clear();
}
