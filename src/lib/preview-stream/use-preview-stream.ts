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

export interface UsePreviewStreamArgs {
  projectSlug: string;
  itemSlug: string;
  port: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Hook is dormant until `enabled` is true (dev server is running). */
  enabled: boolean;
}

export interface UsePreviewStreamResult {
  status: PreviewStreamStatus;
  deviceWidth: number | null;
  deviceHeight: number | null;
  lastError: string | null;
  /** Manually trigger a reload of the underlying Chromium page. */
  reload: () => void;
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

export function usePreviewStream({
  projectSlug,
  itemSlug,
  port,
  canvasRef,
  enabled,
}: UsePreviewStreamArgs): UsePreviewStreamResult {
  const [status, setStatus] = useState<PreviewStreamStatus>("idle");
  const [deviceWidth, setDeviceWidth] = useState<number | null>(null);
  const [deviceHeight, setDeviceHeight] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

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
        let parsed: ReadyFrame | ErrorFrame | StatusFrame;
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
    const url = `${proto}//${window.location.host}${BASE_PATH}/ws/preview-stream/${encodeURIComponent(
      projectSlug,
    )}/${encodeURIComponent(itemSlug)}/${port}`;
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
  }, [projectSlug, itemSlug, port, onMessage, scheduleReconnect, enabled]);

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
      const dw = deviceWidth ?? rect.width;
      const dh = deviceHeight ?? rect.height;
      // Map CSS-pixel position to the device pixel coords Chromium expects.
      return {
        x: ((e.clientX - rect.left) / rect.width) * dw,
        y: ((e.clientY - rect.top) / rect.height) * dh,
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
      sendJson({
        type: "mouse",
        action: "down",
        x,
        y,
        button: buttonName(e.button),
        buttons: e.buttons,
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

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
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
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
    };
  }, [canvasRef, deviceWidth, deviceHeight, enabled, sendJson]);

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

  return { status, deviceWidth, deviceHeight, lastError, reload };
}
