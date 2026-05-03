"use client";

import { useContext, useEffect, useRef, useState } from "react";
import {
  FiAlertTriangle,
  FiArrowLeft,
  FiArrowRight,
  FiChevronDown,
  FiChevronUp,
  FiExternalLink,
  FiLoader,
  FiPlay,
  FiRefreshCw,
  FiSquare,
  FiVolume2,
  FiVolumeX,
} from "react-icons/fi";
import type { WindowDescriptor } from "../canvas-types";
import { ItemContext } from "../item-context";
import { useDevServer } from "@/lib/dev-server/use-dev-server";
import { frameworkLabel } from "@/lib/dev-server/framework-label";
import { usePreviewStream } from "@/lib/preview-stream/use-preview-stream";

interface PreviewWindowProps {
  descriptor: WindowDescriptor;
  /** Persist a new port back into the canvas store. */
  onPortChange: (port: number) => void;
  /** Persist a new path back into the canvas store. */
  onPathChange: (path: string) => void;
  /** Persist a new streaming-quality preset back into the canvas store. */
  onQualityChange: (quality: "performance" | "balanced" | "quality") => void;
  /** Phase 3a (#126): persist the user's mute preference. */
  onMutedChange: (muted: boolean) => void;
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

export function PreviewWindow({
  descriptor,
  onPortChange,
  onPathChange,
  onQualityChange,
  onMutedChange,
}: PreviewWindowProps) {
  if (descriptor.state.kind !== "preview") return null;
  const { port, path, quality, muted } = descriptor.state;
  return (
    <PreviewWindowBody
      port={port}
      path={path ?? "/"}
      quality={quality ?? "balanced"}
      muted={muted ?? true}
      onPortChange={onPortChange}
      onPathChange={onPathChange}
      onQualityChange={onQualityChange}
      onMutedChange={onMutedChange}
    />
  );
}

function PreviewWindowBody({
  port,
  path,
  quality,
  muted,
  onPortChange,
  onPathChange,
  onQualityChange,
  onMutedChange,
}: {
  port: number;
  path: string;
  quality: "performance" | "balanced" | "quality";
  muted: boolean;
  onPortChange: (port: number) => void;
  onPathChange: (path: string) => void;
  onQualityChange: (quality: "performance" | "balanced" | "quality") => void;
  onMutedChange: (muted: boolean) => void;
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const isRunning = status === "running";
  const stream = usePreviewStream({
    projectSlug,
    itemSlug,
    port,
    canvasRef,
    videoRef,
    enabled: isRunning,
    quality,
    muted,
  });

  const [draftPort, setDraftPort] = useState(String(port));
  const [portError, setPortError] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState(path);
  /**
   * While the path input is focused we don't sync from the page's
   * actual URL — otherwise mid-typing the input value gets clobbered
   * by an incoming `url_changed`. On blur the live URL takes over again.
   */
  const pathFocusedRef = useRef(false);
  const [logsOpen, setLogsOpen] = useState(false);

  // Sync drafts when the descriptor changes externally (e.g. canvas
  // hydration). Don't fight the user's keystrokes.
  useEffect(() => {
    setDraftPort(String(port));
  }, [port]);
  useEffect(() => {
    if (!pathFocusedRef.current) setDraftPath(path);
  }, [path]);

  // Reconcile descriptor.path ↔ Chromium's actual URL. Two cases:
  //   • Just-connected: page is at `/` (acquirePage's default) but
  //     descriptor remembers `/about` → tell Chromium to navigate.
  //   • Already running: user clicked a link → page URL changed →
  //     update the persisted path to match.
  // `reconciledRef` separates the two so the initial server-side
  // `/` doesn't clobber the persisted `/about`.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (stream.status !== "ready") {
      reconciledRef.current = false;
      return;
    }
    if (!stream.currentPath) return;
    if (!reconciledRef.current) {
      // First url_changed after ready — navigate to persisted path if needed.
      if (path !== "/" && stream.currentPath !== path) {
        stream.navigate(path);
      }
      reconciledRef.current = true;
      return;
    }
    // Subsequent updates: in-page navigation; persist the new URL.
    if (stream.currentPath !== path) {
      onPathChange(stream.currentPath);
    }
  }, [stream.status, stream.currentPath, path, onPathChange, stream]);

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

  const commitPath = () => {
    let p = draftPath.trim();
    if (!p) p = "/";
    if (!p.startsWith("/")) p = "/" + p;
    if (p !== draftPath) setDraftPath(p);
    if (p !== path) onPathChange(p);
    if (isRunning) stream.navigate(p);
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

        {/* Phase 5a (#131): back/forward navigation. Disabled when the
            previewed page has no history in that direction (driven by
            CDP `Page.getNavigationHistory` on every framenavigated). */}
        <button
          type="button"
          onClick={() => stream.goBack()}
          disabled={!isRunning || stream.status !== "ready" || !stream.canGoBack}
          title="Go back"
          aria-label="Go back"
          className="btn-press flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
        >
          <FiArrowLeft size={12} />
        </button>
        <button
          type="button"
          onClick={() => stream.goForward()}
          disabled={!isRunning || stream.status !== "ready" || !stream.canGoForward}
          title="Go forward"
          aria-label="Go forward"
          className="btn-press flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
        >
          <FiArrowRight size={12} />
        </button>

        {/* Path input — type a route (e.g. /about, /users/42) and press
            Enter or blur to navigate. Auto-syncs from the page's actual
            URL when not focused, so clicking a Link in the previewed
            app updates this. */}
        <span className="text-[11px] font-medium text-canvas-muted">/</span>
        <input
          id={`preview-path-${port}`}
          type="text"
          value={draftPath === "/" ? "" : draftPath.replace(/^\//, "")}
          placeholder="path/to/page"
          onChange={(e) => setDraftPath("/" + e.target.value.replace(/^\//, ""))}
          onFocus={() => {
            pathFocusedRef.current = true;
          }}
          onBlur={() => {
            pathFocusedRef.current = false;
            commitPath();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitPath();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-6 min-w-[80px] flex-1 rounded border border-canvas-border bg-canvas-bg px-1.5 font-mono text-[12px] text-canvas-fg focus:border-accent focus:outline-none"
          aria-label="Page path"
        />

        <div className="w-2" />

        {/* Quality preset — trades bandwidth for fidelity. Changing
            this re-opens the WS so the new preset takes effect on the
            next frame. */}
        <select
          value={quality}
          onChange={(e) =>
            onQualityChange(e.target.value as "performance" | "balanced" | "quality")
          }
          aria-label="Streaming quality"
          title="Streaming quality (trades bandwidth for fidelity)"
          className="h-6 rounded border border-canvas-border bg-canvas-bg px-1 text-[11px] font-medium text-canvas-fg focus:border-accent focus:outline-none"
        >
          <option value="performance">Low</option>
          <option value="balanced">Med</option>
          <option value="quality">High</option>
        </select>

        {/* Mute toggle — only shown when the active stream actually
            carries audio (Phase 3a). Defaults to muted because the
            browser blocks autoplay-with-sound until the user clicks. */}
        {stream.audioAvailable && (
          <button
            type="button"
            onClick={() => onMutedChange(!muted)}
            disabled={!isRunning || stream.status !== "ready"}
            title={muted ? "Unmute preview" : "Mute preview"}
            aria-label={muted ? "Unmute preview" : "Mute preview"}
            aria-pressed={!muted}
            className="btn-press flex h-6 w-6 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
          >
            {muted ? <FiVolumeX size={12} /> : <FiVolume2 size={12} />}
          </button>
        )}

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
        {/* Phase 4 (#130): WebRTC remote stream uses the same <video>
            element as the H.264 / MSE path — only the upstream pipe
            differs. JPEG fallback still renders to <canvas>.
            `stream.mode` is driven by capability detection + sticky
            runtime fallback. */}
        {stream.mode === "video-rtc" || stream.mode === "video" ? (
          <video
            ref={videoRef}
            className="h-full w-full cursor-default bg-white outline-none touch-none select-none"
            autoPlay
            muted
            playsInline
            tabIndex={0}
            aria-label={`Live preview on port ${port}`}
          />
        ) : (
          <canvas
            ref={canvasRef}
            className="h-full w-full cursor-default bg-white outline-none touch-none select-none"
            tabIndex={0}
            aria-label={`Live preview on port ${port}`}
          />
        )}
        {/* Phase 3c (#128): blue overlay shown while a file is dragged
            over the preview. pointer-events-none lets the underlying
            <video>/<canvas> still receive the drag events; the hook
            owns the actual drop handling. */}
        {stream.dragOver && (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-blue-500/15 ring-2 ring-inset ring-dashed ring-blue-400"
            aria-hidden="true"
          >
            <p className="rounded-md bg-blue-500/90 px-3 py-1.5 text-[12px] font-semibold text-white shadow-lg">
              Drop file to upload
            </p>
          </div>
        )}
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
