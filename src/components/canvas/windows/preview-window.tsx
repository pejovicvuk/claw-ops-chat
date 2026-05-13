"use client";

import { useContext, useEffect, useState } from "react";
import {
  FiAlertTriangle,
  FiChevronDown,
  FiChevronUp,
  FiExternalLink,
  FiLoader,
  FiPlay,
  FiSquare,
} from "react-icons/fi";
import type { WindowDescriptor } from "../canvas-types";
import { ItemContext } from "../item-context";
import { useDevServer } from "@/lib/dev-server/use-dev-server";
import { frameworkLabel } from "@/lib/dev-server/framework-label";

interface PreviewWindowProps {
  descriptor: WindowDescriptor;
  /** Persist a new port back into the canvas store. */
  onPortChange: (port: number) => void;
  /** Persist a new path back into the canvas store. */
  onPathChange: (path: string) => void;
  /**
   * Phase 2: removed. Kept on the interface so `window-host.tsx` keeps
   * compiling unchanged. Streaming-quality state is no longer surfaced
   * in the UI; the field stays in `descriptor.state` but is ignored.
   */
  onQualityChange: (quality: "performance" | "balanced" | "quality") => void;
  /** Phase 2: removed. See `onQualityChange`. */
  onMutedChange: (muted: boolean) => void;
  /** Phase 2: removed. See `onQualityChange`. */
  onZoomChange: (zoom: number) => void;
}

/**
 * Launcher for a localhost dev server, paired with the path-based
 * reverse proxy at `${BASE_PATH}/preview/<port>/`. The user clicks
 * Start to spawn `npm run dev`, then clicks "Open in browser" to view
 * the running app in a new tab via the proxy.
 *
 * Two subsystems:
 *   1. Dev-server lifecycle (Start / Stop) — `useDevServer` hook
 *   2. Item-scoped cwd — `ItemContext` tells us which folder to spawn in
 *
 * Phase 1 removed the in-app Chromium streaming preview; the proxy URL
 * is the only viewing surface. The streaming code under
 * `src/lib/preview-stream/` is dead and slated for Phase 2 deletion.
 */

const PORT_MIN = 1024;
const PORT_MAX = 65535;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/chat";

export function PreviewWindow({ descriptor, onPortChange, onPathChange }: PreviewWindowProps) {
  if (descriptor.state.kind !== "preview") return null;
  const { port, path } = descriptor.state;
  return (
    <PreviewWindowBody
      port={port}
      path={path ?? "/"}
      onPortChange={onPortChange}
      onPathChange={onPathChange}
    />
  );
}

function PreviewWindowBody({
  port,
  path,
  onPortChange,
  onPathChange,
}: {
  port: number;
  path: string;
  onPortChange: (port: number) => void;
  onPathChange: (path: string) => void;
}) {
  const item = useContext(ItemContext);
  const projectSlug = item?.projectSlug ?? "";
  const itemSlug = item?.itemSlug ?? "";

  const { status, runningServer, framework, recentLogs, lastError, start, stop } = useDevServer({
    projectSlug,
    itemSlug,
    port,
  });

  const isRunning = status === "running";

  const [draftPort, setDraftPort] = useState(String(port));
  const [portError, setPortError] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState(path);
  const [logsOpen, setLogsOpen] = useState(false);

  // Sync drafts when the descriptor changes externally (e.g. canvas
  // hydration). Phase 1: no in-page navigation reconciliation, so
  // path can't change mid-typing — sync unconditionally.
  useEffect(() => {
    setDraftPort(String(port));
  }, [port]);
  useEffect(() => {
    setDraftPath(path);
  }, [path]);

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
  };

  // URL derived from draftPath (not committed `path`) so the user can
  // type and click Open without first blurring the input. The input's
  // onBlur=commitPath still fires on the click and persists the path.
  const normalizedPath = (() => {
    let p = draftPath.trim();
    if (!p) return "/";
    if (!p.startsWith("/")) p = "/" + p;
    return p;
  })();
  const openUrl = `${BASE_PATH}/preview/${port}${normalizedPath}`;

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

        {/* Path input — appended to the proxy URL when the user clicks Open. */}
        <span className="text-[11px] font-medium text-canvas-muted">/</span>
        <input
          id={`preview-path-${port}`}
          type="text"
          value={draftPath === "/" ? "" : draftPath.replace(/^\//, "")}
          placeholder="path/to/page"
          onChange={(e) => setDraftPath("/" + e.target.value.replace(/^\//, ""))}
          onBlur={commitPath}
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

        {/* Open in browser — primary action. Disabled until the dev
            server is running; click forwards to the path-based proxy
            in a new tab. */}
        <a
          href={openUrl}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!isRunning || undefined}
          onClick={(e) => {
            if (!isRunning) e.preventDefault();
          }}
          title={isRunning ? "Open the dev server in a new tab" : "Start the dev server first"}
          className="btn-press flex h-6 items-center gap-1 rounded bg-accent px-2 text-[11px] font-semibold text-white aria-disabled:pointer-events-none aria-disabled:opacity-40"
        >
          <FiExternalLink size={11} />
          Open in browser
        </a>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
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
        {isRunning && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-canvas-bg px-6 text-center">
            <FiExternalLink size={24} className="text-accent" />
            <p className="text-[13px] font-medium text-canvas-fg">Dev server running on :{port}</p>
            <a
              href={openUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-press rounded-md bg-accent px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90"
            >
              Open in browser
            </a>
            <code className="rounded bg-canvas-surface px-2 py-1 font-mono text-[11px] text-canvas-muted">
              {openUrl}
            </code>
            <p className="max-w-xs text-[11px] text-canvas-muted">
              HMR works automatically in the opened tab. Hot reload routes through the same proxy at{" "}
              <code className="font-mono">
                {BASE_PATH}/preview/{port}/
              </code>
              .
            </p>
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
