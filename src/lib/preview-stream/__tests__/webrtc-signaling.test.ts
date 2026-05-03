import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import {
  PAIR_TIMEOUT_MS,
  _resetAll,
  _stats,
  attachPeer,
  dropSession,
  getOrCreateSession,
  relay,
  type RtcSession,
} from "../webrtc-signaling";

interface FakeWs {
  readyState: number;
  OPEN: number;
  CLOSED: number;
  sent: string[];
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

function fakeWs(opts: { open?: boolean } = {}): FakeWs {
  const ws: FakeWs = {
    readyState: opts.open === false ? 3 /* CLOSED */ : 1 /* OPEN */,
    OPEN: 1,
    CLOSED: 3,
    sent: [],
    send(data: string) {
      ws.sent.push(data);
    },
    close() {
      ws.readyState = 3;
    },
  };
  return ws;
}

beforeEach(() => {
  _resetAll();
  vi.useFakeTimers();
});

afterEach(() => {
  _resetAll();
  vi.useRealTimers();
});

describe("getOrCreateSession", () => {
  it("creates a new session on first call and reuses it on second", () => {
    const a = getOrCreateSession("k", () => {});
    const b = getOrCreateSession("k", () => {});
    expect(a).toBe(b);
    expect(_stats().sessionCount).toBe(1);
  });

  it("starts a pairing timer that fires after PAIR_TIMEOUT_MS when only one slot is filled", () => {
    const onTimeout = vi.fn();
    const session = getOrCreateSession("k", onTimeout);
    attachPeer(session, fakeWs() as unknown as WebSocket, "viewer");
    vi.advanceTimersByTime(PAIR_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onTimeout).toHaveBeenCalledOnce();
    // Session is dropped from the registry as part of timeout handling.
    expect(_stats().sessionCount).toBe(0);
  });

  it("does not fire the pairing timer once both slots are filled", () => {
    const onTimeout = vi.fn();
    const session = getOrCreateSession("k", onTimeout);
    attachPeer(session, fakeWs() as unknown as WebSocket, "viewer");
    attachPeer(session, fakeWs() as unknown as WebSocket, "controller");
    vi.advanceTimersByTime(PAIR_TIMEOUT_MS + 1_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("attachPeer", () => {
  let session: RtcSession;
  beforeEach(() => {
    session = getOrCreateSession("k", () => {});
  });

  it("fills the requested slot on the first call", () => {
    const ws = fakeWs() as unknown as WebSocket;
    expect(attachPeer(session, ws, "viewer")).toEqual({ ok: true });
    expect(session.viewer?.ws).toBe(ws);
  });

  it("rejects re-attach to a filled slot with slot_taken", () => {
    attachPeer(session, fakeWs() as unknown as WebSocket, "controller");
    const result = attachPeer(session, fakeWs() as unknown as WebSocket, "controller");
    expect(result).toEqual({ ok: false, reason: "slot_taken" });
  });

  it("treats viewer and controller as independent slots", () => {
    expect(attachPeer(session, fakeWs() as unknown as WebSocket, "viewer").ok).toBe(true);
    expect(attachPeer(session, fakeWs() as unknown as WebSocket, "controller").ok).toBe(true);
  });
});

describe("relay", () => {
  it("forwards from viewer to controller", () => {
    const session = getOrCreateSession("k", () => {});
    const ctrlWs = fakeWs();
    const viewWs = fakeWs();
    attachPeer(session, ctrlWs as unknown as WebSocket, "controller");
    attachPeer(session, viewWs as unknown as WebSocket, "viewer");
    relay(session, "viewer", { type: "sdp", sdp: { kind: "offer" } });
    expect(ctrlWs.sent).toEqual([JSON.stringify({ type: "sdp", sdp: { kind: "offer" } })]);
    expect(viewWs.sent).toEqual([]);
  });

  it("forwards from controller to viewer", () => {
    const session = getOrCreateSession("k", () => {});
    const ctrlWs = fakeWs();
    const viewWs = fakeWs();
    attachPeer(session, ctrlWs as unknown as WebSocket, "controller");
    attachPeer(session, viewWs as unknown as WebSocket, "viewer");
    relay(session, "controller", { type: "ice", candidate: { mid: "0" } });
    expect(viewWs.sent).toEqual([JSON.stringify({ type: "ice", candidate: { mid: "0" } })]);
    expect(ctrlWs.sent).toEqual([]);
  });

  it("silently drops frames when the partner slot is empty", () => {
    const session = getOrCreateSession("k", () => {});
    attachPeer(session, fakeWs() as unknown as WebSocket, "viewer");
    expect(() => relay(session, "viewer", { type: "sdp", sdp: { kind: "offer" } })).not.toThrow();
  });

  it("silently drops frames when the partner WS is closed", () => {
    const session = getOrCreateSession("k", () => {});
    const ctrlWs = fakeWs({ open: false });
    const viewWs = fakeWs();
    attachPeer(session, ctrlWs as unknown as WebSocket, "controller");
    attachPeer(session, viewWs as unknown as WebSocket, "viewer");
    relay(session, "viewer", { type: "bye" });
    expect(ctrlWs.sent).toEqual([]);
  });
});

describe("dropSession", () => {
  it("clears the pairing timer and removes the session from the registry", () => {
    const onTimeout = vi.fn();
    getOrCreateSession("k", onTimeout);
    dropSession("k");
    expect(_stats().sessionCount).toBe(0);
    vi.advanceTimersByTime(PAIR_TIMEOUT_MS + 1_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("is a noop on unknown keys", () => {
    expect(() => dropSession("does-not-exist")).not.toThrow();
  });
});
