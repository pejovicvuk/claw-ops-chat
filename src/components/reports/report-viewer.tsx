"use client";

import { useCallback, useEffect, useState } from "react";
import { FiArrowLeft, FiDownload, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import MarkdownRenderer from "@/components/chat/markdown-renderer";
import {
  deleteRun,
  fetchReportContent,
  markRead,
  runJobNow,
  type ReportContentResponse,
} from "@/lib/reports-api";
import { useUrlState } from "@/lib/use-url-state";

interface ReportViewerProps {
  runId: string;
  onOpenSessions?: () => void;
}

/**
 * Renders a generated report's markdown inside the main pane. Marks the
 * run as read after 800ms so a fat-fingered back-tap doesn't silently
 * clear the unread dot.
 */
export function ReportViewer({ runId, onOpenSessions }: ReportViewerProps) {
  const { setParam } = useUrlState();
  const [state, setState] = useState<{
    loading: boolean;
    data: ReportContentResponse | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  // Load the report when runId changes. Kept as an effect that spawns an
  // async task rather than calling the loader synchronously inside the
  // effect body so the lint rule "set-state-in-effect" stays happy.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchReportContent(runId);
        if (!cancelled) setState({ loading: false, data, error: null });
      } catch (err) {
        if (!cancelled) {
          setState({
            loading: false,
            data: null,
            error: err instanceof Error ? err.message : "Failed to load report",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Mark-as-read: 800ms after the view stabilises. If the user backs out
  // before then the timer is cancelled and the dot stays.
  useEffect(() => {
    const t = setTimeout(() => {
      markRead(runId, true).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [runId]);

  const handleBack = useCallback(() => {
    setParam("report", null);
  }, [setParam]);

  const handleDelete = useCallback(async () => {
    if (!confirm("Delete this report and its metadata?")) return;
    try {
      await deleteRun(runId);
      setParam("report", null);
    } catch (err) {
      alert(`Failed to delete: ${(err as Error).message}`);
    }
  }, [runId, setParam]);

  const handleRerun = useCallback(async () => {
    const jobId = state.data?.indexEntry.jobId;
    if (!jobId) return;
    try {
      await runJobNow(jobId);
      alert("Re-run triggered — check the sidebar for progress.");
    } catch (err) {
      alert(`Failed to re-run: ${(err as Error).message}`);
    }
  }, [state.data]);

  const handleDownload = useCallback(() => {
    const content = state.data?.content;
    if (!content) return;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${runId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [runId, state.data]);

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
            <h1 className="truncate text-[14px] font-semibold text-canvas-fg">
              {state.data?.indexEntry.jobName ?? "Report"}
            </h1>
            {state.data?.run && (
              <p className="truncate text-[11px] text-canvas-muted">
                {new Date(state.data.run.startedAt).toLocaleString()} · {state.data.run.status}
                {state.data.run.finishedAt &&
                  ` · ${((state.data.run.finishedAt - state.data.run.startedAt) / 1000).toFixed(
                    1,
                  )}s`}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Re-run job" onClick={handleRerun}>
            <FiRefreshCw size={13} />
          </IconButton>
          <IconButton label="Download" onClick={handleDownload}>
            <FiDownload size={13} />
          </IconButton>
          <IconButton label="Delete" onClick={handleDelete}>
            <FiTrash2 size={13} />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {state.loading && (
            <div className="space-y-2">
              <div className="h-6 w-2/3 animate-pulse rounded bg-canvas-surface-hover" />
              <div className="h-4 w-full animate-pulse rounded bg-canvas-surface-hover" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-canvas-surface-hover" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-canvas-surface-hover" />
            </div>
          )}
          {state.error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-[13px] text-red-900">
              Failed to load report: {state.error}
            </div>
          )}
          {!state.loading && state.data && !state.data.content && (
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-[13px] text-yellow-900">
              No report file was produced by this run.
              {state.data.run?.errorMessage && (
                <p className="mt-2 font-mono text-[12px]">{state.data.run.errorMessage}</p>
              )}
            </div>
          )}
          {state.data?.truncated && (
            <div className="mb-4 rounded-lg border border-canvas-border bg-canvas-surface-hover p-3 text-[11px] text-canvas-muted">
              Showing first 1 MB of a {(state.data.sizeBytes / 1024 / 1024).toFixed(1)} MB report.{" "}
              <button
                type="button"
                onClick={handleDownload}
                className="font-semibold text-accent hover:underline"
              >
                Download full file
              </button>
              .
            </div>
          )}
          {state.data?.content && <MarkdownRenderer text={state.data.content} variant="document" />}
        </div>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
    >
      {children}
    </button>
  );
}
