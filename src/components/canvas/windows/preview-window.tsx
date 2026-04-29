"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiExternalLink, FiRefreshCw } from "react-icons/fi";
import type { WindowDescriptor } from "../canvas-types";

interface PreviewWindowProps {
  descriptor: WindowDescriptor;
  /** Persist a new port back into the canvas store. */
  onPortChange: (port: number) => void;
}

/**
 * Live preview of a localhost dev server inside an iframe. The chat
 * server's reverse proxy at `/chat/preview/<port>/*` makes the dev
 * server reachable on the same origin so CSP doesn't block the frame
 * and HMR WebSockets pass through unchanged.
 *
 * UI is intentionally minimal: an editable port input, a reload button,
 * an open-in-new-tab anchor. When the upstream isn't reachable the
 * iframe is masked by a "Dev server not running" overlay (driven by a
 * one-shot HEAD probe on mount + on reload).
 *
 * The iframe is keyed on `${port}-${reloadKey}` so port edits and
 * reload clicks both force a clean remount — much simpler than poking
 * `iframe.contentWindow.location.reload()` and surviving cross-origin
 * weirdness.
 */
const PORT_MIN = 1024;
const PORT_MAX = 65535;
const BASE_PATH = "/chat";

export function PreviewWindow({ descriptor, onPortChange }: PreviewWindowProps) {
  if (descriptor.state.kind !== "preview") return null;
  const { port } = descriptor.state;
  return <PreviewWindowBody port={port} onPortChange={onPortChange} />;
}

function PreviewWindowBody({
  port,
  onPortChange,
}: {
  port: number;
  onPortChange: (port: number) => void;
}) {
  const previewUrl = `${BASE_PATH}/preview/${port}/`;
  const [reloadKey, setReloadKey] = useState(0);
  const [probeStatus, setProbeStatus] = useState<"unknown" | "ok" | "down">("unknown");
  const [draftPort, setDraftPort] = useState(String(port));
  const [portError, setPortError] = useState<string | null>(null);
  const lastProbeRef = useRef<AbortController | null>(null);

  // Sync draft when the descriptor's port changes externally (e.g. on
  // canvas hydration). Don't fight the user's keystrokes.
  useEffect(() => {
    setDraftPort(String(port));
  }, [port]);

  const probe = useCallback(async () => {
    lastProbeRef.current?.abort();
    const ctrl = new AbortController();
    lastProbeRef.current = ctrl;
    try {
      const res = await fetch(`${previewUrl}__claw_probe`, {
        method: "HEAD",
        cache: "no-store",
        signal: ctrl.signal,
      });
      // 502 from the proxy = upstream unreachable.
      // Anything else (200, 404, 405, 301, ...) = dev server is alive
      // but doesn't have that path — still "up" from our perspective.
      setProbeStatus(res.status === 502 ? "down" : "ok");
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      // Network error (chat app dropped the connection, etc.) — treat
      // as down so the user gets a retry affordance.
      setProbeStatus("down");
    }
  }, [previewUrl]);

  useEffect(() => {
    void probe();
    return () => lastProbeRef.current?.abort();
  }, [probe, reloadKey]);

  const commitPort = () => {
    const trimmed = draftPort.trim();
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(n) || String(n) !== trimmed || n < PORT_MIN || n > PORT_MAX) {
      setPortError(`Port must be an integer in [${PORT_MIN}, ${PORT_MAX}]`);
      return;
    }
    setPortError(null);
    if (n !== port) onPortChange(n);
  };

  const handleReload = () => {
    setReloadKey((k) => k + 1);
    setProbeStatus("unknown");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-bg">
      <div className="flex shrink-0 items-center gap-2 border-b border-canvas-border bg-canvas-surface px-2 py-1">
        <label
          className="text-[11px] font-medium text-canvas-muted"
          htmlFor={`preview-port-${port}`}
        >
          Port
        </label>
        <input
          id={`preview-port-${port}`}
          type="number"
          inputMode="numeric"
          min={PORT_MIN}
          max={PORT_MAX}
          value={draftPort}
          onChange={(e) => setDraftPort(e.target.value)}
          onBlur={commitPort}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitPort();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-6 w-20 rounded border border-canvas-border bg-canvas-bg px-1.5 font-mono text-[12px] text-canvas-fg focus:border-accent focus:outline-none"
          aria-invalid={portError ? "true" : "false"}
          aria-errormessage={portError ? `preview-port-error-${port}` : undefined}
        />
        {portError && (
          <span id={`preview-port-error-${port}`} role="alert" className="text-[11px] text-red-500">
            {portError}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleReload}
          title="Reload preview"
          aria-label="Reload preview"
          className="btn-press flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          <FiRefreshCw size={12} />
        </button>
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          title="Open in new tab"
          aria-label="Open in new tab"
          className="btn-press flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          <FiExternalLink size={12} />
        </a>
      </div>
      <div className="relative min-h-0 flex-1">
        {probeStatus === "down" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-canvas-bg/95 px-6 text-center">
            <FiAlertTriangle size={20} className="text-amber-500" />
            <p className="text-[13px] font-medium text-canvas-fg">
              Dev server not running on :{port}
            </p>
            <p className="text-[11px] text-canvas-muted">
              Start it from a chat window in this item, then click reload.
            </p>
            <button
              type="button"
              onClick={handleReload}
              className="btn-press mt-1 rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-white hover:opacity-90"
            >
              Retry
            </button>
          </div>
        )}
        <iframe
          key={`${port}-${reloadKey}`}
          src={previewUrl}
          className="h-full w-full border-0 bg-white"
          // Loose sandbox — same-origin so cookies flow, scripts/forms/
          // popups/modals/downloads enabled because that's what real dev
          // tools (devtools, SSO popups, file downloads) expect.
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          title={`Preview :${port}`}
        />
      </div>
    </div>
  );
}
