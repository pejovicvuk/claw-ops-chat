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

export type PreviewStreamMode = "video" | "canvas";

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
  const [mode, setMode] = useState<PreviewStreamMode>(() =>
    detectMseSupport() === "none" ? "canvas" : "video",
  );

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
      const codecStr = support === "video+audio" ? chosenMseCodec("video+audio") : chosenMseCodec("video");
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

  // Ref-based break of the connect ↔ scheduleReconnect circular
  // dependency. scheduleReconnect captures the ref; connect updates
  // it via the effect below. Same pattern as use-claude-chat.ts.
  const connectRef = useRef<() => void>(() => {});

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
    // Decide codec for this connection. Sticky failure flag forces
    // JPEG for the rest of the session. Otherwise: H.264 (with or
    // without Opus audio) if the browser supports it, JPEG otherwise.
    const support = codecFailureRef.current ? "none" : detectMseSupport();
    const codec: "h264" | "jpeg" = support === "none" ? "jpeg" : "h264";
    setMode(codec === "h264" ? "video" : "canvas");
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
  }, [projectSlug, itemSlug, port, onMessage, scheduleReconnect, enabled, quality, teardownMse]);

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
    };
  }, [enabled, connect]);

  // Mouse / key / wheel input forwarding. Bound to whichever DOM
  // element is currently rendered (canvas in JPEG mode, video in
  // H.264 mode), not the window, so events outside the preview area
  // don't leak into Chromium. Re-binds when `mode` changes.
  useEffect(() => {
    const el: HTMLElement | null = mode === "video" ? videoRef.current : canvasRef.current;
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
        toast.info(
          `Multi-file drop not supported in v1 — uploaded ${files[0].name}`,
        );
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
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
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
      const sendChunk = (chunk: Uint8Array): boolean => {
        if (ws.readyState !== WebSocket.OPEN) return false;
        const framed = new Uint8Array(headerLen + chunk.length);
        framed[0] = FILE_DROP_TAG_CHUNK;
        framed[1] = dropIdBytes.length;
        framed.set(dropIdBytes, 2);
        framed.set(chunk, headerLen);
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
            // Pace against bufferedAmount; matches Phase 2's soft
            // watermark so we share one bandwidth budget.
            while (ws.bufferedAmount > 4 * 1024 * 1024) {
              await new Promise((r) => setTimeout(r, 50));
              if (ws.readyState !== WebSocket.OPEN) return;
            }
            if (!sendChunk(slice)) return;
            pos += DROP_CHUNK_SIZE;
          }
          if (pos < bytes.length) leftover = bytes.subarray(pos);
        }
        if (leftover && leftover.length > 0) {
          while (ws.bufferedAmount > 4 * 1024 * 1024) {
            await new Promise((r) => setTimeout(r, 50));
            if (ws.readyState !== WebSocket.OPEN) return;
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
    const el: HTMLElement | null = mode === "video" ? videoRef.current : canvasRef.current;
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
  };
}
