import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocketServer, WebSocket as WsClient, type WebSocket } from "ws";

/**
 * Phase 4 (#130) hardening: full-stack integration test that exercises
 * the handler against a REAL ws.WebSocketServer + ws clients. The
 * unit tests in webrtc-handler.test.ts use a hand-rolled FakeWs that
 * passes string payloads — the production path receives Buffers, so
 * `data.toString()` parsing has to actually work.
 *
 * Mocks acquirePage (we don't want a real Chromium spawn) but
 * everything else is the real thing: the ws library, the relay
 * helpers, the rate-limit logic, the timer infrastructure.
 */

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

import { _resetForTests, handlePreviewRtc } from "../webrtc-handler";
import { _resetAll as resetSignaling } from "../webrtc-signaling";
import { _resetForTests as resetMetrics } from "../webrtc-metrics";

let httpServer: HttpServer;
let wss: WebSocketServer;
let port: number;

async function setupServer(): Promise<void> {
  httpServer = createServer();
  wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const role = url.searchParams.get("role") ?? "viewer";
    const actor = url.searchParams.get("actor") ?? "tester@x";
    const projectSlug = url.searchParams.get("project") ?? "p";
    const itemSlug = url.searchParams.get("item") ?? "i";
    const previewPort = Number(url.searchParams.get("port") ?? "4321");
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handlePreviewRtc(
        ws,
        actor,
        { projectSlug, itemSlug, port: previewPort },
        { selfPort: 3100 },
        role,
      );
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
}

async function teardownServer(): Promise<void> {
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
}

function dial(role: "viewer" | "controller", actor = "tester@x"): WsClient {
  const url = `ws://localhost:${port}/?role=${role}&actor=${encodeURIComponent(actor)}`;
  return new WsClient(url);
}

function awaitOpen(ws: WsClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function nextMessage(ws: WsClient): Promise<string> {
  return new Promise<string>((resolve) => {
    ws.once("message", (data: WebSocket.RawData) => {
      // Real production data is `Buffer`; the unit tests skipped this
      // branch by fabricating string-typed inputs.
      resolve(typeof data === "string" ? data : data.toString());
    });
  });
}

beforeEach(async () => {
  acquirePageSpy.mockClear();
  _resetForTests();
  resetSignaling();
  resetMetrics();
  await setupServer();
});

afterEach(async () => {
  await teardownServer();
  _resetForTests();
  resetSignaling();
  resetMetrics();
});

describe("integration: real ws clients ↔ handlePreviewRtc", () => {
  it("relays a Buffer-shaped SDP frame from viewer to controller", async () => {
    const viewer = dial("viewer");
    await awaitOpen(viewer);
    // Wait a tick for the controller-spawn side effect.
    await new Promise((r) => setTimeout(r, 20));
    expect(acquirePageSpy).toHaveBeenCalledOnce();

    const controller = dial("controller");
    await awaitOpen(controller);
    // Tiny pause to let the on('message') wiring complete.
    await new Promise((r) => setTimeout(r, 10));

    const recv = nextMessage(controller);
    viewer.send(JSON.stringify({ type: "sdp", sdp: { kind: "answer" } }));
    const text = await recv;
    expect(JSON.parse(text)).toEqual({ type: "sdp", sdp: { kind: "answer" } });

    viewer.close();
    controller.close();
  });

  it("rejects a malformed (non-JSON) frame without throwing — production data is Buffers", async () => {
    const viewer = dial("viewer");
    await awaitOpen(viewer);
    await new Promise((r) => setTimeout(r, 10));
    const controller = dial("controller");
    await awaitOpen(controller);
    await new Promise((r) => setTimeout(r, 10));

    // Nothing should be sent to the controller.
    let received = false;
    controller.on("message", () => {
      received = true;
    });
    viewer.send("{not json");
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toBe(false);

    viewer.close();
    controller.close();
  });

  it("closes a duplicate viewer with 1008/slot_taken", async () => {
    const v1 = dial("viewer");
    await awaitOpen(v1);
    await new Promise((r) => setTimeout(r, 20));

    const v2 = dial("viewer");
    await awaitOpen(v2);
    const closeFrame = await new Promise<{ code: number; reason: string }>((resolve) => {
      v2.once("close", (code: number, reason: Buffer) =>
        resolve({ code, reason: reason.toString() }),
      );
    });
    expect(closeFrame.code).toBe(1008);
    expect(closeFrame.reason).toBe("slot_taken");

    v1.close();
  });
});
