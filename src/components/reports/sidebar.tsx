"use client";

import { useCallback } from "react";
import { FiPlus, FiRefreshCw, FiSettings } from "react-icons/fi";
import { SessionList } from "@/components/chat/session-list";
import { SidebarTabs, type SidebarMode } from "./sidebar-tabs";
import { ReportsList } from "./reports-list";
import { useUrlState } from "@/lib/use-url-state";
import { useReportRuns } from "@/lib/use-reports";
import type { ChatSession } from "@/lib/types";

interface SidebarProps {
  // Chat props — forwarded to SessionList when mode=chats
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onRefreshSessions: () => void;
  sessionsLoading: boolean;
  runningSessionIds?: Set<string>;
  /** Forwarded to SessionList — enables the Delete context-menu item. */
  onDeleteSession?: (sessionId: string) => Promise<void>;
}

/**
 * Wraps the sidebar with a Chats/Reports segmented toggle. Delegates list
 * rendering to either SessionList (unchanged) or ReportsList based on
 * `?sidebar=` URL state.
 *
 * The +/refresh buttons and settings footer live here so they can be
 * context-aware without pushing that concern into SessionList (which is
 * already complex enough managing chat session status dots).
 */
export function Sidebar({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewChat,
  onRefreshSessions,
  sessionsLoading,
  runningSessionIds,
  onDeleteSession,
}: SidebarProps) {
  const { params, setParam } = useUrlState();
  // Derive mode from BOTH ?view and ?sidebar so any URL that targets the
  // reports area (e.g. a deep-linked report runId) consistently shows the
  // reports list instead of silently falling back to chats.
  const mode: SidebarMode =
    params.get("view") === "reports" || params.get("sidebar") === "reports" ? "reports" : "chats";
  const selectedReportId = params.get("report");

  const openSettings = useCallback(() => setParam("settings", "main"), [setParam]);

  // Flip to fast polling while the user is looking at the reports list or
  // the reports view overall — 3s lag vs 30s lag makes running indicators
  // feel live without any WebSocket plumbing.
  const fastPoll = mode === "reports" || params.get("view") === "reports";
  const {
    feed,
    loading: reportsLoading,
    refresh: refreshReports,
  } = useReportRuns({
    fast: fastPoll,
  });

  const handleNewReport = useCallback(() => {
    // Navigate to Reports view + open the New Job drawer. The
    // ReportsDashboard honors ?newReport=1.
    setParam("view", "reports");
    setParam("sidebar", "reports");
    setParam("newReport", "1");
  }, [setParam]);

  const handleSelectReport = useCallback(
    (runId: string) => {
      setParam("view", "reports");
      setParam("sidebar", "reports");
      setParam("report", runId);
    },
    [setParam],
  );

  const handleChangeMode = useCallback(
    (next: SidebarMode) => {
      if (next === "reports") {
        // Clicking the Reports tab must flip BOTH the sidebar list AND
        // the main pane — the previous behavior (only setting ?sidebar)
        // left the main pane on chat, which users correctly perceived as
        // broken: "I clicked Reports but nothing happened."
        setParam("sidebar", "reports");
        setParam("view", "reports");
      } else {
        // Leaving reports clears every reports-scoped URL param so a
        // stale ?report=… doesn't resurrect on the next switch-back.
        setParam("sidebar", null);
        setParam("view", null);
        setParam("report", null);
        setParam("newReport", null);
      }
    },
    [setParam],
  );

  const handleRefresh = mode === "chats" ? onRefreshSessions : refreshReports;
  const handlePlus = mode === "chats" ? onNewChat : handleNewReport;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-canvas-border px-3 py-2.5">
        <SidebarTabs mode={mode} onChange={handleChangeMode} unreadReports={feed.unreadCount} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleRefresh}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            aria-label={mode === "chats" ? "Refresh chats" : "Refresh reports"}
          >
            <FiRefreshCw size={13} />
          </button>
          <button
            type="button"
            onClick={handlePlus}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-accent hover:bg-canvas-surface-hover"
            aria-label={mode === "chats" ? "New chat" : "New report"}
          >
            <FiPlus size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {mode === "chats" ? (
          <SessionList
            selectedSessionId={selectedSessionId}
            sessions={sessions}
            loading={sessionsLoading}
            onSelectSession={onSelectSession}
            onNewChat={onNewChat}
            onRefresh={onRefreshSessions}
            runningSessionIds={runningSessionIds}
            onDeleteSession={onDeleteSession}
            hideHeader
            hideFooter
          />
        ) : (
          <ReportsList
            runs={feed.runs}
            selectedRunId={selectedReportId}
            onSelect={handleSelectReport}
            loading={reportsLoading}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-canvas-border px-2 py-2">
        <button
          type="button"
          onClick={openSettings}
          className="row-hover focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          <FiSettings size={14} />
          Settings
        </button>
      </div>
    </div>
  );
}
