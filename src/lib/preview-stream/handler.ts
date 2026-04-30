import type { WebSocket } from "ws";
import { acquirePage, type AcquiredPage } from "./chromium-pool";
import { startScreencast, type Screencast } from "./cdp-screencast";
import {
  forwardKey,
  forwardMouse,
  forwardResize,
  forwardWheel,
  type KeyEvent,
  type MouseEvent,
  type ResizeEvent,
  type WheelEvent,
} from "./input-forward";

/**
 * WebSocket handler for `/ws/preview-stream/<projectSlug>/<itemSlug>/<port>`.
 *
 * Server → client:
 *   - text JSON `{type: "ready", deviceWidth, deviceHeight}` once
 *     Chromium has the page open and screencast is running
 *   - text JSON `{type: "error", message}` on fatal upstream issues
 *   - text JSON `{type: "status", state: ...}` on lifecycle changes
 *   - binary frames — raw JPEG buffers from CDP screencast
 *
 * Client → server:
 *   - text JSON `{type: "mouse" | "wheel" | "key" | "resize" | "reload" | "navigate", ...}`
 *
 * Backpressure: before each frame we check ws.bufferedAmount; if it's
 * over BUFFER_HIGH_WATERMARK we skip the frame AND skip the
 * `Page.screencastFrameAck` so CDP pauses the stream until we drain.
 */

const BUFFER_HIGH_WATERMARK = 4 * 1024 * 1024; // 4 MB

export interface PreviewStreamRoute {
  projectSlug: string;
  itemSlug: string;
  port: number;
}

interface ClientFrame {
  type: string;
  [k: string]: unknown;
}

export async function handlePreviewStream(
  ws: WebSocket,
  actorEmail: string,
  route: PreviewStreamRoute,
): Promise<void> {
  let acquired: AcquiredPage | null = null;
  let screencast: Screencast | null = null;
  let closed = false;

  const sendJson = (payload: Record<string, unknown>) => {
    if (closed || ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* socket closing */
    }
  };

  const tearDown = async () => {
    if (closed) return;
    closed = true;
    if (screencast) {
      try {
        await screencast.stop();
      } catch {
        /* ignore */
      }
    }
    if (acquired) {
      try {
        await acquired.release();
      } catch {
        /* ignore */
      }
    }
  };

  ws.on("close", () => {
    void tearDown();
  });
  ws.on("error", () => {
    void tearDown();
  });

  try {
    acquired = await acquirePage(route.port);
  } catch (err) {
    sendJson({
      type: "error",
      code: "chromium_launch_failed",
      message: err instanceof Error ? err.message : "Failed to launch Chromium",
    });
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    return;
  }

  const { page } = acquired;

  // Detect upstream errors that didn't throw at acquirePage time
  // (Chromium might have navigated to chrome-error://). The simplest
  // signal: the page URL starts with `chrome-error://`.
  if (page.url().startsWith("chrome-error://")) {
    sendJson({
      type: "error",
      code: "upstream_unreachable",
      message: `Dev server not reachable on :${route.port}`,
    });
    void tearDown();
    return;
  }

  try {
    screencast = await startScreencast(page, {
      format: "jpeg",
      quality: 80,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 6,
    });
  } catch (err) {
    sendJson({
      type: "error",
      code: "page_crashed",
      message: err instanceof Error ? err.message : "Screencast failed to start",
    });
    void tearDown();
    return;
  }

  // Seed the client with viewport dims so it sizes its canvas.
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  sendJson({
    type: "ready",
    deviceWidth: viewport.width,
    deviceHeight: viewport.height,
    screencast: { format: "jpeg", maxFps: 10 },
    actorEmail,
  });

  screencast.onFrame((frame) => {
    if (closed || ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > BUFFER_HIGH_WATERMARK) {
      // Drop frame + skip ack — CDP pauses until we ack the next one.
      return;
    }
    try {
      ws.send(frame.data, { binary: true });
      void frame.ack();
    } catch {
      /* socket closing */
    }
  });

  ws.on("message", (raw) => {
    if (closed) return;
    let parsed: ClientFrame;
    try {
      parsed = JSON.parse(raw.toString()) as ClientFrame;
    } catch {
      return;
    }
    void dispatchClientFrame(parsed, screencast, page, route, sendJson);
  });
}

async function dispatchClientFrame(
  frame: ClientFrame,
  screencast: Screencast | null,
  page: AcquiredPage["page"],
  route: PreviewStreamRoute,
  sendJson: (payload: Record<string, unknown>) => void,
): Promise<void> {
  if (!screencast) return;
  const { session } = screencast;
  try {
    switch (frame.type) {
      case "mouse":
        await forwardMouse(session, frame as unknown as MouseEvent);
        return;
      case "wheel":
        await forwardWheel(session, frame as unknown as WheelEvent);
        return;
      case "key":
        await forwardKey(session, frame as unknown as KeyEvent);
        return;
      case "resize":
        await forwardResize(page, frame as unknown as ResizeEvent);
        return;
      case "reload":
        sendJson({ type: "status", state: "navigating" });
        await page.goto(`http://127.0.0.1:${route.port}/`, {
          waitUntil: "domcontentloaded",
          timeout: 10_000,
        });
        sendJson({ type: "status", state: "ready" });
        return;
      case "navigate": {
        const url = String((frame as { url?: string }).url ?? "");
        // Restrict to same-port localhost — preventing the user from
        // turning this into a generic SSRF / external-page proxy.
        const allowed =
          url.startsWith(`http://127.0.0.1:${route.port}/`) ||
          url.startsWith(`http://localhost:${route.port}/`);
        if (!allowed) {
          sendJson({
            type: "error",
            code: "navigate_rejected",
            message: "External URLs not allowed",
          });
          return;
        }
        sendJson({ type: "status", state: "navigating" });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 });
        sendJson({ type: "status", state: "ready" });
        return;
      }
      default:
        return;
    }
  } catch {
    /* swallow per-event errors so a malformed message doesn't kill the stream */
  }
}
