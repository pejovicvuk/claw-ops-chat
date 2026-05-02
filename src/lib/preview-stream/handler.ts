import type { WebSocket } from "ws";
import { acquirePage, type AcquiredPage } from "./chromium-pool";
import { startScreencast, type Screencast } from "./cdp-screencast";
import { H264Encoder, type SegmentEvent, type AudioMuxOptions } from "./h264-encoder";
import { AudioCapture } from "./audio-capture";
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
 *                     0x02 = reset marker (empty payload) — client must
 *                            tear down its MediaSource and rebuild
 *
 * Client → server:
 *   - text JSON `{type: "mouse" | "wheel" | "key" | "resize" | "reload" | "navigate", ...}`
 *
 * Backpressure (both codecs): before consuming the next CDP frame we
 * check ws.bufferedAmount; if it's over BUFFER_SOFT_WATERMARK we skip
 * the `Page.screencastFrameAck` (so CDP pauses) AND skip handing the
 * frame to the codec layer. For JPEG that means dropping a frame; for
 * H.264 it means ffmpeg's stdin briefly stalls, which naturally
 * propagates upstream without breaking the GOP. If bufferedAmount blows
 * past BUFFER_HARD_CEILING (H.264 only), we restart the encoder + send
 * a reset marker to recover from a stuck client.
 */

const BUFFER_SOFT_WATERMARK = 4 * 1024 * 1024; // 4 MB — pause CDP acks
const BUFFER_HARD_CEILING = 16 * 1024 * 1024; // 16 MB — full encoder restart

/** Debounce window for resize events. Drag bursts are common. */
const RESIZE_DEBOUNCE_MS = 150;

/** 1-byte tag added in front of every binary frame in H.264 mode. */
const H264_TAG_INIT = 0x00;
const H264_TAG_MEDIA = 0x01;
const H264_TAG_RESET = 0x02;

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

/** Phase 3a (#126): audio mux defaults. 48 kHz stereo PCM in, 64 kbps
 *  Opus out. Matches what realtime communication apps (Discord, Meet)
 *  use for voice + content audio. Bandwidth cost is trivial vs. video. */
const AUDIO_MUX: AudioMuxOptions = {
  sampleRate: 48_000,
  channels: 2,
  bitrateKbps: 64,
};

function audioEnabled(): boolean {
  return process.env.PREVIEW_AUDIO !== "disabled";
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
  let encoder: H264Encoder | null = null;
  let audio: AudioCapture | null = null;
  let resizeTimer: NodeJS.Timeout | null = null;
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
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    if (screencast) {
      try {
        await screencast.stop();
      } catch {
        /* ignore */
      }
    }
    if (audio) {
      try {
        await audio.stop();
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
  const initialViewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const dsf = 2; // mirrors chromium-pool's deviceScaleFactor

  /**
   * Send a 1-byte tag with optional payload as a binary WS frame.
   * Used for H.264 init / media / reset envelopes.
   */
  const sendTagged = (tag: number, payload?: Buffer): void => {
    if (closed || ws.readyState !== ws.OPEN) return;
    const framed =
      payload && payload.length > 0 ? Buffer.concat([Buffer.from([tag]), payload]) : Buffer.from([tag]);
    try {
      ws.send(framed, { binary: true });
    } catch {
      /* socket closing */
    }
  };

  /**
   * Wire the encoder's segment + failure events to the WS. Called
   * once per encoder spawn (initial bring-up + every restart).
   */
  const wireEncoderEvents = (enc: H264Encoder): void => {
    enc.on("segment", (seg: SegmentEvent) => {
      if (closed || ws.readyState !== ws.OPEN) return;
      const tag = seg.kind === "init" ? H264_TAG_INIT : H264_TAG_MEDIA;
      sendTagged(tag, seg.data);
    });
    enc.on("failed", (msg: string) => {
      sendJson({ type: "error", code: "encoder_failed", message: msg });
      void tearDown();
    });
  };

  // Audio is opt-out via env (PREVIEW_AUDIO=disabled). The encoder
  // dimensions don't change between video and video+audio, but the
  // ffmpeg argv does, so the encoder needs to know up front.
  const useAudio = audioEnabled();

  /**
   * Spawn a fresh encoder + screencast (+ optional audio capture)
   * sized to the current viewport. Returns the new screencast so the
   * caller can wire its onFrame handler. Audio is started inside this
   * helper so resize / hard-ceiling reset paths automatically respawn
   * `parec` alongside ffmpeg in lockstep.
   */
  const bringUpH264 = async (): Promise<Screencast> => {
    const vp = page.viewportSize() ?? initialViewport;
    encoder = new H264Encoder({
      width: vp.width * dsf,
      height: vp.height * dsf,
      fps: H264_FPS,
      bitrateKbps,
      audio: useAudio ? AUDIO_MUX : null,
    });
    wireEncoderEvents(encoder);
    encoder.start();

    if (useAudio) {
      audio = new AudioCapture({
        sampleRate: AUDIO_MUX.sampleRate,
        channels: AUDIO_MUX.channels,
        clientName: `preview-${route.projectSlug}-${route.itemSlug}-${route.port}`,
      });
      audio.on("warn", (msg: string) => {
        // parec error messages — log but don't fail the stream.
        // ffmpeg will emit silence-substitute and the JPEG fallback
        // already covers Safari (which gets silent video anyway).
        sendJson({ type: "status", state: "audio_warn", message: msg });
      });
      audio.on("exit", (info: { code: number | null; signal: string | null }) => {
        // parec died unexpectedly. Log; encoder keeps producing video.
        sendJson({
          type: "status",
          state: "audio_exit",
          message: `parec exited code=${info.code ?? "null"} signal=${info.signal ?? "null"}`,
        });
      });
      try {
        const pcm = audio.start();
        const fd3 = encoder.audioStdin();
        if (fd3) {
          // Kernel-level backpressure: parec pauses pulse reads when
          // its stdout blocks; ffmpeg drains as fast as it can.
          pcm.pipe(fd3, { end: false });
          pcm.on("error", () => {
            /* parec disconnect — exit handler logs */
          });
        }
      } catch {
        // parec spawn failed (binary missing, permission denied).
        // Drop audio for this connection; video continues normally.
        audio = null;
      }
    }

    return startScreencast(page, {
      format: "png",
      maxWidth: 3200,
      maxHeight: 2000,
      // H.264 wants every frame so the encoder can decide what to
      // drop based on motion. JPEG's everyNthFrame is the only
      // throttle there, so we keep it for that path.
      everyNthFrame: 1,
    });
  };

  // For H.264 we spawn ffmpeg + screencast together. Encoder dimensions
  // track viewport × DSF since that's what CDP screencast emits.
  if (codec === "h264") {
    try {
      screencast = await bringUpH264();
    } catch (err) {
      sendJson({
        type: "error",
        code: "page_crashed",
        message: err instanceof Error ? err.message : "Screencast failed to start",
      });
      void tearDown();
      return;
    }
  } else {
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
  }

  sendJson({
    type: "ready",
    deviceWidth: initialViewport.width,
    deviceHeight: initialViewport.height,
    codec,
    // Phase 3a: tell the client whether the H.264 stream carries an
    // Opus audio track. Drives the mute UI's visibility — there's no
    // point showing a speaker icon when the stream is silent video.
    audio: codec === "h264" && useAudio,
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

  /**
   * Wire `screencast.onFrame` for the current screencast object.
   * Re-called after every H.264 restart with the freshly-spawned
   * screencast.
   */
  const wireScreencastFrames = (sc: Screencast): void => {
    if (codec === "h264") {
      sc.onFrame((frame) => {
        if (closed || ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > BUFFER_HARD_CEILING) {
          // Hard ceiling — client is stuck or absurdly slow. Skip the
          // ack (CDP pauses) and trigger a full pipeline reset to
          // recover with a fresh keyframe. Without this an infinitely
          // backed-up bufferedAmount would never drain.
          void restartH264Pipeline("hard_ceiling");
          return;
        }
        if (ws.bufferedAmount > BUFFER_SOFT_WATERMARK) {
          // Skip ack so CDP pauses; skip pushing to the encoder so its
          // stdin doesn't queue a frame that's already stale by the
          // time the network catches up. The encoder's watchdog
          // tolerates brief gaps (5 s) so a flicker of overflow is
          // harmless.
          return;
        }
        const enc = encoder;
        if (!enc) return;
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
      sc.onFrame((frame) => {
        if (closed || ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > BUFFER_SOFT_WATERMARK) {
          // Drop frame + skip ack — CDP pauses until we ack the next
          // one.
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
  };

  /**
   * Replace the live screencast + encoder pair with a fresh one,
   * sending a `[0x02]` reset to the client so it rebuilds its
   * MediaSource. Used for both viewport resize (ffmpeg's `-s WxH` is
   * fixed at spawn) and the hard-ceiling backpressure recovery.
   * Concurrent calls are coalesced via `restartPending`.
   */
  let restartPending = false;
  const restartH264Pipeline = async (reason: string): Promise<void> => {
    if (codec !== "h264" || closed || restartPending) return;
    restartPending = true;
    try {
      sendTagged(H264_TAG_RESET);
      sendJson({ type: "status", state: "restarting", reason });
      const oldScreencast = screencast;
      const oldEncoder = encoder;
      const oldAudio = audio;
      screencast = null;
      encoder = null;
      audio = null;
      if (oldScreencast) {
        try {
          await oldScreencast.stop();
        } catch {
          /* ignore */
        }
      }
      // Stop audio BEFORE encoder so parec stops trying to write into
      // a soon-to-be-closed pipe. parec's ~50 ms shutdown is part of
      // the resize freeze budget and is imperceptible.
      if (oldAudio) {
        try {
          await oldAudio.stop();
        } catch {
          /* ignore */
        }
      }
      if (oldEncoder) {
        try {
          await oldEncoder.stop();
        } catch {
          /* ignore */
        }
      }
      if (closed) return;
      try {
        screencast = await bringUpH264();
        wireScreencastFrames(screencast);
        sendJson({ type: "status", state: "ready" });
      } catch (err) {
        sendJson({
          type: "error",
          code: "encoder_failed",
          message: err instanceof Error ? err.message : "H.264 restart failed",
        });
        void tearDown();
      }
    } finally {
      restartPending = false;
    }
  };

  wireScreencastFrames(screencast);

  // Resize debounce. Drag bursts produce dozens of resize messages per
  // second; we want the *last* one. JPEG mode applies viewport changes
  // immediately because the screencast doesn't care. H.264 mode batches
  // because every change forces a pipeline restart. `resizeTimer` is
  // hoisted to the function top so tearDown can clear it.
  let pendingResize: ResizeEvent | null = null;

  const onResize = (evt: ResizeEvent): void => {
    if (codec !== "h264") {
      // JPEG: setViewportSize directly, no restart needed.
      void forwardResize(page, evt).catch(() => {
        /* ignore — page may be closing */
      });
      return;
    }
    pendingResize = evt;
    if (resizeTimer) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      const next = pendingResize;
      pendingResize = null;
      if (!next) return;
      void (async () => {
        try {
          await forwardResize(page, next);
        } catch {
          /* ignore */
        }
        await restartH264Pipeline("resize");
      })();
    }, RESIZE_DEBOUNCE_MS);
  };

  ws.on("message", (raw) => {
    if (closed) return;
    let parsed: ClientFrame;
    try {
      parsed = JSON.parse(raw.toString()) as ClientFrame;
    } catch {
      return;
    }
    void dispatchClientFrame(parsed, screencast, page, route, sendJson, onResize);
  });
}

async function dispatchClientFrame(
  frame: ClientFrame,
  screencast: Screencast | null,
  page: AcquiredPage["page"],
  route: PreviewStreamRoute,
  sendJson: (payload: Record<string, unknown>) => void,
  onResize: (evt: ResizeEvent) => void,
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
        // Codec-aware resize: H.264 must restart the encoder; JPEG
        // can apply the viewport change in place.
        onResize(frame as unknown as ResizeEvent);
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
