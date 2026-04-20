"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiAlertTriangle, FiRefreshCw, FiX } from "react-icons/fi";
import { getAccessToken } from "@/lib/apiClient";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

type ConnState = "connecting" | "connected" | "closed" | "error";

interface GoogleSetupTerminalProps {
  /** Shell command to run once the PTY connects (e.g. `bash /path/to/setup.sh`). */
  initialCommand: string;
  /** Public callback URL shown in the banner so the user can double-check their GCP setup. */
  callbackUrl: string;
  onClose: () => void;
}

/**
 * Fullscreen in-browser terminal for the Google Workspace OAuth setup.
 * Same xterm.js + /ws/terminal plumbing used by SettingsTerminalPage;
 * just wrapped in a portal with a persistent "what to do" banner and
 * an auto-typed initial command so the user doesn't need to know the
 * script path.
 */
export function GoogleSetupTerminal({
  initialCommand,
  callbackUrl,
  onClose,
}: GoogleSetupTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const reconnect = useCallback(() => {
    setReconnectKey((k) => k + 1);
  }, []);

  // Escape to close (only if not connected — avoid trapping the user
  // mid-auth by accident).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const copyCallback = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [callbackUrl]);

  useEffect(() => {
    if (!hostRef.current) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    let initialCommandSent = false;

    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);
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
      try { fit.fit(); } catch { /* layout not ready */ }
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
        } catch { /* ignore */ }
        // Type the command ONE TIME. Small delay lets the shell print its prompt
        // first so users can visually confirm the command they're about to run.
        if (!initialCommandSent) {
          initialCommandSent = true;
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(`${initialCommand}\r`);
            }
          }, 250);
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

      ws.onclose = (ev) => {
        if (cancelled) return;
        setState("closed");
        if (ev.code !== 1000 && ev.code !== 1005) {
          setErrorMsg(`Connection closed (code ${ev.code})`);
        }
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      const onResize = () => {
        try { fit.fit(); } catch { /* layout not ready */ }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(hostRef.current);

      cleanup = () => {
        ro.disconnect();
        try { ws.close(); } catch { /* ignore */ }
        term.dispose();
      };
    })().catch((err) => {
      if (cancelled) return;
      console.error("[google-setup-terminal] init failed", err);
      setErrorMsg(err instanceof Error ? err.message : "Failed to load terminal");
      setState("error");
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reconnectKey, initialCommand]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-canvas-bg p-4">
      {/* Header */}
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-canvas-fg">Google Workspace setup</p>
          <p className="truncate text-[11px] text-canvas-muted">
            Runs <code>uvx workspace-mcp</code> in a PTY inside this container.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          title="Close (Esc)"
        >
          <FiX size={16} />
        </button>
      </div>

      {/* Instructions banner */}
      <div className="mb-3 shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-canvas-muted">
        <p className="mb-1 font-medium text-amber-400">Before you click the auth URL:</p>
        <p className="mb-1.5">
          Add this redirect URI to your OAuth client in Google Cloud Console (APIs &amp;
          Services → Credentials → your OAuth 2.0 Client):
        </p>
        <div className="flex items-center gap-2 rounded-md bg-black/40 px-2 py-1 font-mono text-[11px] text-canvas-fg">
          <span className="min-w-0 flex-1 truncate">{callbackUrl}</span>
          <button
            type="button"
            onClick={copyCallback}
            className="shrink-0 rounded px-2 py-0.5 text-[10px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Terminal host */}
      <div
        ref={hostRef}
        className="flex-1 overflow-hidden rounded-lg bg-black"
        style={{ minHeight: 240 }}
      />

      {/* Footer */}
      <div className="mt-2 flex shrink-0 items-center gap-2 text-[11px] text-canvas-muted">
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
          {state === "connecting" && "Connecting…"}
          {state === "connected" && "Connected"}
          {state === "closed" && "Disconnected"}
          {state === "error" && (errorMsg ?? "Error")}
        </span>
        {errorMsg && state !== "connected" && (
          <span className="flex items-center gap-1 text-red-500">
            <FiAlertTriangle size={10} />
            {errorMsg}
          </span>
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
      </div>
    </div>,
    document.body,
  );
}
