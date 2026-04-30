import type { WebSocket } from "ws";
import { acquirePage, type AcquiredPage } from "./chromium-pool";
import { startScreencast, type Screencast } from "./cdp-screencast";
import {
  forwardKey,
  forwardMouse,
  forwardTouch,
  forwardResize,
  forwardWheel,
  type KeyEvent,
  type MouseEvent,
  type ResizeEvent,
  type TouchEvent,
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

export type QualityPreset = "performance" | "balanced" | "quality";

export interface PreviewStreamRoute {
  projectSlug: string;
  itemSlug: string;
  port: number;
  /**
   * Quality preset selected by the user. Trades bandwidth for visual
   * fidelity / frame rate. Defaults to `balanced` when absent.
   */
  quality?: QualityPreset;
}

interface ScreencastSettings {
  everyNthFrame: number;
  jpegQuality: number;
}

/**
 * Quality presets — each is one (frame-rate, JPEG-quality) pair.
 * DSF=2 doubles bytes per frame relative to DSF=1, so the bandwidth
 * targets below already account for it.
 *   performance: ~0.6–1 MB/s, mobile / slow links
 *   balanced  : ~1.5–2 MB/s, default for most home connections
 *   quality   : ~3–5 MB/s, LAN / fiber for smooth animation
 */
const QUALITY_PRESETS: Record<QualityPreset, ScreencastSettings> = {
  performance: { everyNthFrame: 6, jpegQuality: 70 },
  balanced: { everyNthFrame: 4, jpegQuality: 82 },
  quality: { everyNthFrame: 2, jpegQuality: 92 },
};

function resolveQuality(input: QualityPreset | undefined): ScreencastSettings {
  // Env var lets ops override the default in production without a
  // code change. Format: PREVIEW_QUALITY=balanced (or one of the
  // preset names). Anything else falls back to "balanced".
  const envOverride = process.env.PREVIEW_QUALITY as QualityPreset | undefined;
  const chosen: QualityPreset =
    input ?? (envOverride && QUALITY_PRESETS[envOverride] ? envOverride : "balanced");
  return QUALITY_PRESETS[chosen] ?? QUALITY_PRESETS.balanced;
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

  const { everyNthFrame, jpegQuality } = resolveQuality(route.quality);
  try {
    screencast = await startScreencast(page, {
      format: "jpeg",
      quality: jpegQuality,
      // Bumped for DSF=2: a 1440×900 viewport at DSF=2 produces a
      // 2880×1800 bitmap. CDP clamps to maxWidth/maxHeight, so we
      // need headroom for HiDPI rendering at typical desktop sizes.
      maxWidth: 3200,
      maxHeight: 2000,
      everyNthFrame,
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

  // Mirror the page's URL back to the client whenever it changes —
  // covers in-app `<Link>` clicks + history.pushState (which don't
  // round-trip through our `navigate` WS message). Dedup against the
  // last-sent path because SPAs can fire many framenavigated events
  // for what visually looks like one navigation.
  let lastSentPath: string | null = null;
  const onFrameNavigated = (navFrame: { url: () => string; parentFrame: () => unknown }) => {
    // Only the main frame's URL counts — iframe navigations inside the
    // previewed app shouldn't bubble up.
    if (navFrame.parentFrame() !== null) return;
    let path: string;
    try {
      const u = new URL(navFrame.url());
      path = u.pathname + u.search + u.hash;
    } catch {
      return;
    }
    if (path === lastSentPath) return;
    lastSentPath = path;
    sendJson({ type: "url_changed", path });
  };
  page.on("framenavigated", onFrameNavigated);
  // Send the initial URL so the client's path input reflects whatever
  // page Chromium loaded.
  onFrameNavigated({ url: () => page.url(), parentFrame: () => null });

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
      case "touch":
        await forwardTouch(session, frame as unknown as TouchEvent);
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
