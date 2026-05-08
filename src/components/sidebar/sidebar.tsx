"use client";

import { useCallback } from "react";
import { FiRefreshCw, FiSettings } from "react-icons/fi";
import { SessionList } from "@/components/chat/session-list";
import { SidebarNav, type NavSection } from "./sidebar-nav";
import { useUrlState } from "@/lib/use-url-state";
import { useReportRuns } from "@/lib/use-reports";
import type { ChatSession } from "@/lib/types";

interface SidebarProps {
  // Chat props — forwarded to SessionList
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onRefreshSessions: () => void;
  sessionsLoading: boolean;
  runningSessionIds?: Set<string>;
  /** Forwarded to SessionList — enables the Delete context-menu item. */
  onDeleteSession?: (sessionId: string) => Promise<void>;
  /** Optional hook fired after a top-level nav change (Projects /
   *  Reports / Agents / Chats / New). The mobile drawer uses this to
   *  auto-close when the user picks a section so the new pane is
   *  visible without an extra tap. */
  onAfterNavigate?: () => void;
}

/**
 * Sidebar shell: Perplexity-style icon-row navigation at the top
 * (New / Projects / Reports / Agents / Chats) with the recent chat
 * history list always visible below.
 *
 * The dedicated detailed search lives on the new Chats page
 * (`?view=chats`); the sidebar list is a quick recents jumper without
 * its own search field.
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
  onAfterNavigate,
}: SidebarProps) {
  const { params, setParam } = useUrlState();
  const view = params.get("view");
  const active: NavSection | null =
    view === "projects"
      ? "projects"
      : view === "reports"
        ? "reports"
        : view === "agents"
          ? "agents"
          : view === "chats"
            ? "chats"
            : null;

  const openSettings = useCallback(() => setParam("settings", "main"), [setParam]);

  // Reports unread badge — keep the existing fast-poll gate so the
  // count stays roughly live without a WebSocket. We only need
  // `unreadCount` here, no list rendering.
  const fastPoll = view === "reports";
  const { feed } = useReportRuns({ fast: fastPoll });

  const handleNew = useCallback(() => {
    // Clear any view scoping params so the chat surface always wins,
    // then start a fresh chat. page.tsx:handleNewChat also clears these
    // (defense in depth) — duplicating here keeps the sidebar self-
    // contained for any future caller of `onNewChat`.
    setParam("view", null);
    setParam("project", null);
    setParam("report", null);
    setParam("newProject", null);
    setParam("newReport", null);
    setParam("sidebar", null);
    onNewChat();
    onAfterNavigate?.();
  }, [setParam, onNewChat, onAfterNavigate]);

  const handleNavigate = useCallback(
    (section: NavSection) => {
      // Centralised section routing. Each branch clears params owned
      // by *other* sections so deep-link state can't bleed across
      // (a stale `?report=` shouldn't survive into Projects view).
      setParam("view", section);
      setParam("sidebar", section);
      if (section === "projects") {
        setParam("report", null);
        setParam("newReport", null);
      } else if (section === "reports") {
        setParam("project", null);
        setParam("newProject", null);
      } else {
        setParam("project", null);
        setParam("report", null);
        setParam("newProject", null);
        setParam("newReport", null);
      }
      onAfterNavigate?.();
    },
    [setParam, onAfterNavigate],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarNav
        active={active}
        onNew={handleNew}
        onNavigate={handleNavigate}
        unreadReports={feed.unreadCount}
      />

      {/* Divider between the nav block and the history block. Same hairline
          as the rest of the app's section separators. */}
      <div className="mx-3 mb-1 mt-1 border-t border-canvas-border" aria-hidden="true" />

      {/* History header — small caption + refresh button. The detailed
          search experience lives on the dedicated Chats page; this list
          is a quick-jump recents view only. */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-canvas-muted">
          History
        </span>
        <button
          type="button"
          onClick={onRefreshSessions}
          className="btn-press flex h-6 w-6 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          aria-label="Refresh chats"
        >
          <FiRefreshCw size={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
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
