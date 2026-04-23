"use client";

import { useUrlState } from "@/lib/use-url-state";
import { ReportsDashboard } from "./reports-dashboard";
import { ReportViewer } from "./report-viewer";

interface ReportsMainPaneProps {
  onOpenSessions?: () => void;
}

/**
 * Router for the main center pane when ?view=reports.
 *
 *   ?report=<runId>  → markdown viewer
 *   (none)           → dashboard with job cards
 *
 * A future iteration adds ?runLog=<runId> for the live-run timeline;
 * for now running runs just open the viewer which shows "still running"
 * state based on the sidecar.
 */
export function ReportsMainPane({ onOpenSessions }: ReportsMainPaneProps) {
  const { params } = useUrlState();
  const reportId = params.get("report");
  if (reportId) {
    return <ReportViewer runId={reportId} onOpenSessions={onOpenSessions} />;
  }
  return <ReportsDashboard onOpenSessions={onOpenSessions} />;
}
