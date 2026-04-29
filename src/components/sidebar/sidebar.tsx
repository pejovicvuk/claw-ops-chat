"use client";

import { useCallback } from "react";
import { FiPlus, FiRefreshCw, FiSettings } from "react-icons/fi";
import { SessionList } from "@/components/chat/session-list";
import { SidebarTabs, type SidebarMode } from "./sidebar-tabs";
import { ReportsList } from "@/components/reports/reports-list";
import { ProjectsList } from "@/components/projects/projects-list";
import { useUrlState } from "@/lib/use-url-state";
import { useReportRuns } from "@/lib/use-reports";
import { useProjects } from "@/lib/use-projects";
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
  // reports/projects area (e.g. a deep-linked report runId or project
  // slug) consistently shows the right list instead of silently falling
  // back to chats.
  const view = params.get("view");
  const sidebarParam = params.get("sidebar");
  const mode: SidebarMode =
    view === "projects" || sidebarParam === "projects"
      ? "projects"
      : view === "reports" || sidebarParam === "reports"
        ? "reports"
        : "chats";
  const selectedReportId = params.get("report");
  const selectedProjectSlug = params.get("project");

  const openSettings = useCallback(() => setParam("settings", "main"), [setParam]);

  // Flip to fast polling while the user is looking at the reports list or
  // the reports view overall — 3s lag vs 30s lag makes running indicators
  // feel live without any WebSocket plumbing.
  const fastPoll = mode === "reports" || view === "reports";
  const {
    feed,
    loading: reportsLoading,
    refresh: refreshReports,
  } = useReportRuns({
    fast: fastPoll,
  });

  const { projects, loading: projectsLoading, refresh: refreshProjects } = useProjects();

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

  const handleNewProject = useCallback(() => {
    setParam("view", "projects");
    setParam("sidebar", "projects");
    setParam("newProject", "1");
  }, [setParam]);

  const handleSelectProject = useCallback(
    (slug: string) => {
      setParam("view", "projects");
      setParam("sidebar", "projects");
      setParam("project", slug);
    },
    [setParam],
  );

  const handleChangeMode = useCallback(
    (next: SidebarMode) => {
      // Clicking a tab must flip BOTH the sidebar list AND the main pane,
      // and clear params scoped to the OTHER sections so deep-link state
      // doesn't bleed across (e.g. a stale ?report= surviving into
      // Projects view).
      if (next === "reports") {
        setParam("sidebar", "reports");
        setParam("view", "reports");
        setParam("project", null);
        setParam("newProject", null);
      } else if (next === "projects") {
        setParam("sidebar", "projects");
        setParam("view", "projects");
        setParam("report", null);
        setParam("newReport", null);
      } else {
        setParam("sidebar", null);
        setParam("view", null);
        setParam("report", null);
        setParam("newReport", null);
        setParam("project", null);
        setParam("newProject", null);
      }
    },
    [setParam],
  );

  const handleRefresh =
    mode === "chats" ? onRefreshSessions : mode === "reports" ? refreshReports : refreshProjects;
  const handlePlus =
    mode === "chats" ? onNewChat : mode === "reports" ? handleNewReport : handleNewProject;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-canvas-border px-3 py-2.5">
        <SidebarTabs mode={mode} onChange={handleChangeMode} unreadReports={feed.unreadCount} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleRefresh}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            aria-label={
              mode === "chats"
                ? "Refresh chats"
                : mode === "reports"
                  ? "Refresh reports"
                  : "Refresh projects"
            }
          >
            <FiRefreshCw size={13} />
          </button>
          <button
            type="button"
            onClick={handlePlus}
            className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-accent hover:bg-canvas-surface-hover"
            aria-label={
              mode === "chats" ? "New chat" : mode === "reports" ? "New report" : "New project"
            }
          >
            <FiPlus size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {mode === "chats" && (
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
        )}
        {mode === "reports" && (
          <ReportsList
            runs={feed.runs}
            selectedRunId={selectedReportId}
            onSelect={handleSelectReport}
            loading={reportsLoading}
          />
        )}
        {mode === "projects" && (
          <ProjectsList
            projects={projects}
            selectedSlug={selectedProjectSlug}
            onSelect={handleSelectProject}
            loading={projectsLoading}
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
