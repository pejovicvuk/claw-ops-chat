"use client";

import { useCallback, useMemo, useState } from "react";
import { FiPlus, FiRefreshCw, FiSearch, FiSettings, FiX } from "react-icons/fi";
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

  // Local-only search filter for the chats list. Lives in component
  // state (not URL) on purpose — it's transient input that shouldn't
  // round-trip through history or be shareable. State resets naturally
  // each time the mobile drawer remounts. Case-insensitive substring
  // match against `session.display`; could later widen to first-message
  // content, but display titles are usually descriptive enough.
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const filteredSessions = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.display.toLowerCase().includes(q));
  }, [sessions, chatSearchQuery]);
  const noChatMatches =
    mode === "chats" &&
    !!chatSearchQuery.trim() &&
    sessions.length > 0 &&
    filteredSessions.length === 0;

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

      {/* Search bar — chats mode only, hidden until there's something to
          search. Sits OUTSIDE the scroll container so it stays visible
          while the user scrolls the list. `type="search"` lets the
          browser render its native clear-X / Esc-clear affordance; we
          add an explicit clear button + onKeyDown for cross-browser
          consistency (Firefox doesn't always honor Esc on search inputs). */}
      {mode === "chats" && sessions.length > 0 && (
        <div className="shrink-0 border-b border-canvas-border px-3 py-2">
          <div className="relative">
            <FiSearch
              size={11}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-canvas-muted"
            />
            <input
              type="search"
              value={chatSearchQuery}
              onChange={(e) => setChatSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setChatSearchQuery("");
              }}
              placeholder="Search chats..."
              aria-label="Search conversations"
              className="w-full rounded-md border border-canvas-border bg-canvas-surface-hover/40 py-1.5 pl-7 pr-7 text-[12px] text-canvas-fg placeholder:text-canvas-muted focus:border-accent/40 focus:bg-canvas-surface-hover focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
            />
            {chatSearchQuery && (
              <button
                type="button"
                onClick={() => setChatSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
              >
                <FiX size={10} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {mode === "chats" &&
          (noChatMatches ? (
            <div className="px-2 py-8 text-center">
              <p className="text-[11px] text-canvas-muted">
                No chats match &ldquo;{chatSearchQuery}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setChatSearchQuery("")}
                className="mt-2 rounded-md px-2 py-1 text-[11px] text-accent hover:bg-canvas-surface-hover"
              >
                Clear search
              </button>
            </div>
          ) : (
            <SessionList
              selectedSessionId={selectedSessionId}
              sessions={filteredSessions}
              loading={sessionsLoading}
              onSelectSession={onSelectSession}
              onNewChat={onNewChat}
              onRefresh={onRefreshSessions}
              runningSessionIds={runningSessionIds}
              onDeleteSession={onDeleteSession}
              hideHeader
              hideFooter
            />
          ))}
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
