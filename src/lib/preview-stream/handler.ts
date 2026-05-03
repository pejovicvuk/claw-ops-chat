import type { WebSocket } from "ws";
import { acquirePage, type AcquiredPage } from "./chromium-pool";
import { startScreencast, type Screencast } from "./cdp-screencast";
import { H264Encoder, type SegmentEvent, type AudioMuxOptions } from "./h264-encoder";
import { AudioCapture } from "./audio-capture";
import { decodePngToRgb24 } from "./png-decoder";
import {
  CLIPBOARD_BINDING_NAME,
  buildInjectedClipboardScript,
  validateClipboardPayload,
} from "./clipboard-bridge";
import {
  DROP_DISPATCH_BINDING,
  DROP_FETCH_BYTES_BINDING,
  appendChunk,
  buildInjectedFileDropScript,
  cancelDrop,
  closeDrop,
  openDrop,
  scheduleCleanup,
  validateFileDropStart,
  validateUuid,
  type DropEntry,
} from "./file-drop";
import {
  MAX_CONCURRENT_PER_WS as MAX_DOWNLOADS_PER_WS,
  MAX_DOWNLOAD_BYTES,
  MAX_TOTAL_DOWNLOAD_BYTES,
  cancelDownload,
  currentTotalDownloadBytes,
  registerDownload,
} from "./download-relay";
import { readFile, stat as fsStat, unlink as fsUnlink } from "node:fs/promises";
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
import { HistoryStateDeduper, computeHistoryState, type NavigationHistory } from "./history-state";
import { buildFindScript, normalizeQuery } from "./find-in-page";

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

/** Phase 3c (#128): client → server tag carrying file-drop chunks.
 *  Frame layout: [0x10][16-byte UTF-8 dropId truncated/padded][chunk bytes].
 *  Actually we let the dropId be variable-length: a 1-byte length prefix
 *  follows the tag, then the dropId UTF-8 bytes, then the chunk. Keeps
 *  the protocol robust to UUID-format changes. */
const FILE_DROP_TAG_CHUNK = 0x10;

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
  // Phase 3c (#128): in-flight file-drop state. Keyed by dropId.
  // Survives until the per-drop ttl timer fires OR the WS closes.
  const drops: Map<string, DropEntry> = new Map();
  // Phase 3d (#129): per-WS ownership of in-flight download ids. The
  // global registry in download-relay.ts holds the entries; this Set
  // exists so tearDown can cancel just our downloads (not other WS's).
  const ownedDownloadIds: Set<string> = new Set();

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
    // Phase 3c: cancel any in-flight file uploads. Closes the write
    // streams + unlinks the temp files. Run BEFORE acquired.release
    // so we don't lose dropIds when the context dies.
    for (const dropId of Array.from(drops.keys())) {
      try {
        await cancelDrop(drops, dropId);
      } catch {
        /* ignore */
      }
    }
    // Phase 3d: cancel our owned downloads. Each call cancel()s the
    // underlying Playwright Download (if still in flight) + unlinks
    // the temp file. The user can no longer GET the file post-WS-close,
    // so keeping it on disk would just leak.
    for (const downloadId of Array.from(ownedDownloadIds)) {
      try {
        await cancelDownload(downloadId);
      } catch {
        /* ignore */
      }
    }
    ownedDownloadIds.clear();
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
    acquired = await acquirePage(route.port, {
      // Phase 3b (#127): wire the clipboard bridge BEFORE the first
      // navigation so the inject script lands ahead of page scripts.
      // Bound at the BrowserContext level so all frames (iframes,
      // post-reload documents) inherit both the binding + hook.
      beforeNavigate: async (_page, context) => {
        // Clipboard bridge (Phase 3b).
        await context.exposeBinding(CLIPBOARD_BINDING_NAME, async (_source, raw) => {
          if (closed) return;
          const validated = validateClipboardPayload(raw);
          if (!validated.ok || !validated.text) return;
          sendJson({ type: "clipboard_copy", text: validated.text });
        });
        await context.addInitScript({ content: buildInjectedClipboardScript() });

        // File-drop bridge (Phase 3c). The page-side script defines
        // window.__clawDispatchDrop; the binding here returns the
        // base64-encoded bytes for a given dropId so the page can
        // reconstruct a File and dispatch a synthetic drop. Bytes
        // are read from disk per-call — the temp file may have been
        // unlinked already if delivery is slow, in which case we
        // return an empty string (page treats as failure).
        await context.exposeBinding(DROP_FETCH_BYTES_BINDING, async (_source, raw) => {
          if (closed) return "";
          if (!validateUuid(raw)) return "";
          const entry = drops.get(raw as string);
          if (!entry) return "";
          try {
            const buf = await readFile(entry.path);
            return buf.toString("base64");
          } catch {
            return "";
          }
        });
        await context.addInitScript({ content: buildInjectedFileDropScript() });
      },
    });
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

  // Phase 3d (#129): file download relay. When the previewed page
  // triggers a download (<a download>, Content-Disposition: attachment,
  // page.evaluate("a.click()"), etc.), Playwright fires "download"
  // AFTER the bytes are saved to DOWNLOAD_DIR. We stat the result,
  // run the per-file + total-dir + concurrent caps, then register in
  // the global download registry and emit a download_ready JSON. The
  // client (commit D) auto-creates a hidden <a download> pointing at
  // /api/preview-download/<id> (commit C) and clicks it.
  page.on("download", (download) => {
    void (async () => {
      if (closed) {
        try {
          await download.cancel();
        } catch {
          /* already done */
        }
        return;
      }
      const suggestedFilename = download.suggestedFilename();
      // Per-WS concurrent cap. A bulk-export page could trigger
      // dozens; cap protects disk + the global registry.
      if (ownedDownloadIds.size >= MAX_DOWNLOADS_PER_WS) {
        sendJson({
          type: "download_rejected",
          reason: "too_many",
          filename: suggestedFilename,
        });
        try {
          await download.cancel();
        } catch {
          /* ignore */
        }
        return;
      }
      // Total-dir cap — walk DOWNLOAD_DIR before we accept the new
      // file. Slightly racy under concurrent downloads but the worst
      // case is a small overage that the next reject corrects.
      const currentTotal = await currentTotalDownloadBytes();
      if (currentTotal >= MAX_TOTAL_DOWNLOAD_BYTES) {
        sendJson({
          type: "download_rejected",
          reason: "disk_pressure",
          filename: suggestedFilename,
        });
        try {
          await download.cancel();
        } catch {
          /* ignore */
        }
        return;
      }
      let path: string | null = null;
      try {
        // download.path() resolves once Chromium has fully written
        // the file to disk (under DOWNLOAD_DIR via context option).
        path = await download.path();
      } catch (err) {
        sendJson({
          type: "download_failed",
          id: "unknown",
          message: err instanceof Error ? err.message : "download.path failed",
        });
        return;
      }
      if (!path) {
        sendJson({
          type: "download_failed",
          id: "unknown",
          message: "download.path() returned null",
        });
        return;
      }
      let size = 0;
      try {
        const s = await fsStat(path);
        size = s.size;
      } catch {
        sendJson({
          type: "download_failed",
          id: "unknown",
          message: "could not stat downloaded file",
        });
        return;
      }
      // Per-file cap — enforced after the fact since Content-Length
      // isn't always present on the download trigger. Oversized files
      // are unlinked and reported.
      if (size > MAX_DOWNLOAD_BYTES) {
        try {
          await fsUnlink(path);
        } catch {
          /* ignore */
        }
        try {
          await download.delete();
        } catch {
          /* ignore */
        }
        sendJson({
          type: "download_rejected",
          reason: "too_large",
          filename: suggestedFilename,
        });
        return;
      }
      const entry = registerDownload({
        path,
        suggestedFilename,
        size,
        actorEmail,
        handle: download,
      });
      ownedDownloadIds.add(entry.id);
      sendJson({
        type: "download_ready",
        id: entry.id,
        filename: suggestedFilename,
        size,
      });
    })();
  });

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
      payload && payload.length > 0
        ? Buffer.concat([Buffer.from([tag]), payload])
        : Buffer.from([tag]);
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
  const historyDedup = new HistoryStateDeduper();

  /**
   * Phase 5a (#131): query CDP for the current navigation history and
   * emit `history_state` when the (canGoBack, canGoForward) shape
   * changes. Wired into `framenavigated` so the client buttons stay
   * in sync with what Chromium actually has — covers both in-app
   * link clicks and `history.pushState`. Dedup logic lives in
   * `history-state.ts` for unit-test coverage.
   */
  const emitHistoryState = async (): Promise<void> => {
    const session = screencast?.session;
    if (!session) return;
    try {
      // `Page.getNavigationHistory` is a real CDP method but isn't in
      // Playwright's typed command map. Cast through `unknown` to a
      // string-keyed sender — the runtime call is identical.
      const rawSend = (session as unknown as { send: (m: string) => Promise<unknown> }).send.bind(
        session,
      );
      const hist = (await rawSend("Page.getNavigationHistory")) as NavigationHistory;
      const next = historyDedup.shouldEmit(computeHistoryState(hist));
      if (!next) return;
      sendJson({ type: "history_state", ...next });
    } catch {
      /* CDP errors are non-fatal — history state is best-effort */
    }
  };

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
    if (path !== lastSentPath) {
      lastSentPath = path;
      sendJson({ type: "url_changed", path });
    }
    // Forward → back can land on a previously-visited URL with the
    // SAME path but a DIFFERENT history shape, so always check —
    // dedup happens inside emitHistoryState before sending.
    void emitHistoryState();
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

  /**
   * Phase 3c (#128): handle a binary file-drop chunk frame.
   * Layout: [tag(1)][dropIdLen(1)][dropId(N)][chunk bytes]
   */
  const handleFileDropChunk = (buf: Buffer): void => {
    if (closed) return;
    if (buf.length < 2) return;
    const dropIdLen = buf[1];
    if (buf.length < 2 + dropIdLen) return;
    const dropId = buf.subarray(2, 2 + dropIdLen).toString("utf8");
    const chunk = buf.subarray(2 + dropIdLen);
    if (!validateUuid(dropId)) return;
    const entry = drops.get(dropId);
    if (!entry) return;
    if (!appendChunk(entry, chunk)) {
      // Cap exceeded — mid-stream lying header. Tear down + notify.
      void cancelDrop(drops, dropId);
      sendJson({
        type: "file_drop_error",
        dropId,
        code: "size_too_large",
        message: `Upload exceeded ${50}MB cap`,
      });
    }
  };

  ws.on("message", (raw, isBinary) => {
    if (closed) return;
    if (isBinary && Buffer.isBuffer(raw)) {
      // Today only file-drop chunks are client → server binary frames.
      // Tag dispatch keeps the door open for future tag types.
      if (raw.length < 1) return;
      const tag = raw[0];
      if (tag === FILE_DROP_TAG_CHUNK) {
        handleFileDropChunk(raw);
      }
      // Unknown tag — silently drop. Forward-compat: older servers
      // tolerate newer client tags by ignoring.
      return;
    }
    let parsed: ClientFrame;
    try {
      parsed = JSON.parse(raw.toString()) as ClientFrame;
    } catch {
      return;
    }
    void dispatchClientFrame(parsed, screencast, page, route, sendJson, onResize, drops);
  });
}

async function dispatchClientFrame(
  frame: ClientFrame,
  screencast: Screencast | null,
  page: AcquiredPage["page"],
  route: PreviewStreamRoute,
  sendJson: (payload: Record<string, unknown>) => void,
  onResize: (evt: ResizeEvent) => void,
  drops: Map<string, DropEntry>,
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
      case "clipboard_paste": {
        // Phase 3b (#127): user pressed Ctrl+V on the preview element.
        // page.keyboard.insertText handles focused-frame routing — if
        // the focus is in an iframe inside the previewed app, CDP
        // dispatches into that frame for us. Falls back to a no-op
        // when nothing is focused.
        const validated = validateClipboardPayload((frame as { text?: unknown }).text);
        if (!validated.ok || !validated.text) return;
        await page.keyboard.insertText(validated.text);
        return;
      }
      case "file_drop_start": {
        // Phase 3c (#128): client opens a file upload. Validate the
        // header, open a write stream, ack so the client can start
        // sending binary chunks. Actual CDP delivery happens on
        // file_drop_end (commit C).
        const validated = validateFileDropStart(frame);
        if (!validated.ok || !validated.start) {
          sendJson({
            type: "file_drop_error",
            dropId: (frame as { dropId?: unknown }).dropId,
            code: validated.reason ?? "invalid",
            message: `file_drop_start rejected: ${validated.reason ?? "invalid"}`,
          });
          return;
        }
        try {
          await openDrop(drops, validated.start);
          sendJson({ type: "file_drop_ack", dropId: validated.start.dropId, ready: true });
        } catch (err) {
          sendJson({
            type: "file_drop_error",
            dropId: validated.start.dropId,
            code: "open_failed",
            message: err instanceof Error ? err.message : "could not open temp file",
          });
        }
        return;
      }
      case "file_drop_end": {
        // Close the write stream, then invoke the page-side dispatcher.
        // The page's __clawDispatchDrop walks frames to find the target
        // at (x, y), pulls the bytes via the __clawFetchDropBytes
        // binding, and either sets <input type=file>.files or
        // synthesizes a dragenter/dragover/drop sequence.
        const dropId = (frame as { dropId?: unknown }).dropId;
        if (!validateUuid(dropId)) return;
        const entry = drops.get(dropId as string);
        if (!entry) return;
        try {
          await closeDrop(entry);
        } catch {
          sendJson({
            type: "file_drop_error",
            dropId,
            code: "close_failed",
            message: "could not close temp file",
          });
          scheduleCleanup(drops, entry);
          return;
        }
        try {
          // Cast the result as a structured response from the injected
          // dispatcher. Playwright serializes via structured clone so
          // returning `{ok, target, reason?}` round-trips fine.
          interface DispatchResult {
            ok: boolean;
            target?: string;
            reason?: string;
          }
          const result: DispatchResult = await page.evaluate(
            async ({
              bindingName,
              req,
            }: {
              bindingName: string;
              req: Record<string, unknown>;
            }): Promise<DispatchResult> => {
              const w = window as unknown as Record<string, unknown>;
              const fn = w[bindingName] as ((r: unknown) => Promise<DispatchResult>) | undefined;
              if (typeof fn !== "function") {
                return { ok: false, reason: "binding_missing" };
              }
              return fn(req);
            },
            {
              bindingName: DROP_DISPATCH_BINDING,
              req: {
                dropId: entry.start.dropId,
                filename: entry.start.filename,
                mimeType: entry.start.mimeType,
                x: entry.start.x,
                y: entry.start.y,
              },
            },
          );
          if (result.ok) {
            sendJson({
              type: "file_drop_done",
              dropId,
              target: result.target ?? "unknown",
            });
          } else {
            sendJson({
              type: "file_drop_error",
              dropId,
              code: result.reason ?? "dispatch_failed",
              message: `dispatch failed: ${result.reason ?? "unknown"}`,
            });
          }
        } catch (err) {
          sendJson({
            type: "file_drop_error",
            dropId,
            code: "evaluate_failed",
            message: err instanceof Error ? err.message : "page evaluate threw",
          });
        } finally {
          scheduleCleanup(drops, entry);
        }
        return;
      }
      case "reload":
        sendJson({ type: "status", state: "navigating" });
        await page.goto(`http://127.0.0.1:${route.port}/`, {
          waitUntil: "domcontentloaded",
          timeout: 10_000,
        });
        sendJson({ type: "status", state: "ready" });
        return;
      case "go_back":
        // Phase 5a (#131): Playwright's typed wrapper around the CDP
        // Page.goBack call. Returns null when there's no history —
        // the framenavigated listener re-emits history_state once the
        // (possibly identical) URL settles, so the client's button
        // states stay coherent.
        try {
          await page.goBack({ timeout: 10_000 });
        } catch {
          /* no history or timeout — silently ignore */
        }
        return;
      case "go_forward":
        try {
          await page.goForward({ timeout: 10_000 });
        } catch {
          /* no forward history or timeout — silently ignore */
        }
        return;
      case "set_zoom": {
        // Phase 5b (#132): page-zoom shortcut. CDP
        // `Emulation.setPageScaleFactor` accepts the factor directly —
        // 1.0 = 100%. Validate the range here too (defense in depth;
        // the client clamps via `zoom-steps.ts` already).
        const factor = Number((frame as { factor?: unknown }).factor);
        if (!Number.isFinite(factor) || factor < 0.25 || factor > 5) return;
        try {
          // Not in Playwright's typed CDP map — cast through a string-
          // keyed sender. Same pattern as Page.getNavigationHistory.
          const rawSend = (
            session as unknown as {
              send: (m: string, p?: unknown) => Promise<unknown>;
            }
          ).send.bind(session);
          await rawSend("Emulation.setPageScaleFactor", { pageScaleFactor: factor });
        } catch {
          /* CDP errors non-fatal — zoom is best-effort */
        }
        return;
      }
      case "find_open":
      case "find_query":
      case "find_next":
      case "find_prev":
      case "find_close": {
        // Phase 5c (#133): in-page find. The injected script is
        // idempotent so we can call it on every find_* without paying
        // the install cost twice — the IIFE early-returns if
        // window.__clawFind already exists.
        try {
          await page.evaluate(buildFindScript());
          const action = frame.type;
          const rawQuery =
            action === "find_open" || action === "find_query"
              ? normalizeQuery(String((frame as { query?: unknown }).query ?? ""))
              : "";
          const result = (await page.evaluate(
            ({ method, query }: { method: string; query: string }) => {
              const ctrl = (
                window as unknown as {
                  __clawFind?: {
                    open: (q: string) => { count: number; currentIndex: number };
                    next: () => { count: number; currentIndex: number };
                    prev: () => { count: number; currentIndex: number };
                    close: () => { count: number; currentIndex: number };
                  };
                }
              ).__clawFind;
              if (!ctrl) return { count: 0, currentIndex: -1 };
              if (method === "open" || method === "query") return ctrl.open(query);
              if (method === "next") return ctrl.next();
              if (method === "prev") return ctrl.prev();
              return ctrl.close();
            },
            {
              method:
                action === "find_open"
                  ? "open"
                  : action === "find_query"
                    ? "query"
                    : action === "find_next"
                      ? "next"
                      : action === "find_prev"
                        ? "prev"
                        : "close",
              query: rawQuery,
            },
          )) as { count: number; currentIndex: number };
          sendJson({
            type: "find_state",
            query: rawQuery,
            count: result.count,
            currentIndex: result.currentIndex,
          });
        } catch {
          /* find is best-effort — a transient evaluate failure shouldn't
             kill the stream. The client still sees its own optimistic
             findState until the next server frame. */
        }
        return;
      }
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
