"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modifiers } from "./input-forward";

/**
 * Client-side hook driving the preview-stream `<canvas>`. Manages:
 *   - WebSocket lifecycle (open / message / close / reconnect-with-backoff)
 *   - JPEG frame decode + paint loop (uses requestAnimationFrame so we
 *     don't block the main thread on Image.decode)
 *   - Input event capture (mouse, wheel, key) → JSON over the WS
 *   - Resize forwarding so Chromium's emulated viewport tracks the
 *     canvas pixel size
 *   - Mousemove throttling to 60 fps cap so we don't flood the WS
 *
 * One hook instance per PreviewWindow. Driven entirely by the
 * `enabled` flag — when the dev server isn't running, we don't open
 * the WS at all (the canvas stays blank + an overlay tells the user
 * to click Start).
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
const MOUSEMOVE_MIN_INTERVAL_MS = 16; // ~60fps

export type PreviewStreamStatus = "idle" | "connecting" | "ready" | "error" | "closed";

export type QualityPreset = "performance" | "balanced" | "quality";

export interface UsePreviewStreamArgs {
  projectSlug: string;
  itemSlug: string;
  port: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Hook is dormant until `enabled` is true (dev server is running). */
  enabled: boolean;
  /** Streaming quality preset. Defaults to "balanced" server-side when absent. */
  quality?: QualityPreset;
}

export interface UsePreviewStreamResult {
  status: PreviewStreamStatus;
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
  /** Manually trigger a reload of the underlying Chromium page. */
  reload: () => void;
  /**
   * Navigate the previewed page to a new path. Server clamps to
   * same-origin (localhost:port) — external URLs are rejected.
   */
  navigate: (path: string) => void;
}

interface ReadyFrame {
  type: "ready";
  deviceWidth: number;
  deviceHeight: number;
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

export function usePreviewStream({
  projectSlug,
  itemSlug,
  port,
  canvasRef,
  enabled,
  quality,
}: UsePreviewStreamArgs): UsePreviewStreamResult {
  const [status, setStatus] = useState<PreviewStreamStatus>("idle");
  const [deviceWidth, setDeviceWidth] = useState<number | null>(null);
  const [deviceHeight, setDeviceHeight] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const lastMouseMoveAtRef = useRef(0);
  /** Pending paint — coalesce successive frames so we draw at most once per RAF. */
  const pendingFrameRef = useRef<Uint8Array | null>(null);
  const rafScheduledRef = useRef(false);

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
        let parsed: ReadyFrame | ErrorFrame | StatusFrame | UrlChangedFrame;
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
        } else if (parsed.type === "error") {
          const e = parsed as ErrorFrame;
          setLastError(e.message ?? e.code ?? "Stream error");
          setStatus("error");
        } else if (parsed.type === "url_changed") {
          const u = parsed as UrlChangedFrame;
          setCurrentPath(u.path);
        }
        // status frames are informational only for v1 — could surface a navigating spinner later
        return;
      }
      // Binary frame — queue for next RAF paint.
      const buf = evt.data instanceof ArrayBuffer ? new Uint8Array(evt.data) : null;
      if (!buf) return;
      pendingFrameRef.current = buf;
      if (!rafScheduledRef.current) {
        rafScheduledRef.current = true;
        requestAnimationFrame(() => void drawNextFrame());
      }
    },
    [drawNextFrame],
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
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const qualityQS = quality ? `?quality=${encodeURIComponent(quality)}` : "";
    const url = `${proto}//${window.location.host}${BASE_PATH}/ws/preview-stream/${encodeURIComponent(
      projectSlug,
    )}/${encodeURIComponent(itemSlug)}/${port}${qualityQS}`;
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
      scheduleReconnect();
    };
  }, [projectSlug, itemSlug, port, onMessage, scheduleReconnect, enabled, quality]);

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

  // Mouse / key / wheel input forwarding. Bound to the canvas, not
  // the window, so events outside the preview area don't leak into
  // Chromium.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;

    const toCanvas = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      // CDP `Input.dispatchMouseEvent` expects coordinates in CSS
      // pixels relative to the viewport top-left. The page's CSS
      // pixels equal the canvas's CSS pixels because we set
      // `page.setViewportSize({rect.width, rect.height})` whenever
      // the canvas resizes — so the offset within the canvas IS the
      // offset within the page.
      //
      // This works at any deviceScaleFactor: the bitmap is in device
      // pixels (DSF×CSS), the canvas backing store mirrors it, but
      // CDP wants CSS px and we send CSS px. Done.
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
      const rect = canvas.getBoundingClientRect();
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

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchCancel);
    // Key events on the canvas require a tabIndex; keep them on the
    // canvas itself so typing in the chat doesn't leak in.
    canvas.tabIndex = 0;
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchCancel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      activeTouches.clear();
    };
    // deviceWidth/deviceHeight intentionally NOT in deps — toCanvas
    // reads canvas.width/canvas.height instead, so this effect doesn't
    // need to rebind every time the viewport changes.
  }, [canvasRef, enabled, sendJson]);

  // Resize forwarding — when the canvas display size changes, send
  // the new pixel dims so Chromium's emulated viewport matches.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      sendJson({ type: "resize", width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvasRef, enabled, sendJson]);

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

  return { status, deviceWidth, deviceHeight, lastError, currentPath, reload, navigate };
}
