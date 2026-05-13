"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiAlertCircle,
  FiArrowDown,
  FiArrowLeft,
  FiCheckCircle,
  FiLoader,
  FiSquare,
  FiTerminal,
} from "react-icons/fi";
import { fetchRunLog, stopRun, type RunLogResponse } from "@/lib/reports-api";
import { useUrlState } from "@/lib/use-url-state";
import { TimelineRow } from "./run-timeline";

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
  // Whether the user is currently scrolled away from the bottom. Drives the
  // "Jump to latest" affordance AND tells the auto-scroll effect to stay
  // out of the user's way so they can actually read older events while new
  // ones stream in.
  const [awayFromBottom, setAwayFromBottom] = useState(false);

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

  // Auto-scroll: sample the distance-from-bottom BEFORE applying new content
  // and only snap to bottom if the user was already near it. The previous
  // ref-flag approach was self-defeating — the programmatic scroll to
  // bottom itself fired onScroll, which reset the flag and re-enabled
  // auto-scroll, so every new event yanked the user back down. This
  // version keeps the user wherever they chose to scroll.
  const pendingScrollRef = useRef<"none" | "follow">("none");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      pendingScrollRef.current = "follow";
      // Defer to after the DOM has painted the new rows so scrollHeight is up to date.
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        pendingScrollRef.current = "none";
      });
    }
  }, [state.data?.total]);

  const handleScroll = useCallback(() => {
    // Ignore scroll events triggered by our own programmatic scroll —
    // otherwise we'd immediately think the user is back at the bottom.
    if (pendingScrollRef.current === "follow") return;
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAwayFromBottom(distanceFromBottom > 80);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAwayFromBottom(false);
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
      <header className="pt-safe-top flex shrink-0 items-center justify-between border-b border-canvas-border px-4 pb-3">
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

      <div className="relative flex min-h-0 flex-1">
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
        {awayFromBottom && status === "running" && (
          // Floating "Jump to latest" pill — appears only while the run is
          // live AND the user has scrolled up. Lets them go read older
          // events without the timeline yanking them to the bottom, and
          // gives a one-tap return when they want the latest.
          <button
            type="button"
            onClick={jumpToLatest}
            className="btn-press absolute bottom-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[12px] font-medium text-white shadow-lg hover:opacity-90"
          >
            <FiArrowDown size={12} />
            Jump to latest
          </button>
        )}
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
