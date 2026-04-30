import type { WebSocket } from "ws";
import { acquirePage, type AcquiredPage } from "./chromium-pool";
import { startScreencast, type Screencast } from "./cdp-screencast";
import { H264Encoder, type SegmentEvent } from "./h264-encoder";
import { decodePngToRgb24 } from "./png-decoder";
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
 *   - text JSON `{type: "ready", deviceWidth, deviceHeight, codec}` once
 *     Chromium has the page open and the chosen codec pipeline is up.
 *   - text JSON `{type: "error", message}` on fatal upstream issues
 *   - text JSON `{type: "status", state: ...}` on lifecycle changes
 *   - binary frames:
 *       JPEG codec  — raw JPEG bytes (Phase 1 path, no envelope)
 *       H.264 codec — 1-byte tag + payload:
 *                     0x00 = fMP4 init segment (ftyp + moov)
 *                     0x01 = fMP4 media segment (moof + mdat)
 *
 * Client → server:
 *   - text JSON `{type: "mouse" | "wheel" | "key" | "resize" | "reload" | "navigate", ...}`
 *
 * Backpressure (both codecs): before consuming the next CDP frame we
 * check ws.bufferedAmount; if it's over BUFFER_HIGH_WATERMARK we skip
 * the `Page.screencastFrameAck` (so CDP pauses) AND skip handing the
 * frame to the codec layer. For JPEG that means dropping a frame; for
 * H.264 it means ffmpeg's stdin briefly stalls, which naturally
 * propagates upstream without breaking the GOP.
 */

const BUFFER_HIGH_WATERMARK = 4 * 1024 * 1024; // 4 MB

/** 1-byte tag added in front of every binary frame in H.264 mode. */
const H264_TAG_INIT = 0x00;
const H264_TAG_MEDIA = 0x01;

export type QualityPreset = "performance" | "balanced" | "quality";

export type CodecChoice = "jpeg" | "h264";

export interface PreviewStreamRoute {
  projectSlug: string;
  itemSlug: string;
  port: number;
  /**
   * Quality preset selected by the user. Trades bandwidth for visual
   * fidelity / frame rate. Defaults to `balanced` when absent.
   */
  quality?: QualityPreset;
  /**
   * Wire codec selected by the client. The client capability-detects
   * `MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"')`
   * and asks for `h264` if true, `jpeg` otherwise. When absent the
   * server defaults to `jpeg` so Phase 1 clients keep working.
   */
  codec?: CodecChoice;
}

interface ScreencastSettings {
  everyNthFrame: number;
  jpegQuality: number;
  /** Target encoder bitrate when streaming H.264. Ignored for JPEG. */
  bitrateKbps: number;
}

/**
 * Quality presets — each is one (frame-rate, JPEG-quality, H.264
 * bitrate) tuple. DSF=2 doubles bytes per frame relative to DSF=1, so
 * the bandwidth targets below already account for it.
 *
 *   JPEG codec:
 *     performance: ~0.6–1 MB/s, mobile / slow links
 *     balanced  : ~1.5–2 MB/s, default for most home connections
 *     quality   : ~3–5 MB/s, LAN / fiber for smooth animation
 *
 *   H.264 codec (after warmup, on a typical animated page):
 *     performance: ~800 kbps target
 *     balanced  : ~2 Mbps target
 *     quality   : ~5 Mbps target
 *   (Static-page steady state is much lower because P-frames carry
 *   nothing — that's the entire reason for switching to H.264.)
 */
const QUALITY_PRESETS: Record<QualityPreset, ScreencastSettings> = {
  performance: { everyNthFrame: 6, jpegQuality: 70, bitrateKbps: 800 },
  balanced: { everyNthFrame: 4, jpegQuality: 82, bitrateKbps: 2000 },
  quality: { everyNthFrame: 2, jpegQuality: 92, bitrateKbps: 5000 },
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

/** Frames per second targeted by the H.264 encoder. Mirrors the
 *  GOP cadence in `h264-encoder.ts` (one keyframe every 2 s). */
const H264_FPS = 30;

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
  let encoder: H264Encoder | null = null;
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
    if (encoder) {
      try {
        await encoder.stop();
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

  const { everyNthFrame, jpegQuality, bitrateKbps } = resolveQuality(route.quality);
  const codec: CodecChoice = route.codec ?? "jpeg";
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };

  // For H.264 we spawn ffmpeg first so its segment handler is wired
  // before the first PNG arrives — otherwise we could lose the init
  // segment. The encoder dimensions match the page's device pixels
  // (viewport × DSF) since that's what CDP screencast emits.
  if (codec === "h264") {
    const dsf = 2; // mirrors chromium-pool's deviceScaleFactor
    encoder = new H264Encoder({
      width: viewport.width * dsf,
      height: viewport.height * dsf,
      fps: H264_FPS,
      bitrateKbps,
    });
    encoder.on("segment", (seg: SegmentEvent) => {
      if (closed || ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > BUFFER_HIGH_WATERMARK) {
        // Don't drop the segment — dropping a P-frame poisons the
        // GOP. Backpressure is applied upstream (we skip CDP acks),
        // so this branch only fires when bufferedAmount briefly
        // overshoots before the PNG path notices. Send anyway.
      }
      const tag = seg.kind === "init" ? H264_TAG_INIT : H264_TAG_MEDIA;
      const framed = Buffer.allocUnsafe(seg.data.length + 1);
      framed[0] = tag;
      seg.data.copy(framed, 1);
      try {
        ws.send(framed, { binary: true });
      } catch {
        /* socket closing */
      }
    });
    encoder.on("failed", (msg: string) => {
      sendJson({ type: "error", code: "encoder_failed", message: msg });
      void tearDown();
    });
    encoder.start();
  }

  try {
    screencast = await startScreencast(page, {
      // PNG is lossless — fed straight into ffmpeg via sharp's raw
      // RGB24 decode. JPEG path keeps Phase 1's pipeline unchanged.
      format: codec === "h264" ? "png" : "jpeg",
      quality: jpegQuality,
      // Bumped for DSF=2: a 1440×900 viewport at DSF=2 produces a
      // 2880×1800 bitmap. CDP clamps to maxWidth/maxHeight, so we
      // need headroom for HiDPI rendering at typical desktop sizes.
      maxWidth: 3200,
      maxHeight: 2000,
      // H.264 wants every frame so the encoder can decide what to
      // drop based on motion. JPEG's everyNthFrame is the only
      // throttle there, so we keep it.
      everyNthFrame: codec === "h264" ? 1 : everyNthFrame,
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

  sendJson({
    type: "ready",
    deviceWidth: viewport.width,
    deviceHeight: viewport.height,
    codec,
    screencast: {
      format: codec === "h264" ? "h264" : "jpeg",
      maxFps: codec === "h264" ? H264_FPS : 10,
    },
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

  if (codec === "h264" && encoder) {
    const enc = encoder;
    screencast.onFrame((frame) => {
      if (closed || ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > BUFFER_HIGH_WATERMARK) {
        // Skip ack so CDP pauses; skip pushing to the encoder so its
        // stdin doesn't queue a frame that's already stale by the
        // time the network catches up. The encoder's watchdog tolerates
        // brief gaps (5 s) so a flicker of overflow is harmless.
        return;
      }
      void (async () => {
        try {
          const decoded = await decodePngToRgb24(frame.data);
          await enc.pushFrame(decoded.data);
        } catch {
          // PNG decode + ffmpeg push are best-effort — a corrupt frame
          // shouldn't kill the stream. Drop and continue.
        }
        void frame.ack();
      })();
    });
  } else {
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
  }

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
