import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { WebSocket } from "ws";

// Mock the chromium-pool import so the handler doesn't try to launch
// a real Chromium when a viewer connects. The mock just records calls.
const acquirePageSpy = vi.hoisted(() => vi.fn());
vi.mock("../chromium-pool", () => ({
  acquirePage: (port: number, opts: { targetUrl?: string }) => {
    acquirePageSpy(port, opts);
    return Promise.resolve({
      page: {} as unknown,
      context: {} as unknown,
      release: async () => {},
    });
  },
}));

import { _resetForTests, _stats, handlePreviewRtc } from "../webrtc-handler";
import { _resetAll as resetSignaling } from "../webrtc-signaling";

interface FakeWs {
  readyState: number;
  OPEN: number;
  CLOSED: number;
  sent: string[];
  closed: { code?: number; reason?: string } | null;
  listeners: Map<string, Array<(arg?: unknown) => void>>;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, cb: (arg?: unknown) => void): void;
  emit(event: string, arg?: unknown): void;
}

function fakeWs(): FakeWs {
  const listeners = new Map<string, Array<(arg?: unknown) => void>>();
  const ws: FakeWs = {
    readyState: 1,
    OPEN: 1,
    CLOSED: 3,
    sent: [],
    closed: null,
    listeners,
    send(data: string) {
      ws.sent.push(data);
    },
    close(code, reason) {
      ws.closed = { code, reason };
      ws.readyState = 3;
      ws.emit("close");
    },
    on(event, cb) {
      let arr = listeners.get(event);
      if (!arr) {
        arr = [];
        listeners.set(event, arr);
      }
      arr.push(cb);
    },
    emit(event, arg) {
      const arr = listeners.get(event);
      if (!arr) return;
      for (const cb of arr) cb(arg);
    },
  };
  return ws;
}

beforeEach(() => {
  acquirePageSpy.mockClear();
  _resetForTests();
  resetSignaling();
});

afterEach(() => {
  _resetForTests();
  resetSignaling();
});

const route = { projectSlug: "p", itemSlug: "i", port: 4321 };
const ctx = { selfPort: 3100 };

describe("handlePreviewRtc viewer flow", () => {
  it("spawns a Chromium controller via acquirePage when the viewer connects first", async () => {
    const ws = fakeWs();
    await handlePreviewRtc(ws as unknown as WebSocket, "user@x", route, ctx, "viewer");
    expect(acquirePageSpy).toHaveBeenCalledOnce();
    const [port, opts] = acquirePageSpy.mock.calls[0];
    expect(port).toBe(4321);
    expect(String(opts.targetUrl)).toMatch(/\/chat\/preview-controller\?.*port=4321/);
    expect(String(opts.targetUrl)).toContain(`http://127.0.0.1:3100`);
  });

  it("includes a one-shot WS ticket in the controller URL so its incognito WS can authenticate", async () => {
    const ws = fakeWs();
    await handlePreviewRtc(ws as unknown as WebSocket, "user@x", route, ctx, "viewer");
    const opts = acquirePageSpy.mock.calls[0][1];
    expect(String(opts.targetUrl)).toMatch(/[?&]ticket=[0-9a-f-]{36}/);
  });

  it("does NOT re-spawn when the controller has already attached", async () => {
    const viewer = fakeWs();
    const controller = fakeWs();
    await handlePreviewRtc(viewer as unknown as WebSocket, "u", route, ctx, "viewer");
    await handlePreviewRtc(controller as unknown as WebSocket, "u", route, ctx, "controller");
    expect(acquirePageSpy).toHaveBeenCalledOnce();
  });
});

describe("handlePreviewRtc relay", () => {
  it("forwards SDP from viewer to controller and ICE from controller to viewer", async () => {
    const viewer = fakeWs();
    const controller = fakeWs();
    await handlePreviewRtc(viewer as unknown as WebSocket, "u", route, ctx, "viewer");
    await handlePreviewRtc(controller as unknown as WebSocket, "u", route, ctx, "controller");

    viewer.emit("message", JSON.stringify({ type: "sdp", sdp: { kind: "answer" } }));
    expect(controller.sent.at(-1)).toBe(JSON.stringify({ type: "sdp", sdp: { kind: "answer" } }));

    controller.emit("message", JSON.stringify({ type: "ice", candidate: { mid: "0" } }));
    expect(viewer.sent.at(-1)).toBe(JSON.stringify({ type: "ice", candidate: { mid: "0" } }));
  });

  it("ignores unknown frame types", async () => {
    const viewer = fakeWs();
    const controller = fakeWs();
    await handlePreviewRtc(viewer as unknown as WebSocket, "u", route, ctx, "viewer");
    await handlePreviewRtc(controller as unknown as WebSocket, "u", route, ctx, "controller");

    viewer.emit("message", JSON.stringify({ type: "evil-payload", junk: 1 }));
    expect(controller.sent).toEqual([]);
  });

  it("ignores malformed (non-JSON) frames", async () => {
    const viewer = fakeWs();
    const controller = fakeWs();
    await handlePreviewRtc(viewer as unknown as WebSocket, "u", route, ctx, "viewer");
    await handlePreviewRtc(controller as unknown as WebSocket, "u", route, ctx, "controller");

    viewer.emit("message", "{not json");
    expect(controller.sent).toEqual([]);
  });
});

describe("handlePreviewRtc slot collisions", () => {
  it("rejects a second viewer with 1008/slot_taken", async () => {
    const v1 = fakeWs();
    const v2 = fakeWs();
    await handlePreviewRtc(v1 as unknown as WebSocket, "u", route, ctx, "viewer");
    await handlePreviewRtc(v2 as unknown as WebSocket, "u", route, ctx, "viewer");
    expect(v2.closed).toEqual({ code: 1008, reason: "slot_taken" });
  });

  it("scopes by actorEmail so two users on the same project/item/port don't collide", async () => {
    const a = fakeWs();
    const b = fakeWs();
    await handlePreviewRtc(a as unknown as WebSocket, "alice@x", route, ctx, "viewer");
    await handlePreviewRtc(b as unknown as WebSocket, "bob@x", route, ctx, "viewer");
    // Two separate sessions with two separate Chromium spawns.
    expect(_stats().peerKeys.length).toBe(2);
    expect(acquirePageSpy).toHaveBeenCalledTimes(2);
  });
});

describe("handlePreviewRtc teardown", () => {
  it("relays bye and closes both peers when viewer disconnects", async () => {
    const viewer = fakeWs();
    const controller = fakeWs();
    await handlePreviewRtc(viewer as unknown as WebSocket, "u", route, ctx, "viewer");
    await handlePreviewRtc(controller as unknown as WebSocket, "u", route, ctx, "controller");

    viewer.emit("close");
    expect(controller.sent.some((s) => s.includes('"bye"'))).toBe(true);
    expect(controller.closed?.code).toBe(1011);
  });
});

describe("handlePreviewRtc rate limiting", () => {
  it("rejects an actor's 9th concurrent room with 1008/rate_limited (default cap is 8)", async () => {
    const viewers: ReturnType<typeof fakeWs>[] = [];
    for (let i = 0; i < 8; i++) {
      const v = fakeWs();
      viewers.push(v);
      await handlePreviewRtc(
        v as unknown as WebSocket,
        "alice@x",
        { ...route, port: 4000 + i },
        ctx,
        "viewer",
      );
    }
    // First 8 are accepted.
    for (const v of viewers) expect(v.closed).toBeNull();

    // 9th rejected.
    const ninth = fakeWs();
    await handlePreviewRtc(
      ninth as unknown as WebSocket,
      "alice@x",
      { ...route, port: 4099 },
      ctx,
      "viewer",
    );
    expect(ninth.closed).toEqual({ code: 1008, reason: "rate_limited" });
  });

  it("frees a slot when an existing viewer disconnects", async () => {
    const viewers: ReturnType<typeof fakeWs>[] = [];
    for (let i = 0; i < 8; i++) {
      const v = fakeWs();
      viewers.push(v);
      await handlePreviewRtc(
        v as unknown as WebSocket,
        "alice@x",
        { ...route, port: 5000 + i },
        ctx,
        "viewer",
      );
    }
    // Disconnect one — should drop the actor's room count and let a new one in.
    viewers[0].emit("close");
    expect(_stats().actorRoomCounts["alice@x"]).toBeLessThan(8);

    const fresh = fakeWs();
    await handlePreviewRtc(
      fresh as unknown as WebSocket,
      "alice@x",
      { ...route, port: 5099 },
      ctx,
      "viewer",
    );
    expect(fresh.closed).toBeNull();
  });

  it("does not count controllers against the cap (only viewers)", async () => {
    const viewers: ReturnType<typeof fakeWs>[] = [];
    for (let i = 0; i < 8; i++) {
      const v = fakeWs();
      viewers.push(v);
      await handlePreviewRtc(
        v as unknown as WebSocket,
        "alice@x",
        { ...route, port: 6000 + i },
        ctx,
        "viewer",
      );
    }
    // Controller for an existing room must still be accepted.
    const controller = fakeWs();
    await handlePreviewRtc(
      controller as unknown as WebSocket,
      "alice@x",
      { ...route, port: 6000 },
      ctx,
      "controller",
    );
    expect(controller.closed).toBeNull();
  });
});

describe("handlePreviewRtc session key encoding", () => {
  it("uses an unambiguous JSON-tuple key — fields containing | don't collide", async () => {
    // Pre-collision-safe key was `${actor}|${proj}|${item}|${port}`,
    // so an actor email like "a|b@x" collided with project "b@x" etc.
    const v1 = fakeWs();
    const v2 = fakeWs();
    await handlePreviewRtc(v1 as unknown as WebSocket, "a|b@x", route, ctx, "viewer");
    await handlePreviewRtc(
      v2 as unknown as WebSocket,
      "a",
      { ...route, projectSlug: "b@x" },
      ctx,
      "viewer",
    );
    // Two distinct sessions.
    expect(_stats().peerKeys.length).toBe(2);
    expect(v1.closed).toBeNull();
    expect(v2.closed).toBeNull();
  });
});
