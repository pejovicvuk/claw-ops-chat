"use client";

import { useContext, useEffect, useRef, useState } from "react";
import {
  FiAlertTriangle,
  FiChevronDown,
  FiChevronUp,
  FiExternalLink,
  FiLoader,
  FiPlay,
  FiRefreshCw,
  FiSquare,
} from "react-icons/fi";
import type { WindowDescriptor } from "../canvas-types";
import { ItemContext } from "../item-context";
import { useDevServer } from "@/lib/dev-server/use-dev-server";
import { frameworkLabel } from "@/lib/dev-server/detect-framework";
import { usePreviewStream } from "@/lib/preview-stream/use-preview-stream";

interface PreviewWindowProps {
  descriptor: WindowDescriptor;
  /** Persist a new port back into the canvas store. */
  onPortChange: (port: number) => void;
}

/**
 * Live preview of a localhost dev server, rendered server-side by a
 * headless Chromium tab and streamed to the user's browser as JPEG
 * frames over WebSocket.
 *
 * Three subsystems:
 *   1. Dev-server lifecycle (Start / Stop) — `useDevServer` hook
 *   2. Chromium screencast — `usePreviewStream` hook drives the canvas
 *   3. Item-scoped cwd — `ItemContext` tells us which folder to spawn in
 *
 * The PR #108 reverse-proxy iframe path is preserved for the "open in
 * new tab" link, so the user can pop the preview into a real browser
 * tab if they need browser-native features (downloads, devtools).
 */

const PORT_MIN = 1024;
const PORT_MAX = 65535;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";

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
  const item = useContext(ItemContext);
  const projectSlug = item?.projectSlug ?? "";
  const itemSlug = item?.itemSlug ?? "";

  const { status, runningServer, framework, recentLogs, lastError, start, stop } = useDevServer({
    projectSlug,
    itemSlug,
    port,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isRunning = status === "running";
  const stream = usePreviewStream({
    projectSlug,
    itemSlug,
    port,
    canvasRef,
    enabled: isRunning,
  });

  const [draftPort, setDraftPort] = useState(String(port));
  const [portError, setPortError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  // Sync draft when the descriptor's port changes externally (e.g. on
  // canvas hydration). Don't fight the user's keystrokes.
  useEffect(() => {
    setDraftPort(String(port));
  }, [port]);

  const commitPort = () => {
    const trimmed = draftPort.trim();
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(n) || String(n) !== trimmed || n < PORT_MIN || n > PORT_MAX) {
      setPortError(`Port must be in [${PORT_MIN}, ${PORT_MAX}]`);
      return;
    }
    setPortError(null);
    if (n !== port) onPortChange(n);
  };

  const previewUrl = `${BASE_PATH}/preview/${port}/`;
  const startDisabled =
    !item || status === "starting" || status === "running" || status === "stopping";
  const stopDisabled = !runningServer || status === "stopping";

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas-bg">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-canvas-border bg-canvas-surface px-2 py-1">
        {/* Start / Stop */}
        {isRunning || status === "stopping" ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={stopDisabled}
            title="Stop dev server"
            className="btn-press flex h-6 items-center gap-1 rounded bg-red-600 px-2 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            <FiSquare size={11} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={startDisabled}
            title="Start dev server"
            className="btn-press flex h-6 items-center gap-1 rounded bg-green-600 px-2 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {status === "starting" ? (
              <FiLoader size={11} className="animate-spin" />
            ) : (
              <FiPlay size={11} />
            )}
            {status === "starting" ? "Starting" : "Start"}
          </button>
        )}

        {/* Framework chip */}
        {framework && (
          <span
            title={`Detected framework: ${frameworkLabel(framework)}`}
            className="rounded bg-canvas-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-canvas-muted"
          >
            {frameworkLabel(framework)}
          </span>
        )}

        {/* Status dot */}
        <StatusDot status={status} />

        {/* Port input */}
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
        />
        {portError && (
          <span role="alert" className="text-[11px] text-red-500">
            {portError}
          </span>
        )}

        <div className="flex-1" />

        {/* Reload (only meaningful while connected) */}
        <button
          type="button"
          onClick={() => stream.reload()}
          disabled={!isRunning || stream.status !== "ready"}
          title="Reload preview"
          aria-label="Reload preview"
          className="btn-press flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
        >
          <FiRefreshCw size={12} />
        </button>

        {/* Open in real browser tab via the iframe proxy (PR #108). */}
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

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Canvas + overlays */}
        <canvas
          ref={canvasRef}
          className="h-full w-full bg-white outline-none"
          tabIndex={0}
          aria-label={`Live preview on port ${port}`}
        />
        {!isRunning && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-canvas-bg/95 px-6 text-center">
            {status === "starting" ? (
              <>
                <FiLoader size={20} className="animate-spin text-accent" />
                <p className="text-[13px] font-medium text-canvas-fg">Starting dev server…</p>
                <p className="text-[11px] text-canvas-muted">
                  Spawning {framework ? frameworkLabel(framework) : "dev"} on :{port} via{" "}
                  <span className="font-mono">npm run dev</span>
                </p>
              </>
            ) : status === "error" ? (
              <>
                <FiAlertTriangle size={20} className="text-amber-500" />
                <p className="text-[13px] font-medium text-canvas-fg">
                  Couldn&rsquo;t start dev server
                </p>
                {lastError && <p className="text-[11px] text-canvas-muted">{lastError}</p>}
                <button
                  type="button"
                  onClick={() => void start()}
                  className="btn-press mt-1 rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:opacity-90"
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <FiPlay size={20} className="text-canvas-muted" />
                <p className="text-[13px] font-medium text-canvas-fg">Dev server not running</p>
                <p className="text-[11px] text-canvas-muted">
                  Click <span className="font-semibold">Start</span> to spawn{" "}
                  {framework ? frameworkLabel(framework) : "the dev server"} on :{port}.
                </p>
              </>
            )}
          </div>
        )}
        {isRunning && stream.status !== "ready" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-canvas-bg/85 px-6 text-center">
            <FiLoader size={20} className="animate-spin text-accent" />
            <p className="text-[13px] font-medium text-canvas-fg">
              {stream.status === "connecting"
                ? "Connecting Chromium…"
                : stream.status === "error"
                  ? "Stream error"
                  : "Waiting for first frame…"}
            </p>
            {stream.lastError && (
              <p className="text-[11px] text-canvas-muted">{stream.lastError}</p>
            )}
          </div>
        )}
      </div>

      {/* Collapsible log panel */}
      {(runningServer || recentLogs.length > 0) && (
        <div className="shrink-0 border-t border-canvas-border bg-canvas-surface">
          <button
            type="button"
            onClick={() => setLogsOpen((o) => !o)}
            className="btn-press flex h-6 w-full items-center gap-1 px-2 text-[11px] font-medium text-canvas-muted hover:text-canvas-fg"
          >
            {logsOpen ? <FiChevronDown size={11} /> : <FiChevronUp size={11} />}
            <span>Logs ({recentLogs.length})</span>
          </button>
          {logsOpen && (
            <pre className="max-h-40 overflow-y-auto bg-canvas-bg px-2 py-1 font-mono text-[10px] leading-tight text-canvas-fg">
              {recentLogs.length === 0 ? "(no output yet)" : recentLogs.slice(-50).join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: "idle" | "starting" | "running" | "stopping" | "error" }) {
  const color =
    status === "running"
      ? "bg-green-500"
      : status === "starting" || status === "stopping"
        ? "bg-amber-500"
        : status === "error"
          ? "bg-red-500"
          : "bg-canvas-muted";
  const pulse = status === "running" || status === "starting";
  return (
    <span
      title={status}
      className={`inline-block h-2 w-2 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`}
    />
  );
}
