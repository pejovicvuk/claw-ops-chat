"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiMaximize2, FiMinimize2, FiRefreshCw } from "react-icons/fi";
import { getAccessToken } from "@/lib/apiClient";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

type ConnState = "connecting" | "connected" | "closed" | "error";

/**
 * Terminal settings page — xterm.js hooked up to the server's /ws/terminal
 * PTY endpoint. Dynamically imports xterm + addons so the main bundle stays
 * small (xterm is only loaded when the user opens this page).
 */
export function SettingsTerminalPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [fullscreen, setFullscreen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);

  const reconnect = useCallback(() => {
    setReconnectKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      // Dynamic import keeps xterm out of the initial bundle.
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);
      // Load the CSS once; subsequent imports are no-ops.
      await import("@xterm/xterm/css/xterm.css");

      if (cancelled || !hostRef.current) return;

      const term = new Terminal({
        fontFamily: 'ui-monospace, Menlo, "Cascadia Code", Consolas, monospace',
        fontSize: 13,
        cursorBlink: true,
        theme: {
          background: "#0b0b0b",
          foreground: "#f0f0f0",
          cursor: "#e8553a",
          selectionBackground: "#e8553a40",
        },
        scrollback: 5000,
        allowProposedApi: false,
        convertEol: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(hostRef.current);
      try {
        fit.fit();
      } catch {
        /* container may not be laid out yet */
      }
      term.focus();

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const accessToken = getAccessToken();
      const tokenParam = accessToken ? `?token=${encodeURIComponent(accessToken)}` : "";
      const url = `${proto}//${window.location.host}${BASE_PATH}/ws/terminal${tokenParam}`;

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setState("connected");
        setErrorMsg(null);
        try {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        } catch {
          /* ignore */
        }
      };

      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          term.write(e.data);
        } else if (e.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(e.data));
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setErrorMsg("Terminal connection error");
      };

      ws.onclose = (e) => {
        if (cancelled) return;
        setState("closed");
        if (e.code !== 1000 && e.code !== 1005) {
          setErrorMsg(`Connection closed (code ${e.code})`);
        }
      };

      const sendInput = (data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      };
      term.onData(sendInput);

      // Resize observer → fit + notify server.
      const onResize = () => {
        try {
          fit.fit();
        } catch {
          /* layout not ready */
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(hostRef.current);

      cleanup = () => {
        ro.disconnect();
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        term.dispose();
      };
    })().catch((err) => {
      if (cancelled) return;
      console.error("[terminal] failed to initialise", err);
      setErrorMsg(err instanceof Error ? err.message : "Failed to load terminal");
      setState("error");
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // `reconnectKey` bump re-runs this effect so the user can reconnect.
  }, [reconnectKey]);

  // Escape exits fullscreen (without closing the whole settings overlay).
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setFullscreen(false);
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [fullscreen]);

  return (
    <div
      className={
        fullscreen ? "fixed inset-0 z-[60] flex flex-col bg-canvas-bg p-4" : "flex flex-col gap-3"
      }
      style={fullscreen ? {} : { minHeight: "min(560px,70vh)" }}
    >
      {/* Security banner */}
      <div className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2">
        <FiAlertTriangle size={12} className="mt-0.5 shrink-0 text-orange-500" />
        <p className="text-[11px] leading-relaxed text-canvas-muted">
          This terminal runs as the server user with full filesystem access. Be careful — anything
          you type executes on the host machine.
        </p>
      </div>

      {/* Terminal host */}
      <div
        ref={hostRef}
        className="flex-1 overflow-hidden rounded-lg bg-black"
        style={{ minHeight: 240 }}
      />

      {/* Footer — status + fullscreen toggle */}
      <div className="flex items-center gap-2 text-[11px] text-canvas-muted">
        <span className="flex items-center gap-1.5">
          <span
            className={
              "h-1.5 w-1.5 rounded-full " +
              (state === "connected"
                ? "bg-green-500"
                : state === "connecting"
                  ? "bg-yellow-500 animate-pulse"
                  : state === "closed"
                    ? "bg-canvas-muted"
                    : "bg-red-500")
            }
          />
          {state === "connecting" && "Connecting..."}
          {state === "connected" && "Connected"}
          {state === "closed" && "Disconnected"}
          {state === "error" && (errorMsg ?? "Error")}
        </span>
        {errorMsg && state !== "connected" && (
          <span className="truncate text-red-500">{errorMsg}</span>
        )}
        <span className="flex-1" />
        {state !== "connected" && state !== "connecting" && (
          <button
            type="button"
            onClick={reconnect}
            className="inline-flex items-center gap-1 rounded-md border border-canvas-border px-2 py-1 text-[10px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiRefreshCw size={10} />
            Reconnect
          </button>
        )}
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-canvas-border px-2 py-1 text-[10px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
        >
          {fullscreen ? <FiMinimize2 size={10} /> : <FiMaximize2 size={10} />}
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </div>
    </div>
  );
}
