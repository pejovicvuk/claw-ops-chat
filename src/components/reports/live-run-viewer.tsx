"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiAlertCircle,
  FiArrowLeft,
  FiCheckCircle,
  FiLoader,
  FiSquare,
  FiTerminal,
} from "react-icons/fi";
import { fetchRunLog, stopRun, type RunLogEvent, type RunLogResponse } from "@/lib/reports-api";
import { useUrlState } from "@/lib/use-url-state";

interface LiveRunViewerProps {
  runId: string;
  onOpenSessions?: () => void;
  /** Called when the run finishes so the parent can swap to the ReportViewer. */
  onComplete?: () => void;
}

const POLL_MS = 1500;

/**
 * Live timeline of a cron run in progress. Polls the log endpoint every
 * 1.5s, renders each SDK event (tool_use, text_delta, result) as a
 * timeline row with optional expand-to-inspect-input.
 *
 * When the run transitions out of "running" the poller stops and the
 * parent is notified so it can route to the completed ReportViewer.
 */
export function LiveRunViewer({ runId, onOpenSessions, onComplete }: LiveRunViewerProps) {
  const { setParam } = useUrlState();
  const [state, setState] = useState<{
    loading: boolean;
    data: RunLogResponse | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });
  const [stopping, setStopping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTotal = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchRunLog(runId);
      setState({ loading: false, data, error: null });
      lastTotal.current = data.total;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load run log",
      }));
    }
  }, [runId]);

  // Initial load + poll loop. The poll stops once the status leaves
  // "running" — at that point we fire onComplete and the parent swaps
  // to the finished-run viewer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchRunLog(runId);
        if (cancelled) return;
        setState({ loading: false, data, error: null });
        lastTotal.current = data.total;
        if (data.status && data.status !== "running") {
          onComplete?.();
          return;
        }
        timerRef.current = setInterval(async () => {
          try {
            const next = await fetchRunLog(runId);
            if (cancelled) return;
            setState({ loading: false, data: next, error: null });
            lastTotal.current = next.total;
            if (next.status && next.status !== "running") {
              if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
              }
              onComplete?.();
            }
          } catch {
            /* transient error — next tick retries */
          }
        }, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          data: null,
          error: err instanceof Error ? err.message : "Failed to load run log",
        });
      }
    })();
    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [runId, onComplete]);

  // Auto-scroll to bottom unless the user scrolled up — same "read-along"
  // pattern the chat view uses so a live run feels natural to follow.
  useEffect(() => {
    if (userScrolledRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.data?.total]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledRef.current = distanceFromBottom > 80;
  }, []);

  const handleBack = useCallback(() => setParam("report", null), [setParam]);

  const handleStop = useCallback(async () => {
    if (!confirm("Stop this run? Any partial report stays on disk.")) return;
    setStopping(true);
    try {
      await stopRun(runId);
      await load();
    } catch (err) {
      alert(`Failed to stop: ${(err as Error).message}`);
    } finally {
      setStopping(false);
    }
  }, [runId, load]);

  const status = state.data?.status ?? null;
  const events = state.data?.events ?? [];
  const runName = state.data?.run?.jobId ?? "Run";
  const startedAt = state.data?.run?.startedAt;
  const elapsed = startedAt ? ((Date.now() - startedAt) / 1000).toFixed(1) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas-bg">
      <header className="flex shrink-0 items-center justify-between border-b border-canvas-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenSessions ?? handleBack}
            className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            aria-label="Back"
          >
            <FiArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FiTerminal size={13} className="text-canvas-muted" />
              <h1 className="truncate text-[14px] font-semibold text-canvas-fg">{runName}</h1>
              <StatusBadge status={status} />
            </div>
            <p className="truncate text-[11px] text-canvas-muted">
              {startedAt && <>Started {new Date(startedAt).toLocaleTimeString()} · </>}
              {elapsed !== null && status === "running" ? `${elapsed}s elapsed` : null}
              {status !== "running" && state.data?.run?.finishedAt && (
                <>
                  Finished {new Date(state.data.run.finishedAt).toLocaleTimeString()} (
                  {((state.data.run.finishedAt - (startedAt || 0)) / 1000).toFixed(1)}s)
                </>
              )}
            </p>
          </div>
        </div>
        {status === "running" && (
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-1.5 text-[12px] text-canvas-fg hover:bg-canvas-surface-hover disabled:opacity-50"
          >
            <FiSquare size={12} />
            {stopping ? "Stopping…" : "Stop run"}
          </button>
        )}
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl">
          {state.loading && (
            <div className="space-y-2">
              <div className="h-5 w-1/3 animate-pulse rounded bg-canvas-surface-hover" />
              <div className="h-4 w-full animate-pulse rounded bg-canvas-surface-hover" />
            </div>
          )}
          {state.error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-[12px] text-red-900">
              {state.error}
            </div>
          )}
          {!state.loading && events.length === 0 && (
            <div className="py-8 text-center text-[12px] text-canvas-muted">
              Waiting for Claude to produce the first event…
            </div>
          )}
          <div className="space-y-1.5">
            {events.map((event, idx) => (
              <TimelineRow key={idx} event={event} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === "running") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
        style={{ backgroundColor: "#60a5fa22", color: "#60a5fa" }}
      >
        <FiLoader size={9} className="animate-spin" />
        Running
      </span>
    );
  }
  if (status === "success") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
        style={{ backgroundColor: "#34d39922", color: "#34d399" }}
      >
        <FiCheckCircle size={9} />
        Success
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "#f8717122", color: "#f87171" }}
    >
      <FiAlertCircle size={9} />
      {status}
    </span>
  );
}

function TimelineRow({ event }: { event: RunLogEvent }) {
  const [expanded, setExpanded] = useState(false);
  const time = event.at ? new Date(event.at).toLocaleTimeString() : "";

  const { title, body, expandable, color } = describeEvent(event);

  return (
    <div
      className="rounded-lg border border-canvas-border/50 bg-canvas-surface-hover/30 px-3 py-2 text-[12px]"
      style={color ? { borderLeftColor: color, borderLeftWidth: 3 } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-canvas-fg">{title}</span>
            <span className="text-[10px] text-canvas-muted">{time}</span>
          </div>
          {body && !expandable && (
            <div className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-canvas-muted">
              {body}
            </div>
          )}
          {body && expandable && expanded && (
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-canvas-muted">
              {body}
            </pre>
          )}
        </div>
        {expandable && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-[10px] text-accent hover:underline"
          >
            {expanded ? "hide" : "show"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Translate a raw SDK event into a display-friendly description. The set
 * of event types here matches what server.ts broadcasts (tool_use_start,
 * tool_use_complete, tool_result, text_delta, result, turn_start, turn_end,
 * status, error). Unknown types fall back to a JSON dump.
 */
function describeEvent(event: RunLogEvent): {
  title: string;
  body: string;
  expandable: boolean;
  color: string | null;
} {
  switch (event.type) {
    case "tool_use_start":
    case "tool_use_complete": {
      const name = (event.name as string) || "Tool";
      const input = event.input;
      const body = typeof input === "object" ? JSON.stringify(input, null, 2) : String(input ?? "");
      return {
        title: `${event.type === "tool_use_start" ? "→" : "✓"} ${name}`,
        body,
        expandable: body.length > 120,
        color: "#c084fc",
      };
    }
    case "tool_result": {
      const content = String(event.content ?? "");
      const isError = Boolean(event.isError);
      return {
        title: isError ? "⚠ Tool error" : "← Tool result",
        body: content,
        expandable: content.length > 200,
        color: isError ? "#f87171" : "#34d399",
      };
    }
    case "text_delta":
      return {
        title: "Assistant text",
        body: String(event.text ?? ""),
        expandable: false,
        color: "#60a5fa",
      };
    case "turn_start":
      return { title: "Turn started", body: "", expandable: false, color: "#60a5fa" };
    case "turn_end":
      return {
        title: event.isError ? "Turn ended with error" : "Turn complete",
        body: "",
        expandable: false,
        color: event.isError ? "#f87171" : "#34d399",
      };
    case "result":
      return {
        title: event.isError ? "Run failed" : "Run complete",
        body: String(event.text ?? ""),
        expandable: true,
        color: event.isError ? "#f87171" : "#34d399",
      };
    case "status":
      return {
        title: `Status: ${event.status ?? "?"}`,
        body: "",
        expandable: false,
        color: null,
      };
    case "error":
      return {
        title: "Error",
        body: String(event.message ?? JSON.stringify(event)),
        expandable: true,
        color: "#f87171",
      };
    default:
      return {
        title: event.type,
        body: JSON.stringify(event, null, 2),
        expandable: true,
        color: null,
      };
  }
}
