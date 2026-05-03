"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modifiers } from "./input-forward";
import { validateClipboardPayload } from "./clipboard-bridge";
import { toast } from "@/lib/use-toast";

// Phase 3c (#128): MUST stay in sync with file-drop.ts. Inlined here
// rather than imported because file-drop.ts pulls in node:fs and
// safe-path.ts which can't run in a browser bundle.
const MAX_DROP_BYTES = 50 * 1024 * 1024;
const DROP_CHUNK_SIZE = 64 * 1024;
const FILE_DROP_TAG_CHUNK = 0x10;

/**
 * Client-side hook driving the preview stream. Two decode paths share
 * the same WebSocket lifecycle and input forwarding:
 *
 *   - **H.264** (default when `MediaSource.isTypeSupported("video/mp4;
 *     codecs=\"avc1.42E01E\"")` is true): incoming binary frames are
 *     1-byte tagged. 0x00 = init segment (ftyp+moov), 0x01 = media
 *     segment (moof+mdat). Both feed `MediaSource` → `<video>`.
 *   - **JPEG** (Phase 1 fallback): raw JPEG bytes drawn onto a
 *     `<canvas>` via `createImageBitmap` + `drawImage`. Used when MSE
 *     is unavailable or when the H.264 path errors at runtime.
 *
 * Capability detection runs on first connect. If H.264 fails after
 * connect (`SourceBuffer.error`, `appendBuffer` throws something other
 * than QuotaExceededError, etc.), the hook flips a sticky failure flag,
 * closes the WS, and reconnects with `?codec=jpeg` — the next reload
 * starts fresh.
 *
 * One hook instance per PreviewWindow. Driven entirely by the
 * `enabled` flag — when the dev server isn't running, we don't open
 * the WS at all.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
const MOUSEMOVE_MIN_INTERVAL_MS = 16; // ~60fps
// H.264 baseline 3.0. Phase 3a (#126) prefers the audio variant
// (`avc1+opus`) when MSE supports it — the server muxes Opus audio
// into the same fragmented MP4 so we keep one SourceBuffer.
const MSE_CODEC_VIDEO = 'video/mp4; codecs="avc1.42E01E"';
const MSE_CODEC_VIDEO_AUDIO = 'video/mp4; codecs="avc1.42E01E,opus"';
const MSE_BUFFER_TARGET_S = 10; // evict everything older than this

export type PreviewStreamStatus = "idle" | "connecting" | "ready" | "error" | "closed";

export type QualityPreset = "performance" | "balanced" | "quality";

/**
 * `"video-rtc"` — Phase 4 (#130) WebRTC transport. The remote
 *   MediaStream attaches to the same `<video>` element used by MSE,
 *   so the consumer surface is `videoRef` for both modes.
 * `"video"` — Phase 2 H.264/MSE fallback.
 * `"canvas"` — Phase 1 JPEG fallback.
 */
export type PreviewStreamMode = "video-rtc" | "video" | "canvas";

/**
 * Phase 4 (#130): default ICE servers used as a last-resort fallback
 * if `/api/preview/rtc-config` is unreachable. Production deployments
 * configure WEBRTC_TURN_URL / WEBRTC_TURN_USERNAME / WEBRTC_TURN_PASSWORD
 * server-side and the endpoint returns those — see
 * `src/lib/preview-stream/webrtc-config.ts`.
 */
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

/**
 * Phase 4 (#130): default time we wait for
 * `RTCPeerConnection.connectionState` to reach `connected` before
 * flipping sticky-RTC-failure and falling through to MSE. The
 * server-side `/api/preview/rtc-config` may override this via
 * WEBRTC_CONNECT_TIMEOUT_MS.
 */
const FALLBACK_CONNECT_TIMEOUT_MS = 5_000;

interface FetchedRtcConfig {
  iceServers: RTCIceServer[];
  connectTimeoutMs: number;
}

/**
 * Phase 4 hardening: fire-and-forget metric beacon. The server tracks
 * `fallback_to_mse` and `ice_restart` for ops visibility; both happen
 * in the browser only, so the hook posts to /api/preview/metrics-report
 * when they occur. Failures are swallowed — observability MUST NOT
 * affect the user's preview path.
 */
function reportMetric(event: "fallback_to_mse" | "ice_restart"): void {
  try {
    void fetch(`${BASE_PATH}/api/preview/metrics-report`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

async function fetchRtcConfig(): Promise<FetchedRtcConfig> {
  try {
    const res = await fetch(`${BASE_PATH}/api/preview/rtc-config`, {
      credentials: "include",
    });
    if (!res.ok) {
      return {
        iceServers: FALLBACK_ICE_SERVERS,
        connectTimeoutMs: FALLBACK_CONNECT_TIMEOUT_MS,
      };
    }
    const cfg = (await res.json()) as Partial<FetchedRtcConfig>;
    return {
      iceServers:
        Array.isArray(cfg.iceServers) && cfg.iceServers.length > 0
          ? cfg.iceServers
          : FALLBACK_ICE_SERVERS,
      connectTimeoutMs:
        typeof cfg.connectTimeoutMs === "number" && cfg.connectTimeoutMs > 0
          ? cfg.connectTimeoutMs
          : FALLBACK_CONNECT_TIMEOUT_MS,
    };
  } catch {
    return {
      iceServers: FALLBACK_ICE_SERVERS,
      connectTimeoutMs: FALLBACK_CONNECT_TIMEOUT_MS,
    };
  }
}

export interface UsePreviewStreamArgs {
  projectSlug: string;
  itemSlug: string;
  port: number;
  /** Used by the JPEG fallback path. May be unrendered when `mode === "video"`. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Used by the H.264 path. May be unrendered when `mode === "canvas"`. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Hook is dormant until `enabled` is true (dev server is running). */
  enabled: boolean;
  /** Streaming quality preset. Defaults to "balanced" server-side when absent. */
  quality?: QualityPreset;
  /**
   * Phase 3a (#126): user's preferred mute state. Persisted by the
   * caller (e.g. via `WindowState["preview"].muted`). Applied to the
   * `<video>` element on attach and on every reconnect. Browsers
   * block autoplay-with-sound without a gesture, so the safe initial
   * value is `true`.
   */
  muted?: boolean;
}

export interface UsePreviewStreamResult {
  status: PreviewStreamStatus;
  /**
   * Which DOM element the consumer should render. `"video"` when the
   * H.264 / MSE path is active; `"canvas"` when JPEG fallback is.
   * Driven by capability detection + sticky runtime failure.
   */
  mode: PreviewStreamMode;
  deviceWidth: number | null;
  deviceHeight: number | null;
  lastError: string | null;
  /**
   * The page's current URL path (`pathname + search + hash`). Updated
   * whenever Chromium fires `framenavigated` — covers both server-
   * dispatched `navigate` and in-app `<Link>` / `pushState`.
   * `null` until the first url_changed arrives.
   */
  currentPath: string | null;
  /**
   * Phase 3a (#126): true when the active connection is H.264 muxed
   * with Opus audio. Drives the mute-toggle UI's visibility — there's
   * no point showing a speaker icon for silent video / JPEG.
   */
  audioAvailable: boolean;
  /**
   * Phase 3c (#128): true while the user is dragging a file over the
   * preview element. Drives the blue drop-indicator overlay in
   * preview-window.tsx.
   */
  dragOver: boolean;
  /** Manually trigger a reload of the underlying Chromium page. */
  reload: () => void;
  /**
   * Navigate the previewed page to a new path. Server clamps to
   * same-origin (localhost:port) — external URLs are rejected.
   */
  navigate: (path: string) => void;
  /**
   * Phase 4 (#130): when in `video-rtc` mode, the remote MediaStream
   * received from the WebRTC peer connection. The consumer attaches
   * it to the `<video>` element via
   * `videoRef.current.srcObject = remoteStream`. `null` until tracks
   * arrive (or always when not in RTC mode).
   */
  remoteStream: MediaStream | null;
  /** Phase 4 (#130): which transport is currently active. */
  transport: "rtc" | "mse";
}

/**
 * Capability-detect MSE H.264 baseline support, with optional Opus
 * audio. Returns:
 *   "video+audio" — MSE supports `avc1+opus`. Use audio path.
 *   "video"       — MSE supports avc1 but not opus-in-mp4 (Safari).
 *                   Connect with H.264 video, no audio.
 *   "none"        — MSE not supported. Fall back to JPEG canvas.
 *
 * Wrapped in a guard so SSR doesn't crash on undefined `MediaSource`.
 */
function detectMseSupport(): "video+audio" | "video" | "none" {
  if (typeof window === "undefined") return "none";
  if (typeof window.MediaSource === "undefined") return "none";
  try {
    if (window.MediaSource.isTypeSupported(MSE_CODEC_VIDEO_AUDIO)) {
      return "video+audio";
    }
    if (window.MediaSource.isTypeSupported(MSE_CODEC_VIDEO)) {
      return "video";
    }
  } catch {
    /* fall through */
  }
  return "none";
}

function chosenMseCodec(level: "video+audio" | "video"): string {
  return level === "video+audio" ? MSE_CODEC_VIDEO_AUDIO : MSE_CODEC_VIDEO;
}

interface ReadyFrame {
  type: "ready";
  deviceWidth: number;
  deviceHeight: number;
  codec?: "h264" | "jpeg";
  /** Phase 3a (#126): server muxed an Opus audio track into the H.264 stream. */
  audio?: boolean;
}
interface ErrorFrame {
  type: "error";
  message?: string;
  code?: string;
}
interface StatusFrame {
  type: "status";
  state: "loading" | "ready" | "navigating" | "stopped";
}
interface UrlChangedFrame {
  type: "url_changed";
  path: string;
}
interface ClipboardCopyFrame {
  type: "clipboard_copy";
  text: string;
}
interface FileDropAckFrame {
  type: "file_drop_ack";
  dropId: string;
  ready: boolean;
}
interface FileDropDoneFrame {
  type: "file_drop_done";
  dropId: string;
  target: string;
}
interface FileDropErrorFrame {
  type: "file_drop_error";
  dropId: string;
  code: string;
  message: string;
}
// Phase 3d (#129): server → client download-relay frames.
interface DownloadReadyFrame {
  type: "download_ready";
  id: string;
  filename: string;
  size: number;
}
interface DownloadRejectedFrame {
  type: "download_rejected";
  reason: "too_large" | "disk_pressure" | "too_many";
  filename: string;
}
interface DownloadFailedFrame {
  type: "download_failed";
  id: string;
  message: string;
}

// Phase 3d (#129): MUST stay in sync with the route at
// src/app/api/preview-download/[id]/route.ts. Inlined as a string
// constant rather than imported because that route is server-only
// and pulls in node:fs.
const PREVIEW_DOWNLOAD_PREFIX = "/api/preview-download/";

/**
 * Programmatically click a hidden `<a download>` to trigger the user's
 * browser native download UI. Same-origin attachment + Content-Disposition
 * means there's no autoplay-style restriction; the link works the same
 * as if the user had clicked a real download link.
 */
function triggerNativeDownload(id: string, filename: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = `${BASE_PATH}${PREVIEW_DOWNLOAD_PREFIX}${encodeURIComponent(id)}`;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Remove on the next tick — leaving it in the DOM doesn't hurt but
  // clutters the inspector.
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 0);
}

export function usePreviewStream({
  projectSlug,
  itemSlug,
  port,
  canvasRef,
  videoRef,
  enabled,
  quality,
  muted,
}: UsePreviewStreamArgs): UsePreviewStreamResult {
  const [status, setStatus] = useState<PreviewStreamStatus>("idle");
  const [deviceWidth, setDeviceWidth] = useState<number | null>(null);
  const [deviceHeight, setDeviceHeight] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Sticky failure flag: once H.264 has failed at runtime, all
  // subsequent connects (including reconnect-with-backoff) skip the
  // capability-detected codec and force ?codec=jpeg. Survives across
  // reconnects so a flaky stream doesn't keep retrying H.264 forever.
  const codecFailureRef = useRef(false);
  // Phase 4 (#130): same pattern as codecFailureRef — once WebRTC has
  // failed at runtime (timeout, peer-connection failed, or
  // capture_failed from the controller), all subsequent connects skip
  // straight to the MSE/JPEG path. Capability gate also flips this
  // when the browser doesn't expose RTCPeerConnection.
  const rtcFailureRef = useRef(false);
  const [mode, setMode] = useState<PreviewStreamMode>(() => {
    if (typeof window === "undefined" || typeof RTCPeerConnection === "undefined") {
      return detectMseSupport() === "none" ? "canvas" : "video";
    }
    return "video-rtc";
  });
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [transport, setTransport] = useState<"rtc" | "mse">(() => {
    if (typeof window === "undefined" || typeof RTCPeerConnection === "undefined") {
      return "mse";
    }
    return "rtc";
  });

  // Apply the `muted` prop to the video element whenever it changes.
  // Browsers honour `<video muted>` for autoplay; flipping muted to
  // false while the video is already playing is what unmute click does.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted ?? true;
  }, [muted, videoRef, mode]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const lastMouseMoveAtRef = useRef(0);
  /** Pending JPEG paint — coalesce successive frames so we draw at most once per RAF. */
  const pendingFrameRef = useRef<Uint8Array | null>(null);
  const rafScheduledRef = useRef(false);

  // Phase 4 (#130): WebRTC transport state. Lifecycle parallels the
  // existing wsRef + reconnectTimerRef pair. Tear-down flips
  // rtcFailureRef and the existing reconnect machinery picks up the
  // MSE path on the next attempt.
  const rtcPcRef = useRef<RTCPeerConnection | null>(null);
  const rtcSignalingWsRef = useRef<WebSocket | null>(null);
  const rtcCtrlChannelRef = useRef<RTCDataChannel | null>(null);
  const rtcFileChannelRef = useRef<RTCDataChannel | null>(null);
  const rtcConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 4 hardening: when the peer connection first goes
  // `failed`/`disconnected` (laptop sleep, VPN toggle, transient
  // packet loss), trigger one ICE restart before sticky-failing.
  // restartIce() forces a fresh candidate gather + answer exchange,
  // which recovers most network blips without the user ever noticing
  // a fallback to MSE. Stays at the connection scope — survives
  // across renegotiation, resets when the socket dies entirely.
  const rtcIceRestartedRef = useRef(false);

  // MSE state. Lifecycle is per-WS-connection — `setupMse()` runs on
  // open, `teardownMse()` on close. The append queue drains via the
  // `updateend` event, since `SourceBuffer.appendBuffer` rejects when
  // the buffer is busy.
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const mseObjectUrlRef = useRef<string | null>(null);
  const appendQueueRef = useRef<ArrayBuffer[]>([]);
  const lastEvictAtRef = useRef(0);

  const onCodecFailure = useCallback((reason: string) => {
    if (codecFailureRef.current) return;
    codecFailureRef.current = true;
    setLastError(`Falling back to JPEG: ${reason}`);
    setMode("canvas");
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        // 4000 = application reason "codec fallback"
        ws.close(4000, "codec_fallback");
      } catch {
        /* ignore */
      }
    }
    // The onclose handler will fire scheduleReconnect, which then
    // re-runs connect() — codecFailureRef is now true, so this time
    // it picks "jpeg" in the URL and renders the canvas path.
  }, []);

  const drainAppendQueue = useCallback(() => {
    const sb = sourceBufferRef.current;
    if (!sb || sb.updating) return;
    const next = appendQueueRef.current.shift();
    if (!next) return;
    try {
      sb.appendBuffer(next);
    } catch (err) {
      const e = err as DOMException;
      if (e.name === "QuotaExceededError") {
        // Evict the oldest 5 s and re-queue. MSE buffers are bounded
        // (~12-50 MB depending on the platform); without this a long
        // session eventually wedges.
        const ct = videoRef.current?.currentTime ?? 0;
        try {
          sb.remove(0, Math.max(0, ct - 5));
        } catch {
          /* ignore — will retry */
        }
        appendQueueRef.current.unshift(next);
      } else {
        onCodecFailure(`appendBuffer: ${e.name || "error"}`);
      }
    }
  }, [onCodecFailure, videoRef]);

  const teardownMse = useCallback(() => {
    const sb = sourceBufferRef.current;
    const ms = mediaSourceRef.current;
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;
    appendQueueRef.current = [];
    if (sb && ms && ms.readyState === "open") {
      try {
        ms.removeSourceBuffer(sb);
      } catch {
        /* may already be detached */
      }
    }
    if (mseObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(mseObjectUrlRef.current);
      } catch {
        /* ignore */
      }
      mseObjectUrlRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        /* ignore */
      }
    }
  }, [videoRef]);

  const setupMse = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    teardownMse();
    let ms: MediaSource;
    try {
      ms = new MediaSource();
    } catch (err) {
      onCodecFailure(`MediaSource ctor: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    mediaSourceRef.current = ms;
    const url = URL.createObjectURL(ms);
    mseObjectUrlRef.current = url;
    // Sync the muted state before we set src so autoplay isn't blocked.
    // The persistence layer (caller passes `muted` prop) decides the
    // initial value; default to true if the caller forgot.
    video.muted = muted ?? true;
    video.src = url;
    const onSourceOpen = () => {
      if (mediaSourceRef.current !== ms) return;
      // Pick the codec string based on what the browser actually
      // supports. The server muxes Opus into the same fMP4 when the
      // client asked for it, but `MediaSource.isTypeSupported` is the
      // source of truth — we never advertise a codec the browser
      // can't decode.
      const support = detectMseSupport();
      const codecStr =
        support === "video+audio" ? chosenMseCodec("video+audio") : chosenMseCodec("video");
      let sb: SourceBuffer;
      try {
        sb = ms.addSourceBuffer(codecStr);
      } catch (err) {
        onCodecFailure(`addSourceBuffer: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      sb.mode = "segments";
      sb.addEventListener("updateend", () => {
        // Evict old buffer once per second to bound memory; SourceBuffer
        // can't accept remove() while it's still updating.
        const now = performance.now();
        if (now - lastEvictAtRef.current > 1_000) {
          lastEvictAtRef.current = now;
          const ct = videoRef.current?.currentTime ?? 0;
          if (ct > MSE_BUFFER_TARGET_S && !sb.updating) {
            try {
              sb.remove(0, ct - MSE_BUFFER_TARGET_S / 2);
            } catch {
              /* ignore */
            }
          }
        }
        drainAppendQueue();
      });
      sb.addEventListener("error", () => {
        onCodecFailure("SourceBuffer.error");
      });
      sourceBufferRef.current = sb;
      drainAppendQueue();
    };
    ms.addEventListener("sourceopen", onSourceOpen, { once: true });
    // Autoplay must be triggered *after* src is set; muted+playsInline
    // is required for iOS / mobile Safari to honor autoplay.
    void video.play().catch(() => {
      // Some browsers reject autoplay without a gesture. Silent retry
      // happens on the first click anyway.
    });
  }, [drainAppendQueue, onCodecFailure, teardownMse, videoRef, muted]);

  const handleH264Frame = useCallback(
    (data: ArrayBuffer) => {
      if (data.byteLength < 1) return;
      const tag = new Uint8Array(data, 0, 1)[0];
      // Slice into a fresh ArrayBuffer so SourceBuffer.appendBuffer's
      // type signature is satisfied (it requires ArrayBuffer, not the
      // wider ArrayBufferLike that Uint8Array.buffer can be).
      const payload = data.slice(1);
      if (tag === 0x00 || tag === 0x01) {
        // Init and media segments both go through the same source
        // buffer in segments mode; the init segment must arrive first
        // (server invariant).
        appendQueueRef.current.push(payload);
        drainAppendQueue();
      } else if (tag === 0x02) {
        // Reset marker — server has restarted its encoder (resize or
        // hard-ceiling backpressure recovery). The new init segment
        // and media stream are about to arrive on the same WS, so we
        // tear down the current MediaSource and rebuild it. Discard
        // any queued segments — they belong to the previous encoder
        // and are incompatible with the new init segment.
        appendQueueRef.current = [];
        setupMse();
      } else {
        // Unknown tag — ignore. Phase 4 may add new tag types.
      }
    },
    [drainAppendQueue, setupMse],
  );

  const sendJson = useCallback((payload: Record<string, unknown>) => {
    // Phase 4 (#130): when a data channel is open, route input/control
    // through it for true P2P low-latency delivery (sub-frame click
    // response). Otherwise fall back to the WS — same payload shape, so
    // this is transparent to call sites. The file-drop chunked sender
    // has its own data-channel awareness below.
    const dc = rtcCtrlChannelRef.current;
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify(payload));
        return;
      } catch {
        /* channel closing — fall through to WS */
      }
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* socket closing */
    }
  }, []);

  const drawNextFrame = useCallback(async () => {
    rafScheduledRef.current = false;
    const data = pendingFrameRef.current;
    pendingFrameRef.current = null;
    const canvas = canvasRef.current;
    if (!data || !canvas) return;
    try {
      const blob = new Blob([new Uint8Array(data)], { type: "image/jpeg" });
      // createImageBitmap decodes off the main thread when supported.
      const bitmap = await createImageBitmap(blob);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        return;
      }
      // Match canvas internal size to the bitmap to avoid re-scaling.
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    } catch {
      /* drop frame on decode error */
    }
  }, [canvasRef]);

  const onMessage = useCallback(
    (evt: MessageEvent) => {
      if (typeof evt.data === "string") {
        let parsed:
          | ReadyFrame
          | ErrorFrame
          | StatusFrame
          | UrlChangedFrame
          | ClipboardCopyFrame
          | FileDropAckFrame
          | DownloadReadyFrame
          | DownloadRejectedFrame
          | DownloadFailedFrame
          | FileDropDoneFrame
          | FileDropErrorFrame;
        try {
          parsed = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (parsed.type === "ready") {
          const r = parsed as ReadyFrame;
          setDeviceWidth(r.deviceWidth);
          setDeviceHeight(r.deviceHeight);
          setStatus("ready");
          setLastError(null);
          // Phase 3a: server tells us whether it muxed an audio track.
          // Drives the mute-toggle UI's visibility.
          setAudioAvailable(Boolean(r.audio));
          // Server confirms which codec is active — should match what
          // we asked for, but trust the server in case we get something
          // unexpected (older deploy, env override).
          if (r.codec === "h264") {
            setMode("video");
            setupMse();
          } else if (r.codec === "jpeg") {
            setMode("canvas");
            teardownMse();
          }
        } else if (parsed.type === "error") {
          const e = parsed as ErrorFrame;
          setLastError(e.message ?? e.code ?? "Stream error");
          setStatus("error");
          // Server-side encoder failure (or missing ffmpeg). Fall
          // through to JPEG; the next reconnect will request it.
          if (e.code === "encoder_failed") {
            onCodecFailure(e.message ?? "encoder_failed");
          }
        } else if (parsed.type === "url_changed") {
          const u = parsed as UrlChangedFrame;
          setCurrentPath(u.path);
        } else if (parsed.type === "download_ready") {
          // Phase 3d (#129): the previewed page completed a download.
          // Auto-trigger the user's native download UI via a hidden
          // <a download>. The user already initiated this in the
          // preview, so going straight to the OS save dialog matches
          // the symmetry with Phase 3c's auto-upload-on-drop UX.
          triggerNativeDownload(parsed.id, parsed.filename);
          toast.success(`Downloaded: ${parsed.filename}`);
        } else if (parsed.type === "download_rejected") {
          const reasonLabel =
            parsed.reason === "too_large"
              ? "too large (max 500 MB)"
              : parsed.reason === "disk_pressure"
                ? "server out of disk space"
                : "too many concurrent downloads";
          toast.error(`Download rejected: ${parsed.filename} — ${reasonLabel}`);
        } else if (parsed.type === "download_failed") {
          toast.error(`Download failed: ${parsed.message ?? "unknown"}`);
        } else if (parsed.type === "file_drop_done") {
          // Phase 3c (#128): server confirms the upload landed in the
          // page. Show a brief success toast so the user knows the
          // file actually got there.
          toast.success(`File uploaded to preview (${parsed.target})`);
        } else if (parsed.type === "file_drop_error") {
          toast.error(`Upload failed: ${parsed.message ?? parsed.code ?? "unknown"}`);
        } else if (parsed.type === "file_drop_ack") {
          // Receipt only — the chunked sender is already mid-flight,
          // so there's nothing UI-visible to do here.
        } else if (parsed.type === "clipboard_copy") {
          // Phase 3b (#127): the previewed page emitted a copy/cut
          // event; mirror it to the user's system clipboard.
          // Permissions-Policy in next.config.ts grants clipboard-write
          // for same-origin, and the user's recent gesture (Ctrl+C
          // inside the preview) keeps transient activation alive long
          // enough for the WS round-trip on the common case.
          const t = (parsed as { text?: unknown }).text;
          const validated = validateClipboardPayload(t);
          if (
            !validated.ok ||
            !validated.text ||
            typeof navigator === "undefined" ||
            !navigator.clipboard
          )
            return;
          void navigator.clipboard.writeText(validated.text).catch(() => {
            // writeText may fail silently if the chat tab has been
            // backgrounded (no transient activation). Acceptable —
            // the next foreground copy will succeed.
          });
        }
        // status frames are informational only for v1 — could surface a navigating spinner later
        return;
      }
      // Binary frame.
      const data = evt.data instanceof ArrayBuffer ? evt.data : null;
      if (!data) return;
      if (mode === "video") {
        handleH264Frame(data);
      } else {
        // Queue for next RAF paint (JPEG fallback).
        pendingFrameRef.current = new Uint8Array(data);
        if (!rafScheduledRef.current) {
          rafScheduledRef.current = true;
          requestAnimationFrame(() => void drawNextFrame());
        }
      }
    },
    [drawNextFrame, handleH264Frame, mode, onCodecFailure, setupMse, teardownMse],
  );

  // Phase 4 (#130): tear down the WebRTC peer connection + signaling
  // WS. Idempotent. Called when the hook unmounts, when WebRTC fails
  // and we fall through to MSE, or when the user reloads.
  const teardownRtc = useCallback(() => {
    if (rtcConnectTimerRef.current) {
      clearTimeout(rtcConnectTimerRef.current);
      rtcConnectTimerRef.current = null;
    }
    const pc = rtcPcRef.current;
    rtcPcRef.current = null;
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    rtcCtrlChannelRef.current = null;
    rtcFileChannelRef.current = null;
    const sigWs = rtcSignalingWsRef.current;
    rtcSignalingWsRef.current = null;
    if (sigWs && sigWs.readyState <= WebSocket.OPEN) {
      try {
        sigWs.close();
      } catch {
        /* ignore */
      }
    }
    rtcIceRestartedRef.current = false;
    setRemoteStream(null);
  }, []);

  // Ref-based break of the connect ↔ scheduleReconnect circular
  // dependency. scheduleReconnect captures the ref; connect updates
  // it via the effect below. Same pattern as use-claude-chat.ts.
  const connectRef = useRef<() => void>(() => {});

  /**
   * Phase 4 (#130): try to bring up the WebRTC transport.
   *
   *   1. open signaling WS at /ws/preview-rtc/...?role=viewer
   *   2. send {type:"role", role:"viewer"}
   *   3. create RTCPeerConnection; receive ondatachannel for ctrl/file
   *   4. on controller's offer → setRemoteDescription, createAnswer
   *   5. relay ICE candidates both ways
   *   6. ontrack → assemble remote MediaStream and attach to videoRef
   *   7. when connectionState === "connected" → flip mode to
   *      "video-rtc" and clear the 5 s connect timer
   *
   * On any fatal step (capture_failed from controller, peer connection
   * failed/disconnected, or 5 s timeout) flip rtcFailureRef and call
   * `onFail()` so the caller falls through to MSE. The sticky flag
   * survives reconnects so a flaky link doesn't keep retrying RTC.
   */
  const connectRtc = useCallback(
    async (onFail: (reason: string) => void): Promise<void> => {
      if (typeof RTCPeerConnection === "undefined") {
        rtcFailureRef.current = true;
        onFail("RTCPeerConnection unavailable");
        return;
      }
      teardownRtc();

      // Fetch the env-configured ICE servers + connect timeout. A
      // failed fetch falls back to public Google STUN + 5 s default,
      // so the user-facing path is always live.
      const cfg = await fetchRtcConfig();

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl =
        `${proto}//${window.location.host}${BASE_PATH}/ws/preview-rtc/` +
        `${encodeURIComponent(projectSlug)}/${encodeURIComponent(itemSlug)}/${port}` +
        `?role=viewer`;
      let sigWs: WebSocket;
      try {
        sigWs = new WebSocket(wsUrl);
      } catch (err) {
        rtcFailureRef.current = true;
        onFail(err instanceof Error ? err.message : "rtc ws open failed");
        return;
      }
      rtcSignalingWsRef.current = sigWs;

      const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
      rtcPcRef.current = pc;
      const remote = new MediaStream();

      const giveUp = (reason: string) => {
        rtcFailureRef.current = true;
        // Tell the server we're switching to MSE so the operations
        // dashboard reflects the effective transport mix.
        reportMetric("fallback_to_mse");
        teardownRtc();
        onFail(reason);
      };

      // Connection-state watchdog: env-configurable timeout to reach
      // "connected", else fall back to MSE.
      rtcConnectTimerRef.current = setTimeout(() => {
        if (pc.connectionState !== "connected") {
          giveUp(`rtc connect timeout (state=${pc.connectionState})`);
        }
      }, cfg.connectTimeoutMs);

      pc.ontrack = (evt) => {
        for (const track of evt.streams[0]?.getTracks() ?? [evt.track]) {
          if (!remote.getTracks().includes(track)) remote.addTrack(track);
        }
        setRemoteStream(remote);
        // The server muxes a separate audio track when audio capture
        // succeeds — surface that to the consumer's mute toggle.
        setAudioAvailable(remote.getAudioTracks().length > 0);
      };

      pc.onicecandidate = (evt) => {
        if (evt.candidate && sigWs.readyState === WebSocket.OPEN) {
          try {
            sigWs.send(JSON.stringify({ type: "ice", candidate: evt.candidate.toJSON() }));
          } catch {
            /* ignore */
          }
        }
      };

      pc.ondatachannel = (evt) => {
        const ch = evt.channel;
        if (ch.label === "ctrl") {
          rtcCtrlChannelRef.current = ch;
          ch.binaryType = "arraybuffer";
          ch.onmessage = (msg) => {
            if (typeof msg.data !== "string") return;
            try {
              const f = JSON.parse(msg.data);
              if (f.type === "url_changed") setCurrentPath(String(f.path ?? ""));
              else if (f.type === "clipboard_copy") {
                const validated = validateClipboardPayload(f.text);
                if (validated.ok && validated.text && navigator.clipboard) {
                  void navigator.clipboard.writeText(validated.text).catch(() => {});
                }
              }
            } catch {
              /* drop malformed */
            }
          };
        } else if (ch.label === "file") {
          rtcFileChannelRef.current = ch;
          ch.binaryType = "arraybuffer";
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          if (rtcConnectTimerRef.current) {
            clearTimeout(rtcConnectTimerRef.current);
            rtcConnectTimerRef.current = null;
          }
          // A successful connect/reconnect resets the restart budget
          // — if the next blip happens after stable streaming we want
          // to try restartIce() again before giving up.
          rtcIceRestartedRef.current = false;
          setMode("video-rtc");
          setTransport("rtc");
          setStatus("ready");
          setLastError(null);
          // Wire the remote stream to the video element.
          const v = videoRef.current;
          if (v) {
            v.srcObject = remote;
            v.muted = muted ?? true;
            void v.play().catch(() => {
              /* autoplay block — silent retry on first click */
            });
          }
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          if (rtcFailureRef.current) return;
          // Phase 4 hardening: try one ICE restart before sticky-
          // failing. Recovers laptop-sleep / VPN-toggle / transient
          // packet-loss blips without dropping the user back to MSE.
          if (!rtcIceRestartedRef.current && pc.signalingState === "stable") {
            rtcIceRestartedRef.current = true;
            reportMetric("ice_restart");
            // Re-arm the connect-timeout watchdog for the recovery
            // window. cfg.connectTimeoutMs is in scope from the
            // top of connectRtc.
            if (rtcConnectTimerRef.current) {
              clearTimeout(rtcConnectTimerRef.current);
            }
            rtcConnectTimerRef.current = setTimeout(() => {
              if (pc.connectionState !== "connected") {
                giveUp(`rtc connect timeout after restart (state=${pc.connectionState})`);
              }
            }, cfg.connectTimeoutMs);
            try {
              pc.restartIce();
            } catch {
              giveUp("rtc restartIce failed");
            }
            return;
          }
          giveUp(`rtc peer state=${pc.connectionState}`);
        } else if (pc.connectionState === "closed") {
          if (!rtcFailureRef.current) {
            giveUp(`rtc peer state=${pc.connectionState}`);
          }
        }
      };

      sigWs.onopen = () => {
        try {
          sigWs.send(JSON.stringify({ type: "role", role: "viewer" }));
        } catch {
          /* ignore */
        }
      };
      sigWs.onmessage = async (evt) => {
        if (typeof evt.data !== "string") return;
        let frame: {
          type: string;
          sdp?: RTCSessionDescriptionInit;
          candidate?: RTCIceCandidateInit;
          reason?: string;
        };
        try {
          frame = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (frame.type === "sdp" && frame.sdp) {
          try {
            await pc.setRemoteDescription(frame.sdp);
            // Controller is the offerer — viewer answers.
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sigWs.send(JSON.stringify({ type: "sdp", sdp: pc.localDescription }));
          } catch (err) {
            giveUp(`sdp answer: ${err instanceof Error ? err.message : "failed"}`);
          }
        } else if (frame.type === "ice" && frame.candidate) {
          try {
            await pc.addIceCandidate(frame.candidate);
          } catch {
            /* late candidates may fail benignly */
          }
        } else if (frame.type === "capture_failed") {
          giveUp(`controller capture failed: ${frame.reason ?? "unknown"}`);
        } else if (frame.type === "bye") {
          giveUp("controller disconnected");
        }
      };
      sigWs.onerror = () => {
        giveUp("rtc signaling ws error");
      };
      sigWs.onclose = () => {
        if (pc.connectionState !== "connected" && !rtcFailureRef.current) {
          giveUp("rtc signaling ws closed before pairing");
        }
      };
    },
    [projectSlug, itemSlug, port, teardownRtc, videoRef, muted],
  );

  const scheduleReconnect = useCallback(() => {
    if (intentionalCloseRef.current) return;
    if (reconnectTimerRef.current) return;
    const attempt = reconnectAttemptsRef.current++;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    if (intentionalCloseRef.current) return;
    if (!enabled) return;
    setStatus("connecting");

    // Phase 4 (#130): try the WebRTC transport first. On any fatal
    // failure connectRtc flips rtcFailureRef and calls back here,
    // which re-enters connect() to take the MSE path. The sticky flag
    // survives reconnects so the second attempt skips straight past
    // this branch.
    if (!rtcFailureRef.current) {
      void connectRtc((reason) => {
        setLastError(`RTC fallback: ${reason}`);
        setTransport("mse");
        // Re-enter connect via microtask to avoid a render cascade.
        queueMicrotask(() => {
          if (intentionalCloseRef.current) return;
          connectRef.current();
        });
      });
      return;
    }

    // Decide codec for this connection. Sticky failure flag forces
    // JPEG for the rest of the session. Otherwise: H.264 (with or
    // without Opus audio) if the browser supports it, JPEG otherwise.
    const support = codecFailureRef.current ? "none" : detectMseSupport();
    const codec: "h264" | "jpeg" = support === "none" ? "jpeg" : "h264";
    setMode(codec === "h264" ? "video" : "canvas");
    setTransport("mse");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams();
    if (quality) params.set("quality", quality);
    params.set("codec", codec);
    const qs = params.toString();
    const url = `${proto}//${window.location.host}${BASE_PATH}/ws/preview-stream/${encodeURIComponent(
      projectSlug,
    )}/${encodeURIComponent(itemSlug)}/${port}${qs ? `?${qs}` : ""}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      setStatus("error");
      setLastError(err instanceof Error ? err.message : "WS open failed");
      scheduleReconnect();
      return;
    }
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
    };
    ws.onmessage = onMessage;
    ws.onerror = () => {
      setStatus("error");
    };
    ws.onclose = () => {
      wsRef.current = null;
      if (intentionalCloseRef.current) return;
      setStatus("closed");
      teardownMse();
      scheduleReconnect();
    };
  }, [
    projectSlug,
    itemSlug,
    port,
    onMessage,
    scheduleReconnect,
    enabled,
    quality,
    teardownMse,
    connectRtc,
  ]);

  // Keep the connectRef current so scheduleReconnect always invokes
  // the freshest closure (with up-to-date enabled / port / etc.).
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Open / close the socket as `enabled` flips.
  useEffect(() => {
    intentionalCloseRef.current = false;
    if (enabled) {
      // Defer to a microtask so the synchronous setStatus("connecting")
      // inside connect() doesn't trigger a cascading render during this
      // effect's commit phase (react-hooks/set-state-in-effect).
      queueMicrotask(() => {
        if (intentionalCloseRef.current) return;
        connect();
      });
    }
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState <= WebSocket.OPEN) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      teardownRtc();
    };
  }, [enabled, connect, teardownRtc]);

  // Mouse / key / wheel input forwarding. Bound to whichever DOM
  // element is currently rendered (canvas in JPEG mode, video in
  // H.264 mode), not the window, so events outside the preview area
  // don't leak into Chromium. Re-binds when `mode` changes.
  useEffect(() => {
    // Phase 4 (#130): both "video" (MSE) and "video-rtc" (WebRTC) modes
    // render to the same <video> element — only the upstream pipe differs.
    const el: HTMLElement | null =
      mode === "video" || mode === "video-rtc" ? videoRef.current : canvasRef.current;
    if (!el || !enabled) return;

    const toCanvas = (e: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      // CDP `Input.dispatchMouseEvent` expects coordinates in CSS
      // pixels relative to the viewport top-left. The page's CSS
      // pixels equal the display element's CSS pixels because we set
      // `page.setViewportSize({rect.width, rect.height})` whenever
      // the element resizes — so the offset within the element IS the
      // offset within the page.
      //
      // This works at any deviceScaleFactor: the bitmap (or video
      // intrinsic size) is in device pixels (DSF×CSS), but CDP wants
      // CSS px and we send CSS px. Done.
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const buildModifiers = (e: KeyboardEvent | MouseEvent | WheelEvent): number => {
      let m = 0;
      if (e.altKey) m |= Modifiers.Alt;
      if (e.ctrlKey) m |= Modifiers.Ctrl;
      if (e.metaKey) m |= Modifiers.Meta;
      if (e.shiftKey) m |= Modifiers.Shift;
      return m;
    };

    const buttonName = (n: number): "left" | "right" | "middle" => {
      if (n === 1) return "middle";
      if (n === 2) return "right";
      return "left";
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      const { x, y } = toCanvas(e);
      // `e.detail` is the browser-tracked multi-click count: 1 for a
      // single click, 2 for double, 3 for triple — using the OS click
      // cadence, which CDP needs to dispatch double-click semantics.
      sendJson({
        type: "mouse",
        action: "down",
        x,
        y,
        button: buttonName(e.button),
        buttons: e.buttons,
        clickCount: e.detail || 1,
      });
    };
    const onMouseUp = (e: MouseEvent) => {
      const { x, y } = toCanvas(e);
      sendJson({
        type: "mouse",
        action: "up",
        x,
        y,
        button: buttonName(e.button),
        buttons: e.buttons,
        clickCount: e.detail || 1,
      });
    };
    const onMouseMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastMouseMoveAtRef.current < MOUSEMOVE_MIN_INTERVAL_MS) return;
      lastMouseMoveAtRef.current = now;
      const { x, y } = toCanvas(e);
      sendJson({ type: "mouse", action: "move", x, y, buttons: e.buttons });
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = toCanvas(e);
      sendJson({ type: "wheel", x, y, deltaX: e.deltaX, deltaY: e.deltaY });
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      sendJson({
        type: "key",
        action: "down",
        key: e.key,
        code: e.code,
        text: e.key.length === 1 ? e.key : undefined,
        modifiers: buildModifiers(e),
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      sendJson({
        type: "key",
        action: "up",
        key: e.key,
        code: e.code,
        modifiers: buildModifiers(e),
      });
    };

    // Touch handling for mobile / tablets / pen displays. CDP works in
    // absolutes (each event carries the full set of currently-active
    // touches), so we maintain a per-finger map keyed by `identifier`
    // and rebuild the array on every touchstart/move/end.
    const activeTouches = new Map<number, { x: number; y: number }>();
    const buildTouchModifiers = (e: globalThis.TouchEvent): number => {
      let m = 0;
      if (e.altKey) m |= Modifiers.Alt;
      if (e.ctrlKey) m |= Modifiers.Ctrl;
      if (e.metaKey) m |= Modifiers.Meta;
      if (e.shiftKey) m |= Modifiers.Shift;
      return m;
    };
    const updateTouches = (e: globalThis.TouchEvent) => {
      const rect = el.getBoundingClientRect();
      // Sync to the changed touches (start / move) and remove ended ones.
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (e.type === "touchend" || e.type === "touchcancel") {
          activeTouches.delete(t.identifier);
        } else {
          activeTouches.set(t.identifier, {
            x: t.clientX - rect.left,
            y: t.clientY - rect.top,
          });
        }
      }
    };
    const buildTouchPoints = () =>
      Array.from(activeTouches.entries()).map(([id, p]) => ({
        id,
        x: p.x,
        y: p.y,
      }));
    const onTouchStart = (e: globalThis.TouchEvent) => {
      e.preventDefault();
      updateTouches(e);
      sendJson({
        type: "touch",
        action: "start",
        touchPoints: buildTouchPoints(),
        modifiers: buildTouchModifiers(e),
      });
    };
    const onTouchMove = (e: globalThis.TouchEvent) => {
      e.preventDefault();
      updateTouches(e);
      sendJson({
        type: "touch",
        action: "move",
        touchPoints: buildTouchPoints(),
        modifiers: buildTouchModifiers(e),
      });
    };
    const onTouchEnd = (e: globalThis.TouchEvent) => {
      e.preventDefault();
      updateTouches(e);
      sendJson({
        type: "touch",
        action: "end",
        touchPoints: buildTouchPoints(),
        modifiers: buildTouchModifiers(e),
      });
    };
    const onTouchCancel = (e: globalThis.TouchEvent) => {
      updateTouches(e);
      sendJson({
        type: "touch",
        action: "cancel",
        touchPoints: buildTouchPoints(),
        modifiers: buildTouchModifiers(e),
      });
    };

    // Phase 3b (#127): user paste into the preview. The handler MUST
    // read e.clipboardData synchronously — `navigator.clipboard.readText`
    // requires fresh user-gesture activation that doesn't survive an
    // await, and the paste event already carries the text inline.
    const onPaste = (e: ClipboardEvent) => {
      if (!e.isTrusted) return;
      const data = e.clipboardData;
      if (!data) return;
      const raw = data.getData("text/plain");
      const validated = validateClipboardPayload(raw);
      if (!validated.ok || !validated.text) return;
      // preventDefault so the browser doesn't *also* try to paste into
      // the (non-editable) preview element, which is a no-op for canvas
      // but can produce double-paste on contenteditable wrappers.
      e.preventDefault();
      sendJson({ type: "clipboard_paste", text: validated.text });
    };

    // Phase 3c (#128): drag-in file uploads. Depth counter mirrors the
    // file-dropzone.tsx pattern — dragenter / dragleave fire on every
    // child boundary crossing, so a naive boolean toggles on/off
    // wildly during a single drag. Counting nested entries keeps the
    // overlay stable.
    let dragDepth = 0;
    const isFileDrag = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      // Some browsers expose types as DOMStringList, others as Array;
      // includes() works on both.
      return Array.from(types).includes("Files");
    };
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth++;
      if (dragDepth === 1) setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDragOver(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      if (files.length > 1) {
        toast.info(`Multi-file drop not supported in v1 — uploaded ${files[0].name}`);
      }
      const file = files[0];
      if (file.size > MAX_DROP_BYTES) {
        toast.error(
          `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max ${MAX_DROP_BYTES / 1024 / 1024} MB)`,
        );
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Fire-and-forget upload. Errors land on the file_drop_error
      // JSON branch above, which toasts the user.
      void uploadDroppedFile(file, x, y);
    };

    /**
     * Stream a File over the WS using the start / chunks / end
     * protocol. Paces sends against `bufferedAmount` so we never
     * inflate the browser-side WS buffer past Phase 2's soft
     * watermark.
     */
    const uploadDroppedFile = async (file: File, x: number, y: number): Promise<void> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        toast.error("Preview disconnected — drop again after reconnect");
        return;
      }
      const dropId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      sendJson({
        type: "file_drop_start",
        dropId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        x,
        y,
      });

      const dropIdBytes = new TextEncoder().encode(dropId);
      // Tag (1) + dropIdLen (1) + dropId (N) + chunk bytes
      const headerLen = 2 + dropIdBytes.length;
      // Phase 4 (#130): when the data channel is open, route binary
      // chunks through it for P2P delivery. Falls back to the WS when
      // the data channel is closed (e.g. mid-WebRTC failure).
      const fileChannel = rtcFileChannelRef.current;
      const useDataChannel = fileChannel && fileChannel.readyState === "open";
      const sendChunk = (chunk: Uint8Array): boolean => {
        const framed = new Uint8Array(headerLen + chunk.length);
        framed[0] = FILE_DROP_TAG_CHUNK;
        framed[1] = dropIdBytes.length;
        framed.set(dropIdBytes, 2);
        framed.set(chunk, headerLen);
        if (useDataChannel && fileChannel.readyState === "open") {
          try {
            fileChannel.send(framed);
            return true;
          } catch {
            return false;
          }
        }
        if (ws.readyState !== WebSocket.OPEN) return false;
        ws.send(framed);
        return true;
      };

      const buffered = file.stream();
      const reader = buffered.getReader();
      let leftover: Uint8Array | null = null;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          let pos = 0;
          const bytes: Uint8Array = leftover
            ? (() => {
                const merged = new Uint8Array(leftover.length + value.length);
                merged.set(leftover);
                merged.set(value, leftover.length);
                return merged;
              })()
            : value;
          leftover = null;
          while (pos + DROP_CHUNK_SIZE <= bytes.length) {
            const slice = bytes.subarray(pos, pos + DROP_CHUNK_SIZE);
            // Pace against bufferedAmount on whichever transport is
            // active. RTCDataChannel exposes the same `bufferedAmount`
            // surface as WebSocket so the watermark math is identical.
            const bufferedSrc = useDataChannel ? fileChannel : ws;
            while (bufferedSrc.bufferedAmount > 4 * 1024 * 1024) {
              await new Promise((r) => setTimeout(r, 50));
              if (
                useDataChannel
                  ? fileChannel.readyState !== "open"
                  : ws.readyState !== WebSocket.OPEN
              )
                return;
            }
            if (!sendChunk(slice)) return;
            pos += DROP_CHUNK_SIZE;
          }
          if (pos < bytes.length) leftover = bytes.subarray(pos);
        }
        if (leftover && leftover.length > 0) {
          const bufferedSrc = useDataChannel ? fileChannel : ws;
          while (bufferedSrc.bufferedAmount > 4 * 1024 * 1024) {
            await new Promise((r) => setTimeout(r, 50));
            if (
              useDataChannel ? fileChannel.readyState !== "open" : ws.readyState !== WebSocket.OPEN
            )
              return;
          }
          sendChunk(leftover);
        }
        sendJson({ type: "file_drop_end", dropId });
      } catch {
        // Reader threw — file was unreadable. Server-side temp file
        // gets garbage-collected by the cron sweeper.
        toast.error("Upload failed reading file");
      }
    };

    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mouseup", onMouseUp);
    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("paste", onPaste);
    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel);
    // Key events require a tabIndex; keep them on the element itself
    // so typing in the chat doesn't leak in.
    el.tabIndex = 0;
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("keyup", onKeyUp);

    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", onKeyUp);
      activeTouches.clear();
    };
    // deviceWidth/deviceHeight intentionally NOT in deps — toCanvas
    // reads `el.getBoundingClientRect()` instead, so this effect
    // doesn't need to rebind every time the viewport changes.
  }, [canvasRef, videoRef, enabled, sendJson, mode]);

  // Resize forwarding — when the display element's size changes,
  // send the new pixel dims so Chromium's emulated viewport matches.
  useEffect(() => {
    // Phase 4 (#130): both "video" (MSE) and "video-rtc" (WebRTC) modes
    // render to the same <video> element — only the upstream pipe differs.
    const el: HTMLElement | null =
      mode === "video" || mode === "video-rtc" ? videoRef.current : canvasRef.current;
    if (!el || !enabled) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      sendJson({ type: "resize", width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasRef, videoRef, enabled, sendJson, mode]);

  const reload = useCallback(() => {
    sendJson({ type: "reload" });
  }, [sendJson]);

  const navigate = useCallback(
    (path: string) => {
      // Always start with `/` — server requires same-origin
      // localhost:port URLs and rejects anything else with
      // {type: "error", code: "navigate_rejected"}.
      const normalized = path.startsWith("/") ? path : `/${path}`;
      sendJson({
        type: "navigate",
        url: `http://127.0.0.1:${port}${normalized}`,
      });
    },
    [port, sendJson],
  );

  return {
    status,
    mode,
    deviceWidth,
    deviceHeight,
    lastError,
    currentPath,
    audioAvailable,
    dragOver,
    reload,
    navigate,
    remoteStream,
    transport,
  };
}
