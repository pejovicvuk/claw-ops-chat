import type { WebSocket } from "ws";
import { acquirePage, type AcquiredPage } from "./chromium-pool";
import {
  attachPeer,
  dropSession,
  getOrCreateSession,
  relay,
  type SignalFrame,
  type RtcRole,
} from "./webrtc-signaling";

/**
 * Phase 4 (#130): WebSocket handler for `/ws/preview-rtc/...`. Pairs a
 * "viewer" peer (the user's browser tab) with a "controller" peer (the
 * headless Chromium controller page) and relays SDP / ICE between
 * them.
 *
 * Two WS clients connect to the same URL with `?role=viewer` /
 * `?role=controller`. The server is signaling-only — once both peers
 * have exchanged SDP + ICE the media stream flows P2P over SRTP via
 * STUN.
 *
 * Lifecycle:
 *   1. Viewer connects first → server spins up the headless Chromium
 *      controller via `acquirePage(port, {targetUrl: <controller URL>})`.
 *   2. Controller page boots inside Chromium and opens its own WS to
 *      the same path with `?role=controller`.
 *   3. Server pairs the two slots; from this point on `relay()`
 *      forwards every signaling frame from one slot to the other.
 *   4. Either side closes → handler tears down the session and
 *      releases the Chromium page back to the pool.
 *
 * Re-acquire on the same room key (same user + same preview) returns
 * `slot_taken` and the new connection is closed with `1008` so a stuck
 * old peer doesn't get kicked.
 */

export interface WebRtcRoute {
  projectSlug: string;
  itemSlug: string;
  port: number;
}

export interface WebRtcCtx {
  /** Chat server's own listen port — used to build the controller URL. */
  selfPort: number;
}

const VIEWER_ROLE: RtcRole = "viewer";
const CONTROLLER_ROLE: RtcRole = "controller";

const VALID_FRAME_TYPES = new Set<SignalFrame["type"]>([
  "role",
  "sdp",
  "ice",
  "bye",
  "capture_failed",
]);

const acquiredPages = new Map<string, Promise<AcquiredPage>>();
const peerRegistry = new Map<string, Set<WebSocket>>();

function buildKey(actorEmail: string, route: WebRtcRoute): string {
  return `${actorEmail}|${route.projectSlug}|${route.itemSlug}|${route.port}`;
}

function buildControllerUrl(selfPort: number, route: WebRtcRoute, room: string): string {
  const params = new URLSearchParams({
    port: String(route.port),
    project: route.projectSlug,
    item: route.itemSlug,
    room,
  });
  return `http://127.0.0.1:${selfPort}/chat/preview-controller?${params.toString()}`;
}

function parseRole(roleParam: string | undefined | null): RtcRole {
  return roleParam === "controller" ? CONTROLLER_ROLE : VIEWER_ROLE;
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    /* socket already destroyed */
  }
}

function registerPeer(key: string, ws: WebSocket): void {
  let set = peerRegistry.get(key);
  if (!set) {
    set = new Set();
    peerRegistry.set(key, set);
  }
  set.add(ws);
}

function unregisterPeer(key: string, ws: WebSocket): void {
  const set = peerRegistry.get(key);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) peerRegistry.delete(key);
}

async function releaseAcquiredPage(key: string): Promise<void> {
  const promise = acquiredPages.get(key);
  if (!promise) return;
  acquiredPages.delete(key);
  try {
    const acquired = await promise;
    await acquired.release();
  } catch {
    /* page may have failed to acquire — nothing to release */
  }
}

function teardownSession(key: string, reason: string): void {
  const peers = peerRegistry.get(key);
  if (peers) {
    for (const peer of peers) safeClose(peer, 1011, reason);
    peerRegistry.delete(key);
  }
  dropSession(key);
  void releaseAcquiredPage(key);
}

export async function handlePreviewRtc(
  ws: WebSocket,
  actorEmail: string,
  route: WebRtcRoute,
  ctx: WebRtcCtx,
  roleParam?: string,
): Promise<void> {
  const role = parseRole(roleParam);
  const key = buildKey(actorEmail, route);
  const session = getOrCreateSession(key, () => {
    teardownSession(key, "pair_timeout");
  });

  const attachResult = attachPeer(session, ws, role);
  if (!attachResult.ok) {
    // 1008 = policy violation; tells the client this slot is occupied.
    safeClose(ws, 1008, attachResult.reason ?? "rejected");
    return;
  }

  registerPeer(key, ws);

  ws.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString();
    let frame: SignalFrame;
    try {
      frame = JSON.parse(text) as SignalFrame;
    } catch {
      return; // ignore malformed
    }
    if (!frame || typeof frame !== "object" || typeof frame.type !== "string") {
      return;
    }
    if (!VALID_FRAME_TYPES.has(frame.type as SignalFrame["type"])) {
      return; // unknown type; drop without echoing
    }
    if (frame.type === "role") return; // already learned from URL
    relay(session, role, frame);
    if (frame.type === "bye") {
      teardownSession(key, "bye");
    }
  });

  ws.on("close", () => {
    unregisterPeer(key, ws);
    // Tell the partner the peer is gone so it can tear down its
    // RTCPeerConnection without waiting for ICE timeouts.
    relay(session, role, { type: "bye" });
    teardownSession(key, "peer_closed");
  });

  ws.on("error", () => {
    unregisterPeer(key, ws);
    relay(session, role, { type: "bye" });
    teardownSession(key, "peer_error");
  });

  // Viewer connects first; spin up the controller via Chromium so its
  // page can connect back as `?role=controller`.
  if (role === VIEWER_ROLE && !session.controller && !acquiredPages.has(key)) {
    const acquirePromise = acquirePage(route.port, {
      targetUrl: buildControllerUrl(ctx.selfPort, route, key),
    });
    acquiredPages.set(key, acquirePromise);
    acquirePromise.catch((err) => {
      acquiredPages.delete(key);
      const message = err instanceof Error ? err.message : "controller_spawn_failed";
      // Push capture_failed onto the viewer slot so the client falls
      // back to MSE without waiting for the 30 s pair timeout.
      relay(session, "controller", { type: "capture_failed", reason: message });
    });
  }
}

/** Test-only: snapshot of internal state. */
export function _stats(): {
  acquiredPageCount: number;
  peerKeys: string[];
} {
  return {
    acquiredPageCount: acquiredPages.size,
    peerKeys: Array.from(peerRegistry.keys()),
  };
}

/** Test-only: drop ALL state without going through the WS lifecycle. */
export function _resetForTests(): void {
  acquiredPages.clear();
  peerRegistry.clear();
}
