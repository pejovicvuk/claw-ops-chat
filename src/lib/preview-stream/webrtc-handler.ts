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
import { issueWsTicket } from "../ws-ticket-store";
import { getIceServers } from "./webrtc-config";

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

/**
 * Phase 4 hardening: per-actor concurrent room cap. Without it a
 * single authenticated user could spin up unlimited Chromium tabs
 * (each WebRTC pairing acquires one). Configurable via env so an
 * operator with more capacity can raise it.
 */
const MAX_CONCURRENT_RTC_ROOMS_PER_ACTOR = (() => {
  const raw = process.env.MAX_CONCURRENT_RTC_ROOMS_PER_ACTOR;
  if (!raw) return 8;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 256) return 8;
  return Math.floor(n);
})();

const roomsByActor = new Map<string, Set<string>>();

/**
 * Phase 4 hardening: collision-safe session key. The previous
 * implementation used `${actor}|${project}|${item}|${port}` which
 * collides if any field contains `|`. JSON.stringify on a tuple is
 * unambiguous and deterministic — same shape for the same inputs.
 */
function buildKey(actorEmail: string, route: WebRtcRoute): string {
  return JSON.stringify([actorEmail, route.projectSlug, route.itemSlug, route.port]);
}

function trackActorRoom(actor: string, key: string): void {
  let set = roomsByActor.get(actor);
  if (!set) {
    set = new Set();
    roomsByActor.set(actor, set);
  }
  set.add(key);
}

function untrackActorRoom(actor: string, key: string): void {
  const set = roomsByActor.get(actor);
  if (!set) return;
  set.delete(key);
  if (set.size === 0) roomsByActor.delete(actor);
}

function actorRoomCount(actor: string): number {
  return roomsByActor.get(actor)?.size ?? 0;
}

function buildControllerUrl(
  selfPort: number,
  route: WebRtcRoute,
  room: string,
  ticket: string,
): string {
  // Thread iceServers through the URL so the incognito controller
  // doesn't have to re-authenticate to fetch /api/preview/rtc-config.
  // Source of truth lives in webrtc-config.ts (env-driven).
  const iceServers = JSON.stringify(getIceServers());
  const params = new URLSearchParams({
    port: String(route.port),
    project: route.projectSlug,
    item: route.itemSlug,
    room,
    // Phase 4 (#130) hardening: the controller page runs in an
    // incognito Chromium context with no session cookie. The ticket
    // gives it one-shot WS auth — consumed when the controller's WS
    // connection upgrades; expires after 60 s otherwise.
    ticket,
    iceServers,
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

function teardownSession(key: string, reason: string, actorEmail?: string): void {
  const peers = peerRegistry.get(key);
  if (peers) {
    for (const peer of peers) safeClose(peer, 1011, reason);
    peerRegistry.delete(key);
  }
  dropSession(key);
  if (actorEmail) untrackActorRoom(actorEmail, key);
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

  // Rate limit BEFORE creating any session state — only viewers count
  // against the cap (a controller is paired with an existing viewer
  // slot, not a new room). Already-known keys are exempt so a
  // legitimate reconnect to an existing room isn't blocked.
  if (
    role === VIEWER_ROLE &&
    !roomsByActor.get(actorEmail)?.has(key) &&
    actorRoomCount(actorEmail) >= MAX_CONCURRENT_RTC_ROOMS_PER_ACTOR
  ) {
    safeClose(ws, 1008, "rate_limited");
    return;
  }

  const session = getOrCreateSession(key, () => {
    teardownSession(key, "pair_timeout", actorEmail);
  });

  const attachResult = attachPeer(session, ws, role);
  if (!attachResult.ok) {
    // 1008 = policy violation; tells the client this slot is occupied.
    safeClose(ws, 1008, attachResult.reason ?? "rejected");
    return;
  }

  registerPeer(key, ws);
  if (role === VIEWER_ROLE) trackActorRoom(actorEmail, key);

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
      teardownSession(key, "bye", actorEmail);
    }
  });

  ws.on("close", () => {
    unregisterPeer(key, ws);
    // Tell the partner the peer is gone so it can tear down its
    // RTCPeerConnection without waiting for ICE timeouts.
    relay(session, role, { type: "bye" });
    teardownSession(key, "peer_closed", actorEmail);
  });

  ws.on("error", () => {
    unregisterPeer(key, ws);
    relay(session, role, { type: "bye" });
    teardownSession(key, "peer_error", actorEmail);
  });

  // Viewer connects first; spin up the controller via Chromium so its
  // page can connect back as `?role=controller`. Mint a fresh
  // single-use WS ticket for the controller's incognito context.
  if (role === VIEWER_ROLE && !session.controller && !acquiredPages.has(key)) {
    const controllerTicket = issueWsTicket(actorEmail);
    const acquirePromise = acquirePage(route.port, {
      targetUrl: buildControllerUrl(ctx.selfPort, route, key, controllerTicket),
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
  actorRoomCounts: Record<string, number>;
} {
  const actorRoomCounts: Record<string, number> = {};
  for (const [actor, set] of roomsByActor.entries()) {
    actorRoomCounts[actor] = set.size;
  }
  return {
    acquiredPageCount: acquiredPages.size,
    peerKeys: Array.from(peerRegistry.keys()),
    actorRoomCounts,
  };
}

/** Test-only: drop ALL state without going through the WS lifecycle. */
export function _resetForTests(): void {
  acquiredPages.clear();
  peerRegistry.clear();
  roomsByActor.clear();
}
