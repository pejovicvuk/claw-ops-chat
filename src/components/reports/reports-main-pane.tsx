"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchReportContent, type ReportContentResponse } from "@/lib/reports-api";
import { useUrlState } from "@/lib/use-url-state";
import { ReportsDashboard } from "./reports-dashboard";
import { ReportViewer } from "./report-viewer";
import { LiveRunViewer } from "./live-run-viewer";

interface ReportsMainPaneProps {
  onOpenSessions?: () => void;
}

/**
 * Router for the main center pane when ?view=reports.
 *
 *   (no ?report)            → dashboard with job cards
 *   ?report=<runId>, running → live timeline (LiveRunViewer)
 *   ?report=<runId>, finished → markdown viewer (ReportViewer)
 *
 * The live/static split is decided by a light HEAD-like fetch against
 * /api/reports/runs/[runId] so we don't need to duplicate the state in
 * URL — the server is authoritative for status.
 */
export function ReportsMainPane({ onOpenSessions }: ReportsMainPaneProps) {
  const { params } = useUrlState();
  const reportId = params.get("report");

  if (reportId) {
    return <ReportRouter runId={reportId} onOpenSessions={onOpenSessions} />;
  }
  return <ReportsDashboard onOpenSessions={onOpenSessions} />;
}

/**
 * Fetches the report metadata once to decide live vs. static. If the
 * status is "running", hand off to LiveRunViewer — which will call
 * back with `onComplete` when the poll sees the run terminate, at which
 * point we re-fetch and show ReportViewer.
 */
function ReportRouter({ runId, onOpenSessions }: { runId: string; onOpenSessions?: () => void }) {
  const [meta, setMeta] = useState<ReportContentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchReportContent(runId);
        if (!cancelled) {
          setMeta(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load report");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, reloadKey]);

  const handleComplete = useCallback(() => {
    // Bump the key so the parent re-fetches the metadata and realises the
    // run is no longer "running" — that flips us to ReportViewer below.
    setReloadKey((k) => k + 1);
  }, []);

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-canvas-bg">
        <p className="text-[13px] text-red-500">{error}</p>
      </div>
    );
  }
  if (!meta) {
    // No metadata yet — show the live viewer by default; it handles its
    // own loading state and falls back to an empty timeline gracefully.
    return (
      <LiveRunViewer runId={runId} onOpenSessions={onOpenSessions} onComplete={handleComplete} />
    );
  }

  const status = meta.run?.status ?? meta.indexEntry.status;
  if (status === "running") {
    return (
      <LiveRunViewer runId={runId} onOpenSessions={onOpenSessions} onComplete={handleComplete} />
    );
  }
  return <ReportViewer runId={runId} onOpenSessions={onOpenSessions} />;
}
